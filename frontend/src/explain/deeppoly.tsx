import { useEffect, useRef, type ReactNode } from 'react'
import { fmt, texLayer, texLin, texNum, texSym, textSym } from '../format'
import { IntervalBar, ReluPlot, niceRange } from '../components/plots'
import { Tex, hi, lo } from '../components/Tex'
import type { Bounds, DiagramFocus, DiagramPrompt, DiagramReveal, Line, Side, Stage, Step, Trace } from '../types'
import { pneuron, pw, type StepProps, type StepView } from './registry'

type Status = 'active' | 'inactive' | 'unstable'

interface RelaxUse { neuron: number; coef: number; line: Side; pre: Bounds; status: Status; lower: Line; upper: Line }
interface ExpandUse { neuron: number; coef: number; weights: number[]; bias: number }
interface StartSub { op: 'start'; stage: number; coeffs: number[]; const: number }
interface RelaxSub { op: 'relax'; replaced: number; stage: number; uses: RelaxUse[]; coeffs: number[]; const: number }
interface ExpandSub { op: 'expand'; replaced: number; stage: number; uses: ExpandUse[]; coeffs: number[]; const: number }
type Sub = StartSub | RelaxSub | ExpandSub
interface BoxTerm { input: number; coef: number; pick: Side; value: number }
interface Derivation { steps: Sub[]; box: { terms: BoxTerm[]; const: number }; value: number }
interface AffineDetail { lower: Derivation; upper: Derivation; ibp: Bounds }
interface ReluDetail { pre: Bounds; status: Status; relax: { lower: Line; upper: Line }; lower: Derivation; upper: Derivation }

const EPS = 1e-12
const paint = (side: Side, tex: string) => (side === 'lower' ? lo(tex) : hi(tex))
const rel = (side: Side) => (side === 'lower' ? '\\ge' : '\\le')
const expr = (coeffs: number[], s: Stage, c: number) => texLin(coeffs, (i) => texSym(s, i), c)
const lineTex = (ln: Line, z: string) => texLin([ln.slope], () => z, ln.bias)
const wrap = (t: string) => (t.includes(' ') ? `\\left(${t}\\right)` : t)
const times = (c: number, inner: string) => `${texNum(c)} \\cdot ${wrap(inner)}`
const sum = (parts: string[], c: number) =>
  [...parts, ...(Math.abs(c) >= EPS || parts.length === 0 ? [texNum(c)] : [])].join(' + ')

function SideToggle({ side, onSide }: { side: Side; onSide: (s: Side) => void }) {
  return (
    <div className="seg-toggle" role="tablist">
      {(['lower', 'upper'] as const).map((s) => (
        <button key={s} role="tab" aria-selected={side === s} className={`${s === 'lower' ? 'lo' : 'hi'} ${side === s ? 'on' : ''}`}
          onClick={() => onSide(s)}>
          {s === 'lower' ? 'Lower bound' : 'Upper bound'}
        </button>
      ))}
    </div>
  )
}

function Card({ n, title, state, onSelect, children }: {
  n: ReactNode; title: ReactNode; state: 'done' | 'current' | 'next'; onSelect: () => void; children: ReactNode
}) {
  const ref = useRef<HTMLLIElement>(null)
  // follow the walk as it moves, but not on first render: opening a step should show its
  // explanation from the top, not jump to the first card
  // (compare with the previous state rather than counting renders: StrictMode runs effects twice)
  const prev = useRef(state)
  useEffect(() => {
    if (state === 'current' && prev.current !== 'current') ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    prev.current = state
  }, [state])
  return (
    <li ref={ref} className={`bs-card ${state}`} onClick={onSelect}>
      <div className="bs-head"><span className="bs-num">{n}</span><span className="bs-title">{title}</span></div>
      <div className="bs-body">{children}</div>
    </li>
  )
}

