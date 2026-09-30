import type { CSSProperties } from 'react'
import { viewFor } from '../explain'
import type { Trace } from '../types'

interface Props {
  trace: Trace
  index: number
  onIndex: (i: number) => void
  onPrev: () => void
  onNext: () => void
  atStart: boolean
  atEnd: boolean
  playing: boolean
  onPlaying: (p: boolean) => void
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
)

const ICONS = {
  first: 'M6 5h2v14H6zM20 5v14l-10-7z',
  prev: 'M16 5v14L6 12z',
  next: 'M8 5v14l10-7z',
  last: 'M16 5h2v14h-2zM4 5v14l10-7z',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
}

export function Stepper({ trace, index, onIndex, onPrev, onNext, atStart, atEnd, playing, onPlaying }: Props) {
  const n = trace.steps.length
  // group consecutive steps by layer so the progress bar reads x | layer 1 | ... | y | ✓
  const lastLayer = trace.stages[trace.stages.length - 1].layer
  const groups: { layer: number; output: boolean; steps: number[] }[] = []
  trace.steps.forEach((s, i) => {
    const layer = trace.stages[s.stage].layer
    const output = s.kind === 'output'
    const g = groups.at(-1)
    if (g && g.layer === layer && g.output === output) g.steps.push(i)
    else groups.push({ layer, output, steps: [i] })
  })

  return (
    <div className="stepper">
      <div className="stepper-controls">
        <button className="icon-btn" onClick={() => onIndex(0)} disabled={index === 0} title="First step (Home)">
          <Icon d={ICONS.first} />
        </button>
        <button className="icon-btn" onClick={onPrev} disabled={atStart} title="Previous (←)">
          <Icon d={ICONS.prev} />
        </button>
        <button className="icon-btn primary" onClick={() => onPlaying(!playing)} title="Play / pause (Space)">
          <Icon d={playing ? ICONS.pause : ICONS.play} />
        </button>
        <button className="icon-btn" onClick={onNext} disabled={atEnd} title="Next (→)">
          <Icon d={ICONS.next} />
        </button>
        <button className="icon-btn" onClick={() => onIndex(n - 1)} disabled={index === n - 1} title="Last step (End)">
          <Icon d={ICONS.last} />
        </button>
        <span className="step-count mono">
          {index + 1}<span className="muted"> / {n}</span>
        </span>
      </div>

      <div className="progress" role="group" aria-label="Steps">
        {groups.map((g) => {
          return (
            <div key={g.steps[0]} className="progress-group" style={{ '--n': g.steps.length } as CSSProperties}>
              <div className="progress-segs">
                {g.steps.map((i) => (
                  <button
                    key={i}
                    className={`seg ${i <= index ? 'done' : ''} ${i === index ? 'current' : ''}`}
                    onClick={() => onIndex(i)}
                    title={viewFor(trace.steps[i].kind).title(trace.steps[i], trace)}
                    aria-label={`Step ${i + 1}`}
                  />
                ))}
              </div>
              <div className="progress-label">
                {g.output ? '✓' : g.layer === 0 ? <i>x</i> : g.layer === lastLayer ? <i>y</i> : `Layer ${g.layer}`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
