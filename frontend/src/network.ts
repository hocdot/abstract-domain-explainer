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

/** Add a neuron at the bottom of column `c` (0 = the inputs, k = dense layer k).
 *  A hidden neuron brings its ReLU along. */
export function addNeuron(net: Network, box: InputBox, c: number): { network: Network; box: InputBox } {
  const sizes = sizesOf(net).map((s, k) => (k === c ? s + 1 : s))
  return { network: resize(net, sizes), box: resizeBox(box, sizes[0]) }
}

/** Remove neuron `j` of column `c`, with its incoming and outgoing weights
 *  (and its input bounds, for an input). */
export function removeNeuron(net: Network, box: InputBox, c: number, j: number): { network: Network; box: InputBox } {
  const drop = <T,>(xs: T[]) => xs.filter((_, k) => k !== j)
  const layers = net.layers.map((l, k) => ({
    ...l,
    weight: (k === c - 1 ? drop(l.weight) : l.weight).map((row) => (k === c ? drop(row) : row)),
    bias: k === c - 1 ? drop(l.bias) : l.bias,
  }))
  return {
    network: { input_dim: c === 0 ? net.input_dim - 1 : net.input_dim, layers },
    box: c === 0 ? { lower: drop(box.lower), upper: drop(box.upper) } : box,
  }
}

/** Insert a hidden ReLU layer between columns `g` and `g + 1`. It starts as the
 *  identity (as wide as column `g`), so no other weight has to change; after a
 *  hidden layer, whose values are already >= 0, the network computes the same
 *  function as before. */
export function insertLayer(net: Network, g: number): Network {
  const n = sizesOf(net)[g]
  const layer = {
    weight: Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => (i === j ? 1 : 0))),
    bias: Array.from({ length: n }, () => 0),
    activation: 'relu' as const,
  }
  return { ...net, layers: [...net.layers.slice(0, g), layer, ...net.layers.slice(g)] }
}

/** Remove hidden layer `c` (1-based column). The layer after it now reads column
 *  `c - 1`: weights that still fit are kept, new ones are ±1. */
export function removeLayer(net: Network, c: number): Network {
  const pm1 = () => (Math.random() < 0.5 ? -1 : 1)
  const inDim = sizesOf(net)[c - 1]
  const layers = net.layers.filter((_, k) => k !== c - 1)
  const next = layers[c - 1]
  layers[c - 1] = {
    ...next,
    weight: next.weight.map((row) => Array.from({ length: inDim }, (_, i) => row[i] ?? pm1())),
  }
  return { ...net, layers }
}
