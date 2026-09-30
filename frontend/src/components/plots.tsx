import { useId, type ReactNode } from 'react'
import { fmt } from '../format'
import type { Bounds, Line } from '../types'
import { MathSpans, mlin, mtxt, mvar } from './SvgMath'

/** Pad a [min, max] range so it always includes 0 and never collapses. */
export function niceRange(values: number[]): [number, number] {
  let min = Math.min(0, ...values)
  let max = Math.max(0, ...values)
  if (max - min < 1e-9) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.12
  return [min - pad, max + pad]
}

interface BarProps {
  bounds: Bounds
  range: [number, number]
  label?: ReactNode
  faded?: boolean
  /** Range actually reached on sampled inputs, drawn inside the bound. */
  sampled?: Bounds
}

/** One interval drawn on a number line, with a tick at zero. */
export function IntervalBar({ bounds, range, label, faded, sampled }: BarProps) {
  const W = 260
  const H = 34
  const x = (v: number) => ((v - range[0]) / (range[1] - range[0])) * W
  const x0 = x(0)
  const xl = x(bounds.lower)
  const xu = x(bounds.upper)
  return (
    <div className={`ibar ${faded ? 'faded' : ''}`}>
      {label && <div className="ibar-label">{label}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="ibar-svg" role="img"
        aria-label={`interval from ${fmt(bounds.lower)} to ${fmt(bounds.upper)}`}>
        <line x1={0} x2={W} y1={14} y2={14} className="axis" />
        <line x1={x0} x2={x0} y1={8} y2={20} className="axis-zero" />
        <text x={x0} y={32} className="axis-text" textAnchor="middle">0</text>
        <rect x={xl} y={9} width={Math.max(xu - xl, 1.5)} height={10} rx={3} className="ibar-fill" />
        <line x1={xl} x2={xl} y1={5} y2={23} className="stroke-lo" />
        <line x1={xu} x2={xu} y1={5} y2={23} className="stroke-hi" />
        {sampled && (
          <rect x={x(sampled.lower)} y={12} width={Math.max(x(sampled.upper) - x(sampled.lower), 2)} height={4} rx={2}
            className="ibar-sampled">
            <title>{`reached on sampled inputs: [${fmt(sampled.lower)}, ${fmt(sampled.upper)}]`}</title>
          </rect>
        )}
      </svg>
      <div className="ibar-values mono">
        [<span className="lo">{fmt(bounds.lower)}</span>, <span className="hi">{fmt(bounds.upper)}</span>]
      </div>
    </div>
  )
}

/** ReLU curve with the incoming interval on the x-axis and the outgoing one on
 *  the y-axis. With `relax`, also draws the linear lower/upper bounds and the
 *  region between them. */
export function ReluPlot({ pre, relax, used, small, lineLabels = true }: {
  pre: Bounds
  relax?: { lower: Line; upper: Line }
  /** emphasize one of the two lines (the other is drawn faintly) */
  used?: 'lower' | 'upper'
  /** thumbnail: no text labels */
  small?: boolean
  /** print each line's equation with an arrow onto it (off when a caption names the lines) */
  lineLabels?: boolean
}) {
  // with the relaxation drawn (not a thumbnail), a row above the plot holds the upper line's
  // equation and a row under the axis numbers holds the lower line's
  const labels = !!relax && !small && lineLabels
  const W = 280
  const H = (relax ? 220 : 200) + (labels ? 36 : 0)
  const m = { l: 34, r: 14, t: labels ? 42 : 24, b: labels ? 48 : 30 }
  const [a, b] = niceRange([pre.lower, pre.upper, -1, 1])
  const at = (ln: Line, v: number) => ln.slope * v + ln.bias
  const yMin = relax ? Math.min(0, at(relax.lower, pre.lower)) : 0
  const yMax = Math.max(b, 0.5)
  // one scale for both axes, so ReLU's active part is drawn at 45 degrees
  const plotW = W - m.l - m.r
  const k = Math.min(plotW / (b - a), ((H - m.t - m.b) * 0.92) / (yMax - yMin))
  const ox = m.l + (plotW - (b - a) * k) / 2
  const sx = (v: number) => ox + (v - a) * k
  const sy = (v: number) => H - m.b - (v - yMin) * k
  const outL = Math.max(0, pre.lower)
  const outU = Math.max(0, pre.upper)
  const baseY = sy(0)
  const id = useId()
  const flat = outU - outL < 1e-9
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`relu-plot ${small ? 'small' : ''}`} role="img"
      aria-label={`ReLU maps [${fmt(pre.lower)}, ${fmt(pre.upper)}] to [${fmt(outL)}, ${fmt(outU)}]`}>
      {/* ranges fade from the lower-bound color to the upper-bound color */}
      <defs>
        <linearGradient id={`${id}-in`} gradientUnits="userSpaceOnUse" x1={sx(pre.lower)} x2={sx(pre.upper)} y1={0} y2={0}>
          <stop offset="0" className="stop-lo" />
          <stop offset="1" className="stop-hi" />
        </linearGradient>
        {['lo', 'hi'].map((c) => (
          <marker key={c} id={`${id}-ah-${c}`} viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse"
            markerWidth={7} markerHeight={7} orient="auto">
            <path d="M0,1.5 L10,5 L0,8.5 z" className={`plot-ah ${c}`} />
          </marker>
        ))}
        <linearGradient id={`${id}-out`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={sy(outL)} y2={sy(outU)}>
          <stop offset="0" className="stop-lo" />
          <stop offset="1" className="stop-hi" />
        </linearGradient>
      </defs>
      {/* input interval band */}
      <rect x={sx(pre.lower)} y={m.t} width={Math.max(sx(pre.upper) - sx(pre.lower), 1)} height={H - m.b - m.t}
        className="band" />
      {relax && (
        <polygon
          className="relax-area"
          points={[
            [pre.lower, at(relax.lower, pre.lower)],
            [pre.upper, at(relax.lower, pre.upper)],
            [pre.upper, at(relax.upper, pre.upper)],
            [pre.lower, at(relax.upper, pre.lower)],
          ].map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}
        />
      )}
      {/* axes */}
      <line x1={sx(a)} x2={sx(b)} y1={baseY} y2={baseY} className="axis" />
      <line x1={sx(0)} x2={sx(0)} y1={m.t} y2={H - m.b + 4} className="axis" />
      {/* relu */}
      <polyline points={`${sx(a)},${baseY} ${sx(0)},${baseY} ${sx(b)},${sy(b)}`} className="relu-curve" />
      {/* guides from endpoints */}
      {[pre.lower, pre.upper].map((v, i) => (
        <line key={i} x1={sx(v)} x2={sx(v)} y1={baseY} y2={sy(Math.max(0, v))} className="guide" />
      ))}
      {/* the output interval on the h-axis: IBP's view. With the relaxation drawn the two
          lines are the point, and the interval only comes later (at concretize), so skip it. */}
      {!relax && <line x1={sx(0)} x2={sx(pre.upper)} y1={sy(outU)} y2={sy(outU)} className="guide" />}
      {!relax && outL > 0 && <line x1={sx(0)} x2={sx(pre.lower)} y1={sy(outL)} y2={sy(outL)} className="guide" />}
      {/* output interval on the y-axis */}
      {!flat && !relax && (
        <>
          <line x1={sx(0)} x2={sx(0)} y1={sy(outL)} y2={sy(outU)} className="out-seg" stroke={`url(#${id}-out)`} />
          <circle cx={sx(0)} cy={sy(outL)} r={3.5} className="dot-lo" />
          <circle cx={sx(0)} cy={sy(outU)} r={3.5} className="dot-hi" />
        </>
      )}
      {/* input interval on the x-axis */}
      <line x1={sx(pre.lower)} x2={sx(pre.upper)} y1={baseY} y2={baseY} className="in-seg" stroke={`url(#${id}-in)`} />
      {relax && (
        <>
          <line x1={sx(pre.lower)} x2={sx(pre.upper)} y1={sy(at(relax.upper, pre.lower))} y2={sy(at(relax.upper, pre.upper))}
            className={`relax-line hi-line ${used === 'lower' ? 'unused' : ''}`} />
          <line x1={sx(pre.lower)} x2={sx(pre.upper)} y1={sy(at(relax.lower, pre.lower))} y2={sy(at(relax.lower, pre.upper))}
            className={`relax-line lo-line ${used === 'upper' ? 'unused' : ''}`} />
        </>
      )}
      <circle cx={sx(pre.lower)} cy={baseY} r={3.5} className="dot-lo" />
      <circle cx={sx(pre.upper)} cy={baseY} r={3.5} className="dot-hi" />
      {labels && relax && (() => {
        // both arrows at one z, in the widest gap between the axis numbers (so they miss the
        // numbers and the h-axis): down onto the upper line from above, up onto the lower from below
        const ticks = [pre.lower, pre.upper, ...(pre.lower < 0 && pre.upper > 0 ? [0] : [])].sort((p, q) => p - q)
        let zt = (pre.lower + pre.upper) / 2
        let gap = -1
        for (let i = 0; i + 1 < ticks.length; i++) {
          if (ticks[i + 1] - ticks[i] > gap) { gap = ticks[i + 1] - ticks[i]; zt = (ticks[i] + ticks[i + 1]) / 2 }
        }
        const tx = sx(zt)
        const tu = sy(at(relax.upper, zt))
        const tl = sy(at(relax.lower, zt))
        const uy = 16                  // label baselines
        const ly = H - 6
        const up = [mvar('h'), mtxt(' ≤ '), ...mlin([relax.upper.slope], relax.upper.bias, () => mvar('z'))]
        const lo = [mvar('h'), mtxt(' ≥ '), ...mlin([relax.lower.slope], relax.lower.bias, () => mvar('z'))]
        // keep the labels inside the plot horizontally
        const clampX = (x: number) => Math.min(W - 40, Math.max(40, x))
        return (
          <g>
            <text x={clampX(tx)} y={uy} textAnchor="middle" className="plot-eq hi"><MathSpans toks={up} size={12.5} /></text>
            <path d={`M${clampX(tx)},${uy + 5} C${clampX(tx)},${uy + 18} ${tx},${tu - 16} ${tx},${tu - 3}`}
              className="plot-arrow hi" markerEnd={`url(#${id}-ah-hi)`} />
            <text x={clampX(tx)} y={ly} textAnchor="middle" className="plot-eq lo"><MathSpans toks={lo} size={12.5} /></text>
            <path d={`M${clampX(tx)},${ly - 14} C${clampX(tx)},${ly - 24} ${tx},${tl + 16} ${tx},${tl + 4}`}
              className="plot-arrow lo" markerEnd={`url(#${id}-ah-lo)`} />
          </g>
        )
      })()}
      {/* the origin, unless an endpoint label already sits there */}
      {Math.abs(sx(0) - sx(pre.lower)) > 16 && Math.abs(sx(0) - sx(pre.upper)) > 16 && (
        <text x={sx(0)} y={H - m.b + 20} className="axis-text" textAnchor="middle">0</text>
      )}
      <text x={sx(pre.lower)} y={H - m.b + 20} className="axis-text lo" textAnchor="middle">{fmt(pre.lower)}</text>
      <text x={sx(pre.upper)} y={H - m.b + 20} className="axis-text hi" textAnchor="middle">{fmt(pre.upper)}</text>
      {!relax && outU !== 0 && (
        <text x={sx(0) - 6} y={sy(outU) + 4} className="axis-text hi" textAnchor="end">{fmt(outU)}</text>
      )}
      {!relax && outL !== outU && outL !== 0 && (
        <text x={sx(0) - 6} y={sy(outL) + 4} className="axis-text lo" textAnchor="end">{fmt(outL)}</text>
      )}
      <text x={sx(b)} y={baseY - 6} className="axis-label" textAnchor="end">z</text>
      <text x={sx(0) + 6} y={m.t - 8} className="axis-label">h</text>
    </svg>
  )
}