/** Why this ReLU term is replaced by this line, with the line's own derivation. */
function RelaxRow({ u, side, h, z }: { u: RelaxUse; side: Side; h: string; z: string }) {
  const ln = u[u.line]
  const { lower: l, upper: up } = u.pre
  let why: ReactNode
  if (u.status === 'active') {
    why = <>Always active (<Tex>{`${z} \\ge 0`}</Tex> on its whole interval), so <Tex>{`${h} = ${z}`}</Tex> exactly and both lines are <Tex>{z}</Tex>.</>
  } else if (u.status === 'inactive') {
    why = <>Always inactive (<Tex>{`${z} \\le 0`}</Tex> on its whole interval), so <Tex>{`${h} = 0`}</Tex> exactly and both lines are 0.</>
  } else if (u.line === 'upper') {
    why = (
      <>
        Unstable, so the upper line is the chord through <Tex>{'(l, 0)'}</Tex> and <Tex>{'(u, u)'}</Tex>: slope{' '}
        <Tex>{`\\tfrac{u}{u-l} = \\tfrac{${fmt(up)}}{${fmt(up)} - ${texNum(l)}} = ${fmt(ln.slope)}`}</Tex>, intercept{' '}
        <Tex>{`-l \\cdot ${fmt(ln.slope)} = ${fmt(ln.bias)}`}</Tex>.
      </>
    )
  } else {
    why = (
      <>
        Unstable, so the lower line is <Tex>{`${h} \\ge \\lambda ${z}`}</Tex> with <Tex>{'\\lambda = 1'}</Tex> if{' '}
        <Tex>{'u > -l'}</Tex>, else <Tex>{'0'}</Tex> (whichever leaves the smaller area). Here{' '}
        <Tex>{`u = ${texNum(up)} ${up > -l ? '>' : '\\le'} -l = ${texNum(-l)}`}</Tex>, so <Tex>{`\\lambda = ${fmt(ln.slope)}`}</Tex>.
      </>
    )
  }
  const need = (u.coef >= 0) === (side === 'lower') ? 'small' : 'large'
  return (
    <div className="relax-row">
      <ReluPlot small pre={u.pre} relax={{ lower: u.lower, upper: u.upper }} used={u.line} />
      <div className="relax-text">
        <div>
          <Tex>{`${h} = \\mathrm{ReLU}(${z}),\\ ${z} \\in [${fmt(l)},\\ ${fmt(up)}]`}</Tex>{' '}
          <span className={`status small status-${u.status}`}>{u.status}</span>
        </div>
        <div>
          Coefficient <Tex>{texNum(u.coef)}</Tex> is {u.coef >= 0 ? 'positive' : 'negative'}, so to make this term as {need}{' '}
          as allowed we use the <span className={u.line === 'lower' ? 'lo' : 'hi'}>{u.line} line</span>:{' '}
          <Tex>{`${h} ${u.line === 'lower' ? '\\ge' : '\\le'} ${paint(u.line, lineTex(ln, z))}`}</Tex>
        </div>
        <div className="why">{why}</div>
      </div>
    </div>
  )
}

/** The two candidate lower lines of an unstable ReLU, side by side, with their areas. */
function LambdaCompare({ pre, upper, picked, h, z }: { pre: Bounds; upper: Line; picked: number; h: string; z: string }) {
  const l = pre.lower
  const u = pre.upper
  const tie = Math.abs(u + l) < 1e-9
  const cases = [
    { lam: 0, area: 0.5 * (u - l) * u, corners: `(l, 0),\\ (u, 0),\\ (u, u)`, height: 'u', hv: u },
    { lam: 1, area: 0.5 * (u - l) * -l, corners: `(l, l),\\ (l, 0),\\ (u, u)`, height: '(-l)', hv: -l },
  ]
  return (
    <div className="lambda-compare">
      {cases.map((c) => (
        <figure key={c.lam} className={c.lam === picked ? 'picked' : ''}>
          <figcaption>
            <Tex>{`\\lambda = ${c.lam}:\\ ${h} \\ge ${lo(c.lam ? z : '0')}`}</Tex>
            {c.lam === picked && <span className="pick-badge">{tie ? 'tie, picked' : 'smaller, picked'}</span>}
          </figcaption>
          <ReluPlot pre={pre} relax={{ lower: { slope: c.lam, bias: 0 }, upper }} lineLabels={false} />
          <p className="small">Triangle <Tex>{c.corners}</Tex></p>
          <Tex block>{`\\begin{aligned} \\text{area} &= \\tfrac12 (u - l)\\cdot ${c.height} \\\\ &= \\tfrac12 \\cdot ${texNum(u - l)} \\cdot ${texNum(c.hv)} = ${fmt(c.area)} \\end{aligned}`}</Tex>
        </figure>
      ))}
    </div>
  )
}

