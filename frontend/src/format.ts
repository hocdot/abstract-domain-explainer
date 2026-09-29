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
  return stage.kind === 'affine' ? `Layer ${stage.layer} · weighted sum` : `Layer ${stage.layer} · ReLU`
}
