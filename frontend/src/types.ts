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
  check: { description: string; max_abs_diff: number; ok: boolean }
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
