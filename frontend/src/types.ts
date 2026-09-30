// Mirrors backend/netspec.py and backend/schema.py.

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
  sup: number | null
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
