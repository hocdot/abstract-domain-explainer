// Every call runs the engine in the browser, so the site is fully static.
// The functions stay async so the UI does not care where the work happens.
import * as engine from './engine/index.ts'
import type { DomainInfo, InputBox, Network, Preset, Trace } from './types'

export class ApiError extends Error {}

function call<T>(f: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      resolve(f())
    } catch (e) {
      reject(e instanceof engine.SpecError ? new ApiError(e.message) : e)
    }
  })
}

export const api = {
  domains: () => call<DomainInfo[]>(engine.domains),
  presets: () => call<Preset[]>(engine.presets),
  random: (sizes: number[], style: 'integer' | 'decimal', seed: number) =>
    call<Network>(() => engine.random(sizes, style, seed)),
  // `signal` is kept for the caller's sake: the analysis is synchronous and fast
  analyze: (domain: string, network: Network, input: InputBox, _signal?: AbortSignal) =>
    call<Trace>(() => engine.analyze(domain, network, input)),
}
