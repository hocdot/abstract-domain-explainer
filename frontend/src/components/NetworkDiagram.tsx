import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmt, textLin, textSym } from '../format'
import { MathSpans, mlin, mtxt, mvar, mwidth, type MTok } from './SvgMath'
import type { DiagramFocus, LinBound, Network, Stage, Trace } from '../types'
import { NumberField } from './NumberField'

const CELL_W = 100
const CELL_H = 60
const GAP_X = 124 // between layers (weighted edges)
const ACT_GAP = 60 // between z and h of the same layer (one activation arrow)
const ACT_GAP_EQ = 128 // ... wide enough to print the ReLU's two lines on the arrow
const GAP_Y = 36 // bias label sits above each neuron, inside this gap
const GAP_Y_EQ = 67 // ... plus two bound equations under the neuron above it
const EXACT_H = 17 // ... plus one more line for "h = ..." under always-active/inactive ReLUs
const EQ_MAX_W = 210
const ARROW_HEAD = 8
const TOP = 64 // column titles + room for the first row's bias labels
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
  focus: DiagramFocus | null
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
  dst: number // stage index of the target neuron
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

// advance widths in em of KaTeX_Math italic letters and KaTeX_Main script characters
const LETTER_EM: Record<string, number> = { x: 0.53, z: 0.465, h: 0.576, y: 0.49 }
const scriptEm = (s: string) => [...s].reduce((w, c) => w + (c === '(' || c === ')' ? 0.389 : 0.5), 0)

/** Neuron symbol like z⁽²⁾₁, with the layer and index stacked as KaTeX sets them. */
function Symbol({ stage, j, x, y }: { stage: Stage; j: number; x: number; y: number }) {
  const sup = stage.sup != null ? `(${stage.sup})` : ''
  const sub = String(j + 1)
  const lw = (LETTER_EM[stage.letter] ?? 0.55) * 21 + (sup ? 1 : 0)
  const sw = Math.max(scriptEm(sup), scriptEm(sub)) * 12
  const x0 = x - (lw + sw) / 2
  return (
    <g className="cell-sym">
      <text x={x0} y={y} className="sym-letter">{stage.letter}</text>
      {sup && <text x={x0 + lw} y={y - 8} className="sym-script">{sup}</text>}
      <text x={x0 + lw} y={y + 4} className="sym-script">{sub}</text>
    </g>
  )
}

/** Equation text under a neuron; squeezed if it would run into the next column. */
const EQ_SIZE = 12.5
const sameLin = (a: LinBound, b: LinBound) =>
  Math.abs(a.const - b.const) < 1e-9 && a.coeffs.every((c, i) => Math.abs(c - b.coeffs[i]) < 1e-9)

function Eq({ x, y, anchor, className, maxW = EQ_MAX_W, toks }: {
  x: number; y: number; anchor: 'start' | 'middle' | 'end'; className: string; maxW?: number; toks: MTok[]
}) {
  return (
    <>
      <text x={x} y={y} textAnchor={anchor} className={`math ${className}`}
        {...(mwidth(toks, EQ_SIZE) > maxW ? { textLength: maxW, lengthAdjust: 'spacingAndGlyphs' } : {})}>
        <MathSpans toks={toks} size={EQ_SIZE} />
      </text>
    </>
  )
}

