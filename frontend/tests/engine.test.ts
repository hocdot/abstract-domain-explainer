// Run with `npm test` (Node's built-in test runner, no extra dependencies).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyze, domains, presets, random } from '../src/engine/index.ts'
import { forwardStages } from '../src/engine/netspec.ts'
import { rng } from '../src/engine/sampling.ts'
import type { InputBox, Network, Trace } from '../src/types.ts'

const preset = (key: string) => presets().find((p) => p.key === key)!
const bounds = (trace: Trace, stage: number) =>
  trace.stages[stage].bounds.map((b) => [+b.lower.toFixed(9), +b.upper.toFixed(9)])
const box: InputBox = { lower: [-1, 0], upper: [0.5, 2] }

/** Uniform random inputs in the box, and every stage's value on each. */
function samples(net: Network, b: InputBox, n: number, seed: number) {
  const rand = rng(seed + 1000)
  return Array.from({ length: n }, () => {
    const x = b.lower.map((l, i) => l + (b.upper[i] - l) * rand())
    return { x, stages: forwardStages(net, x) }
  })
}

// --- IBP ---

test('ibp: DeepPoly example by hand', () => {
  const p = preset('deeppoly-example')
  const trace = analyze('ibp', p.network, p.input)
  assert.deepEqual(trace.stages.map((s) => s.bounds.map((b) => [b.lower, b.upper])), [
    [[-1, 1], [-1, 1]], // x
    [[-2, 2], [-2, 2]], // z1
    [[0, 2], [0, 2]], // h1
    [[0, 4], [-2, 2]], // z2
    [[0, 4], [0, 2]], // h2
    [[1, 7], [0, 2]], // y
  ])
  assert.ok(trace.checks.every((c) => c.ok))
})

test('ibp: relu statuses', () => {
  const p = preset('three-relu-cases')
  const trace = analyze('ibp', p.network, p.input)
  const statuses = trace.steps.filter((s) => s.kind === 'ibp.relu').map((s) => s.detail.status)
  assert.deepEqual(statuses, ['active', 'inactive', 'unstable'])
})

test('ibp: step order covers every neuron, layer by layer', () => {
  const p = preset('deeppoly-example')
  const trace = analyze('ibp', p.network, p.input)
  assert.equal(trace.steps[0].kind, 'input')
  assert.equal(trace.steps[trace.steps.length - 1].kind, 'output')
  assert.deepEqual(trace.steps.slice(1, -1).map((s) => [s.stage, s.neuron]),
    [[1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1]])
})

// --- DeepPoly ---

test('deeppoly: paper example', () => {
  // Singh et al. 2019, Fig. 2: x11 in [1, 5.5], x12 in [0, 2]
  const p = preset('deeppoly-example')
  const trace = analyze('deeppoly', p.network, p.input)
  assert.deepEqual(bounds(trace, 3), [[0, 3], [-2, 2]]) // z2 (IBP gives [0,4], [-2,2])
  assert.deepEqual(bounds(trace, 5), [[1, 5.5], [0, 2]]) // y  (IBP gives [1,7], [0,2])
})

test('deeppoly: first layer matches ibp', () => {
  const p = preset('three-relu-cases')
  assert.deepEqual(bounds(analyze('deeppoly', p.network, p.input), 1), bounds(analyze('ibp', p.network, p.input), 1))
})

test('deeppoly: linear bounds over inputs, paper example', () => {
  // y1 <= x1 + 0.5 x2 + 4 (Singh et al. 2019, Sec. 2)
  const p = preset('deeppoly-example')
  const y1 = analyze('deeppoly', p.network, p.input).stages.at(-1)!.linear[0]
  assert.deepEqual([y1.upper.coeffs, y1.upper.const], [[1, 0.5], 4])
  assert.deepEqual([y1.lower.coeffs, y1.lower.const], [[0, 0], 1])
})

