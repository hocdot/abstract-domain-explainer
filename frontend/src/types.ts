// The shapes the engine (src/engine) reads and writes.

export type Activation = 'relu' | 'none'

export interface Dense {
  weight: number[][] // (out, in)
  bias: number[]
  activation: Activation
}

export interface Network {
  input_dim: number
  layers: Dense[]
}

export interface InputBox {
  lower: number[]
  upper: number[]
}

export interface Bounds {
  lower: number
  upper: number
}

export interface Stage {
  index: number
  kind: 'input' | 'affine' | 'relu'
  layer: number
  letter: string
  /** neurons are numbered on across layers: this stage's first is number first + 1 */
  first: number
  size: number
  bounds: Bounds[]
  /** min/max reached on sampled inputs */
  sampled: Bounds[]
  /** linear bounds over the inputs (DeepPoly, CROWN, ...); empty for IBP */
  linear: LinearBounds[]
  /** ReLU stages: per-neuron lines in terms of the pre-activation */
  relax: Relaxation[]
}

/** slope * z + bias */
export interface Line {
  slope: number
  bias: number
}

export type Side = 'lower' | 'upper'

/** What the diagram should highlight while a step walks through sub-steps
 *  (e.g. one back-substitution at a time). */
/** How much of one neuron a step has worked out so far: its equation (always), then its
 *  lower bound, then both. The diagram shows the equation under the neuron while it is worked on. */
export interface DiagramReveal {
  stage: number
  neuron: number
  bounds: 'none' | 'lower' | 'both'
  /** a ReLU's lines on its arrow (DeepPoly): none yet, the lower one, or both */
  lines?: 'none' | 'lower' | 'both'
}

/** A question shown in the diagram where its answer is about to appear; clicking it continues. */
export interface DiagramPrompt {
  stage: number
  /** null: the stage's column as a whole */
  neuron: number | null
  /** the neuron's interval, one of the bound lines under it, the line below those, or its column header */
  slot: 'interval' | 'lower' | 'upper' | 'below' | 'column' | 'def' | 'line-upper' | 'line-lower'
  /** words and math: `w` marks words, `v` a variable with an optional sub- or superscript */
  text: { s: string; v?: boolean; w?: boolean; sub?: string; sup?: string }[]
}

export interface DiagramFocus {
  /** stage the current lower/upper expressions of the target neuron are written over */
  stage: number
  lower: LinBound
  upper: LinBound
  /** the bound being walked; null once the walk is done and both are final */
  side: Side | null
  /** whether the target's interval is known yet (only at the concretize step) */
  concrete: boolean
  /** relaxation lines just substituted in */
  lines: { stage: number; neuron: number; line: Side }[]
  /** weighted sums just expanded */
  expanded: { stage: number; neurons: number[] } | null
}

export interface Relaxation {
  lower: Line
  upper: Line
}

/** sum_i coeffs[i] * x_i + const */
export interface LinBound {
  coeffs: number[]
  const: number
}

export interface LinearBounds {
  lower: LinBound
  upper: LinBound
}

export interface Step<D = Record<string, unknown>> {
  kind: string
  stage: number
  neuron: number | null
  detail: D
}

export interface Trace {
  domain: string
  stages: Stage[]
  steps: Step[]
  checks: { label: string; detail: string; ok: boolean }[]
}

export interface DomainInfo {
  key: string
  name: string
  short: string
  summary: string
}

export interface Preset {
  key: string
  name: string
  description: string
  network: Network
  input: InputBox
}