function Backsub({ d, side, stage, j, trace, sub, onSub }: {
  d: Derivation; side: Side; stage: Stage; j: number; trace: Trace; sub: number; onSub: (k: number) => void
}) {
  const s = texSym(stage, j)
  const S = trace.stages
  let relaxed = false
  const at = (k: number) => ({
    n: k + 1,
    state: (k < sub ? 'done' : k === sub ? 'current' : 'next') as 'done' | 'current' | 'next',
    onSelect: () => onSub(k),
  })
  const cards = d.steps.map((st, k) => {
    if (st.op === 'start') {
      return stage.kind === 'relu' ? (
        <Card key={k} {...at(k)} title="Start from the neuron itself">
          <p>
            To write <Tex>{s}</Tex> over the inputs, substitute backward exactly as for a linear neuron. The first
            substitution is this neuron's own pair of ReLU lines.
          </p>
          <Tex block>{`${s} = ${s}`}</Tex>
        </Card>
      ) : (
        <Card key={k} {...at(k)} title="Start from the definition">
          <Tex block>{`${s} = ${expr(st.coeffs, S[st.stage], st.const)}`}</Tex>
        </Card>
      )
    }
    const prev = d.steps[k - 1]
    const replaced = S[st.replaced]
    const below = S[st.stage]
    const simplified = expr(st.coeffs, below, st.const)
    if (st.op === 'relax') {
      relaxed = true
      const subst = sum(st.uses.map((u) => times(u.coef, lineTex(u[u.line], texSym(below, u.neuron)))), prev.const)
      return (
        <Card key={k} {...at(k)} title={<>Relax <Tex>{texLayer(replaced)}</Tex>: replace each ReLU output by a line</>}>
          <p>
            Each ReLU output gets one of its two lines (the ones printed on its arrow in the diagram). For the {side} bound, a
            positive coefficient takes the <span className={side === 'lower' ? 'lo' : 'hi'}>{side}</span> line and a
            negative one takes the <span className={side === 'lower' ? 'hi' : 'lo'}>{side === 'lower' ? 'upper' : 'lower'}</span> line.
          </p>
          {st.uses.length === 0 && <p className="muted">Every coefficient is 0: nothing to replace.</p>}
          {st.uses.map((u) => (
            <RelaxRow key={u.neuron} u={u} side={side} h={texSym(replaced, u.neuron)} z={texSym(below, u.neuron)} />
          ))}
          <p className="small">Substitute and simplify:</p>
          <Tex block>{`\\begin{aligned} ${s} &${rel(side)} ${subst} \\\\ &= ${simplified} \\end{aligned}`}</Tex>
        </Card>
      )
    }
    const subst = sum(st.uses.map((u) => times(u.coef, expr(u.weights, below, u.bias))), prev.const)
    return (
      <Card key={k} {...at(k)} title={<>Expand <Tex>{texLayer(replaced)}</Tex>: replace each linear neuron by its definition</>}>
        <p>These come straight from the weights and biases in the diagram, so this step is exact.</p>
        {st.uses.length === 0 && <p className="muted">Every coefficient is 0: nothing to replace.</p>}
        {st.uses.map((u) => (
          <Tex key={u.neuron} block>{`${texSym(replaced, u.neuron)} = ${expr(u.weights, below, u.bias)}`}</Tex>
        ))}
        <p className="small">Substitute and simplify:</p>
        <Tex block>{`\\begin{aligned} ${s} &${relaxed ? rel(side) : '='} ${subst} \\\\ &= ${simplified} \\end{aligned}`}</Tex>
      </Card>
    )
  })

  return <ol className="backsub">{cards}</ol>
}

/** The finished lower bound, kept (greyed) while the upper bound is walked. */
function PrevBound({ d, stage, j, trace, onSelect }: { d: Derivation; stage: Stage; j: number; trace: Trace; onSelect: () => void }) {
  const last = d.steps[d.steps.length - 1]
  return (
    <div className="prev-bound" onClick={onSelect} title="Click to review the lower-bound walk">
      <span className="small">Lower bound, done:</span>
      <Tex>{`${texSym(stage, j)} \\ge ${expr(last.coeffs, trace.stages[0], last.const)}`}</Tex>
    </div>
  )
}

