// DeepPoly / CROWN, traced neuron by neuron.
//
// For every weighted-sum neuron we record the full back-substitution of its lower
// and upper bound: the starting expression, then one entry per substituted layer
// (which ReLU line or weighted-sum definition replaced each term, and the
// simplified result), then how the box is plugged in. Every stage also gets its
// linear bounds over the inputs (Stage.linear). IBP's interval is included
// for comparison.
import type { LinBound, LinearBounds, Side, Step } from '../../types.ts'
import { type LinExpr, type Op, backSubstitute, reluRelaxation } from '../core/deeppoly.ts'
import { PerturbInterval } from '../core/interval.ts'
import { type Domain, reluStatus, stageLayout, toBounds } from './base.ts'

const EPS = 1e-12

const lin = (e: LinExpr): LinBound => ({ coeffs: e.coeffs, const: e.const })
const nonzero = (coeffs: number[]) => coeffs.some((c) => Math.abs(c) >= EPS)

/** Turn a back-substitution chain into steps a reader can follow. */
function explain(chain: LinExpr[], ops: Op[], side: Side, box: [number[], number[]], value: number) {
  const steps: Record<string, unknown>[] = [
    { op: 'start', stage: chain[0].stage, coeffs: chain[0].coeffs, const: chain[0].const },
  ]
  for (let k = 1; k < chain.length; k++) {
    const [prev, cur] = [chain[k - 1], chain[k]]
    if (!nonzero(prev.coeffs)) break // already a constant: nothing left to substitute
    const t = prev.stage // the stage being substituted away
    const op = ops[t]!
    const uses: Record<string, unknown>[] = []
    prev.coeffs.forEach((c, i) => {
      if (Math.abs(c) < EPS) return
      if (op.kind === 'relu') {
        // everything needed to explain this term without looking elsewhere:
        // the ReLU's input interval, both of its lines, and which one is used
        const { r } = op
        const [pl, pu] = [op.lower[i], op.upper[i]]
        uses.push({
          neuron: i, coef: c,
          line: (c >= 0) === (side === 'lower') ? 'lower' : 'upper',
          pre: { lower: pl, upper: pu },
          status: reluStatus(pl, pu),
          lower: { slope: r.lowerSlope[i], bias: r.lowerBias[i] },
          upper: { slope: r.upperSlope[i], bias: r.upperBias[i] },
        })
      } else {
        uses.push({ neuron: i, coef: c, weights: op.W[i], bias: op.b[i] })
      }
    })
    steps.push({
      op: op.kind === 'relu' ? 'relax' : 'expand',
      replaced: t, stage: cur.stage, uses,
      coeffs: cur.coeffs, const: cur.const,
    })
  }

  const last = chain[steps.length - 1]
  const [l, u] = box
  const terms: Record<string, unknown>[] = []
  last.coeffs.forEach((c, i) => {
    if (Math.abs(c) < EPS) return
    const pick = (c >= 0) === (side === 'lower') ? 'lower' : 'upper'
    terms.push({ input: i, coef: c, pick, value: pick === 'lower' ? l[i] : u[i] })
  })
  return { steps, box: { terms, const: last.const }, value }
}

