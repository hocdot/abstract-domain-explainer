import { useId, type ReactNode } from 'react'
import { fmt } from '../format'
import type { Bounds } from '../types'

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
}

/** One interval drawn on a number line, with a tick at zero. */
export function IntervalBar({ bounds, range, label, faded }: BarProps) {
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
      </svg>
      <div className="ibar-values mono">
        [<span className="lo">{fmt(bounds.lower)}</span>, <span className="hi">{fmt(bounds.upper)}</span>]
      </div>
    </div>
  )
}

/** ReLU curve with the incoming interval on the x-axis and the outgoing one on the y-axis. */
export function ReluPlot({ pre }: { pre: Bounds }) {
  const W = 280
  const H = 190
  const m = { l: 34, r: 14, t: 14, b: 30 }
  const [a, b] = niceRange([pre.lower, pre.upper, -1, 1])
  const yMax = Math.max(b, 0.5)
  const sx = (v: number) => m.l + ((v - a) / (b - a)) * (W - m.l - m.r)
  const sy = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b) * 0.92
  const outL = Math.max(0, pre.lower)
  const outU = Math.max(0, pre.upper)
  const baseY = sy(0)
  const id = useId()
  const flat = outU - outL < 1e-9
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="relu-plot" role="img"
      aria-label={`ReLU maps [${fmt(pre.lower)}, ${fmt(pre.upper)}] to [${fmt(outL)}, ${fmt(outU)}]`}>
      {/* ranges fade from the lower-bound color to the upper-bound color */}
      <defs>
        <linearGradient id={`${id}-in`} gradientUnits="userSpaceOnUse" x1={sx(pre.lower)} x2={sx(pre.upper)} y1={0} y2={0}>
          <stop offset="0" className="stop-lo" />
          <stop offset="1" className="stop-hi" />
        </linearGradient>
        <linearGradient id={`${id}-out`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={sy(outL)} y2={sy(outU)}>
          <stop offset="0" className="stop-lo" />
          <stop offset="1" className="stop-hi" />
        </linearGradient>
      </defs>
      {/* input interval band */}
      <rect x={sx(pre.lower)} y={m.t} width={Math.max(sx(pre.upper) - sx(pre.lower), 1)} height={baseY - m.t}
        className="band" />
      {/* axes */}
      <line x1={m.l} x2={W - m.r} y1={baseY} y2={baseY} className="axis" />
      <line x1={sx(0)} x2={sx(0)} y1={m.t} y2={H - m.b + 4} className="axis" />
      {/* relu */}
      <polyline points={`${sx(a)},${baseY} ${sx(0)},${baseY} ${sx(b)},${sy(b)}`} className="relu-curve" />
      {/* guides from endpoints */}
      {[pre.lower, pre.upper].map((v, i) => (
        <line key={i} x1={sx(v)} x2={sx(v)} y1={baseY} y2={sy(Math.max(0, v))} className="guide" />
      ))}
      <line x1={sx(0)} x2={sx(pre.upper)} y1={sy(outU)} y2={sy(outU)} className="guide" />
      {/* output interval on the y-axis */}
      {flat ? (
        <circle cx={sx(0)} cy={sy(outL)} r={4} className="dot-lo" />
      ) : (
        <>
          <line x1={sx(0)} x2={sx(0)} y1={sy(outL)} y2={sy(outU)} className="out-seg" stroke={`url(#${id}-out)`} />
          <circle cx={sx(0)} cy={sy(outL)} r={3.5} className="dot-lo" />
          <circle cx={sx(0)} cy={sy(outU)} r={3.5} className="dot-hi" />
        </>
      )}
      {/* input interval on the x-axis */}
      <line x1={sx(pre.lower)} x2={sx(pre.upper)} y1={baseY} y2={baseY} className="in-seg" stroke={`url(#${id}-in)`} />
      <circle cx={sx(pre.lower)} cy={baseY} r={3.5} className="dot-lo" />
      <circle cx={sx(pre.upper)} cy={baseY} r={3.5} className="dot-hi" />
      <text x={sx(pre.lower)} y={H - 10} className="axis-text lo" textAnchor="middle">{fmt(pre.lower)}</text>
      <text x={sx(pre.upper)} y={H - 10} className="axis-text hi" textAnchor="middle">{fmt(pre.upper)}</text>
      {outU !== 0 && (
        <text x={sx(0) - 6} y={sy(outU) + 4} className="axis-text hi" textAnchor="end">{fmt(outU)}</text>
      )}
      {outL !== outU && outL !== 0 && (
        <text x={sx(0) - 6} y={sy(outL) + 4} className="axis-text lo" textAnchor="end">{fmt(outL)}</text>
      )}
      <text x={W - m.r} y={baseY - 6} className="axis-label" textAnchor="end">z</text>
      <text x={sx(0) + 6} y={m.t + 8} className="axis-label">ReLU(z)</text>
    </svg>
  )
}

/** The input region when there are exactly two inputs. */
export function BoxPlot({ lower, upper }: { lower: number[]; upper: number[] }) {
  const S = 200
  const m = 28
  const [a, b] = niceRange([lower[0], upper[0], lower[1], upper[1], -1, 1])
  const s = (v: number) => m + ((v - a) / (b - a)) * (S - 2 * m)
  const sy = (v: number) => S - s(v)
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="box-plot" role="img" aria-label="input box">
      <line x1={m - 6} x2={S - m + 6} y1={sy(0)} y2={sy(0)} className="axis" />
      <line x1={s(0)} x2={s(0)} y1={m - 6} y2={S - m + 6} className="axis" />
      <rect x={s(lower[0])} y={sy(upper[1])} width={Math.max(s(upper[0]) - s(lower[0]), 1.5)}
        height={Math.max(sy(lower[1]) - sy(upper[1]), 1.5)} className="box-fill" />
      <text x={S - m + 8} y={sy(0) + 4} className="axis-label">x₁</text>
      <text x={s(0) + 5} y={m - 10} className="axis-label">x₂</text>
      <text x={s(lower[0])} y={S - 8} className="axis-text lo" textAnchor="middle">{fmt(lower[0])}</text>
      <text x={s(upper[0])} y={S - 8} className="axis-text hi" textAnchor="middle">{fmt(upper[0])}</text>
      <text x={8} y={sy(lower[1]) + 4} className="axis-text lo">{fmt(lower[1])}</text>
      <text x={8} y={sy(upper[1]) + 4} className="axis-text hi">{fmt(upper[1])}</text>
    </svg>
  )
}
