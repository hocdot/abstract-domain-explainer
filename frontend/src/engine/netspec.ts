// A toy fully-connected network and its input box, validated and run forward.
import type { InputBox, Network } from '../types.ts'

// Keep the playground toy-sized.
export const MAX_WIDTH = 8
export const MAX_LAYERS = 6

export class SpecError extends Error {}

export const outDim = (net: Network) => net.layers[net.layers.length - 1].bias.length

export function validateNetwork(net: Network): void {
  if (!Number.isInteger(net.input_dim) || net.input_dim < 1 || net.input_dim > MAX_WIDTH)
    throw new SpecError(`the input must have between 1 and ${MAX_WIDTH} dimensions`)
  if (net.layers.length < 1 || net.layers.length > MAX_LAYERS)
    throw new SpecError(`the network must have between 1 and ${MAX_LAYERS} layers`)
  let dim = net.input_dim
  net.layers.forEach((layer, k) => {
    const W = layer.weight
    if (!W.length || !W[0].length) throw new SpecError('weight must be a non-empty (out, in) matrix')
    if (W.some((row) => row.length !== W[0].length)) throw new SpecError('weight rows must all have the same length')
    if (layer.bias.length !== W.length)
      throw new SpecError(`bias has ${layer.bias.length} entries, expected ${W.length}`)
    if (W.length > MAX_WIDTH || W[0].length > MAX_WIDTH)
      throw new SpecError(`layers are limited to ${MAX_WIDTH} neurons`)
    if (W[0].length !== dim) throw new SpecError(`layer ${k + 1} expects ${W[0].length} inputs but receives ${dim}`)
    if ([...W.flat(), ...layer.bias].some((v) => !Number.isFinite(v)))
      throw new SpecError('every weight and bias must be a finite number')
    dim = W.length
  })
}

export function validateBox(box: InputBox, net: Network): void {
  if (box.lower.length !== box.upper.length) throw new SpecError('lower and upper must have the same length')
  if ([...box.lower, ...box.upper].some((v) => !Number.isFinite(v)))
    throw new SpecError('every input bound must be a finite number')
  if (box.lower.some((l, i) => l > box.upper[i])) throw new SpecError('every lower bound must be <= its upper bound')
  if (box.lower.length !== net.input_dim)
    throw new SpecError(`input box has ${box.lower.length} dimensions, network expects ${net.input_dim}`)
}

/** Concrete value of every stage (x, z1, h1, z2, ...), same order as the trace. */
export function forwardStages(net: Network, x: number[]): number[][] {
  const out = [x]
  for (const layer of net.layers) {
    x = layer.weight.map((row, j) => dot(row, x) + layer.bias[j])
    out.push(x)
    if (layer.activation === 'relu') {
      x = x.map((v) => Math.max(v, 0))
      out.push(x)
    }
  }
  return out
}

export function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
