import { stageName } from '../format'
import { viewFor } from '../explain'
import type { Trace } from '../types'

interface Props {
  trace: Trace
  index: number
  sub: number
  subCount: number
  onSub: (k: number) => void
  onPrev: () => void
  onNext: () => void
  atStart: boolean
  atEnd: boolean
}

export function ExplainPanel({ trace, index, sub, subCount, onSub, onPrev, onNext, atStart, atEnd }: Props) {
  const step = trace.steps[index]
  const view = viewFor(step.kind)
  const stage = trace.stages[step.stage]
  const n = trace.steps.length
  return (
    <aside className="explain card">
      <div className="explain-head">
        <div className="eyebrow">
          Step {index + 1} of {n} · {stageName(stage, step.stage === trace.stages.length - 1)}
        </div>
        <h2>{view.heading?.(step, trace) ?? view.title(step, trace)}</h2>
      </div>
      <div className="explain-body" key={index}>
        <view.Body step={step} trace={trace} sub={sub} onSub={onSub} />
      </div>
      <div className="explain-foot">
        <div className="nav">
          <button className="btn ghost" onClick={onPrev} disabled={atStart}>
            ← Back
          </button>
          <button className="btn primary" onClick={onNext} disabled={atEnd}>
            {sub < subCount - 1 ? `Continue (${sub + 1}/${subCount}) →` : 'Next →'}
          </button>
        </div>
        <ul className="checks">
          {trace.checks.map((c) => (
            <li key={c.label} className={`check ${c.ok ? 'ok' : 'bad'}`} title={c.detail}>
              {c.ok ? '✓' : '!'} {c.label}
              <span className="muted"> · {c.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
