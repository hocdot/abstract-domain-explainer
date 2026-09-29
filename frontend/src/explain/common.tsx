import { fmt, texSym } from '../format'
import { BoxPlot, IntervalBar, niceRange } from '../components/plots'
import { Tex } from '../components/Tex'
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

function OutputBody({ trace }: StepProps) {
  const y = trace.stages[trace.stages.length - 1]
  const range = niceRange(y.bounds.flatMap((b) => [b.lower, b.upper]))
  return (
    <>
      <p>
        That's the whole network. For <em>every</em> input in the box, each output is guaranteed to lie in its interval:
        the bounds are <strong>sound</strong>.
      </p>
      <div className="bars">
        {y.bounds.map((b, j) => (
          <IntervalBar key={j} bounds={b} range={range} label={<Tex>{texSym(y, j)}</Tex>} />
        ))}
      </div>
      <p>
        The guarantee only goes one way. The true range of an output can be <em>smaller</em> than its interval, because
        the bounds get a little looser at every layer. Tighter abstract domains, such as CROWN and DeepPoly, shrink that gap.
      </p>
    </>
  )
}

export const commonViews: Record<string, StepView> = {
  input: { title: () => 'Start with a box of inputs', Body: InputBody },
  output: { title: () => 'Output bounds', Body: OutputBody },
}
