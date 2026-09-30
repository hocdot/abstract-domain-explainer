// Hand-picked toy networks, plus a random generator.
import type { Dense, Network, Preset } from '../types.ts'
import { rng } from './sampling.ts'

const dense = (weight: number[][], bias: number[], activation: Dense['activation'] = 'relu'): Dense =>
  ({ weight, bias, activation })

export const PRESETS: Preset[] = [
  {
    key: 'three-relu-cases',
    name: 'Three ReLU cases',
    description: 'One hidden layer where a neuron is always on, one is always off, '
      + 'and one could be either. A good first example.',
    network: { input_dim: 2, layers: [
      dense([[1, 1], [-1, -1], [1, -1]], [1, -0.5, 0]),
      dense([[1, 1, 1], [1, 0, -1]], [0, 0], 'none'),
    ] },
    input: { lower: [0, 0], upper: [1, 1] },
  },
  {
    key: 'deeppoly-example',
    name: 'DeepPoly paper example',
    description: 'The 2-2-2-2 running example from Singh et al., "An Abstract Domain '
      + 'for Certifying Neural Networks" (POPL 2019).',
    network: { input_dim: 2, layers: [
      dense([[1, 1], [1, -1]], [0, 0]),
      dense([[1, 1], [1, -1]], [0, 0]),
      dense([[1, 1], [0, 1]], [1, 0], 'none'),
    ] },
    input: { lower: [-1, -1], upper: [1, 1] },
  },
]

/** `sizes = [input, hidden..., output]`; ReLU on every layer but the last. */
export function randomNetwork(sizes: number[], style: 'integer' | 'decimal', seed: number): Network {
  const rand = rng(seed)
  const choice = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())

  const draw = (scale: number) => {
    if (style === 'integer') return scale === 1 ? choice([-2, -1, -1, 0, 1, 1, 2]) : choice([-1, 0, 0, 1])
    return Math.round(gauss() * scale * 10) / 10 || 0 // `|| 0` turns -0 into 0
  }

  const layers = sizes.slice(1).map((nOut, k) => dense(
    Array.from({ length: nOut }, () => Array.from({ length: sizes[k] }, () => draw(1))),
    Array.from({ length: nOut }, () => draw(0.5)),
    k === sizes.length - 2 ? 'none' : 'relu',
  ))
  return { input_dim: sizes[0], layers }
}
