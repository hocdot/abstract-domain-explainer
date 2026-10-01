import { fmt, texNum, texSym, textSym } from '../format'
import { IntervalBar, ReluPlot, niceRange } from '../components/plots'
import { Tex, hi, lo } from '../components/Tex'
import type { Bounds, DiagramPrompt, DiagramReveal, Stage, Step, Trace } from '../types'
import { pneuron, pw, type StepProps, type StepView } from './registry'

type Pick = 'lower' | 'upper'

interface Term {
  source: number
  weight: number
  lower_pick: Pick
  lower_value: number
  lower_contrib: number
  upper_pick: Pick
  upper_value: number
  upper_contrib: number
}

interface AffineDetail {
  bias: number
  terms: Term[]
  textbook: Bounds
}

interface ReluDetail {
  pre: Bounds
  status: 'active' | 'inactive' | 'unstable'
}

const color = (pick: Pick, tex: string) => (pick === 'lower' ? lo(tex) : hi(tex))

/** "1 x_1 - 2 x_2 + 0.5", skipping zero weights. */
function linearCombo(terms: Term[], src: Stage, bias: number): string {
  const parts: string[] = []
  for (const t of terms) {
    if (t.weight === 0) continue
    const a = Math.abs(t.weight)
    const coef = a === 1 ? '' : `${fmt(a)}\\,`
    const sign = t.weight < 0 ? '-' : '+'
    parts.push(parts.length === 0 ? `${sign === '-' ? '-' : ''}${coef}${texSym(src, t.source)}` : ` ${sign} ${coef}${texSym(src, t.source)}`)
  }
  if (bias !== 0 || parts.length === 0) {
    parts.push(parts.length === 0 ? fmt(bias) : ` ${bias < 0 ? '-' : '+'} ${fmt(Math.abs(bias))}`)
  }
  return parts.join('')
}

/** Three aligned lines: symbolic endpoints, numbers, result. */
function boundDerivation(side: Pick, stage: Stage, j: number, src: Stage, d: AffineDetail, result: number): string {
  const live = d.terms.filter((t) => t.weight !== 0)
  const pick = (t: Term) => (side === 'lower' ? t.lower_pick : t.upper_pick)
  const value = (t: Term) => (side === 'lower' ? t.lower_value : t.upper_value)
  const symbolic = live.map((t) => `${texNum(t.weight)}\\cdot ${color(pick(t), texSym(src, t.source, pick(t)))}`)
  const numeric = live.map((t) => `${texNum(t.weight)}\\cdot ${color(pick(t), texNum(value(t)))}`)
  const b = texNum(d.bias)
  const lhs = color(side, texSym(stage, j, side))
  const join = (xs: string[]) => [...xs, b].join(' + ')
  return `\\begin{aligned} ${lhs} &= ${join(symbolic)} \\\\ &= ${join(numeric)} \\\\ &= ${color(side, fmt(result))} \\end{aligned}`
}

/** Sub-steps of a neuron: 0 its equation, 1 its lower bound, 2 its upper bound. */
const SUBS = 3
const REVEAL = ['none', 'lower', 'both'] as const

