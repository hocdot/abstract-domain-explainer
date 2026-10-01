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

/** TeX symbol of neuron j in a stage, e.g. z_{4}. `mark` adds an under/overline. */
export function texSym(stage: Pick<Stage, 'letter' | 'first'>, j: number, mark?: 'lower' | 'upper'): string {
  const letter = mark === 'lower' ? `\\underline{${stage.letter}}` : mark === 'upper' ? `\\overline{${stage.letter}}` : stage.letter
  return `${letter}_{${stage.first + j + 1}}`
}

/** A whole stage, e.g. h_{4}, h_{5}, h_{6} (with "\\dots" past three neurons). */
export function texLayer(stage: Pick<Stage, 'letter' | 'first' | 'size'>): string {
  const js = stage.size <= 3 ? Array.from({ length: stage.size }, (_, j) => j) : [0, -1, stage.size - 1]
  return js.map((j) => (j < 0 ? '\\dots' : texSym(stage, j))).join(', ')
}

const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' }
const map = (s: string, table: Record<string, string>) => [...s].map((c) => table[c] ?? c).join('')

/** Plain-text symbol for titles and tooltips, e.g. z₄. */
export function textSym(stage: Pick<Stage, 'letter' | 'first'>, j?: number): string {
  const sub = j != null ? map(String(stage.first + j + 1), SUB) : ''
  return `${stage.letter}${sub}`
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
export function textLin(coeffs: number[], c: number, sym = (i: number) => textSym({ letter: 'x', first: 0 }, i)): string {
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
