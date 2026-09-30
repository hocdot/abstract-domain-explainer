import { Fragment } from 'react'
import { fmt } from '../format'

/**
 * Math drawn inside the SVG diagram. KaTeX can't render into <text>, so we set
 * equations with KaTeX's own fonts (italic KaTeX_Math for variables, upright
 * KaTeX_Main for numbers and operators) to match the formulas in the panel.
 */
export type MTok = { s: string; v?: boolean; sub?: string }

export const mvar = (s: string, sub?: string | number): MTok => ({ s, v: true, sub: sub == null ? undefined : String(sub) })
export const mtxt = (s: string): MTok => ({ s })

const EPS = 1e-12
const minus = (s: string) => s.replace('-', '−')

/** Linear expression "0.5x₁ − x₂ + 1" as tokens, skipping zero coefficients. */
export function mlin(coeffs: number[], c: number, sym: (i: number) => MTok): MTok[] {
  const out: MTok[] = []
  coeffs.forEach((w, i) => {
    if (Math.abs(w) < EPS) return
    const a = Math.abs(w)
    const sign = out.length === 0 ? (w < 0 ? '−' : '') : w < 0 ? ' − ' : ' + '
    const coef = Math.abs(a - 1) < EPS ? '' : fmt(a)
    if (sign + coef) out.push(mtxt(sign + coef))
    out.push(sym(i))
  })
  if (Math.abs(c) >= EPS || out.length === 0) {
    out.push(mtxt(out.length === 0 ? minus(fmt(c)) : `${c < 0 ? ' − ' : ' + '}${fmt(Math.abs(c))}`))
  }
  return out
}

/** Rough rendered width, used to decide when to squeeze an equation. */
export function mwidth(toks: MTok[], size: number): number {
  let em = 0
  for (const t of toks) em += t.s.length * (t.v ? 0.55 : 0.5) + (t.sub ? t.sub.length * 0.36 : 0)
  return em * size
}

/** The tokens as <tspan>s; subscripts are lowered and the baseline restored after. */
export function MathSpans({ toks, size }: { toks: MTok[]; size: number }) {
  const drop = size * 0.24
  let reset = false
  return (
    <>
      {toks.map((t, k) => {
        const dy = reset ? -drop : undefined
        reset = !!(t.v && t.sub)
        return (
          <Fragment key={k}>
            <tspan dy={dy} className={t.v ? 'm-var' : 'm-txt'}>{t.s}</tspan>
            {t.v && t.sub && <tspan dy={drop} className="m-txt" fontSize={size * 0.7}>{t.sub}</tspan>}
          </Fragment>
        )
      })}
    </>
  )
}
