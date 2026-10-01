// Domain interface and the stage layout every domain shares.
import type { Bounds, DomainInfo, InputBox, Network, Stage, Trace } from '../../types.ts'
import { forwardStages } from '../netspec.ts'
import { sobol } from '../sampling.ts'

export const N_SAMPLES = 4000
export const N_SHOWN = 100

export interface Domain extends DomainInfo {
  analyze(net: Network, box: InputBox): Trace
}

/** `analyze`, then record the range each neuron reaches on sampled inputs. */
export function run(domain: Domain, net: Network, box: InputBox): Trace {
  const trace = domain.analyze(net, box)
  attachSamples(trace, net, box)
  return trace
}

/** Stages with empty bounds: x, then z and h per dense layer, the very last stage named y.
 *  Hidden neurons are numbered on across layers (z₁ z₂ z₃ in layer 1, z₄ … in layer 2), and
 *  each ReLU output takes its input's number (z₄ → h₄). */
export function stageLayout(net: Network): Stage[] {
  const stage = (kind: Stage['kind'], layer: number, letter: string, first: number, size: number): Stage => ({
    index: stages.length, kind, layer, letter, first, size, bounds: [], sampled: [], linear: [], relax: [],
  })
  const stages: Stage[] = []
  stages.push(stage('input', 0, 'x', 0, net.input_dim))
  let first = 0
  net.layers.forEach((layer, k) => {
    stages.push(stage('affine', k + 1, 'z', first, layer.bias.length))
    if (layer.activation === 'relu') stages.push(stage('relu', k + 1, 'h', first, layer.bias.length))
    first += layer.bias.length
  })
  stages[stages.length - 1].letter = 'y'
  stages[stages.length - 1].first = 0
  return stages
}

export const toBounds = (lower: number[], upper: number[]): Bounds[] =>
  lower.map((l, i) => ({ lower: l, upper: upper[i] }))

/** Every corner of the box, the first dimension varying slowest. */
function corners(box: InputBox): number[][] {
  return box.lower.reduce<number[][]>(
    (acc, l, i) => acc.flatMap((c) => [[...c, l], [...c, box.upper[i]]]),
    [[]],
  )
}

/** Run the real network on inputs spread over the box (plus its corners) and store the
 *  range each neuron actually reaches: an inner estimate of its true range, drawn
 *  inside the interval bars to show how loose a bound is. */
export function attachSamples(trace: Trace, net: Network, box: InputBox, n = N_SAMPLES, seed = 0): void {
  const { lower, upper } = box
  const xs = sobol(n, lower.length, seed).map((p) => p.map((t, i) => lower[i] + (upper[i] - lower[i]) * t))
  xs.push(...corners(box))
  const lo = trace.stages.map((s) => new Array<number>(s.size).fill(Infinity))
  const hi = trace.stages.map((s) => new Array<number>(s.size).fill(-Infinity))
  const outputs: number[][] = []
  xs.forEach((x, k) => {
    const values = forwardStages(net, x)
    values.forEach((vals, s) =>
      vals.forEach((v, j) => {
        lo[s][j] = Math.min(lo[s][j], v)
        hi[s][j] = Math.max(hi[s][j], v)
      }),
    )
    if (k < N_SHOWN) outputs.push(values[values.length - 1])
  })
  trace.stages.forEach((stage, s) => (stage.sampled = toBounds(lo[s], hi[s])))
  // a few of the random inputs and their outputs, for the picture on the input step
  if (trace.steps[0]?.kind === 'input')
    trace.steps[0].detail.samples = { inputs: xs.slice(0, Math.min(N_SHOWN, n)), outputs }
}

export function reluStatus(l: number, u: number): 'active' | 'inactive' | 'unstable' {
  if (l >= 0) return 'active'
  if (u <= 0) return 'inactive'
  return 'unstable'
}
