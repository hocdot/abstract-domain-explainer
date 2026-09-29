import { MAX_HIDDEN, MAX_WIDTH, resize, setBias, setWeight, sizesOf } from '../network'
import type { DomainInfo, InputBox, Network, Preset } from '../types'
import { NumberField } from './NumberField'

// Shown greyed out so newcomers can see where the playground is heading.
const PLANNED = [
  { key: 'deeppoly', short: 'DeepPoly', summary: 'One linear lower and upper bound per neuron.' },
  { key: 'crown', short: 'CROWN', summary: 'Linear bounds propagated backward from the output.' },
  { key: 'zonotope', short: 'Zonotope', summary: 'Shared noise symbols keep neurons correlated.' },
  { key: 'alpha-crown', short: 'α-CROWN', summary: 'CROWN with optimized ReLU slopes.' },
]

interface Props {
  presets: Preset[]
  presetKey: string | null
  onPreset: (p: Preset) => void
  network: Network
  onNetwork: (n: Network) => void
  box: InputBox
  onBox: (b: InputBox) => void
  onRandomize: (style: 'integer' | 'decimal') => void
  domains: DomainInfo[]
  domain: string
  onDomain: (d: string) => void
}

function SizeStepper({ value, onChange, min = 1, max = MAX_WIDTH, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label: string
}) {
  return (
    <div className="size-stepper" aria-label={label}>
      <button onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`fewer ${label}`}>−</button>
      <span className="mono">{value}</span>
      <button onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`more ${label}`}>+</button>
    </div>
  )
}

export function Controls(p: Props) {
  const sizes = sizesOf(p.network)
  const hidden = sizes.length - 2
  const setSize = (idx: number, v: number) => p.onNetwork(resize(p.network, sizes.map((s, i) => (i === idx ? v : s))))
  const addHidden = () => p.onNetwork(resize(p.network, [...sizes.slice(0, -1), 2, sizes.at(-1)!]))
  const removeHidden = () => p.onNetwork(resize(p.network, [...sizes.slice(0, -2), sizes.at(-1)!]))

  return (
    <div className="controls">
      <section className="card">
        <h3>Example</h3>
        <select
          className="select"
          value={p.presetKey ?? ''}
          onChange={(e) => {
            const preset = p.presets.find((x) => x.key === e.target.value)
            if (preset) p.onPreset(preset)
          }}
        >
          {p.presetKey == null && <option value="">Custom network</option>}
          {p.presets.map((x) => (
            <option key={x.key} value={x.key}>{x.name}</option>
          ))}
        </select>
        <p className="muted small">
          {p.presets.find((x) => x.key === p.presetKey)?.description ?? 'Your own weights. Edit anything below or on the diagram.'}
        </p>
      </section>

      <section className="card">
        <h3>Abstract domain</h3>
        <div className="domains">
          {p.domains.map((d) => (
            <button key={d.key} className={`domain ${d.key === p.domain ? 'selected' : ''}`} onClick={() => p.onDomain(d.key)}>
              <span className="domain-name">{d.short}</span>
              <span className="domain-sum">{d.summary}</span>
            </button>
          ))}
        </div>
        <div className="planned-list">
          <span className="muted small">Coming soon</span>
          {PLANNED.filter((d) => !p.domains.some((x) => x.key === d.key)).map((d) => (
            <span key={d.key} className="soon" title={d.summary}>{d.short}</span>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Input box</h3>
        <div className="box-grid">
          <span />
          <span className="muted small">lower</span>
          <span className="muted small">upper</span>
          {p.box.lower.map((l, i) => (
            <div key={i} className="box-row">
              <span className="sym">x<sub>{i + 1}</sub></span>
              <NumberField value={l} label={`lower bound of x${i + 1}`} className="lo-field"
                onChange={(v) => p.onBox({ ...p.box, lower: p.box.lower.map((x, k) => (k === i ? v : x)) })} />
              <NumberField value={p.box.upper[i]} label={`upper bound of x${i + 1}`} className="hi-field"
                onChange={(v) => p.onBox({ ...p.box, upper: p.box.upper.map((x, k) => (k === i ? v : x)) })} />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Architecture</h3>
        <div className="arch">
          <div className="arch-row"><span>Inputs</span><SizeStepper label="inputs" value={sizes[0]} onChange={(v) => setSize(0, v)} /></div>
          {sizes.slice(1, -1).map((s, k) => (
            <div key={k} className="arch-row">
              <span>Hidden layer {k + 1}</span>
              <SizeStepper label={`neurons in layer ${k + 1}`} value={s} onChange={(v) => setSize(k + 1, v)} />
            </div>
          ))}
          <div className="arch-row"><span>Outputs</span><SizeStepper label="outputs" value={sizes.at(-1)!} onChange={(v) => setSize(sizes.length - 1, v)} /></div>
        </div>
        <div className="row gap">
          <button className="btn small" onClick={addHidden} disabled={hidden >= MAX_HIDDEN}>+ layer</button>
          <button className="btn small" onClick={removeHidden} disabled={hidden === 0}>− layer</button>
        </div>
        <div className="randomize">
          <span className="muted small">Random weights</span>
          <div className="row gap-sm">
            <button className="btn small" onClick={() => p.onRandomize('integer')}>Integers</button>
            <button className="btn small" onClick={() => p.onRandomize('decimal')}>Decimals</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Weights &amp; biases</h3>
        <p className="muted small">Row <em>j</em> holds the weights into neuron <em>j</em>. You can also click any edge in the diagram.</p>
        {p.network.layers.map((layer, k) => (
          <details key={k} className="matrix" open={k === 0}>
            <summary>
              {k === p.network.layers.length - 1 ? 'Output layer' : `Layer ${k + 1}`}
              <span className="muted small mono"> {layer.bias.length}×{layer.weight[0].length}</span>
            </summary>
            <div className="matrix-grid" style={{ gridTemplateColumns: `repeat(${layer.weight[0].length}, 1fr) 12px 1fr` }}>
              {layer.weight[0].map((_, i) => <span key={`h${i}`} className="muted small center">w·{i + 1}</span>)}
              <span />
              <span className="muted small center">b</span>
              {layer.weight.map((row, j) => [
                ...row.map((w, i) => (
                  <NumberField key={`${j}-${i}`} value={w} label={`weight ${j + 1},${i + 1}`}
                    onChange={(v) => p.onNetwork(setWeight(p.network, k, j, i, v))} />
                )),
                <span key={`s${j}`} />,
                <NumberField key={`b${j}`} value={layer.bias[j]} label={`bias ${j + 1}`}
                  onChange={(v) => p.onNetwork(setBias(p.network, k, j, v))} />,
              ])}
            </div>
          </details>
        ))}
      </section>
    </div>
  )
}
