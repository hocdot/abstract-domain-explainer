import type { Stage } from './types'

/** Short, human number: at most 3 decimals, no trailing zeros, no "-0". */
export function fmt(x: number): string {
  const r = Number(x.toFixed(3))
  return (Object.is(r, -0) ? 0 : r).toString()
}

/** Number as a TeX factor: negatives get parentheses. */
export function texNum(x: number): string {
  const s = fmt(x)
  return s.startsWith('-') ? `(${s})` : s
}

/** TeX symbol of neuron j in a stage, e.g. z^{(1)}_{2}. `mark` adds an under/overline. */
export function texSym(stage: Pick<Stage, 'letter' | 'sup'>, j: number, mark?: 'lower' | 'upper'): string {
  const letter = mark === 'lower' ? `\\underline{${stage.letter}}` : mark === 'upper' ? `\\overline{${stage.letter}}` : stage.letter
  const sup = stage.sup != null ? `^{(${stage.sup})}` : ''
  return `${letter}${sup}_{${j + 1}}`
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '(': '⁽', ')': '⁾' }
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' }
const map = (s: string, table: Record<string, string>) => [...s].map((c) => table[c] ?? c).join('')

/** Plain-text symbol for titles and tooltips, e.g. z⁽¹⁾₂. */
export function textSym(stage: Pick<Stage, 'letter' | 'sup'>, j?: number): string {
  const sup = stage.sup != null ? map(`(${stage.sup})`, SUP) : ''
  const sub = j != null ? map(String(j + 1), SUB) : ''
  return `${stage.letter}${sup}${sub}`
}

export function stageName(stage: Stage, last: boolean): string {
  if (stage.kind === 'input') return 'Input'
  if (last) return 'Output'
  return stage.kind === 'affine' ? `Layer ${stage.layer} · Linear` : `Layer ${stage.layer} · ReLU`
}

const EPS = 1e-12

/** TeX linear expression "0.5 x_1 - x_2 + 1", skipping zero coefficients. */
export function texLin(coeffs: number[], sym: (i: number) => string, c: number): string {
  const parts: string[] = []
  coeffs.forEach((w, i) => {
    if (Math.abs(w) < EPS) return
    const a = Math.abs(w)
    const coef = Math.abs(a - 1) < EPS ? '' : `${fmt(a)}\\,`
    const s = sym(i)
    parts.push(parts.length === 0 ? `${w < 0 ? '-' : ''}${coef}${s}` : ` ${w < 0 ? '-' : '+'} ${coef}${s}`)
  })
  if (Math.abs(c) >= EPS || parts.length === 0) {
    parts.push(parts.length === 0 ? fmt(c) : ` ${c < 0 ? '-' : '+'} ${fmt(Math.abs(c))}`)
  }
  return parts.join('')
}

/** Plain-text linear expression, by default over the inputs: "x₁ + 0.5x₂ + 4". */
export function textLin(coeffs: number[], c: number, sym = (i: number) => textSym({ letter: 'x', sup: null }, i)): string {
  const parts: string[] = []
  coeffs.forEach((w, i) => {
    if (Math.abs(w) < EPS) return
    const a = Math.abs(w)
    const term = `${Math.abs(a - 1) < EPS ? '' : fmt(a)}${sym(i)}`
    parts.push(parts.length === 0 ? `${w < 0 ? '−' : ''}${term}` : ` ${w < 0 ? '−' : '+'} ${term}`)
  })
  if (Math.abs(c) >= EPS || parts.length === 0) {
    parts.push(parts.length === 0 ? fmt(c) : ` ${c < 0 ? '−' : '+'} ${fmt(Math.abs(c))}`)
  }
  return parts.join('')
}
