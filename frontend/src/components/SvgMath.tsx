import { Fragment } from 'react'
import { fmt } from '../format'

/**
 * Math drawn inside the SVG diagram. KaTeX can't render into <text>, so we set
 * equations with KaTeX's own fonts (italic KaTeX_Math for variables, upright
 * KaTeX_Main for numbers and operators) to match the formulas in the panel.
 */
/** `v`: a variable (math italic), `w`: plain words (the UI font), else upright math. */
export type MTok = { s: string; v?: boolean; w?: boolean; sub?: string; sup?: string }

export const mvar = (s: string, sub?: string | number): MTok => ({ s, v: true, sub: sub == null ? undefined : String(sub) })
export const mtxt = (s: string): MTok => ({ s })
export const mword = (s: string): MTok => ({ s, w: true })

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
  for (const t of toks) em += t.s.length * (t.v ? 0.55 : 0.5) + Math.max(t.sub?.length ?? 0, t.sup?.length ?? 0) * 0.36
  return em * size
}

/** The tokens as <tspan>s; sub- and superscripts are shifted and the baseline restored after. */
export function MathSpans({ toks, size }: { toks: MTok[]; size: number }) {
  const drop = size * 0.24
  const rise = size * 0.4
  let shift = 0 // how far the baseline currently sits below where it should be
  let skip = 0 // after a stacked pair: how much further the wider script reaches
  return (
    <>
      {toks.map((t, k) => {
        const dy = shift ? -shift : undefined
        const dx = skip || undefined
        const sup = t.v ? t.sup : undefined
        const sub = t.v ? t.sub : undefined
        // both: the superscript, then the subscript pulled back under it (stacked, as KaTeX sets z₁⁽¹⁾)
        const supW = sup ? [...sup].reduce((n, c) => n + (c === '(' || c === ')' ? 0.389 : 0.5), 0) * size * 0.7 : 0
        shift = sub != null ? drop : sup != null ? -rise : 0
        skip = sup != null && sub != null ? Math.max(0, supW - sub.length * 0.5 * size * 0.7) : 0
        return (
          <Fragment key={k}>
            <tspan dx={dx} dy={dy} className={t.v ? 'm-var' : t.w ? 'm-word' : 'm-txt'}>{t.s}</tspan>
            {sup != null && <tspan dy={-rise} className="m-txt" fontSize={size * 0.7}>{sup}</tspan>}
            {sub != null && (
              <tspan dx={sup != null ? -supW : undefined} dy={sup != null ? rise + drop : drop} className="m-txt"
                fontSize={size * 0.7}>{sub}</tspan>
            )}
          </Fragment>
        )
      })}
    </>
  )
}
