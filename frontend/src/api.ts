import type { DomainInfo, InputBox, Network, Preset, Trace } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Cannot reach the backend. Is the API server running?')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail
    // FastAPI validation errors are a list of {msg}; our own errors are a string
    const msg = Array.isArray(detail)
      ? detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, '')).join('; ')
      : (detail ?? res.statusText)
    throw new ApiError(msg)
  }
  return res.json()
}

export const api = {
  domains: () => request<DomainInfo[]>('/api/domains'),
  presets: () => request<Preset[]>('/api/presets'),
  random: (sizes: number[], style: 'integer' | 'decimal', seed: number) =>
    request<Network>('/api/random', { method: 'POST', body: JSON.stringify({ sizes, style, seed }) }),
  analyze: (domain: string, network: Network, input: InputBox, signal?: AbortSignal) =>
    request<Trace>('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ domain, network, input }),
      signal,
    }),
}
