import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmt, textLin, textSym } from '../format'
import { MathSpans, mlin, mtxt, mvar, mwidth, type MTok } from './SvgMath'
import { MAX_HIDDEN, MAX_WIDTH } from '../network'
import type { Zoom } from './DiagramTools'
import type { DiagramFocus, DiagramPrompt, DiagramReveal, InputBox, LinBound, Network, Stage, Trace } from '../types'
import { NumberField } from './NumberField'

const CELL_W = 100
const CELL_H = 60
const GAP_X = 124 // between layers (weighted edges)
const ACT_GAP = 60 // between z and h of the same layer (one activation arrow)
const ACT_GAP_EQ = 128 // ... wide enough to print the ReLU's two lines on the arrow
const GAP_Y = 36 // bias label sits above each neuron, inside this gap
const GAP_Y_EQ = 77 // ... plus two bound equations under the neuron above it
// baselines of the two bound lines under a neuron, far enough apart that subscripts never touch the line below
const EQ_LINE1 = 21
const EQ_LINE2 = 42
const EXACT_H = 21 // ... plus one more line for "h = ..." under always-active/inactive ReLUs
const DEF_H = 22 // without bound lines: one line for the equation of the neuron being worked out
const PROMPT_H = 24 // ... plus one line for the next question (see `prompt`)
const EQ_MAX_W = 210
const MAX_GAP_STRETCH = 150 // in "Fit", rows may spread apart by at most this much more
const TOP = 70 // column titles + room for the first row's bias labels
const PAD = 12
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
  /** the question the next step answers, placed where its answer will appear */
  prompt: DiagramPrompt | null
  /** clicking the prompt: the same as Continue */
  onPrompt: () => void
  /** a neuron worked out in parts (IBP): its equation under it, its bounds one at a time */
  reveal: DiagramReveal | null
  onJump: (stage: number, neuron: number) => void
  onEditWeight: (layer: number, j: number, i: number, value: number) => void
  onEditBias: (layer: number, j: number, value: number) => void
  box: InputBox
  onEditBox: (box: InputBox) => void
  /** column c: 0 = the inputs, k = dense layer k (a hidden neuron brings its ReLU) */
  onAddNeuron: (c: number) => void
  onRemoveNeuron: (c: number, j: number) => void
  /** insert a hidden layer between columns g and g + 1 */
  onInsertLayer: (g: number) => void
  /** remove hidden layer c (its column) */
  onRemoveLayer: (c: number) => void
  /** shown under the diagram */
  legend?: ReactNode
  zoom: Zoom
  /** reports the scale "Fit" shows, so the zoom buttons can continue from it */
  onFitScale: (scale: number) => void
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
  | { kind: 'box'; i: number; side: 'lower' | 'upper' }

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

/** Neuron symbol like z₄, set as KaTeX sets it. */
function Symbol({ stage, j, x, y }: { stage: Stage; j: number; x: number; y: number }) {
  const sub = String(stage.first + j + 1)
  const lw = (LETTER_EM[stage.letter] ?? 0.55) * 21
  const sw = scriptEm(sub) * 12
  const x0 = x - (lw + sw) / 2
  return (
    <g className="cell-sym">
      <text x={x0} y={y} className="sym-letter">{stage.letter}</text>
      <text x={x0 + lw} y={y + 4} className="sym-script">{sub}</text>
    </g>
  )
}

/** A neuron in an equation, written as in its cell, e.g. z₄. */
const msym = (stage: Stage, i: number): MTok => ({ s: stage.letter, v: true, sub: String(stage.first + i + 1) })

/** Equation text under a neuron; squeezed if it would run into the next column. */
const EQ_SIZE = 14
const PROMPT_SIZE = 14.5
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

