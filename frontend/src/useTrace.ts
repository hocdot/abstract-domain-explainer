import { useEffect, useState } from 'react'
import { api } from './api'
import type { InputBox, Network, Trace } from './types'

interface State {
  /** Last successful result, paired with the network it was computed for. */
  result: { trace: Trace; network: Network } | null
  error: string | null
  loading: boolean
}

/** Re-analyze (debounced) whenever the network, box, or domain changes. */
export function useTrace(domain: string, network: Network | null, box: InputBox | null): State {
  const [state, setState] = useState<State>({ result: null, error: null, loading: false })

  useEffect(() => {
    if (!network || !box) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }))
      api
        .analyze(domain, network, box, ctrl.signal)
        .then((trace) => setState({ result: { trace, network }, error: null, loading: false }))
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setState((s) => ({ ...s, error: e.message, loading: false }))
        })
    }, 120)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [domain, network, box])

  return state
}
