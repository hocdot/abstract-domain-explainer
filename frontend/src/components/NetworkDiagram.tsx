import { useMemo, useRef, useState } from 'react'
import { fmt, textSym } from '../format'
import type { Network, Stage, Trace } from '../types'
import { NumberField } from './NumberField'

const CELL_W = 100
const CELL_H = 60
const GAP_X = 124
const GAP_Y = 36 // leaves room for the bias label under each neuron
const TOP = 52
const PAD = 12
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2]
const STATUS_LABEL = {
  on: 'always active (ReLU passes it through)',
  off: 'always inactive (ReLU outputs 0)',
  unstable: 'unstable (input can be negative or positive)',
}

interface Props {
  network: Network
  trace: Trace
  step: number
  showAll: boolean
  onJump: (stage: number, neuron: number) => void
  onEditWeight: (layer: number, j: number, i: number, value: number) => void
  onEditBias: (layer: number, j: number, value: number) => void
}

type Point = { x: number; y: number }

interface Edge {
  key: string
  layer: number // 0-based dense layer
  i: number
  j: number
  w: number
  from: Point
  to: Point
  label: Point
}

/** What the popover is editing. */
type Target =
  | { kind: 'weight'; layer: number; j: number; i: number; value: number }
  | { kind: 'bias'; layer: number; j: number; value: number }