/** The last two sub-steps: both finished bounds side by side, then plug in the box. */
function Finish({ lower, upper, stage, j, trace, phase, onSelect, concretize = true, children }: {
  lower: Derivation; upper: Derivation; stage: Stage; j: number; trace: Trace
  phase: 'walk' | 'bounds' | 'concretize'; onSelect: (k: 0 | 1) => void
  /** false for a ReLU output: DeepPoly never needs its interval, so there is nothing to plug in */
  concretize?: boolean; children?: ReactNode
}) {
  const s = texSym(stage, j)
  const x = trace.stages[0]
  const final = (side: Side, d: Derivation) => {
    const last = d.steps[d.steps.length - 1]
    return `${s} ${rel(side)} ${paint(side, expr(last.coeffs, x, last.const))}`
  }
  const plug = (side: Side, d: Derivation) => {
    const last = d.steps[d.steps.length - 1]
    // a constant bound has nothing to plug in
    if (d.box.terms.length === 0) return `${s} &${rel(side)} ${paint(side, fmt(d.value))} && \\text{(already a number)}`
    const terms = d.box.terms.map((t) => `${texNum(t.coef)} \\cdot ${paint(t.pick, texNum(t.value))}`)
    return `${s} &${rel(side)} ${paint(side, expr(last.coeffs, x, last.const))} \\\\ &${rel(side)} ${sum(terms, d.box.const)} = ${paint(side, fmt(d.value))}`
  }
  return (
    <ol className="backsub concretize">
      <Card n="=" state={phase === 'bounds' ? 'current' : phase === 'concretize' ? 'done' : 'next'} onSelect={() => onSelect(0)}
        title="Both bounds over the inputs">
        <p>
          Both walks are finished: <Tex>{s}</Tex> is now sandwiched between two bounds that use only the inputs (or
          just a constant). They hold for every input in the box:
        </p>
        <Tex block>{`${final('lower', lower)} \\qquad ${final('upper', upper)}`}</Tex>
        {/* the interval only exists once the box is plugged in, below */}
        {!concretize && children}
      </Card>
      {concretize && <Card n="✓" state={phase === 'concretize' ? 'current' : 'next'} onSelect={() => onSelect(1)}
        title="Concretize: plug the box into both bounds">
        <p>
          Each input takes the end of its interval that makes its term
          as small as possible for the <span className="lo">lower</span> bound (as large as possible for the{' '}
          <span className="hi">upper</span> bound).
        </p>
        <Tex block>{`\\begin{aligned} ${plug('lower', lower)} \\end{aligned}`}</Tex>
        <Tex block>{`\\begin{aligned} ${plug('upper', upper)} \\end{aligned}`}</Tex>
        {children}
      </Card>}
    </ol>
  )
}

/** Sub-steps of a walked step: the lower walk, the upper walk, both bounds, concretize. */
function walkPhase(d: { lower: Derivation; upper: Derivation }, sub: number) {
  // the two walks can differ in length: one stops early once it is a constant
  const n = d.lower.steps.length              // where the upper walk starts
  const end = n + d.upper.steps.length        // where the walks are over
  const side: Side = sub < n ? 'lower' : 'upper'
  const phase = sub < end ? 'walk' : sub === end ? 'bounds' : 'concretize'
  return { n, end, side, local: side === 'lower' ? sub : sub - n, done: sub >= end, phase } as const
}

