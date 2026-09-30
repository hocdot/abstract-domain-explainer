import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { Controls } from './components/Controls'
import { ExplainPanel } from './components/ExplainPanel'
import { NetworkDiagram } from './components/NetworkDiagram'
import { Stepper } from './components/Stepper'
import { resizeBox, setBias, setWeight, sizesOf } from './network'
import { viewFor } from './explain'
import type { DomainInfo, InputBox, Network, Preset } from './types'
import { useTrace } from './useTrace'

type Theme = 'light' | 'dark' | 'system'

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('theme') as Theme) ?? 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* storage unavailable: theme just isn't remembered */
    }
  }, [theme])
  return [theme, setTheme]
}

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

export default function App() {
  const [theme, setTheme] = useTheme()
  const [presets, setPresets] = useState<Preset[]>([])
  const [domains, setDomains] = useState<DomainInfo[]>([])
  const [bootError, setBootError] = useState<string | null>(null)
  const [presetKey, setPresetKey] = useState<string | null>(null)
  const [network, setNetwork] = useState<Network | null>(null)
  const [box, setBox] = useState<InputBox | null>(null)
  const [domain, setDomain] = useState(() => new URLSearchParams(location.search).get('domain') ?? 'ibp')
  const [index, setIndex] = useState(() => Number(new URLSearchParams(location.search).get('step') ?? 1) - 1 || 0)
  const [playing, setPlaying] = useState(false)
  const [seed, setSeed] = useState(1)
  const [controlsOpen, setControlsOpen] = useState(true)
  const [sub, setSub] = useState(() => Number(new URLSearchParams(location.search).get('sub') ?? 1) - 1 || 0)

  const { result, error } = useTrace(domain, network, box)
  const trace = result?.trace
  const n = trace?.steps.length ?? 1
  const clamped = Math.min(index, n - 1)

  // Some steps (DeepPoly's back-substitution) have sub-steps that Next walks
  // through before moving on to the next neuron.
  const subCount = (i: number) => {
    const s = trace?.steps[i]
    return s ? (viewFor(s.kind).subSteps?.(s) ?? 1) : 1
  }
  const subC = Math.min(sub, subCount(clamped) - 1)
  const atStart = clamped === 0 && subC === 0
  const atEnd = clamped === n - 1 && subC === subCount(clamped) - 1
  const jumpTo = (i: number) => {
    setIndex(Math.max(0, Math.min(n - 1, i)))
    setSub(0)
  }
  const forward = () => {
    if (subC < subCount(clamped) - 1) setSub(subC + 1)
    else if (clamped < n - 1) jumpTo(clamped + 1)
  }
  const backward = () => {
    if (subC > 0) setSub(subC - 1)
    else if (clamped > 0) {
      setIndex(clamped - 1)
      setSub(subCount(clamped - 1) - 1)
    }
  }
  const curStep = trace?.steps[clamped]
  const focus = trace && curStep ? (viewFor(curStep.kind).focus?.(curStep, trace, subC) ?? null) : null

  const load = useCallback((p: Preset) => {
    setPresetKey(p.key)
    setNetwork(p.network)
    setBox(p.input)
    setIndex(0)
    setSub(0)
    setPlaying(false)
  }, [])

  useEffect(() => {
    Promise.all([api.presets(), api.domains()])
      .then(([ps, ds]) => {
        setPresets(ps)
        setDomains(ds)
        const wanted = new URLSearchParams(location.search).get('example')
        const first = ps.find((p) => p.key === wanted) ?? ps[0]
        if (first) {
          setPresetKey(first.key)
          setNetwork(first.network)
          setBox(first.input)
        }
      })
      .catch((e: Error) => setBootError(e.message))
  }, [load])

  // autoplay
  useEffect(() => {
    if (!playing) return
    if (atEnd) {
      setPlaying(false)
      return
    }
    const t = setTimeout(forward, 1400)
    return () => clearTimeout(t)
  })

  // keyboard: ← → Home End Space (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, select, textarea, [contenteditable]')) return
      if (e.key === 'ArrowRight') forward()
      else if (e.key === 'ArrowLeft') backward()
      else if (e.key === 'Home') jumpTo(0)
      else if (e.key === 'End') jumpTo(n - 1)
      else if (e.key === ' ' && !el.closest('button')) setPlaying((p) => !p)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const editNetwork = (net: Network) => {
    setPresetKey(null)
    setNetwork(net)
    if (box && net.input_dim !== box.lower.length) setBox(resizeBox(box, net.input_dim))
  }

  const randomize = (style: 'integer' | 'decimal') => {
    if (!network) return
    const next = seed + 1
    setSeed(next)
    api.random(sizesOf(network), style, next).then(editNetwork).catch((e: Error) => setBootError(e.message))
  }

  const jump = (stage: number, neuron: number) => {
    if (!trace) return
    const i = trace.steps.findIndex((s) => s.stage === stage && (s.neuron === neuron || s.neuron == null))
    if (i >= 0) {
      setPlaying(false)
      jumpTo(i)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">[ ]</span>
          <h1>Abstract Domain Explainer</h1>
        </div>
        <div className="row gap-sm">
          <a
            className="btn ghost small"
            href="https://github.com/hocdot/abstract-domain-explainer/issues/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            Suggest an idea
          </a>
          <button className="btn ghost small" onClick={() => setControlsOpen(!controlsOpen)} aria-pressed={!controlsOpen}>
            {controlsOpen ? 'Hide controls' : 'Show controls'}
          </button>
          <button className="btn ghost small" onClick={() => setTheme(NEXT_THEME[theme])} title="Switch theme">
            Theme: {theme}
          </button>
        </div>
      </header>

      {(bootError || error) && <div className="banner">{bootError ?? error}</div>}

      {network && box ? (
        <main className={`layout ${controlsOpen ? '' : 'no-controls'}`}>
          {controlsOpen && <Controls
            presets={presets}
            presetKey={presetKey}
            onPreset={load}
            network={network}
            onNetwork={editNetwork}
            box={box}
            onBox={(b) => {
              setPresetKey(null)
              setBox(b)
            }}
            onRandomize={randomize}
            domains={domains}
            domain={domain}
            onDomain={setDomain}
          />}
          {trace && result ? (
            <>
              <section className="stage card">
                <NetworkDiagram
                  network={result.network}
                  trace={trace}
                  step={clamped}
                  focus={focus}
                  onJump={jump}
                  onEditWeight={(k, j, i, v) => editNetwork(setWeight(network, k, j, i, v))}
                  onEditBias={(k, j, v) => editNetwork(setBias(network, k, j, v))}
                />
                <div className="legend">
                  <span><i className="sw lo" /> lower bound</span>
                  <span><i className="sw hi" /> upper bound</span>
                  <span><i className="ln" /> positive weight</span>
                  <span><i className="ln neg" /> negative weight</span>
                  <span className="legend-group">
                    ReLU:
                    <span><i className="tint st-on" /> always active</span>
                    <span><i className="tint st-off" /> always inactive</span>
                    <span><i className="tint st-unstable" /> unstable</span>
                  </span>
                </div>
                <Stepper
                  trace={trace}
                  index={clamped}
                  onIndex={(i) => {
                    setPlaying(false)
                    jumpTo(i)
                  }}
                  onPrev={() => { setPlaying(false); backward() }}
                  onNext={() => { setPlaying(false); forward() }}
                  atStart={atStart}
                  atEnd={atEnd}
                  playing={playing}
                  onPlaying={setPlaying}
                />
              </section>
              <ExplainPanel
                trace={trace}
                index={clamped}
                sub={subC}
                subCount={subCount(clamped)}
                onSub={(k) => { setPlaying(false); setSub(k) }}
                onPrev={() => { setPlaying(false); backward() }}
                onNext={() => { setPlaying(false); forward() }}
                atStart={atStart}
                atEnd={atEnd}
              />
            </>
          ) : (
            <div className="card placeholder">Computing bounds…</div>
          )}
        </main>
      ) : (
        !bootError && <div className="placeholder">Loading…</div>
      )}
    </div>
  )
}
