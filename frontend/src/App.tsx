import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { ExplainPanel } from './components/ExplainPanel'
import { NetworkDiagram } from './components/NetworkDiagram'
import { DiagramTools, type Zoom } from './components/DiagramTools'
import { SetupBar } from './components/SetupBar'
import { Stepper } from './components/Stepper'
import { addNeuron, insertLayer, removeLayer, removeNeuron, resizeBox, setBias, setWeight, sizesOf } from './network'
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
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [fitScale, setFitScale] = useState(1)
  const [showEq, setShowEq] = useState(true)
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
  // the question the next press of Continue answers, shown in the diagram where its answer appears
  const next = !trace || atEnd ? null
    : subC < subCount(clamped) - 1 ? { i: clamped, k: subC + 1 } : { i: clamped + 1, k: 0 }
  const nextStep = next && trace?.steps[next.i]
  const prompt = trace && next && nextStep ? (viewFor(nextStep.kind).prompt?.(nextStep, trace, next.k) ?? null) : null
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

  const editShape = ({ network: net, box: b }: { network: Network; box: InputBox }) => {
    setPresetKey(null)
    setNetwork(net)
    setBox(b)
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
    <div className={`app ${zoom === 'fit' ? '' : 'zoomed'}`}>
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
          <button className="btn ghost small" onClick={() => setTheme(NEXT_THEME[theme])} title="Switch theme">
            Theme: {theme}
          </button>
        </div>
      </header>

      {(bootError || error) && <div className="banner">{bootError ?? error}</div>}

      {network && box ? (
        <main className="layout">
          {trace && result ? (
            <>
              <section className="stage card">
                <SetupBar
                  presets={presets}
                  presetKey={presetKey}
                  onPreset={load}
                  domains={domains}
                  domain={domain}
                  onDomain={setDomain}
                  onRandomize={randomize}
                  tools={
                    <DiagramTools
                      zoom={zoom}
                      onZoom={setZoom}
                      fitScale={fitScale}
                      // only domains with linear bounds have equations to show
                      showEq={trace.stages.some((s) => s.relax.length > 0 || (s.index > 0 && s.linear.length > 0)) ? showEq : null}
                      onShowEq={setShowEq}
                    />
                  }
                />
                <NetworkDiagram
                  network={result.network}
                  trace={trace}
                  step={clamped}
                  focus={focus}
                  prompt={prompt}
                  onPrompt={() => { setPlaying(false); forward() }}
                  onJump={jump}
                  onEditWeight={(k, j, i, v) => editNetwork(setWeight(network, k, j, i, v))}
                  onEditBias={(k, j, v) => editNetwork(setBias(network, k, j, v))}
                  box={box}
                  onEditBox={(b) => {
                    setPresetKey(null)
                    setBox(b)
                  }}
                  onAddNeuron={(c) => editShape(addNeuron(network, box, c))}
                  onRemoveNeuron={(c, j) => editShape(removeNeuron(network, box, c, j))}
                  onInsertLayer={(g) => editNetwork(insertLayer(network, g))}
                  onRemoveLayer={(c) => editNetwork(removeLayer(network, c))}
                  zoom={zoom}
                  showEq={showEq}
                  onFitScale={(v) => setFitScale((s) => (Math.abs(s - v) < 0.005 ? s : v))}
                  legend={
                    <>
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
                    </>
                  }
                />
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