function AffineBody({ step, trace, sub, onSub }: StepProps) {
  const d = step.detail as unknown as AffineDetail
  const j = step.neuron!
  const stage = trace.stages[step.stage]
  const src = trace.stages[step.stage - 1]
  const out = stage.bounds[j]
  const first = src.kind === 'input'
  const range = niceRange([out.lower, out.upper, d.ibp.lower, d.ibp.upper])
  const gain = d.ibp.upper - d.ibp.lower - (out.upper - out.lower)
  const start = d.lower.steps[0]
  const { n, end, side, local, done, phase } = walkPhase(d, sub)

  return (
    <>
      <p>
        To compute <Tex>{texSym(stage, j)}</Tex>, the network multiplies {first ? 'each input' : 'each neuron of the previous layer'} by
        the weight on its edge and adds the bias:{' '}
        <Tex>{`${texSym(stage, j)} = ${expr(start.coeffs, src, start.const)}`}</Tex>.
      </p>
      {first ? (
        <p>The first layer depends on the inputs directly, so there is nothing to substitute: we plug in the box, just like IBP.</p>
      ) : (
        <p>
          IBP would replace each neuron in this sum by its interval, as if they could vary independently. DeepPoly
          instead substitutes <strong>linear</strong> bounds backward, layer by layer, until only the inputs remain, so
          neurons that depend on the same inputs can cancel.
        </p>
      )}

      <div className="section-head">
        <h3>Back-substitution</h3>
        <SideToggle side={side} onSide={(s) => onSub(s === 'lower' ? 0 : n)} />
      </div>
      <p className="hint muted">
        Press <em>Continue</em> (or <kbd>→</kbd>) to substitute one layer at a time and watch the expression move left
        in the diagram: first the lower bound, then the upper bound, then both together, then concretize. Or click any step below.
      </p>
      {side === 'upper' && <PrevBound d={d.lower} stage={stage} j={j} trace={trace} onSelect={() => onSub(0)} />}
      <Backsub d={d[side]} side={side} stage={stage} j={j} trace={trace} sub={done ? d[side].steps.length : local}
        onSub={(k) => onSub(side === 'lower' ? k : n + k)} />

      <Finish lower={d.lower} upper={d.upper} stage={stage} j={j} trace={trace}
        phase={phase} onSelect={(k) => onSub(end + k)}>
        <p className="small">That gives the interval:</p>
        <div className="compare">
          <IntervalBar bounds={out} range={range} sampled={stage.sampled[j]} label={<span className="bar-name">DeepPoly</span>} />
          <IntervalBar bounds={d.ibp} range={range} faded label={<span className="bar-name">IBP</span>} />
        </div>
        <p className="small muted">
          {gain > 1e-9 ? <><strong>Tighter than IBP by {fmt(gain)}.</strong> </> : 'Same interval as IBP here. '}
          Dark inner bar: values reached on sampled inputs.
        </p>
      </Finish>

      <details className="aside">
        <summary>DeepPoly or CROWN?</summary>
        <p>
          CROWN (Zhang et al., 2018) runs the same backward substitution with the same ReLU lines, so on these networks
          it computes exactly the same bounds. The two papers differ in presentation and in the options they offer
          (e.g. CROWN also handles other activations, and α-CROWN optimizes the lower slope).
        </p>
      </details>
    </>
  )
}

/** Which of a ReLU's lines its walks have reached at sub-step `sub`. */
function reluLines(d: { lower: Derivation; upper: Derivation }, sub: number): 'none' | 'lower' | 'both' {
  const n = d.lower.steps.length
  return sub >= n + 1 ? 'both' : sub >= 1 ? 'lower' : 'none'
}

