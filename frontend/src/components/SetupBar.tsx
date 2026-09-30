import type { ReactNode } from 'react'
import type { DomainInfo, Preset } from '../types'

// Shown greyed out so newcomers can see where the playground is heading.
const PLANNED = [
  { key: 'zonotope', short: 'Zonotope', summary: 'Shared noise symbols keep neurons correlated.' },
  { key: 'alpha-crown', short: 'α-CROWN', summary: 'CROWN with optimized ReLU slopes.' },
]

interface Props {
  presets: Preset[]
  presetKey: string | null
  onPreset: (p: Preset) => void
  domains: DomainInfo[]
  domain: string
  onDomain: (d: string) => void
  onRandomize: (style: 'integer' | 'decimal') => void
  /** pinned to the top-right corner (the diagram's zoom and equations toggle) */
  tools?: ReactNode
}

/** Example, abstract domain and random weights, above the diagram. */
export function SetupBar(p: Props) {
  const preset = p.presets.find((x) => x.key === p.presetKey)
  return (
    <div className="setup">
      <div className="setup-tools">{p.tools}</div>
      <div className="setup-row">
        <div className="setup-line">
          <span className="setup-label" id="setup-example">Example</span>
          <select
            className="select"
            aria-labelledby="setup-example"
            value={p.presetKey ?? ''}
            onChange={(e) => {
              const next = p.presets.find((x) => x.key === e.target.value)
              if (next) p.onPreset(next)
            }}
          >
            {p.presetKey == null && <option value="">Custom network</option>}
            {p.presets.map((x) => (
              <option key={x.key} value={x.key}>{x.name}</option>
            ))}
          </select>
          <span className="muted small">or random weights</span>
          <div className="seg-toggle">
            <button onClick={() => p.onRandomize('integer')}>Integers</button>
            <button onClick={() => p.onRandomize('decimal')}>Decimals</button>
          </div>
        </div>

        <div className="setup-line">
          <span className="setup-label" id="setup-domain">Domain</span>
          <div className="seg-toggle domain-toggle" role="radiogroup" aria-labelledby="setup-domain">
          {p.domains.map((d) => (
            <button key={d.key} role="radio" aria-checked={d.key === p.domain} title={d.summary}
              className={d.key === p.domain ? 'on' : ''} onClick={() => p.onDomain(d.key)}>
              {d.short}
            </button>
          ))}
          {PLANNED.filter((d) => !p.domains.some((x) => x.key === d.key)).map((d) => (
            <button key={d.key} disabled title={`Coming soon: ${d.summary}`} className="soon-seg">
              {d.short}
            </button>
          ))}
          </div>
        </div>
      </div>
      <p className="muted small setup-desc">
        {preset?.description ?? 'Your own network: click any weight, bias or input bound to change it.'}
      </p>
    </div>
  )
}
