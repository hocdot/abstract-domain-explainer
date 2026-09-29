import { fmt, texNum, texSym, textSym } from '../format'
import { IntervalBar, ReluPlot, niceRange } from '../components/plots'
import { Tex, hi, lo } from '../components/Tex'
import type { Bounds, Stage } from '../types'
import type { StepProps, StepView } from './registry'

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
  center: number
  radius: number
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

function AffineBody({ step, trace }: StepProps) {
  const d = step.detail as unknown as AffineDetail
  const j = step.neuron!
  const stage = trace.stages[step.stage]
  const src = trace.stages[step.stage - 1]
  const out = stage.bounds[j]
  const range = niceRange([out.lower, out.upper, ...src.bounds.flatMap((b) => [b.lower, b.upper])])
  const firstLayer = src.kind === 'input'

  return (
    <>
      <p>
        <Tex>{texSym(stage, j)}</Tex> is a weighted sum of the neurons on its left:
      </p>
      <Tex block>{`${texSym(stage, j)} = ${linearCombo(d.terms, src, d.bias)}`}</Tex>
      <p>
        We already have an interval for each of those neurons. How small and how large can the sum get? Take each term on
        its own. A <strong>positive</strong> weight gives the smallest product at the input's{' '}
        <span className="lo">lower</span> end. A <strong>negative</strong> weight flips this: the smallest product comes
        from the <span className="hi">upper</span> end.
      </p>

      <table className="terms">
        <thead>
          <tr>
            <th>input</th>
            <th>interval</th>
            <th>weight</th>
            <th><span className="lo">smallest</span> w·input</th>
            <th><span className="hi">largest</span> w·input</th>
          </tr>
        </thead>
        <tbody>
          {d.terms.map((t) => {
            const b = src.bounds[t.source]
            return (
              <tr key={t.source} className={t.weight === 0 ? 'muted' : ''}>
                <td><Tex>{texSym(src, t.source)}</Tex></td>
                <td className="mono">[<span className="lo">{fmt(b.lower)}</span>, <span className="hi">{fmt(b.upper)}</span>]</td>
                <td className="mono">{fmt(t.weight)}</td>
                <td className="mono">
                  <span className="uses">{t.lower_pick === 'lower' ? 'lower' : 'upper'} →</span>{' '}
                  <span className="lo">{fmt(t.lower_contrib)}</span>
                </td>
                <td className="mono">
                  <span className="uses">{t.upper_pick === 'lower' ? 'lower' : 'upper'} →</span>{' '}
                  <span className="hi">{fmt(t.upper_contrib)}</span>
                </td>
              </tr>
            )
          })}
          <tr className="bias-row">
            <td colSpan={2}>bias</td>
            <td className="mono">{fmt(d.bias)}</td>
            <td className="mono">{fmt(d.bias)}</td>
            <td className="mono">{fmt(d.bias)}</td>
          </tr>
        </tbody>
      </table>

      <p>Add up each column:</p>
      <Tex block>{boundDerivation('lower', stage, j, src, d, out.lower)}</Tex>
      <Tex block>{boundDerivation('upper', stage, j, src, d, out.upper)}</Tex>

      <IntervalBar bounds={out} range={range} label={<Tex>{`${texSym(stage, j)} \\in`}</Tex>} />

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

      <details className="aside">
        <summary>How the code computes it: center and radius</summary>
        <p>
          The implementation (<code>backend/core/interval.py</code>) stores each interval as a center <Tex>c</Tex> and a
          radius <Tex>r</Tex>. It updates a whole layer at once: <Tex>{`c' = Wc + b`}</Tex> and{' '}
          <Tex>{`r' = |W|\\,r`}</Tex>. For this neuron:
        </p>
        <Tex block>{`c = ${fmt(d.center)},\\quad r = ${fmt(d.radius)} \\;\\Rightarrow\\; [c - r,\\ c + r] = [${fmt(out.lower)},\\ ${fmt(out.upper)}]`}</Tex>
        <p>That's the same interval as the table above, computed a different way.</p>
      </details>
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

function ReluBody({ step, trace }: StepProps) {
  const d = step.detail as unknown as ReluDetail
  const j = step.neuron!
  const stage = trace.stages[step.stage]
  const pre = trace.stages[step.stage - 1]
  const out = stage.bounds[j]
  const s = STATUS_TEXT[d.status]
  return (
    <>
      <p>
        Next, the activation: <Tex>{`${texSym(stage, j)} = \\mathrm{ReLU}(${texSym(pre, j)}) = \\max(0,\\ ${texSym(pre, j)})`}</Tex>
      </p>
      <div className={`status status-${d.status}`}>{s.label}</div>
      <p>{s.body}</p>
      <ReluPlot pre={d.pre} />
      <Tex block>{`${texSym(stage, j)} \\in [\\max(0,\\ ${lo(texNum(d.pre.lower))}),\\ \\max(0,\\ ${hi(texNum(d.pre.upper))})] = [${lo(fmt(out.lower))},\\ ${hi(fmt(out.upper))}]`}</Tex>
      {d.status === 'unstable' && (
        <div className="callout">
          <strong>Why unstable neurons matter.</strong> For this one neuron, the interval is still exact. But IBP forgets how{' '}
          <Tex>{texSym(stage, j)}</Tex> depends on <Tex>{texSym(pre, j)}</Tex>. Domains like CROWN and DeepPoly keep a
          linear relation for unstable neurons instead, which pays off in the layers that follow.
        </div>
      )}
    </>
  )
}

export const ibpViews: Record<string, StepView> = {
  'ibp.affine': {
    title: (step, trace) => `Bounding ${textSym(trace.stages[step.stage], step.neuron!)}: a weighted sum`,
    heading: (step, trace) => <>Bounding <Tex>{texSym(trace.stages[step.stage], step.neuron!)}</Tex>: a weighted sum</>,
    Body: AffineBody,
  },
  'ibp.relu': {
    title: (step, trace) => `Bounding ${textSym(trace.stages[step.stage], step.neuron!)}: through ReLU`,
    heading: (step, trace) => <>Bounding <Tex>{texSym(trace.stages[step.stage], step.neuron!)}</Tex>: through ReLU</>,
    Body: ReluBody,
  },
}