function ReluBody({ step, trace, sub, onSub }: StepProps) {
  const d = step.detail as unknown as ReluDetail
  const j = step.neuron!
  const stage = trace.stages[step.stage]
  const pre = trace.stages[step.stage - 1]
  const h = texSym(stage, j)
  const z = texSym(pre, j)
  const l = d.pre.lower
  const u = d.pre.upper
  const { n, end, side, local, done, phase } = walkPhase(d, sub)
  const at = onSub
  // each line is found by the first substitution of its walk (this neuron by its own line)
  const lines = reluLines(d, sub)

  return (
    <>
      <p>
        Next, the activation: <Tex>{`${h} = \\max(0,\\ ${z})`}</Tex>. DeepPoly replaces it with two lines, one above and
        one below, that hold for every <Tex>{z}</Tex> in <Tex>{`[${fmt(l)},\\ ${fmt(u)}]`}</Tex>. From now on they are
        printed on the arrow into this neuron in the diagram (upper line above it, lower line below).
      </p>
      <div className={`status status-${d.status}`}>
        {d.status === 'active' ? 'Always active' : d.status === 'inactive' ? 'Always inactive' : 'Unstable'}
      </div>

      {lines !== 'none' && (
        <>
          <h3 className="lo">Lower line</h3>
          {d.status === 'active' && (
            <p>The interval is at or above 0, so ReLU is the identity here and the line is exact: <Tex>{`${h} \\ge ${lo(z)}`}</Tex>.</p>
          )}
          {d.status === 'inactive' && (
            <p>The interval is at or below 0, so the neuron is always off and the line is exact: <Tex>{`${h} \\ge ${lo('0')}`}</Tex>.</p>
          )}
          {d.status === 'unstable' && (
            <>
              <p>
                Any <Tex>{`${h} \\ge \\lambda\\, ${z}`}</Tex> with <Tex>{'0 \\le \\lambda \\le 1'}</Tex> stays below
                ReLU on the interval, so any of them is valid. DeepPoly tries the two extremes,{' '}
                <Tex>{'\\lambda = 0'}</Tex> and <Tex>{'\\lambda = 1'}</Tex>, and keeps the one whose shaded region (the
                gap between the two lines, i.e. how much it over-approximates ReLU) is smaller. Both regions are triangles:
              </p>
              <LambdaCompare pre={d.pre} upper={d.relax.upper} picked={d.relax.lower.slope} h={h} z={z} />
              <p>
                Both areas share the factor <Tex>{'\\tfrac12 (u - l)'}</Tex>, so the choice only compares{' '}
                <Tex>{'u'}</Tex> with <Tex>{'-l'}</Tex>: here <Tex>{`u = ${texNum(u)} ${u > -l ? '>' : '\\le'} -l = ${texNum(-l)}`}</Tex>,
                so <Tex>{`\\lambda = ${fmt(d.relax.lower.slope)}`}</Tex>{u === -l ? ' (a tie: either works, DeepPoly takes 0)' : ''}:
              </p>
              <Tex block>{`${h} \\ge ${lo(lineTex(d.relax.lower, z))}`}</Tex>
            </>
          )}
        </>
      )}

      {lines === 'both' && (
        <>
          <h3 className="hi">Upper line</h3>
          {d.status === 'unstable' ? (
            <>
              <p>
                The chord from <Tex>{`(${fmt(l)}, 0)`}</Tex> to <Tex>{`(${fmt(u)}, ${fmt(u)})`}</Tex>. It is the lowest
                line that stays above ReLU on the whole interval.
              </p>
              <Tex block>{`${h} \\le \\frac{u}{u - l}\\,(${z} - l) = ${hi(lineTex(d.relax.upper, z))}`}</Tex>
            </>
          ) : (
            <p>Exact as well: <Tex>{`${h} \\le ${hi(d.status === 'active' ? z : '0')}`}</Tex>.</p>
          )}
          <ReluPlot pre={d.pre} relax={d.relax} />
        </>
      )}

      <div className="section-head">
        <h3>Bounds of <Tex>{h}</Tex> over the inputs</h3>
        <SideToggle side={side} onSide={(s) => at(s === 'lower' ? 0 : n)} />
      </div>
      <p className="hint muted">
        Press <em>Continue</em> (or <kbd>→</kbd>) to substitute one layer at a time: first the lower bound, then the
        upper bound, then both together. Or click any step below.
      </p>
      {side === 'upper' && <PrevBound d={d.lower} stage={stage} j={j} trace={trace} onSelect={() => at(0)} />}
      <Backsub d={d[side]} side={side} stage={stage} j={j} trace={trace} sub={done ? d[side].steps.length : local}
        onSub={(k) => at(side === 'lower' ? k : n + k)} />

      <Finish lower={d.lower} upper={d.upper} stage={stage} j={j} trace={trace}
        phase={phase} onSelect={(k) => at(end + k)} concretize={false}>
        <p className="small muted">
          No need to concretize <Tex>{h}</Tex>: DeepPoly never uses its interval. Stability was decided by{' '}
          <Tex>{z}</Tex>'s interval, and later layers substitute through <Tex>{h}</Tex> with its two lines, not with
          numbers.
        </p>
      </Finish>
    </>
  )
}

/** Diagram state at sub-step `sub`: during a walk, the walked bound's expression
 *  at that depth and what was just substituted (with the finished lower bound
 *  kept, greyed, during the upper walk); then both finished bounds; then the interval. Works for any step whose detail carries
 *  `lower` / `upper` walks (weighted sums and ReLUs). */
function walkFocus(step: Step, _trace: Trace, sub: number): DiagramFocus {
  const d = step.detail as unknown as { lower: Derivation; upper: Derivation }
  const { side, local, done, phase } = walkPhase(d, sub)
  const lastLo = d.lower.steps[d.lower.steps.length - 1]
  const lastUp = d.upper.steps[d.upper.steps.length - 1]
  if (done) {
    return {
      stage: 0, side: null, lines: [], expanded: null, concrete: phase === 'concretize',
      lower: { coeffs: lastLo.coeffs, const: lastLo.const },
      upper: { coeffs: lastUp.coeffs, const: lastUp.const },
    }
  }
  const st = d[side].steps[local]
  return {
    stage: st.stage,
    lower: side === 'lower' ? { coeffs: st.coeffs, const: st.const } : { coeffs: lastLo.coeffs, const: lastLo.const },
    upper: side === 'upper' ? { coeffs: st.coeffs, const: st.const } : { coeffs: lastUp.coeffs, const: lastUp.const },
    side,
    concrete: false,
    lines: st.op === 'relax' ? st.uses.map((u) => ({ stage: st.replaced, neuron: u.neuron, line: u.line })) : [],
    expanded: st.op === 'expand' ? { stage: st.replaced, neurons: st.uses.map((u) => u.neuron) } : null,
  }
}