function AffineBody({ step, trace, sub }: StepProps) {
  const d = step.detail as unknown as AffineDetail
  const j = step.neuron!
  const stage = trace.stages[step.stage]
  const src = trace.stages[step.stage - 1]
  const out = stage.bounds[j]
  const range = niceRange([out.lower, out.upper, ...src.bounds.flatMap((b) => [b.lower, b.upper])])
  const firstLayer = src.kind === 'input'
  const z = texSym(stage, j)
  const paren = (v: number) => (v < 0 ? `(${fmt(v)})` : fmt(v))
  // the term at one end of the interval; the end is coloured like the
  // interval column (lower blue, upper orange) so it can be traced back
  const product = (pick: string, value: number, contrib: number, cls: string, w: number) => (
    <td className="mono">
      {paren(w)} · <span className={pick === 'lower' ? 'lo' : 'hi'}>{paren(value)}</span>
      {' = '}<span className={cls}>{fmt(contrib)}</span>
    </td>
  )

  return (
    <>
      <p>
        To compute <Tex>{z}</Tex>, the network multiplies {firstLayer ? 'each input' : 'each neuron of the previous layer'} by
        the weight on its edge and adds the bias:
      </p>
      <Tex block>{`${z} = ${linearCombo(d.terms, src, d.bias)}`}</Tex>
      {sub === 0 && (
        <p>
          We already have an interval for each neuron in this sum. Next, we find how small{' '}
          <Tex>{z}</Tex> can get, and then how large.
        </p>
      )}

      {sub >= 1 && (
        <>
          <h3 className="lo">Lower bound</h3>
          <p>
            To make the sum as small as possible, make each term as small as possible on its own. A{' '}
            <strong>positive</strong> weight gives the smallest product at the input's <span className="lo">lower</span>{' '}
            end. A <strong>negative</strong> weight flips this: the smallest product comes from the{' '}
            <span className="hi">upper</span> end.
          </p>
          {sub >= 2 && (
            <>
              <h3 className="hi">Upper bound</h3>
              <p>
                For the largest sum it is the other way round: a positive weight takes the input's{' '}
                <span className="hi">upper</span> end and a negative weight its <span className="lo">lower</span> end.
              </p>
            </>
          )}
          <table className="terms">
            <thead>
              <tr>
                <th>term</th>
                <th>interval</th>
                <th><span className="lo">smallest</span></th>
                {sub >= 2 && <th><span className="hi">largest</span></th>}
              </tr>
            </thead>
            <tbody>
              {d.terms.map((t) => {
                const b = src.bounds[t.source]
                return (
                  <tr key={t.source} className={t.weight === 0 ? 'muted' : ''}>
                    <td><Tex>{`${texNum(t.weight)} \\cdot ${texSym(src, t.source)}`}</Tex></td>
                    <td className="mono">[<span className="lo">{fmt(b.lower)}</span>, <span className="hi">{fmt(b.upper)}</span>]</td>
                    {product(t.lower_pick, t.lower_value, t.lower_contrib, 'lo', t.weight)}
                    {sub >= 2 && product(t.upper_pick, t.upper_value, t.upper_contrib, 'hi', t.weight)}
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p>Add up each term and the bias:</p>
          <div className="bound-label lo">Lower bound</div>
          <Tex block>{boundDerivation('lower', stage, j, src, d, out.lower)}</Tex>
          {sub >= 2 && (
            <>
              <div className="bound-label hi">Upper bound</div>
              <Tex block>{boundDerivation('upper', stage, j, src, d, out.upper)}</Tex>
            </>
          )}
        </>
      )}

      {sub >= 2 && (
        <>
          <IntervalBar bounds={out} range={range} sampled={stage.sampled[j]} label={<Tex>{`${z} \\in`}</Tex>} />
          <p className="hint muted">Dark inner bar: values the neuron actually reaches on thousands of sampled inputs.</p>

          {firstLayer ? (
            <div className="callout">
              <strong>Exact here.</strong> The inputs vary independently, so every term can hit its extreme at the same time.
              No interval could be tighter than this one.
            </div>
          ) : (
            <div className="callout warn">
              <strong>Where precision is lost.</strong> The neurons feeding in all depend on the same inputs, so they usually
              can't all hit their extremes at once. IBP ignores that link and treats them as independent, so this interval
              can be wider than the true range.
            </div>
          )}
        </>
      )}
    </>
  )
}

const STATUS_TEXT: Record<ReluDetail['status'], { label: string; body: string }> = {
  active: {
    label: 'Always active',
    body: 'The whole interval is at or above 0, so ReLU changes nothing: the output equals the input, and so does its interval.',
  },
  inactive: {
    label: 'Always inactive',
    body: 'The whole interval is at or below 0, so ReLU always outputs 0. This neuron is off for every input in the box.',
  },
  unstable: {
    label: 'Unstable',
    body: 'The interval crosses 0: for some inputs the neuron is on, for others it is off. ReLU never decreases its input, so IBP applies it to both endpoints.',
  },
}

function ReluBody({ step, trace, sub }: StepProps) {
  const d = step.detail as unknown as ReluDetail
  const j = step.neuron!
  const stage = trace.stages[step.stage]
  const pre = trace.stages[step.stage - 1]
  const out = stage.bounds[j]
  const s = STATUS_TEXT[d.status]
  const h = texSym(stage, j)
  const z = texSym(pre, j)
  return (
    <>
      <p>
        Next, the activation: <Tex>{`${h} = \\mathrm{ReLU}(${z}) = \\max(0,\\ ${z})`}</Tex>, where{' '}
        <Tex>{`${z} \\in [${lo(fmt(d.pre.lower))},\\ ${hi(fmt(d.pre.upper))}]`}</Tex>.
      </p>
      <div className={`status status-${d.status}`}>{s.label}</div>
      <p>{s.body}</p>
      {sub >= 1 && (
        <>
          <div className="bound-label lo">Lower bound</div>
          <Tex block>{`${lo(texSym(stage, j, 'lower'))} = \\max(0,\\ ${lo(texNum(d.pre.lower))}) = ${lo(fmt(out.lower))}`}</Tex>
        </>
      )}
      {sub >= 2 && (
        <>
          <div className="bound-label hi">Upper bound</div>
          <Tex block>{`${hi(texSym(stage, j, 'upper'))} = \\max(0,\\ ${hi(texNum(d.pre.upper))}) = ${hi(fmt(out.upper))}`}</Tex>
          <ReluPlot pre={d.pre} />
          {d.status === 'unstable' && (
            <div className="callout">
              <strong>Why unstable neurons matter.</strong> For this one neuron, the interval is still exact. But IBP forgets how{' '}
              <Tex>{h}</Tex> depends on <Tex>{z}</Tex>. Domains like CROWN and DeepPoly keep a linear relation for unstable
              neurons instead, which pays off in the layers that follow.
            </div>
          )}
        </>
      )}
    </>
  )
}

/** The question each sub-step answers: the equation first, then each bound. */
const prompt = (step: Step, trace: Trace, sub: number): DiagramPrompt => {
  const n = pneuron(trace.stages[step.stage], step.neuron!)
  return sub === 0
    ? { stage: step.stage, neuron: step.neuron, slot: 'def', text: [pw('Equation of '), n, pw('?')] }
    : { stage: step.stage, neuron: step.neuron, slot: 'interval', text: [pw(sub === 1 ? 'Lower bound of ' : 'Upper bound of '), n, pw('?')] }
}
const reveal = (step: Step, _trace: Trace, sub: number): DiagramReveal =>
  ({ stage: step.stage, neuron: step.neuron!, bounds: REVEAL[Math.min(sub, SUBS - 1)] })

export const ibpViews: Record<string, StepView> = {
  'ibp.affine': {
    title: (step, trace) => `Bounding ${textSym(trace.stages[step.stage], step.neuron!)}: a linear layer`,
    heading: (step, trace) => <>Bounding <Tex>{texSym(trace.stages[step.stage], step.neuron!)}</Tex>: a linear layer</>,
    subSteps: () => SUBS,
    reveal,
    prompt,
    Body: AffineBody,
  },
  'ibp.relu': {
    title: (step, trace) => `Bounding ${textSym(trace.stages[step.stage], step.neuron!)}: through ReLU`,
    heading: (step, trace) => <>Bounding <Tex>{texSym(trace.stages[step.stage], step.neuron!)}</Tex>: through ReLU</>,
    subSteps: () => SUBS,
    reveal,
    prompt,
    Body: ReluBody,
  },
}