const bezier = (a: Point, b: Point) => {
  const dx = (b.x - a.x) * 0.5
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`
}

const pointAt = (a: Point, b: Point, t: number): Point => {
  // cubic bezier with control points at the horizontal midpoint
  const dx = (b.x - a.x) * 0.5
  const p1 = { x: a.x + dx, y: a.y }
  const p2 = { x: b.x - dx, y: b.y }
  const u = 1 - t
  return {
    x: u ** 3 * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * b.x,
    y: u ** 3 * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * b.y,
  }
}

function Symbol({ stage, j, x, y }: { stage: Stage; j: number; x: number; y: number }) {
  return (
    <text x={x} y={y} textAnchor="middle" className="cell-sym">
      <tspan className="sym-letter">{stage.letter}</tspan>
      {stage.sup != null && <tspan dy={-7} className="sym-script">({stage.sup})</tspan>}
      <tspan dy={stage.sup != null ? 11 : 4} className="sym-script">{j + 1}</tspan>
    </text>
  )
}

export function NetworkDiagram({ network, trace, step, showAll, onJump, onEditWeight, onEditBias }: Props) {
  const outerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ target: Target; left: number; top: number } | null>(null)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')

  const cur = trace.steps[Math.min(step, trace.steps.length - 1)]
  const curStage = trace.stages[cur.stage]

  const layout = useMemo(() => {
    const columns: Stage[][] = []
    for (const s of trace.stages) (columns[s.layer] ??= []).push(s)
    const maxRows = Math.max(...trace.stages.map((s) => s.size))
    const height = TOP + maxRows * CELL_H + (maxRows - 1) * GAP_Y + 28
    const pos: Point[][] = []
    const colX: number[] = []
    let x = PAD
    for (const col of columns) {
      colX.push(x)
      for (const s of col) {
        const offset = ((maxRows - s.size) * (CELL_H + GAP_Y)) / 2
        pos[s.index] = Array.from({ length: s.size }, (_, j) => ({ x, y: TOP + offset + j * (CELL_H + GAP_Y) }))
        x += CELL_W
      }
      x += GAP_X
    }
    const width = x - GAP_X + PAD

    // Each target neuron gets one input port per source, spread along its left
    // side. Weight labels sit just before the port, so they line up in a
    // column next to the neuron they feed instead of piling up mid-edge.
    const edges: Edge[] = []
    network.layers.forEach((layer, k) => {
      const src = columns[k][columns[k].length - 1]
      const dst = columns[k + 1][0]
      const n = layer.weight[0].length
      const spacing = n > 1 ? Math.min(16, (CELL_H - 14) / (n - 1)) : 0
      layer.weight.forEach((row, j) =>
        row.forEach((w, i) => {
          const from = { x: pos[src.index][i].x + CELL_W, y: pos[src.index][i].y + CELL_H / 2 }
          const to = { x: pos[dst.index][j].x, y: pos[dst.index][j].y + CELL_H / 2 + (i - (n - 1) / 2) * spacing }
          const t = n > 2 && i % 2 === 1 ? 0.66 : 0.8
          edges.push({ key: `${k}-${j}-${i}`, layer: k, i, j, w, from, to, label: pointAt(from, to, t) })
        }),
      )
    })
    return { columns, pos, colX, width, height, edges }
  }, [trace.stages, network])

  // step index at which each (stage, neuron) first gets its bounds
  const revealAt = useMemo(() => {
    const m = new Map<string, number>()
    trace.steps.forEach((s, i) => {
      const js = s.neuron != null ? [s.neuron] : Array.from({ length: trace.stages[s.stage].size }, (_, j) => j)
      for (const j of js) if (!m.has(`${s.stage}:${j}`)) m.set(`${s.stage}:${j}`, i)
    })
    return m
  }, [trace])

  const maxAbsW = Math.max(1e-9, ...layout.edges.map((e) => Math.abs(e.w)))

  const revealed = (s: number, j: number) => showAll || (revealAt.get(`${s}:${j}`) ?? Infinity) <= step
  const isActive = (s: number, j: number) => s === cur.stage && (cur.neuron == null || j === cur.neuron)
  const isSource = (s: number, j: number) => {
    if (cur.neuron == null || s !== cur.stage - 1) return false
    return curStage.kind === 'affine' || (curStage.kind === 'relu' && j === cur.neuron)
  }
  const edgeActive = (e: Edge) =>
    curStage.kind === 'affine' && cur.neuron === e.j && curStage.layer === e.layer + 1
  const focusing = curStage.kind === 'affine' && cur.neuron != null

  const openEditor = (target: Target, at: Point) => {
    const svg = svgRef.current
    const outer = outerRef.current
    if (!svg || !outer) return
    const r = svg.getBoundingClientRect()
    const o = outer.getBoundingClientRect()
    const scale = r.width / layout.width
    setEditing({ target, left: r.left - o.left + at.x * scale, top: r.top - o.top + at.y * scale })
  }
  const editWeight = (e: Edge) =>
    openEditor({ kind: 'weight', layer: e.layer, j: e.j, i: e.i, value: e.w }, e.label)

  /** ReLU status from the pre-activation interval; null for non-ReLU cells. */
  const reluStatus = (s: Stage, j: number): keyof typeof STATUS_LABEL | null => {
    if (s.kind !== 'relu') return null
    const pre = trace.stages[s.index - 1].bounds[j]
    return pre.lower >= 0 ? 'on' : pre.upper <= 0 ? 'off' : 'unstable'
  }

  // current effective zoom, so +/- continue from "fit"
  const effectiveZoom = () => {
    if (zoom !== 'fit') return zoom
    const w = svgRef.current?.getBoundingClientRect().width
    return w ? w / layout.width : 1
  }
  const stepZoom = (dir: 1 | -1) => {
    const z = effectiveZoom()
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.01) : [...ZOOMS].reverse().find((v) => v < z - 0.01)
    if (next) setZoom(next)
  }
  const svgStyle =
    zoom === 'fit'
      ? { width: '100%', maxWidth: layout.width, minWidth: layout.width * 0.65 } // below 65%, scroll instead
      : { width: layout.width * zoom, maxWidth: 'none' }

  const t = editing?.target
  return (
    <div className="diagram-outer" ref={outerRef}>
      <div className="diagram-toolbar">
        <span className="muted small">Click a neuron to explain it, or a weight or bias to edit it.</span>
        <div className="zoom" role="group" aria-label="Zoom">
          <button onClick={() => stepZoom(-1)} title="Zoom out" aria-label="Zoom out">−</button>
          <button className="zoom-level mono" onClick={() => setZoom('fit')} title="Fit to width">
            {zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
          </button>
          <button onClick={() => stepZoom(1)} title="Zoom in" aria-label="Zoom in">+</button>
        </div>
      </div>

      <div className="diagram-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="diagram"
          style={svgStyle}
          role="img"
          aria-label="Network diagram with the bounds of every neuron"
        >
          {/* column headers */}
          {layout.columns.map((col, c) => {
            const w = col.length * CELL_W
            const title = c === 0 ? 'Input' : c === layout.columns.length - 1 ? 'Output' : `Layer ${c}`
            const sub = c === 0 ? 'the box we start from' : col.length === 2 ? 'weighted sum → ReLU' : 'weighted sum'
            return (
              <g key={c}>
                <text x={layout.colX[c] + w / 2} y={18} textAnchor="middle" className="col-title">{title}</text>
                <text x={layout.colX[c] + w / 2} y={34} textAnchor="middle" className="col-sub">{sub}</text>
              </g>
            )
          })}

          {/* edges */}
          {layout.edges.map((e) => {
            const on = edgeActive(e)
            const dim = focusing && !on
            return (
              <g key={e.key}>
                <path
                  d={bezier(e.from, e.to)}
                  className={`edge ${e.w < 0 ? 'neg' : ''} ${e.w === 0 ? 'zero' : ''} ${on ? 'on' : ''} ${dim ? 'dim' : ''} ${hover === e.key ? 'hover' : ''}`}
                  style={{ strokeWidth: 0.8 + 2.2 * (Math.abs(e.w) / maxAbsW) }}
                />
                <path
                  d={bezier(e.from, e.to)}
                  className="edge-hit"
                  onMouseEnter={() => setHover(e.key)}
                  onMouseLeave={() => setHover((h) => (h === e.key ? null : h))}
                  onClick={() => editWeight(e)}
                >
                  <title>{`weight ${fmt(e.w)} · click to edit`}</title>
                </path>
              </g>
            )
          })}

          {/* weight labels, drawn after all edges so no edge crosses a label */}
          {layout.edges.map((e) => {
            const label = fmt(e.w)
            const w = label.length * 6.4 + 10
            const on = edgeActive(e)
            return (
              <g
                key={`l-${e.key}`}
                className={`weight-chip ${on ? 'on' : ''} ${focusing && !on ? 'dim' : ''} ${hover === e.key ? 'hover' : ''}`}
                transform={`translate(${e.label.x},${e.label.y})`}
                onMouseEnter={() => setHover(e.key)}
                onMouseLeave={() => setHover((h) => (h === e.key ? null : h))}
                onClick={() => editWeight(e)}
              >
                <rect x={-w / 2} y={-8} width={w} height={16} rx={8} />
                <text textAnchor="middle" y={3.8}>{label}</text>
              </g>
            )
          })}

          {/* neurons */}
          {layout.columns.map((col, c) =>
            Array.from({ length: col[0].size }, (_, j) => {
              const x = layout.pos[col[0].index][j].x
              const y = layout.pos[col[0].index][j].y
              const w = col.length * CELL_W
              const clip = `pill-${c}-${j}`
              const bias = c > 0 ? network.layers[c - 1].bias[j] : null
              return (
                <g key={`${c}-${j}`}>
                  <clipPath id={clip}>
                    <rect x={x} y={y} width={w} height={CELL_H} rx={14} />
                  </clipPath>
                  <rect x={x} y={y} width={w} height={CELL_H} rx={14} className="pill" />
                  {col.map((s, n) => {
                    const cx = x + n * CELL_W
                    const b = s.bounds[j]
                    const show = revealed(s.index, j)
                    const label = `[${fmt(b.lower)}, ${fmt(b.upper)}]`
                    const status = show ? reluStatus(s, j) : null
                    return (
                      <g
                        key={s.index}
                        className={`cell ${isActive(s.index, j) ? 'active' : ''} ${isSource(s.index, j) ? 'source' : ''} ${show ? '' : 'pending'}`}
                        onClick={() => onJump(s.index, j)}
                      >
                        <title>{`${textSym(s, j)} ∈ ${show ? label : '?'}${status ? ` · ${STATUS_LABEL[status]}` : ''} · click to explain`}</title>
                        {status && (
                          <>
                            <rect x={cx} y={y} width={CELL_W} height={CELL_H} clipPath={`url(#${clip})`} className={`relu-tint st-${status}`} />
                            <rect x={cx} y={y + CELL_H - 3} width={CELL_W} height={3} clipPath={`url(#${clip})`} className={`relu-strip st-${status}`} />
                          </>
                        )}
                        <rect x={cx} y={y} width={CELL_W} height={CELL_H} clipPath={`url(#${clip})`} className="cell-bg" />
                        <Symbol stage={s} j={j} x={cx + CELL_W / 2} y={y + 24} />
                        <text
                          x={cx + CELL_W / 2}
                          y={y + 46}
                          textAnchor="middle"
                          className="cell-val"
                          {...(show && label.length > 13 ? { textLength: CELL_W - 12, lengthAdjust: 'spacingAndGlyphs' } : {})}
                        >
                          {show ? (
                            <>
                              [<tspan className="lo">{fmt(b.lower)}</tspan>, <tspan className="hi">{fmt(b.upper)}</tspan>]
                            </>
                          ) : (
                            '?'
                          )}
                        </text>
                      </g>
                    )
                  })}
                  <rect x={x} y={y} width={w} height={CELL_H} rx={14} className="pill-border" />
                  {col.length === 2 && (
                    <g className="relu-glyph" transform={`translate(${x + CELL_W},${y + CELL_H / 2})`}>
                      <line x1={0} x2={0} y1={-CELL_H / 2} y2={CELL_H / 2} className="divider" />
                      <circle r={9} />
                      <polyline points="-5,2.5 0,2.5 4.5,-3.5" />
                    </g>
                  )}
                  {bias != null && (
                    <text
                      x={x + CELL_W / 2}
                      y={y + CELL_H + 15}
                      textAnchor="middle"
                      className={`bias-label ${isActive(col[0].index, j) && curStage.kind === 'affine' ? 'on' : ''}`}
                      onClick={() =>
                        openEditor({ kind: 'bias', layer: c - 1, j, value: bias }, { x: x + CELL_W / 2, y: y + CELL_H + 10 })
                      }
                    >
                      <title>bias · click to edit</title>
                      b = {fmt(bias)}
                    </text>
                  )}
                </g>
              )
            }),
          )}
        </svg>
      </div>

      {editing && t && (
        <div className="popover" style={{ left: editing.left, top: editing.top }}>
          <div className="popover-title">
            {t.kind === 'weight' ? (
              <>
                Weight from {textSym(layout.columns[t.layer].at(-1)!, t.i)} to {textSym(layout.columns[t.layer + 1][0], t.j)}
              </>
            ) : (
              <>Bias of {textSym(layout.columns[t.layer + 1][0], t.j)}</>
            )}
          </div>
          <NumberField
            value={t.value}
            autoFocus
            label={t.kind}
            onChange={(v) => {
              if (t.kind === 'weight') onEditWeight(t.layer, t.j, t.i, v)
              else onEditBias(t.layer, t.j, v)
              setEditing((ed) => (ed ? { ...ed, target: { ...ed.target, value: v } } : ed))
            }}
            onDone={() => setEditing(null)}
          />
          <div className="popover-hint">Enter to close</div>
        </div>
      )}
    </div>
  )
}
