// Interval (box) domain in center/radius form: only the ops a fully-connected
// ReLU network needs.
import { dot } from '../netspec.ts'

export class PerturbInterval {
  readonly center: number[]
  readonly radii: number[]

  constructor(center: number[], radii: number[]) {
    if (radii.some((r) => r < 0)) throw new Error('radii must be non-negative')
    this.center = center
    this.radii = radii
  }

  static fromBounds(lower: number[], upper: number[]): PerturbInterval {
    return new PerturbInterval(
      lower.map((l, i) => 0.5 * (l + upper[i])),
      lower.map((l, i) => 0.5 * (upper[i] - l)),
    )
  }

  get lower(): number[] {
    return this.center.map((c, i) => c - this.radii[i])
  }

  get upper(): number[] {
    return this.center.map((c, i) => c + this.radii[i])
  }

  /** weight: (out, in). The center moves like a normal input; the radius
   *  can only grow, so it is pushed through |W|. */
  linear(weight: number[][], bias: number[]): PerturbInterval {
    return new PerturbInterval(
      weight.map((row, j) => dot(row, this.center) + bias[j]),
      weight.map((row) => dot(row.map(Math.abs), this.radii)),
    )
  }

  /** ReLU is monotone, so applying it to both endpoints is exact. */
  relu(): PerturbInterval {
    const relu = (v: number) => Math.max(v, 0)
    return PerturbInterval.fromBounds(this.lower.map(relu), this.upper.map(relu))
  }
}