/** The question each sub-step answers. A new bound goes in its own line under the neuron;
 *  a substitution goes in the free line under the bound it rewrites. */
function walkPrompt(step: Step, trace: Trace, sub: number): DiagramPrompt {
  const d = step.detail as unknown as { lower: Derivation; upper: Derivation }
  const { side, local, phase } = walkPhase(d, sub)
  const stage = trace.stages[step.stage]
  const name = pneuron(stage, step.neuron!)
  const at = (slot: DiagramPrompt['slot'], text: DiagramPrompt['text']): DiagramPrompt => ({ stage: step.stage, neuron: step.neuron, slot, text })
  if (phase === 'bounds') return at('below', [pw('Combine both bounds')])
  if (phase === 'concretize') return at('interval', [pw('Interval of '), name, pw('?')])
  const st = d[side].steps[local]
  if (st.op === 'start') {
    return at(side, [pw(`${side === 'lower' ? 'Lower' : 'Upper'} bound of `), name, pw('?')])
  }
  // the neurons this substitution rewrites and the layer they are rewritten over,
  // e.g. "Substitute h₁, h₂ in terms of z₁, z₂". Each ReLU output has lines in its
  // own input only; a weighted sum is over the neurons its result uses (all of the layer
  // when that is only a constant)
  // a ReLU's walk first substitutes the neuron by its own line: ask for that line, on its arrow
  if (st.op === 'relax' && st.replaced === step.stage) {
    return at(side === 'lower' ? 'line-lower' : 'line-upper', [pw(`${side === 'lower' ? 'Lower' : 'Upper'} line of `), name, pw('?')])
  }
  const layer = trace.stages[st.replaced]
  const below = trace.stages[st.stage]
  const list = (stage: Stage, js: number[]) => js.flatMap((j, k) => [...(k ? [pw(', ')] : []), pneuron(stage, j)])
  const replaced = st.uses.map((u) => u.neuron)
  const who = list(layer, replaced)
  const used = st.coeffs.flatMap((c, i) => (Math.abs(c) > EPS ? [i] : []))
  const over = list(below, st.op === 'relax' ? replaced
    : used.length ? used : Array.from({ length: below.size }, (_, i) => i))
  return at(side === 'lower' ? 'upper' : 'below', who.length
    ? [pw('Substitute '), ...who, pw(' in terms of '), ...over]
    : [pw('Nothing to substitute in '), ...list(layer, Array.from({ length: layer.size }, (_, i) => i))])
}

// lower walk + upper walk + both bounds + concretize
const walkLength = (step: Step) => {
  const d = step.detail as unknown as { lower: Derivation; upper: Derivation }
  return d.lower.steps.length + d.upper.steps.length + 2
}
// a ReLU output stops at "both bounds": no concretize step
const reluWalkLength = (step: Step) => walkLength(step) - 1
// its lines appear on the arrow as the walks reach them
const reluReveal = (step: Step, _trace: Trace, sub: number): DiagramReveal => ({
  stage: step.stage, neuron: step.neuron!, bounds: 'both',
  lines: reluLines(step.detail as unknown as ReluDetail, sub),
})

export const deeppolyViews: Record<string, StepView> = {
  'deeppoly.affine': {
    subSteps: walkLength,
    focus: walkFocus,
    prompt: walkPrompt,
    title: (step, trace) => `Bounding ${textSym(trace.stages[step.stage], step.neuron!)}: substitute backward`,
    heading: (step, trace) => <>Bounding <Tex>{texSym(trace.stages[step.stage], step.neuron!)}</Tex>: substitute backward</>,
    Body: AffineBody,
  },
  'deeppoly.relu': {
    subSteps: reluWalkLength,
    focus: walkFocus,
    prompt: walkPrompt,
    reveal: reluReveal,
    title: (step, trace) => `Relaxing ${textSym(trace.stages[step.stage], step.neuron!)}: two lines for ReLU`,
    heading: (step, trace) => <>Relaxing <Tex>{texSym(trace.stages[step.stage], step.neuron!)}</Tex>: two lines for ReLU</>,
    Body: ReluBody,
  },
}
