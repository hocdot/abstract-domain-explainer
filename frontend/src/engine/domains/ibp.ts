// Interval Bound Propagation, traced neuron by neuron.
//
// The bounds come from the engine (core PerturbInterval, center/radius form).
// The explanation re-derives each neuron with the textbook endpoint rule
//
//     lower(z_j) = b_j + sum_i  w_ji * (lower(x_i) if w_ji >= 0 else upper(x_i))
//     upper(z_j) = b_j + sum_i  w_ji * (upper(x_i) if w_ji >= 0 else lower(x_i))
//
// and a Check reports how far the two derivations are apart.
import type { Step } from '../../types.ts'
import { PerturbInterval } from '../core/interval.ts'
import { type Domain, reluStatus, stageLayout, toBounds } from './base.ts'

function affineDetail(W: number[][], b: number[], j: number, prev: PerturbInterval, out: PerturbInterval) {
  const [pl, pu] = [prev.lower, prev.upper]
  const terms = W[j].map((w, i) => {
    const [l, u] = [pl[i], pu[i]]
    const [loVal, hiVal] = w >= 0 ? [l, u] : [u, l]
    return {
      source: i, weight: w,
      lower_pick: w >= 0 ? 'lower' : 'upper', lower_value: loVal, lower_contrib: w * loVal,
      upper_pick: w >= 0 ? 'upper' : 'lower', upper_value: hiVal, upper_contrib: w * hiVal,
    }
  })
  const bias = b[j]
  return {
    bias,
    terms,
    textbook: {
      lower: bias + terms.reduce((s, t) => s + t.lower_contrib, 0),
      upper: bias + terms.reduce((s, t) => s + t.upper_contrib, 0),
    },
    // the engine's own view of the same neuron
    center: out.center[j],
    radius: out.radii[j],
  }
}

/** Python-style `f'{x:.1e}'`, e.g. 3.0e-17 */
const sci = (x: number) => x.toExponential(1).replace(/e([+-])(\d)$/, 'e$10$2')

export const IBP: Domain = {
  key: 'ibp',
  name: 'Interval Bound Propagation',
  short: 'IBP',
  summary: 'Push a box through the network one layer at a time, bounding every neuron by an interval.',

  analyze(net, box) {
    const stages = stageLayout(net)
    let value = PerturbInterval.fromBounds(box.lower, box.upper)
    stages[0].bounds = toBounds(value.lower, value.upper)
    const steps: Step[] = [{ kind: 'input', stage: 0, neuron: null, detail: {} }]

    let worst = 0
    let s = 1
    for (const layer of net.layers) {
      const { weight: W, bias: b } = layer
      const prev = value
      value = value.linear(W, b)
      const pre = value
      const z = s
      stages[z].bounds = toBounds(value.lower, value.upper)
      s += 1
      const relu = layer.activation === 'relu'
      if (relu) {
        value = value.relu()
        stages[s].bounds = toBounds(value.lower, value.upper)
        s += 1
      }

      // layer by layer: every weighted sum of the layer, then every ReLU
      for (let j = 0; j < b.length; j++) {
        const detail = affineDetail(W, b, j, prev, pre)
        worst = Math.max(worst,
          Math.abs(detail.textbook.lower - detail.center + detail.radius),
          Math.abs(detail.textbook.upper - detail.center - detail.radius))
        steps.push({ kind: 'ibp.affine', stage: z, neuron: j, detail })
      }
      if (relu) {
        const [pl, pu] = [pre.lower, pre.upper]
        for (let j = 0; j < b.length; j++) {
          steps.push({ kind: 'ibp.relu', stage: z + 1, neuron: j, detail: {
            pre: { lower: pl[j], upper: pu[j] },
            status: reluStatus(pl[j], pu[j]),
          } })
        }
      }
    }

    steps.push({ kind: 'output', stage: stages.length - 1, neuron: null, detail: {} })
    const check = {
      label: 'Engine matches the textbook rule',
      detail: `engine vs. the endpoint rule above, max difference ${sci(worst)}`,
      ok: worst <= 1e-9,
    }
    return { domain: this.key, stages, steps, checks: [check] }
  },
}
