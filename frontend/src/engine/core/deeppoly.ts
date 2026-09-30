// DeepPoly / CROWN: linear relaxations + back-substitution.
//
// Every neuron keeps a linear lower and upper bound in terms of the stage right
// before it:
//
// * affine  z = W h + b          (exact, lower = upper)
// * ReLU    a_l z + c_l <= h <= a_u z + c_u   (element-wise relaxation)
//
// To bound a neuron, start from its expression over the previous stage and
// substitute backward until only the inputs remain, then evaluate it on the box.
// With full back-substitution and the adaptive lower slope below, DeepPoly
// (Singh et al., 2019) and CROWN (Zhang et al., 2018) give the same bounds.
import type { Side } from '../../types.ts'
import { dot } from '../netspec.ts'

/** Per-neuron linear bounds of ReLU(z) valid on z in [l, u]. */
export interface Relaxation {
  lowerSlope: number[]
  lowerBias: number[]
  upperSlope: number[]
  upperBias: number[]
}

/** sum_i coeffs[i] * (neuron i of `stage`) + const */
export interface LinExpr {
  stage: number
  coeffs: number[]
  const: number
}

/** ops[t]: how stage t depends on stage t-1 (ops[0] is the input, so null). */
export type Op =
  | null
  | { kind: 'affine'; W: number[][]; b: number[] }
  | { kind: 'relu'; r: Relaxation; lower: number[]; upper: number[] }

export function reluRelaxation(lower: number[], upper: number[]): Relaxation {
  const r: Relaxation = { lowerSlope: [], lowerBias: [], upperSlope: [], upperBias: [] }
  lower.forEach((l, i) => {
    const u = upper[i]
    const active = l >= 0
    const unstable = l < 0 && u > 0
    // upper: identity if active, 0 if inactive, the chord (l,0)-(u,u) if unstable
    const chord = unstable ? u / Math.max(u - l, 1e-12) : 0
    r.upperSlope.push(active ? 1 : chord)
    r.upperBias.push(unstable ? -l * chord : 0)
    // lower: h >= lambda * z with lambda in {0, 1}; pick the one with the smaller
    // relaxation area (lambda = 1 when u > -l)
    r.lowerSlope.push(active ? 1 : unstable && u > -l ? 1 : 0)
    r.lowerBias.push(0)
  })
  return r
}

/** Bound `coeffs @ stage[start - 1] + const` from below (side 'lower') or above.
 *  Returns the expression after each substitution (first: over stage start-1,
 *  last: over the input) and its value on the box. */
export function backSubstitute(
  ops: Op[], start: number, coeffs: number[], cst: number, side: Side, box: [number[], number[]],
): [LinExpr[], number] {
  const chain: LinExpr[] = [{ stage: start - 1, coeffs, const: cst }]
  for (let t = start - 1; t > 0; t--) {
    const op = ops[t]!
    if (op.kind === 'affine') {
      cst = cst + dot(coeffs, op.b)
      const c = coeffs
      coeffs = op.W[0].map((_, i) => op.W.reduce((s, row, j) => s + c[j] * row[i], 0))
    } else {
      // a positive coefficient wants the lower relaxation for a lower
      // bound (and the upper one for an upper bound); negative flips it
      const useLower = coeffs.map((c) => (side === 'lower' ? c >= 0 : c < 0))
      const slope = useLower.map((lo, i) => (lo ? op.r.lowerSlope[i] : op.r.upperSlope[i]))
      const bias = useLower.map((lo, i) => (lo ? op.r.lowerBias[i] : op.r.upperBias[i]))
      cst = cst + dot(coeffs, bias)
      coeffs = coeffs.map((c, i) => c * slope[i])
    }
    chain.push({ stage: t - 1, coeffs, const: cst })
  }

  const [l, u] = box
  const pick = coeffs.map((c, i) => ((side === 'lower' ? c >= 0 : c < 0) ? l[i] : u[i]))
  return [chain, cst + dot(coeffs, pick)]
}