export function NetworkDiagram({ network, trace, step, focus, onJump, onEditWeight, onEditBias }: Props) {
  const outerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ target: Target; left: number; top: number } | null>(null)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [showEq, setShowEq] = useState(true)
  const arrowId = `arrow-${useId().replace(/:/g, '')}`
  const hasEq = trace.stages.some((s) => s.relax.length > 0 || (s.index > 0 && s.linear.length > 0))
  const eqOn = hasEq && showEq

  const cur = trace.steps[Math.min(step, trace.steps.length - 1)]
  const curStage = trace.stages[cur.stage]

  const [overflow, setOverflow] = useState(0)
  const layout = useMemo(() => {
    const columns: Stage[][] = []
    for (const s of trace.stages) (columns[s.layer] ??= []).push(s)
    const maxRows = Math.max(...trace.stages.map((s) => s.size))
    // an always-active/inactive ReLU gets a third line (h = ...), so leave room for it
    const hasExact = trace.stages.some((s) => s.kind === 'relu' && s.linear.length > 0 &&
      trace.stages[s.index - 1].bounds.some((b) => b.lower >= 0 || b.upper <= 0))
    const gapY = eqOn ? GAP_Y_EQ + (hasExact ? EXACT_H : 0) : GAP_Y
    const actGap = eqOn && trace.stages.some((s) => s.relax.length > 0) ? ACT_GAP_EQ : ACT_GAP
    const height = TOP + maxRows * CELL_H + (maxRows - 1) * gapY + (eqOn ? 40 + (hasExact ? EXACT_H : 0) : 14)
    const pos: Point[][] = []
    const colX: number[] = []
    const colW: number[] = []
    let x = PAD
    for (const col of columns) {
      colX.push(x)
      col.forEach((s, n) => {
        if (n > 0) x += actGap
        const offset = ((maxRows - s.size) * (CELL_H + gapY)) / 2
        pos[s.index] = Array.from({ length: s.size }, (_, j) => ({ x, y: TOP + offset + j * (CELL_H + gapY) }))
        x += CELL_W
      })
      colW.push(x - colX[colX.length - 1])
      x += GAP_X
    }
    // plus room for the output's equations, measured after render (they can be wider than the cell)
    const width = x - GAP_X + PAD + overflow

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
          edges.push({ key: `${k}-${j}-${i}`, layer: k, i, j, w, dst: dst.index, from, to, label: pointAt(from, to, t) })
        }),
      )
    })
    return { columns, pos, colX, colW, width, height, edges }
  }, [trace.stages, network, eqOn, overflow])

  // step index at which each (stage, neuron) first gets its bounds
  const revealAt = useMemo(() => {
    const m = new Map<string, number>()
    trace.steps.forEach((s, i) => {
      const js = s.neuron != null ? [s.neuron] : Array.from({ length: trace.stages[s.stage].size }, (_, j) => j)
      for (const j of js) if (!m.has(`${s.stage}:${j}`)) m.set(`${s.stage}:${j}`, i)
    })
    return m
  }, [trace])

  // grow the canvas if equations (e.g. under the outputs) reach past its right edge;
  // measure again once the math fonts arrive, since they change the text width
  const [, setFontsTick] = useState(0)
  useEffect(() => {
    const bump = () => setFontsTick((t) => t + 1)
    document.fonts.ready.then(bump)
    document.fonts.addEventListener('loadingdone', bump)
    return () => document.fonts.removeEventListener('loadingdone', bump)
  }, [])
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const b = svg.getBBox()
    const need = Math.max(0, Math.ceil(b.x + b.width + 6 - (layout.width - overflow)))
    if (Math.abs(need - overflow) > 1) setOverflow(need)
  })

  const maxAbsW = Math.max(1e-9, ...layout.edges.map((e) => Math.abs(e.w)))

  const revealed = (s: number, j: number) => (revealAt.get(`${s}:${j}`) ?? Infinity) <= step
  const isActive = (s: number, j: number) => s === cur.stage && (cur.neuron == null || j === cur.neuron)
  const isSource = (s: number, j: number) => {
    if (focus || cur.neuron == null || s !== cur.stage - 1) return false
    return curStage.kind === 'affine' || (curStage.kind === 'relu' && j === cur.neuron)
  }
  // while walking through sub-steps, only the weighted sums being expanded light up
  const edgeActive = (e: Edge) =>
    focus
      ? !!focus.expanded && focus.expanded.stage === e.dst && focus.expanded.neurons.includes(e.j)
      : curStage.kind === 'affine' && cur.neuron === e.j && curStage.layer === e.layer + 1
  const focusing = !!focus || (curStage.kind === 'affine' && cur.neuron != null)
  // neurons that appear in the target's current expression
  const inExpr = (stage: number, j: number) =>
    !!focus && focus.stage === stage &&
    ((focus.side !== 'upper' && Math.abs(focus.lower.coeffs[j]) > 1e-12) ||
     (focus.side !== 'lower' && Math.abs(focus.upper.coeffs[j]) > 1e-12))
  const isTarget = (stage: number, j: number) => !!focus && stage === cur.stage && j === cur.neuron
  const lineUsed = (stage: number, neuron: number, line: 'lower' | 'upper') =>
    !!focus?.lines.some((l) => l.stage === stage && l.neuron === neuron && l.line === line)

  const openEditor = (target: Target, at: Point) => {
    const svg = svgRef.current
    const outer = outerRef.current
    if (!svg || !outer) return
    const r = svg.getBoundingClientRect()
    const o = outer.getBoundingClientRect()
    // the viewBox is scaled to fit and centered inside the svg box
    const scale = Math.min(r.width / layout.width, r.height / layout.height)
    const dx = (r.width - layout.width * scale) / 2
    const dy = (r.height - layout.height * scale) / 2
    setEditing({ target, left: r.left - o.left + dx + at.x * scale, top: r.top - o.top + dy + at.y * scale })
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
    const r = svgRef.current?.getBoundingClientRect()
    return r ? Math.min(r.width / layout.width, r.height / layout.height) : 1
  }
  const stepZoom = (dir: 1 | -1) => {
    const z = effectiveZoom()
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.01) : [...ZOOMS].reverse().find((v) => v < z - 0.01)
    if (next) setZoom(next)
  }
  const svgStyle =
    zoom === 'fit'
      // fill the card's width, but never taller than most of the window; below 65%, scroll instead
      ? { width: '100%', height: 'auto', maxHeight: '74vh' }
      : { width: layout.width * zoom, maxWidth: 'none' }

  const t = editing?.target
  return (
    <div className="diagram-outer" ref={outerRef}>
      <div className="diagram-toolbar">
        <span className="muted small">Click a neuron to explain it, or a weight or bias to edit it.</span>
        {hasEq && (
          <label className="toggle">
            <input type="checkbox" checked={showEq} onChange={(e) => setShowEq(e.target.checked)} />
            <span>Show equations</span>
          </label>
        )}
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
          {/* arrowhead for the z -> h activation arrows */}
          <defs>
            {/* fixed size (not scaled by stroke width), one per state so the head matches its line */}
            {['', '-on'].map((v) => (
              <marker key={v} id={arrowId + v} viewBox="0 0 10 10" refX="0" refY="5" markerUnits="userSpaceOnUse"
                markerWidth={ARROW_HEAD} markerHeight={ARROW_HEAD} orient="auto">
                <path d="M0,1.5 L10,5 L0,8.5 z" className={`arrow-head${v}`} />
              </marker>
            ))}
          </defs>

          {/* column headers: one title per layer, one label per stage */}
          {layout.columns.map((col, c) => {
            const title = c === 0 ? 'Input' : c === layout.columns.length - 1 ? 'Output' : `Layer ${c}`
            return (
              <g key={c}>
                <text x={layout.colX[c] + layout.colW[c] / 2} y={18} textAnchor="middle" className="col-title">{title}</text>
                {col.map((s) => (
                  <text key={s.index} x={layout.pos[s.index][0].x + CELL_W / 2} y={34} textAnchor="middle" className="col-sub">
                    {s.kind === 'input' ? 'input box' : s.kind === 'affine' ? 'Linear' : 'ReLU'}
                  </text>
                ))}
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
                  style={{ strokeWidth: 0.6 + 1.1 * (Math.abs(e.w) / maxAbsW) }}
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

          {/* activation arrows: one z -> h arrow per neuron */}
          {trace.stages.filter((s) => s.kind === 'relu').map((s) =>
            layout.pos[s.index].map((p, j) => {
              const x0 = layout.pos[s.index - 1][j].x + CELL_W
              const y0 = p.y + CELL_H / 2
              const on = isActive(s.index, j)
              // stop short of the dashed outline (4px out, plus its halo) so the head is never covered
              const tip = p.x - 8
              // centre of the visible shaft (the head takes the last ARROW_HEAD px), so both halves match
              const mid = (x0 + tip - ARROW_HEAD) / 2
              const relax = s.relax[j]
              const eqW = p.x - x0 - 10
              return (
                <g key={`act-${s.index}-${j}`} className={`act ${on ? 'on' : ''}`}>
                  <g className={focusing && !on ? 'dim' : ''}>
                    {/* the line stops where the head begins; the head reaches the tip */}
                    <line x1={x0} x2={tip - ARROW_HEAD} y1={y0} y2={y0} markerEnd={`url(#${arrowId}${on ? '-on' : ''})`} />
                    <g className="relu-glyph" transform={`translate(${mid},${y0})`}>
                      <circle r={10} />
                      <polyline points="-5.5,2.5 0,2.5 5,-3.5" />
                    </g>
                  </g>
                  {/* the ReLU's two lines in terms of z: upper above the arrow, lower below */}
                  {eqOn && relax && revealed(s.index, j) && (
                    <g className={`eq ${on ? 'on' : ''}`}>
                      <title>DeepPoly's two lines for this ReLU, in terms of its input z</title>
                      <Eq x={mid} y={y0 - 15} anchor="middle" maxW={eqW} className={`hi ${lineUsed(s.index, j, 'upper') ? 'used' : focus ? 'unused' : ''}`}
                        toks={[mvar('h', j + 1), mtxt(' ≤ '), ...mlin([relax.upper.slope], relax.upper.bias, () => mvar('z', j + 1))]} />
                      <Eq x={mid} y={y0 + 24} anchor="middle" maxW={eqW} className={`lo ${lineUsed(s.index, j, 'lower') ? 'used' : focus ? 'unused' : ''}`}
                        toks={[mvar('h', j + 1), mtxt(' ≥ '), ...mlin([relax.lower.slope], relax.lower.bias, () => mvar('z', j + 1))]} />
                    </g>
                  )}
                </g>
              )
            }),
          )}

          {/* neurons: one cell per stage */}
          {trace.stages.map((s) =>
            layout.pos[s.index].map(({ x, y }, j) => {
              const clip = `cell-${s.index}-${j}`
              const b = s.bounds[j]
              const show = revealed(s.index, j)
              // the node being walked is concretized only at the final step
              const concrete = show && !(isTarget(s.index, j) && focus && !focus.concrete)
              // a ReLU output under DeepPoly (it has a relaxation) never needs an interval
              const noInterval = s.relax.length > 0
              const label = `[${fmt(b.lower)}, ${fmt(b.upper)}]`
              const status = show ? reluStatus(s, j) : null
              const lin = s.linear[j]
              const bias = s.kind === 'affine' ? network.layers[s.layer - 1].bias[j] : null
              const tip = [
                `${textSym(s, j)}${s.relax.length > 0 ? '' : ` ∈ ${show ? label : '?'}`}${status ? ` · ${STATUS_LABEL[status]}` : ''}`,
                ...(show && lin
                  ? [`${textSym(s, j)} ≥ ${textLin(lin.lower.coeffs, lin.lower.const)}`,
                     `${textSym(s, j)} ≤ ${textLin(lin.upper.coeffs, lin.upper.const)}`]
                  : []),
                'click to explain',
              ].join('\n')
              const cx = x + CELL_W / 2
              return (
                <g key={`${s.index}-${j}`}>
                  <g
                    className={`cell ${isActive(s.index, j) ? 'active' : ''} ${isSource(s.index, j) ? 'source' : ''} ${show ? '' : 'pending'}`}
                    onClick={() => onJump(s.index, j)}
                  >
                    <title>{tip}</title>
                    <clipPath id={clip}>
                      <rect x={x} y={y} width={CELL_W} height={CELL_H} rx={14} />
                    </clipPath>
                    <rect x={x} y={y} width={CELL_W} height={CELL_H} rx={14} className="pill" />
                    {status && (
                      <>
                        <rect x={x} y={y} width={CELL_W} height={CELL_H} clipPath={`url(#${clip})`} className={`relu-tint st-${status}`} />
                        <rect x={x} y={y + CELL_H - 3} width={CELL_W} height={3} clipPath={`url(#${clip})`} className={`relu-strip st-${status}`} />
                      </>
                    )}
                    <rect x={x} y={y} width={CELL_W} height={CELL_H} clipPath={`url(#${clip})`} className="cell-bg" />
                    <rect x={x} y={y} width={CELL_W} height={CELL_H} rx={14} className="pill-border" />
                    <Symbol stage={s} j={j} x={cx} y={noInterval ? y + CELL_H / 2 + 7 : y + 24} />
                    {!noInterval && <text
                      x={cx}
                      y={y + 46}
                      textAnchor="middle"
                      className="cell-val"
                      {...(concrete && label.length > 13 ? { textLength: CELL_W - 12, lengthAdjust: 'spacingAndGlyphs' } : {})}
                    >
                      {concrete ? (
                        <>
                          [<tspan className="lo">{fmt(b.lower)}</tspan>, <tspan className="hi">{fmt(b.upper)}</tspan>]
                        </>
                      ) : (
                        '?'
                      )}
                    </text>}
                  </g>

                  {/* z, h, y: bounds over the inputs. While its back-substitution is being
                      walked, the target shows its bounds at the current depth instead, written
                      over whichever layer the walk has reached. */}
                  {eqOn && s.kind !== 'input' && lin && show && (() => {
                    const target = isTarget(s.index, j) && focus
                    const over = target ? trace.stages[focus.stage] : trace.stages[0]
                    // letter + index only: the outlined cells show which layer is meant
                    const sym = (i: number) => mvar(over.letter, i + 1)
                    // during the upper walk the finished lower bound stays, greyed, over the inputs
                    const loDone = !!target && focus.side === 'upper'
                    const loSym = loDone ? (i: number) => mvar(trace.stages[0].letter, i + 1) : sym
                    const lb = target ? focus.lower : lin.lower
                    const ub = target ? focus.upper : lin.upper
                    return (
                      <g className={`eq ${isActive(s.index, j) ? 'on' : ''} ${target ? 'walking' : ''}`}>
                        <title>{target ? `Bounds so far, written over ${textSym(over)}` : 'Linear bounds of this neuron over the inputs'}</title>
                        {/* while walking one bound, show only that one */}
                        <Eq x={cx} y={y + CELL_H + 20} anchor="middle" className={`lo ${loDone ? 'done' : ''}`}
                          toks={[mvar(s.letter, j + 1), mtxt(' ≥ '), ...mlin(lb.coeffs, lb.const, loSym)]} />
                        {!(target && focus.side === 'lower') && (
                          <Eq x={cx} y={y + CELL_H + 36} anchor="middle" className="hi"
                            toks={[mvar(s.letter, j + 1), mtxt(' ≤ '), ...mlin(ub.coeffs, ub.const, sym)]} />
                        )}
                        {/* always active/inactive: the two lines coincide, so the neuron is exactly this */}
                        {(status === 'on' || status === 'off') && !(target && focus.side != null) && (
                          <Eq x={cx} y={y + CELL_H + 36 + EXACT_H} anchor="middle" className="exact"
                            toks={[mtxt('(or '), mvar(s.letter, j + 1), mtxt(' = '), ...(
                              status === 'off' ? [mtxt('0')]
                              : sameLin(lb, ub) ? mlin(lb.coeffs, lb.const, sym)
                              : [mvar(trace.stages[s.index - 1].letter, j + 1)]), mtxt(')')]} />
                        )}
                      </g>
                    )
                  })()}

                  {bias != null && (
                    <text
                      x={cx}
                      y={y - 10}
                      textAnchor="middle"
                      className={`bias-label math ${isActive(s.index, j) ? 'on' : ''}`}
                      onClick={() => openEditor({ kind: 'bias', layer: s.layer - 1, j, value: bias }, { x: cx, y: y - 12 })}
                    >
                      <title>bias · click to edit</title>
                      <MathSpans toks={[mvar('b'), mtxt(` = ${fmt(bias).replace('-', '−')}`)]} size={12} />
                    </text>
                  )}
                </g>
              )
            }),
          )}

          {/* back-substitution: outline the neurons the target's current expression refers to */}
          {focus && layout.pos[focus.stage].map((p, i) =>
            inExpr(focus.stage, i) ? (
              <g key={`ref-${i}`}>
                {/* halo in the page colour so edges and arrowheads stop at the ring instead of crossing it */}
                <rect x={p.x - 4} y={p.y - 4} width={CELL_W + 8} height={CELL_H + 8} rx={17} className="ref-halo" />
                <rect x={p.x - 4} y={p.y - 4} width={CELL_W + 8} height={CELL_H + 8} rx={17} className="ref-ring">
                  <title>appears in the current bound expression</title>
                </rect>
              </g>
            ) : null,
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
