// Seeded randomness: a small PRNG and a scrambled Sobol sequence.

/** mulberry32: a tiny, fast, seedable PRNG returning floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Joe & Kuo direction numbers (new-joe-kuo-6.21201) for dimensions 2..8:
// [s, a, m_1..m_s]. Dimension 1 is the van der Corput sequence.
const JOE_KUO: [number, number, number[]][] = [
  [1, 0, [1]],
  [2, 1, [1, 3]],
  [3, 1, [1, 3, 1]],
  [3, 2, [1, 1, 1]],
  [4, 1, [1, 1, 3, 3]],
  [4, 4, [1, 3, 5, 13]],
  [5, 2, [1, 1, 5, 5, 17]],
]
export const SOBOL_MAX_DIM = JOE_KUO.length + 1

const BITS = 32

function directions(dim: number): number[][] {
  const v: number[][] = [Array.from({ length: BITS }, (_, k) => 2 ** (BITS - 1 - k))]
  for (const [s, a, m] of JOE_KUO.slice(0, dim - 1)) {
    const d: number[] = []
    for (let k = 0; k < BITS; k++) {
      if (k < s) {
        d.push((m[k] * 2 ** (BITS - 1 - k)) >>> 0)
      } else {
        let x = (d[k - s] ^ (d[k - s] >>> s)) >>> 0
        for (let q = 1; q < s; q++) if ((a >>> (s - 1 - q)) & 1) x = (x ^ d[k - q]) >>> 0
        d.push(x)
      }
    }
    v.push(d)
  }
  return v
}

/** `n` points of a `dim`-dimensional Sobol sequence in [0, 1)^dim, scrambled by a
 *  seeded random digital shift. Low-discrepancy points spread evenly over the box
 *  instead of the clumps and gaps of plain random sampling, so even the first 100
 *  cover it well. */
export function sobol(n: number, dim: number, seed: number): number[][] {
  if (dim > SOBOL_MAX_DIM) throw new Error(`sobol supports at most ${SOBOL_MAX_DIM} dimensions`)
  const v = directions(dim)
  const rand = rng(seed)
  const shift = v.map(() => Math.floor(rand() * 2 ** BITS) >>> 0)
  const x = new Array<number>(dim).fill(0)
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    out.push(x.map((xi, d) => ((xi ^ shift[d]) >>> 0) / 2 ** BITS))
    // Gray-code order: flip the direction number of the lowest zero bit of i
    let c = 0
    while ((i >>> c) & 1) c++
    for (let d = 0; d < dim; d++) x[d] = (x[d] ^ v[d][c]) >>> 0
  }
  return out
}
