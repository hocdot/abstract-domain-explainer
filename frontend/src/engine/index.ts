// The whole analysis runs in the browser. To add a domain (zonotopes,
// alpha-CROWN, ...), put its math in `core/`, write a Domain in `domains/` that
// emits its own step kinds, and list it in REGISTRY below.
import type { DomainInfo, InputBox, Network, Trace } from '../types.ts'
import { type Domain, run } from './domains/base.ts'
import { DeepPoly } from './domains/deeppoly.ts'
import { IBP } from './domains/ibp.ts'
import { MAX_LAYERS, MAX_WIDTH, SpecError, validateBox, validateNetwork } from './netspec.ts'
import { PRESETS, randomNetwork } from './presets.ts'

export { SpecError } from './netspec.ts'
export { PRESETS } from './presets.ts'

export const REGISTRY: Record<string, Domain> = Object.fromEntries([IBP, DeepPoly].map((d) => [d.key, d]))

export const domains = (): DomainInfo[] =>
  Object.values(REGISTRY).map(({ key, name, short, summary }) => ({ key, name, short, summary }))

export function analyze(domain: string, network: Network, input: InputBox): Trace {
  const d = REGISTRY[domain]
  if (!d) throw new SpecError(`unknown domain '${domain}'; available: ${Object.keys(REGISTRY).sort().join(', ')}`)
  validateNetwork(network)
  validateBox(input, network)
  return run(d, network, input)
}

export function random(sizes: number[], style: 'integer' | 'decimal', seed: number): Network {
  if (sizes.length < 2 || sizes.length > MAX_LAYERS + 1)
    throw new SpecError(`a network needs between 2 and ${MAX_LAYERS + 1} layer sizes`)
  if (sizes.some((s) => !Number.isInteger(s) || s < 1 || s > MAX_WIDTH))
    throw new SpecError(`layer sizes must be between 1 and ${MAX_WIDTH}`)
  return randomNetwork(sizes, style, seed)
}

export const presets = () => structuredClone(PRESETS)