/**
 * A region and some points in it: a 2D scatter when there are two dimensions, otherwise
 * one strip per dimension (the interval, with the points spread slightly for visibility).
 */
export function SamplePlot({ box, points, name, proven }: {
  box: Bounds[]
  points: number[][]
  /** variable letter for the axis labels, e.g. x or y */
  name: string
  /** style the box as bounds to be proven (not a given region) */
  proven?: boolean
}) {
  const boxClass = `sample-box ${proven ? 'proven' : ''}`
  if (box.length === 2) {
    const S = 180
    const m = 26
    const ml = 30 // room for the numbers on the left and underneath
    const mb = 22
    const rx = niceRange([box[0].lower, box[0].upper, ...points.map((p) => p[0])])
    const ry = niceRange([box[1].lower, box[1].upper, ...points.map((p) => p[1])])
    const sx = (v: number) => ml + ((v - rx[0]) / (rx[1] - rx[0])) * (S - ml - m)
    const sy = (v: number) => S - mb - ((v - ry[0]) / (ry[1] - ry[0])) * (S - mb - m)
    // numbers sit right beside an axis when the box is on one side of it (like the ReLU plot),
    // else along the plot's edge; dashed guides run from the box's corners to them
    const baseY = box[1].lower >= 0 ? sy(0) : S - mb
    const baseX = box[0].lower >= 0 ? sx(0) : ml
    const xt = [{ v: box[0].lower, c: 'lo' }, { v: box[0].upper, c: 'hi' }]
    const yt = [{ v: box[1].lower, c: 'lo' }, { v: box[1].upper, c: 'hi' }]
    // one 0 at the origin, when both numbers rows meet there and it has room
    const zero = baseY === sy(0) && baseX === sx(0) &&
      xt.every((t) => Math.abs(sx(t.v) - sx(0)) > 12) && yt.every((t) => Math.abs(sy(t.v) - sy(0)) > 10)
    return (
      <svg viewBox={`0 0 ${S} ${S}`} className="sample-plot" role="img" aria-label={`${name} region with ${points.length} points`}>
        <line x1={ml} x2={S - m + 6} y1={sy(0)} y2={sy(0)} className="axis" />
        <line x1={sx(0)} x2={sx(0)} y1={m - 6} y2={S - mb} className="axis" />
        <rect x={sx(box[0].lower)} y={sy(box[1].upper)} width={Math.max(sx(box[0].upper) - sx(box[0].lower), 1.5)}
          height={Math.max(sy(box[1].lower) - sy(box[1].upper), 1.5)} className={boxClass} />
        {xt.map((t, k) => (
          <g key={`x${k}`}>
            {sy(box[1].lower) < baseY - 1 && <line x1={sx(t.v)} x2={sx(t.v)} y1={sy(box[1].lower)} y2={baseY} className="guide" />}
            {(k === 0 || sx(xt[1].v) - sx(xt[0].v) > 12) && (
              <text x={sx(t.v)} y={baseY + 13} textAnchor="middle" className={`axis-text ${t.c}`}>{fmt(t.v)}</text>
            )}
          </g>
        ))}
        {yt.map((t, k) => (
          <g key={`y${k}`}>
            {sx(box[0].lower) > baseX + 1 && <line x1={baseX} x2={sx(box[0].lower)} y1={sy(t.v)} y2={sy(t.v)} className="guide" />}
            {(k === 0 || sy(yt[0].v) - sy(yt[1].v) > 10) && (
              <text x={baseX - 5} y={sy(t.v) + 4} textAnchor="end" className={`axis-text ${t.c}`}>{fmt(t.v)}</text>
            )}
          </g>
        ))}
        {zero && <text x={sx(0) - 5} y={sy(0) + 13} textAnchor="end" className="axis-text">0</text>}
        {points.map((p, k) => <circle key={k} cx={sx(p[0])} cy={sy(p[1])} r={1.9} className="sample-dot" />)}
        <text x={S - m + 8} y={sy(0) + 4} className="axis-label">{name}<tspan className="m-txt" fontSize={10} dy={3}>1</tspan></text>
        <text x={sx(0) + 5} y={m - 10} className="axis-label">{name}<tspan className="m-txt" fontSize={10} dy={3}>2</tspan></text>
      </svg>
    )
  }
  const W = 180
  const row = 38 // strip plus a line of numbers under it
  const l = 22
  const H = box.length * row + 8
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sample-plot" role="img" aria-label={`${name} intervals with ${points.length} points`}>
      {box.map((b, i) => {
        const r = niceRange([b.lower, b.upper, ...points.map((p) => p[i])])
        const s = (v: number) => l + 6 + ((v - r[0]) / (r[1] - r[0])) * (W - l - 14)
        const cy = 6 + i * row + 12
        return (
          <g key={i}>
            <text x={2} y={cy + 4} className="axis-label">{name}<tspan className="m-txt" fontSize={10} dy={3}>{i + 1}</tspan></text>
            <rect x={s(b.lower)} y={cy - 7} width={Math.max(s(b.upper) - s(b.lower), 1.5)} height={14} rx={3} className={boxClass} />
            <text x={s(b.lower)} y={cy + 20} textAnchor="middle" className="axis-text lo">{fmt(b.lower)}</text>
            {s(b.upper) - s(b.lower) > 14 && (
              <text x={s(b.upper)} y={cy + 20} textAnchor="middle" className="axis-text hi">{fmt(b.upper)}</text>
            )}
            {points.map((p, k) => (
              // spread the points up and down a little so they don't all sit on one line
              <circle key={k} cx={s(p[i])} cy={cy + (((k * 37) % 11) - 5) * 0.9} r={1.6} className="sample-dot" />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

