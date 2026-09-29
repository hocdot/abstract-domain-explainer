import type { InputBox, Network } from './types'

export const MAX_WIDTH = 6
export const MAX_HIDDEN = 4

export const sizesOf = (net: Network) => [net.input_dim, ...net.layers.map((l) => l.bias.length)]

/** Change layer sizes, keeping every existing weight that still fits.
 *  New weights are ±1 so new edges are visible; new biases are 0. */
export function resize(net: Network, sizes: number[]): Network {
  const pm1 = () => (Math.random() < 0.5 ? -1 : 1)
  const layers = sizes.slice(1).map((out, k) => {
    const inp = sizes[k]
    const old = net.layers[k]
    return {
      weight: Array.from({ length: out }, (_, j) =>
        Array.from({ length: inp }, (_, i) => old?.weight[j]?.[i] ?? pm1()),
      ),
      bias: Array.from({ length: out }, (_, j) => old?.bias[j] ?? 0),
      activation: k === sizes.length - 2 ? ('none' as const) : ('relu' as const),
    }
  })
  return { input_dim: sizes[0], layers }
}

export function resizeBox(box: InputBox, dim: number): InputBox {
  return {
    lower: Array.from({ length: dim }, (_, i) => box.lower[i] ?? -1),
    upper: Array.from({ length: dim }, (_, i) => box.upper[i] ?? 1),
  }
}

export function setWeight(net: Network, k: number, j: number, i: number, v: number): Network {
  return {
    ...net,
    layers: net.layers.map((l, kk) =>
      kk !== k ? l : { ...l, weight: l.weight.map((row, jj) => (jj !== j ? row : row.map((w, ii) => (ii === i ? v : w)))) },
    ),
  }
}

export function setBias(net: Network, k: number, j: number, v: number): Network {
  return {
    ...net,
    layers: net.layers.map((l, kk) => (kk !== k ? l : { ...l, bias: l.bias.map((b, jj) => (jj === j ? v : b)) })),
  }
}