export const DeepPoly: Domain = {
  key: 'deeppoly',
  name: 'DeepPoly / CROWN',
  short: 'DeepPoly / CROWN',
  summary: 'Keep a linear lower and upper bound for every neuron, and substitute them back to the inputs.',

  analyze(net, inputBox) {
    const stages = stageLayout(net)
    const box: [number[], number[]] = [inputBox.lower, inputBox.upper]
    const [l0, u0] = box
    const nIn = l0.length
    stages[0].bounds = toBounds(l0, u0)
    const eye = (i: number, n: number) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0))
    stages[0].linear = l0.map((_, i) => ({
      lower: { coeffs: eye(i, nIn), const: 0 },
      upper: { coeffs: eye(i, nIn), const: 0 },
    }))
    const steps: Step[] = [{ kind: 'input', stage: 0, neuron: null, detail: {} }]

    const ops: Op[] = [null] // ops[t]: how stage t depends on stage t-1
    let ibp = PerturbInterval.fromBounds(l0, u0)

    let s = 1
    for (const layer of net.layers) {
      const { weight: W, bias: b } = layer
      const width = b.length
      let ibpZ = ibp.linear(W, b)
      const [ibpL, ibpU] = [ibpZ.lower, ibpZ.upper]
      ops.push({ kind: 'affine', W, b })
      const z = s
      const details: Record<string, unknown>[] = []
      const zl: number[] = []
      const zu: number[] = []
      const linear: LinearBounds[] = []
      for (let j = 0; j < width; j++) {
        const [lowChain, low] = backSubstitute(ops, z, W[j], b[j], 'lower', box)
        const [upChain, up] = backSubstitute(ops, z, W[j], b[j], 'upper', box)
        zl.push(low)
        zu.push(up)
        linear.push({ lower: lin(lowChain[lowChain.length - 1]), upper: lin(upChain[upChain.length - 1]) })
        details.push({
          lower: explain(lowChain, ops, 'lower', box, low),
          upper: explain(upChain, ops, 'upper', box, up),
          ibp: { lower: ibpL[j], upper: ibpU[j] },
        })
      }
      stages[z].bounds = toBounds(zl, zu)
      stages[z].linear = linear
      s += 1

      const relu = layer.activation === 'relu'
      const r = reluRelaxation(zl, zu)
      const hWalks: Record<string, unknown>[] = []
      if (relu) {
        ops.push({ kind: 'relu', r, lower: zl, upper: zu })
        stages[s].bounds = toBounds(zl.map((v) => Math.max(v, 0)), zu.map((v) => Math.max(v, 0)))
        stages[s].relax = zl.map((_, j) => ({
          lower: { slope: r.lowerSlope[j], bias: r.lowerBias[j] },
          upper: { slope: r.upperSlope[j], bias: r.upperBias[j] },
        }))
        // linear bounds of h over the inputs: back-substitute h_j on its own,
        // starting from h_j itself (so the first substitution is its own line)
        const hLinear: LinearBounds[] = []
        for (let j = 0; j < width; j++) {
          const e = eye(j, width)
          const [hl, hlVal] = backSubstitute(ops, s + 1, e, 0, 'lower', box)
          const [hu, huVal] = backSubstitute(ops, s + 1, e, 0, 'upper', box)
          hLinear.push({ lower: lin(hl[hl.length - 1]), upper: lin(hu[hu.length - 1]) })
          hWalks.push({
            lower: explain(hl, ops, 'lower', box, hlVal),
            upper: explain(hu, ops, 'upper', box, huVal),
          })
        }
        stages[s].linear = hLinear
        ibpZ = ibpZ.relu()
        s += 1
      }
      ibp = ibpZ

      // layer by layer: every weighted sum of the layer, then every ReLU
      for (let j = 0; j < width; j++)
        steps.push({ kind: 'deeppoly.affine', stage: z, neuron: j, detail: details[j] })
      if (relu) {
        for (let j = 0; j < width; j++) {
          steps.push({ kind: 'deeppoly.relu', stage: z + 1, neuron: j, detail: {
            pre: { lower: zl[j], upper: zu[j] },
            status: reluStatus(zl[j], zu[j]),
            relax: {
              lower: { slope: r.lowerSlope[j], bias: r.lowerBias[j] },
              upper: { slope: r.upperSlope[j], bias: r.upperBias[j] },
            },
            ...hWalks[j], // lower / upper: back-substitution of h_j to the inputs
          } })
        }
      }
    }

    const out = stages[stages.length - 1]
    const [il, iu] = [ibp.lower, ibp.upper]
    steps.push({ kind: 'output', stage: out.index, neuron: null, detail: {
      ibp: il.map((l, i) => ({ lower: l, upper: iu[i] })),
    } })
    return { domain: this.key, stages, steps, checks: [] }
  },
}