export function NetworkDiagram({
  network, trace, step, focus, prompt, onPrompt, reveal, onJump, onEditWeight, onEditBias, box, onEditBox, onAddNeuron, onRemoveNeuron,
  onInsertLayer, onRemoveLayer, legend, zoom, onFitScale,
}: Props) {
  const outerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  // `${column}:${row}`: the neuron under the pointer, which shows its remove button
  const [hoverNeuron, setHoverNeuron] = useState<string | null>(null)
  // hidden layer whose column the pointer is over (anywhere, gaps included),
  // which shows its remove button next to the title
  const [hoverCol, setHoverCol] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ target: Target; left: number; top: number } | null>(null)
  const hasEq = trace.stages.some((s) => s.relax.length > 0 || (s.index > 0 && s.linear.length > 0))
  // domains with linear bounds print them under the neurons
  const eqOn = hasEq

  const cur = trace.steps[Math.min(step, trace.steps.length - 1)]
  const curStage = trace.stages[cur.stage]

  const [overflow, setOverflow] = useState(0)
  // size of the space "Fit" fills. Only measured when the page is one window tall
  // (same breakpoint as the wide-screen block in styles.css): below it the space
  // has no height of its own, since it grows with the diagram.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const wide = window.matchMedia('(min-width: 1101px)')
    const measure = () => {
      const next = wide.matches && el.clientWidth > 0 ? { w: el.clientWidth, h: el.clientHeight } : null
      setArea((a) => (a?.w === next?.w && a?.h === next?.h ? a : next))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    wide.addEventListener('change', measure)
    measure()
    return () => {
      ro.disconnect()
      wide.removeEventListener('change', measure)
    }
  }, [])
  const layout = useMemo(() => {
    const columns: Stage[][] = []
    for (const s of trace.stages) (columns[s.layer] ??= []).push(s)
    const maxRows = Math.max(...trace.stages.map((s) => s.size))
    // an always-active/inactive ReLU gets a third line (h = ...), so leave room for it
    const hasExact = trace.stages.some((s) => s.kind === 'relu' && s.linear.length > 0 &&
      trace.stages[s.index - 1].bounds.some((b) => b.lower >= 0 || b.upper <= 0))
    const gapY0 = (eqOn ? GAP_Y_EQ + (hasExact ? EXACT_H : 0) : GAP_Y + DEF_H) + PROMPT_H
    const actGap = eqOn && trace.stages.some((s) => s.relax.length > 0) ? ACT_GAP_EQ : ACT_GAP
    // one "+" under each column, below its last neuron and that neuron's equations
    const eqRoom = (eqOn ? EQ_LINE2 + (hasExact ? EXACT_H : 0) + 6 : DEF_H) + PROMPT_H

    /** Positions for a given gap between rows. Only the height depends on it. */
    const place = (gapY: number) => {
      const baseHeight = TOP + maxRows * CELL_H + (maxRows - 1) * gapY + (eqOn ? EQ_LINE2 + 2 + (hasExact ? EXACT_H : 0) : 14 + DEF_H) + PROMPT_H
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
      const adders = columns.map((col, c) => {
        // under the column's first cell: z for a hidden layer, not its ReLU
        const p = pos[col[0].index][col[0].size - 1]
        return { c, size: col[0].size, x: p.x + CELL_W / 2, y: p.y + CELL_H + (c > 0 ? eqRoom : 0) + 22 }
      })
      const height = Math.max(baseHeight, ...adders.map((a) => a.y + 12 + PAD))
      // plus room for the output's equations, measured after render (they can be wider than the cell)
      const width = x - GAP_X + PAD + overflow
      return { pos, colX, colW, adders, height, width }
    }

    // "Fit" on a wide screen: spread the rows until the diagram has the shape of
    // the space it is shown in, so it fills the height as well as the width
    let placed = place(gapY0)
    if (zoom === 'fit' && area && maxRows > 1) {
      const target = (placed.width * area.h) / area.w
      const extra = Math.min(MAX_GAP_STRETCH, Math.max(0, (target - placed.height) / (maxRows - 1)))
      if (extra > 1) placed = place(gapY0 + extra)
    }
    const { pos, colX, colW, adders, height, width } = placed

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
    return { columns, pos, colX, colW, width, height, edges, adders }
  }, [trace.stages, network, eqOn, overflow, zoom, area])

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

  // zooming keeps the point in the middle of the view where it was (the middle of
  // the network, coming from "Fit"): remember it on scroll, restore it on zoom
  const viewCenter = useRef({ x: 0.5, y: 0.5 })
  const rememberCenter = () => {
    const el = wrapRef.current
    if (el) viewCenter.current = {
      x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
      y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
    }
  }
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (zoom === 'fit') {
      // "Fit" shows everything, so there is nothing to scroll: start from the top
      el.scrollTop = 0
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
      rememberCenter()
      return
    }
    el.scrollLeft = viewCenter.current.x * el.scrollWidth - el.clientWidth / 2
    el.scrollTop = viewCenter.current.y * el.scrollHeight - el.clientHeight / 2
  }, [zoom])

  // The diagram never scrolls vertically: zoomed in, its card grows and the page
  // scrolls. A diagram wider than the card is dragged sideways instead of showing
  // a scrollbar; a drag must not also count as a click on what it started on.
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const [pannable, setPannable] = useState(false)
  const [panning, setPanning] = useState(false)
  useLayoutEffect(() => {
    const el = wrapRef.current
    const can = !!el && el.scrollWidth > el.clientWidth + 1
    if (can !== pannable) setPannable(can)
  })
  const panStart = (e: PointerEvent) => {
    const el = wrapRef.current
    if (!pannable || !el || e.button !== 0) return
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false }
  }
  const panMove = (e: PointerEvent) => {
    const d = drag.current
    const el = wrapRef.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 4) return
    if (!d.moved) {
      d.moved = true
      el.setPointerCapture(e.pointerId)
      setPanning(true)
    }
    el.scrollLeft = d.left - dx
  }
  const panEnd = () => {
    if (drag.current && !drag.current.moved) drag.current = null
    setPanning(false)
  }

  useLayoutEffect(() => {
    const r = svgRef.current?.getBoundingClientRect()
    if (zoom === 'fit' && r && r.width > 0) onFitScale(Math.min(r.width / layout.width, r.height / layout.height))
  })
  // "Fit" is sized by CSS (.diagram.fit): the whole network, as large as the space allows
  const svgStyle = zoom === 'fit' ? undefined : { width: layout.width * zoom, maxWidth: 'none' }

  const t = editing?.target
  return (
    <div className="diagram-outer" ref={outerRef}>
      <div
        className={`diagram-wrap ${pannable ? 'pannable' : ''} ${panning ? 'panning' : ''}`}
        ref={wrapRef}
        onScroll={rememberCenter}
        onPointerDown={panStart}
        onPointerMove={panMove}
        onPointerUp={panEnd}
        onPointerCancel={() => {
          drag.current = null
          setPanning(false)
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.stopPropagation()
            e.preventDefault()
          }
          drag.current = null
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className={`diagram ${zoom === 'fit' ? 'fit' : ''}`}
          style={svgStyle}
          role="img"
          aria-label="Network diagram with the bounds of every neuron"
          onMouseMove={(e) => {
            const m = svgRef.current?.getScreenCTM()
            if (!m) return
            const x = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()).x
            const last = layout.columns.length - 1
            const c = layout.colX.findIndex((x0, k) => k > 0 && k < last && x >= x0 - 12 && x <= x0 + layout.colW[k] + 12)
            setHoverCol(c >= 0 ? c : null)
          }}
          onMouseLeave={() => setHoverCol(null)}
        >
          <title>Click a neuron to explain it, or a weight, bias or input bound to edit it.</title>

          {/* column headers: one title per layer, one label per stage */}
          {layout.columns.map((col, c) => {
            const title = c === 0 ? 'Input' : c === layout.columns.length - 1 ? 'Output' : `Layer ${c}`
            const hidden = c > 0 && c < layout.columns.length - 1
            const mid = layout.colX[c] + layout.colW[c] / 2
            return (
              <g key={c}>
                <text x={mid} y={24} textAnchor="middle" className="col-title">{title}</text>
                {hidden && (
                  <g
                    className={`node-remove ${hoverCol === c ? 'show' : ''}`}
                    transform={`translate(${mid + title.length * 5 + 14},${17})`}
                    onClick={() => {
                      setHoverCol(null)
                      setEditing(null)
                      onRemoveLayer(c)
                    }}
                  >
                    <title>{`remove layer ${c}`}</title>
                    <circle r={8} />
                    <line x1={-3.5} x2={3.5} />
                  </g>
                )}
                {col.map((s) => (
                  <text key={s.index} x={layout.pos[s.index][0].x + CELL_W / 2} y={40} textAnchor="middle" className="col-sub">
                    {s.kind === 'input' ? 'Input box' : s.kind === 'affine' ? 'Linear' : 'ReLU'}
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
            const w = label.length * 7.6 + 12
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
                <rect x={-w / 2} y={-9.5} width={w} height={19} rx={9.5} />
                <text textAnchor="middle" y={4.6}>{label}</text>
              </g>
            )
          })}

          {/* activation arrows: one z -> h arrow per neuron */}
          {trace.stages.filter((s) => s.kind === 'relu').map((s) =>
            layout.pos[s.index].map((p, j) => {
              const x0 = layout.pos[s.index - 1][j].x + CELL_W
              const y0 = p.y + CELL_H / 2
              const on = isActive(s.index, j)
              // a plain line into h, like the weight edges into z; the ReLU glyph sits at its middle
              const mid = (x0 + p.x) / 2
              const relax = s.relax[j]
              const eqW = p.x - x0 - 10
              return (
                <g key={`act-${s.index}-${j}`} className={`act ${on ? 'on' : ''}`}>
                  <g className={focusing && !on ? 'dim' : ''}>
                    <line x1={x0} x2={p.x} y1={y0} y2={y0} />
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
                        toks={[msym(s, j), mtxt(' ≤ '), ...mlin([relax.upper.slope], relax.upper.bias, () => msym(trace.stages[s.index - 1], j))]} />
                      <Eq x={mid} y={y0 + 24} anchor="middle" maxW={eqW} className={`lo ${lineUsed(s.index, j, 'lower') ? 'used' : focus ? 'unused' : ''}`}
                        toks={[msym(s, j), mtxt(' ≥ '), ...mlin([relax.lower.slope], relax.lower.bias, () => msym(trace.stages[s.index - 1], j))]} />
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
              const part = reveal && reveal.stage === s.index && reveal.neuron === j ? reveal.bounds : 'both'
              const concrete = show && part === 'both' && !(isTarget(s.index, j) && focus && !focus.concrete)
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
              // the next question asks for this interval: the "?" is what Continue fills in
              const asking = prompt?.slot === 'interval' && prompt.stage === s.index && prompt.neuron === j
              return (
                <g key={`${s.index}-${j}`}>
                  <g
                    className={`cell ${isActive(s.index, j) ? 'active' : ''} ${isSource(s.index, j) ? 'source' : ''} ${show ? '' : 'pending'} ${asking ? 'asking' : ''}`}
                    onClick={() => (asking ? onPrompt() : onJump(s.index, j))}
                    onMouseEnter={() => setHoverNeuron(`${s.layer}:${j}`)}
                    onMouseLeave={() => setHoverNeuron((h) => (h === `${s.layer}:${j}` ? null : h))}
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
                    {asking && <rect x={x - 4} y={y - 4} width={CELL_W + 8} height={CELL_H + 8} rx={17} className="ask-ring" />}
                    <Symbol stage={s} j={j} x={cx} y={noInterval ? y + CELL_H / 2 + 7 : y + 24} />
                    {!noInterval && <text
                      x={cx}
                      y={y + 47}
                      textAnchor="middle"
                      className="cell-val"
                      {...(concrete && label.length * 8.3 > CELL_W - 12 ? { textLength: CELL_W - 12, lengthAdjust: 'spacingAndGlyphs' } : {})}
                    >
                      {concrete ? (
                        <>
                          [<tspan className={`lo ${hover === `box:${j}:lower` ? 'hovered' : ''}`}>{fmt(b.lower)}</tspan>,{' '}
                          <tspan className={`hi ${hover === `box:${j}:upper` ? 'hovered' : ''}`}>{fmt(b.upper)}</tspan>]
                        </>
                      ) : show && part === 'lower' ? (
                        <>[<tspan className="lo">{fmt(b.lower)}</tspan>, <tspan className="ask">?</tspan>]</>
                      ) : (
                        '?'
                      )}
                    </text>}
                    {/* the input box is edited in place: click either end of the interval */}
                    {s.kind === 'input' && (['lower', 'upper'] as const).map((side, k) => (
                      <rect
                        key={side}
                        x={x + (k * CELL_W) / 2}
                        y={y + 31}
                        width={CELL_W / 2}
                        height={22}
                        className="bound-hit"
                        onMouseEnter={() => setHover(`box:${j}:${side}`)}
                        onMouseLeave={() => setHover((h) => (h === `box:${j}:${side}` ? null : h))}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          openEditor({ kind: 'box', i: j, side }, { x: cx, y: y + 4 })
                        }}
                      >
                        <title>{`${side} bound of ${textSym(s, j)} · click to edit`}</title>
                      </rect>
                    ))}
                  </g>

                  {/* z, h, y: bounds over the inputs. While its back-substitution is being
                      walked, the target shows its bounds at the current depth instead, written
                      over whichever layer the walk has reached. */}
                  {eqOn && s.kind !== 'input' && lin && show && (() => {
                    const target = isTarget(s.index, j) && focus
                    const over = target ? trace.stages[focus.stage] : trace.stages[0]
                    const sym = (i: number) => msym(over, i)
                    // during the upper walk the finished lower bound stays, greyed, over the inputs
                    const loDone = !!target && focus.side === 'upper'
                    const loSym = loDone ? (i: number) => msym(trace.stages[0], i) : sym
                    const lb = target ? focus.lower : lin.lower
                    const ub = target ? focus.upper : lin.upper
                    return (
                      <g className={`eq ${isActive(s.index, j) ? 'on' : ''} ${target ? 'walking' : ''}`}>
                        <title>{target ? `Bounds so far, written over ${textSym(over)}` : 'Linear bounds of this neuron over the inputs'}</title>
                        {/* while walking one bound, show only that one */}
                        <Eq x={cx} y={y + CELL_H + EQ_LINE1} anchor="middle" className={`lo ${loDone ? 'done' : ''}`}
                          toks={[msym(s, j), mtxt(' ≥ '), ...mlin(lb.coeffs, lb.const, loSym)]} />
                        {!(target && focus.side === 'lower') && (
                          <Eq x={cx} y={y + CELL_H + EQ_LINE2} anchor="middle" className="hi"
                            toks={[msym(s, j), mtxt(' ≤ '), ...mlin(ub.coeffs, ub.const, sym)]} />
                        )}
                        {/* always active/inactive: the two lines coincide, so the neuron is exactly this */}
                        {(status === 'on' || status === 'off') && !(target && focus.side != null) && (
                          <Eq x={cx} y={y + CELL_H + EQ_LINE2 + EXACT_H} anchor="middle" className="exact"
                            toks={[mtxt('(or '), msym(s, j), mtxt(' = '), ...(
                              status === 'off' ? [mtxt('0')]
                              : sameLin(lb, ub) ? mlin(lb.coeffs, lb.const, sym)
                              : [msym(trace.stages[s.index - 1], j)]), mtxt(')')]} />
                        )}
                      </g>
                    )
                  })()}

                  {/* each neuron's equation, e.g. z₁ = x₁ + x₂ + 1, from its step on; bold while worked on */}
                  {!eqOn && s.kind !== 'input' && show && (
                    <g className={`eq def ${isActive(s.index, j) ? 'on' : ''}`}>
                      <Eq x={cx} y={y + CELL_H + 20} anchor="middle" className="exact"
                        toks={s.kind === 'relu'
                          ? [msym(s, j), mtxt(' = ReLU('), msym(trace.stages[s.index - 1], j), mtxt(')')]
                          : [msym(s, j), mtxt(' = '), ...mlin(network.layers[s.layer - 1].weight[j], network.layers[s.layer - 1].bias[j],
                              (i) => msym(trace.stages[s.index - 1], i))]} />
                    </g>
                  )}

                  {bias != null && (
                    <text
                      x={cx}
                      y={y - 10}
                      textAnchor="middle"
                      className={`bias-label math ${isActive(s.index, j) ? 'on' : ''}`}
                      onClick={() => openEditor({ kind: 'bias', layer: s.layer - 1, j, value: bias }, { x: cx, y: y - 12 })}
                    >
                      <title>bias · click to edit</title>
                      <MathSpans toks={[mvar('b'), mtxt(` = ${fmt(bias).replace('-', '−')}`)]} size={13.5} />
                    </text>
                  )}
                </g>
              )
            }),
          )}

          {/* remove a neuron: a small "−" on its top-right corner, shown on hover */}
          {layout.columns.map((col, c) => {
            // on the column's first cell: z for a hidden layer, not its ReLU
            if (col[0].size <= 1) return null
            return layout.pos[col[0].index].map((p, j) => {
              const key = `${c}:${j}`
              return (
                <g
                  key={`rm-${key}`}
                  className={`node-remove ${hoverNeuron === key ? 'show' : ''}`}
                  transform={`translate(${p.x + CELL_W - 4},${p.y + 4})`}
                  onMouseEnter={() => setHoverNeuron(key)}
                  onMouseLeave={() => setHoverNeuron((h) => (h === key ? null : h))}
                  onClick={() => {
                    setHoverNeuron(null)
                    setEditing(null)
                    onRemoveNeuron(c, j)
                  }}
                >
                  <title>{`remove ${textSym(col[0], j)}${col.length > 1 ? ' and its ReLU' : ''}`}</title>
                  <circle r={8} />
                  <line x1={-3.5} x2={3.5} />
                </g>
              )
            })
          })}

          {/* add a layer: a "+" in the header row, in the gap between two columns */}
          {layout.columns.length - 2 < MAX_HIDDEN && layout.columns.slice(0, -1).map((_, g) => (
            <g
              key={`add-layer-${g}`}
              className="node-add"
              transform={`translate(${(layout.colX[g] + layout.colW[g] + layout.colX[g + 1]) / 2},${17})`}
              onClick={() => {
                setEditing(null)
                onInsertLayer(g)
              }}
            >
              <title>{`add a layer between ${g === 0 ? 'the input' : `layer ${g}`} and ${g + 1 === layout.columns.length - 1 ? 'the output' : `layer ${g + 1}`}`}</title>
              <circle r={9} />
              <line x1={-3.5} x2={3.5} />
              <line y1={-3.5} y2={3.5} />
            </g>
          ))}

          {/* add a neuron: a "+" under each column */}
          {layout.adders.map((a) =>
            a.size < MAX_WIDTH ? (
              <g key={`add-${a.c}`} className="node-add" transform={`translate(${a.x},${a.y})`} onClick={() => onAddNeuron(a.c)}>
                <title>
                  {a.c === 0 ? 'add an input' : a.c === layout.columns.length - 1 ? 'add an output' : `add a neuron to layer ${a.c}`}
                </title>
                <circle r={11} />
                <line x1={-4.5} x2={4.5} />
                <line y1={-4.5} y2={4.5} />
              </g>
            ) : null,
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
          {prompt && (() => {
            // a whole column's question goes under its last neuron
            const col = layout.pos[prompt.stage]
            const p = col?.[prompt.neuron ?? col.length - 1]
            if (!p) return null
            // box centres: both bound lines while neither is shown, under the lower bound line,
            // under both (the line reserved by PROMPT_H), or just under the neuron without equations
            // without bound lines: the equation's line, or the line under it
            const y = prompt.slot === 'lower' ? p.y + CELL_H + 27
              : prompt.slot === 'upper' ? p.y + CELL_H + EQ_LINE2 + 4
              : prompt.slot === 'def' ? p.y + CELL_H + 15
              : eqOn ? p.y + CELL_H + EQ_LINE2 + 21 : p.y + CELL_H + DEF_H + 20
            return (
              <PromptBox key={`${prompt.stage}-${prompt.neuron}-${prompt.slot}-${JSON.stringify(prompt.text)}`}
                prompt={prompt} x={p.x + CELL_W / 2} y={y} onClick={onPrompt} />
            )
          })()}
        </svg>
      </div>

      <div className="diagram-foot">
        <div className="legend">{legend}</div>
      </div>

      {editing && t?.kind === 'box' && (
        <BoxEditor
          key={`${t.i}-${t.side}`}
          i={t.i}
          side={t.side}
          box={box}
          name={textSym(trace.stages[0], t.i)}
          onBox={onEditBox}
          onClose={() => setEditing(null)}
          style={{ left: editing.left, top: editing.top }}
        />
      )}
      {editing && t && t.kind !== 'box' && (
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

/** The next question in a box, clickable like Continue. The box is sized to the text as rendered. */
function PromptBox({ prompt, x, y, onClick }: { prompt: DiagramPrompt; x: number; y: number; onClick: () => void }) {
  const textRef = useRef<SVGTextElement>(null)
  const [textW, setTextW] = useState(() =>
    prompt.text.reduce((n, t) => n + (t.w ? t.s.length * 6.9 : mwidth([t], PROMPT_SIZE)), 0))
  useLayoutEffect(() => {
    const w = textRef.current?.getComputedTextLength()
    if (w && Math.abs(w - textW) > 0.5) setTextW(w)
  })
  const w = textW + 24
  return (
    <g
      className="next-prompt"
      transform={`translate(${x},${y})`}
      role="button"
      tabIndex={0}
      aria-label={`${prompt.text.map((t) => t.s + (t.sup ?? '') + (t.sub ?? '')).join('')} (continue)`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <title>Click to find out (same as Continue)</title>
      <rect x={-w / 2} y={-11.5} width={w} height={23} rx={11.5} />
      <text ref={textRef} x={-textW / 2} y={4.6}><MathSpans toks={prompt.text} size={PROMPT_SIZE} /></text>
    </g>
  )
}

/** Both bounds of one input. A bound is applied as soon as it is valid; while the
 *  lower bound exceeds the upper one, the box keeps its last valid value. */
function BoxEditor({ i, side, box, name, onBox, onClose, style }: {
  i: number
  side: 'lower' | 'upper'
  box: InputBox
  name: string
  onBox: (b: InputBox) => void
  onClose: () => void
  style: CSSProperties
}) {
  const [draft, setDraft] = useState({ lower: box.lower[i], upper: box.upper[i] })
  const ok = draft.lower <= draft.upper
  const set = (which: 'lower' | 'upper', v: number) => {
    const next = { ...draft, [which]: v }
    setDraft(next)
    if (next.lower <= next.upper) {
      onBox({
        lower: box.lower.map((x, k) => (k === i ? next.lower : x)),
        upper: box.upper.map((x, k) => (k === i ? next.upper : x)),
      })
    }
  }
  return (
    <div
      className="popover box-popover"
      style={style}
      // close once focus leaves both fields (Enter and Escape blur the field)
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose()
      }}
    >
      <div className="popover-title">Input bounds of {name}</div>
      <div className="box-fields">
        <label>
          <span className="muted">lower</span>
          <NumberField value={draft.lower} label={`lower bound of ${name}`} autoFocus={side === 'lower'}
            className={`lo-field ${ok ? '' : 'invalid'}`} onChange={(v) => set('lower', v)} />
        </label>
        <label>
          <span className="muted">upper</span>
          <NumberField value={draft.upper} label={`upper bound of ${name}`} autoFocus={side === 'upper'}
            className={`hi-field ${ok ? '' : 'invalid'}`} onChange={(v) => set('upper', v)} />
        </label>
      </div>
      <div className={ok ? 'popover-hint' : 'popover-error'} role={ok ? undefined : 'alert'}>
        {ok ? 'Enter to close' : 'The lower bound must not exceed the upper bound.'}
      </div>
    </div>
  )
}
