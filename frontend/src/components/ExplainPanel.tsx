import { stageName } from '../format'
import { viewFor } from '../explain'
import type { Trace } from '../types'

interface Props {
  trace: Trace
  index: number
  onIndex: (i: number) => void
}

export function ExplainPanel({ trace, index, onIndex }: Props) {
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
        <view.Body step={step} trace={trace} />
      </div>
      <div className="explain-foot">
        <div className="nav">
          <button className="btn ghost" onClick={() => onIndex(index - 1)} disabled={index === 0}>
            ← Back
          </button>
          <button className="btn primary" onClick={() => onIndex(index + 1)} disabled={index === n - 1}>
            Next →
          </button>
        </div>
        <div className={`check ${trace.check.ok ? 'ok' : 'bad'}`} title={trace.check.description}>
          {trace.check.ok ? '✓' : '!'} Engine and textbook rule{' '}
          {trace.check.ok ? 'agree' : 'disagree'}
          <span className="muted"> (max diff {trace.check.max_abs_diff === 0 ? '0' : trace.check.max_abs_diff.toExponential(1)})</span>
        </div>
      </div>
    </aside>
  )
}