test('deeppoly: back-substitution walks end at the inputs and evaluate to the bound', () => {
  const p = preset('deeppoly-example')
  const trace = analyze('deeppoly', p.network, p.input)
  type Walk = { steps: { stage: number; op: string; replaced?: number; coeffs: number[]; const: number }[]
    box: { terms: { coef: number; value: number }[]; const: number }; value: number }
  const constant = (c: number[]) => !c.some((v) => Math.abs(v) > 1e-12)
  for (const step of trace.steps) {
    if (step.kind !== 'deeppoly.affine' && step.kind !== 'deeppoly.relu') continue
    for (const side of ['lower', 'upper'] as const) {
      const d = step.detail[side] as Walk
      const first: number = step.kind === 'deeppoly.affine' ? step.stage - 1 : step.stage // h starts from itself
      const stages = d.steps.map((e) => e.stage)
      // the walk reaches the inputs, or stops early once the bound is a constant
      assert.deepEqual(stages, Array.from({ length: stages.length }, (_, k) => first - k))
      const last = d.steps.at(-1)!
      assert.ok(stages.at(-1) === 0 || constant(last.coeffs))
      assert.ok(d.steps.slice(0, -1).every((e) => !constant(e.coeffs)))
      for (const e of d.steps.slice(1))
        assert.equal(e.op, trace.stages[e.replaced!].kind === 'relu' ? 'relax' : 'expand')
      const value = d.box.const + d.box.terms.reduce((s, t) => s + t.coef * t.value, 0)
      assert.ok(Math.abs(value - d.value) < 1e-9)
      const lin = trace.stages[step.stage].linear[step.neuron!][side]
      if (stages.at(-1) === 0) assert.deepEqual(lin.coeffs, last.coeffs)
      else assert.ok(constant(lin.coeffs) && Math.abs(lin.const - last.const) < 1e-9)
    }
  }
})

test('deeppoly: linear bounds hold on sampled inputs', () => {
  for (let seed = 0; seed < 10; seed++) {
    const net = random([2, 3, 3, 2], 'decimal', seed)
    const trace = analyze('deeppoly', net, box)
    for (const { x, stages } of samples(net, box, 2000, seed)) {
      trace.stages.forEach((stage, s) => stage.linear.forEach((lb, j) => {
        const at = (l: { coeffs: number[]; const: number }) => l.coeffs.reduce((a, c, i) => a + c * x[i], l.const)
        assert.ok(at(lb.lower) <= stages[s][j] + 1e-9 && stages[s][j] <= at(lb.upper) + 1e-9, `seed ${seed}`)
      }))
    }
  }
})

// --- both domains ---

for (const domain of ['ibp', 'deeppoly']) {
  test(`${domain}: sound on random networks`, () => {
    for (let seed = 0; seed < 30; seed++) {
      const net = random([2, 3, 3, 2], seed % 2 ? 'decimal' : 'integer', seed)
      const trace = analyze(domain, net, box)
      assert.ok(trace.checks.every((c) => c.ok), `seed ${seed}`)
      for (const { stages } of samples(net, box, 2000, seed)) {
        trace.stages.forEach((stage, s) => stage.bounds.forEach((b, j) =>
          assert.ok(b.lower - 1e-9 <= stages[s][j] && stages[s][j] <= b.upper + 1e-9, `seed ${seed}`)))
      }
      // the sampled ranges must also sit inside the bounds
      trace.stages.forEach((stage) => stage.sampled.forEach((sb, j) =>
        assert.ok(stage.bounds[j].lower - 1e-9 <= sb.lower && sb.upper <= stage.bounds[j].upper + 1e-9)))
    }
  })
}

// --- API surface ---

test('api: domains, random, and validation', () => {
  assert.deepEqual(domains().map((d) => d.key), ['ibp', 'deeppoly'])
  const net = random([2, 2, 2, 2], 'integer', 3)
  assert.deepEqual(net.layers.map((l) => l.weight.length), [2, 2, 2])
  assert.deepEqual(random([2, 2, 2, 2], 'integer', 3), net) // same seed, same network
  const p = presets()[0]
  assert.throws(() => analyze('ibp', p.network, { lower: [0], upper: [1] }), /input box has 1 dimensions/)
  assert.throws(() => analyze('nope', p.network, p.input), /unknown domain/)
  assert.throws(() => analyze('ibp', p.network, { lower: [1, 0], upper: [0, 1] }), /lower bound must be/)
  assert.throws(() => random([2, 9], 'integer', 0), /between 1 and 8/)
})
