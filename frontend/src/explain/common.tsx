import { fmt, texLin, texSym } from '../format'
import { BoxPlot, IntervalBar, niceRange } from '../components/plots'
import { Tex } from '../components/Tex'
import type { Bounds } from '../types'
import { DOMAIN_NAMES, type StepProps, type StepView } from './registry'

function InputBody({ trace }: StepProps) {
  const x = trace.stages[0]
  const lower = x.bounds.map((b) => b.lower)
  const upper = x.bounds.map((b) => b.upper)
  return (
    <>
      <p>
        A verifier doesn't test one input. It reasons about <em>every</em> input in a region at once. Here the region is
        a <strong>box</strong>: each input gets its own interval and can take any value inside it.
      </p>
      <div className="split">
        <ul className="bound-list">
          {x.bounds.map((b, i) => (
            <li key={i}>
              <Tex>{`${texSym(x, i)} \\in [${fmt(b.lower)},\\ ${fmt(b.upper)}]`}</Tex>
            </li>
          ))}
        </ul>
        {x.size === 2 && <BoxPlot lower={lower} upper={upper} />}
      </div>
      <p>
        Our goal is an interval for every neuron that is <strong>guaranteed</strong> to contain all the values it can take
        on this box. {DOMAIN_NAMES[trace.domain] ?? trace.domain} computes them left to right, one neuron at a time.
      </p>
      <p className="hint">Press <kbd>→</kbd> or <em>Next</em> to start.</p>
    </>
  )
}

function OutputBody({ step, trace }: StepProps) {
  const y = trace.stages[trace.stages.length - 1]
  // domains that tighten IBP pass its output bounds along for comparison
  const ibp = (step.detail as { ibp?: Bounds[] }).ibp
  const range = niceRange([...y.bounds, ...(ibp ?? [])].flatMap((b) => [b.lower, b.upper]))
  return (
    <>
      <p>
        That's the whole network. For <em>every</em> input in the box, each output is guaranteed to lie in its interval:
        the bounds are <strong>sound</strong>.
      </p>
      <div className="bars">
        {y.bounds.map((b, j) => (
          <div key={j} className={ibp ? 'compare' : ''}>
            <IntervalBar bounds={b} range={range} sampled={y.sampled[j]} label={<Tex>{texSym(y, j)}</Tex>} />
            {ibp && <IntervalBar bounds={ibp[j]} range={range} faded label={<span className="bar-name">IBP</span>} />}
          </div>
        ))}
      </div>
      {y.linear.length > 0 && (
        <div className="result-card">
          <div className="result-title">Linear bounds over the inputs</div>
          <Tex block>{`\\begin{aligned} ${y.linear
            .map((lb, j) => {
              const x = (i: number) => texSym(trace.stages[0], i)
              return `\\htmlClass{tex-lo}{${texLin(lb.lower.coeffs, x, lb.lower.const)}} &\\le ${texSym(y, j)} \\le \\htmlClass{tex-hi}{${texLin(lb.upper.coeffs, x, lb.upper.const)}}`
            })
            .join(' \\\\ ')} \\end{aligned}`}</Tex>
          <p className="small muted">Each output is squeezed between two linear functions of the inputs; evaluating them on the box gives the intervals above.</p>
        </div>
      )}
      <p className="hint muted">
        Dark inner bar: the range actually reached on thousands of sampled inputs. The true range lies somewhere between
        it and the bound.{ibp && ' Faded bars: what IBP computes for the same outputs.'}
      </p>
      <p>
        The guarantee only goes one way. The true range of an output can be <em>smaller</em> than its interval, because
        the bounds get a little looser at every layer.{' '}
        {ibp
          ? 'Linear relaxations shrink that gap compared with IBP, but still cannot close it in general.'
          : 'Tighter abstract domains, such as DeepPoly and CROWN, shrink that gap.'}
      </p>
    </>
  )
}

export const commonViews: Record<string, StepView> = {
  input: { title: () => 'Start with a box of inputs', Body: InputBody },
  output: { title: () => 'Output bounds', Body: OutputBody },
}
