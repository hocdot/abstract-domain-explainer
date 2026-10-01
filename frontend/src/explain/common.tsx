import { fmt, texLin, texSym } from '../format'
import { IntervalBar, SamplePlot, niceRange } from '../components/plots'
import { Tex } from '../components/Tex'
import type { Bounds } from '../types'
import { DOMAIN_NAMES, type StepProps, type StepView } from './registry'

function InputBody({ step, trace }: StepProps) {
  const x = trace.stages[0]
  const y = trace.stages[trace.stages.length - 1]
  const samples = (step.detail as { samples?: { inputs: number[][]; outputs: number[][] } }).samples
  const domain = DOMAIN_NAMES[trace.domain] ?? trace.domain
  // a property the bounds settle, e.g. y1 ∈ [1, 4] proves y1 < 5: the next whole number above the bound
  const out = y.bounds[0]
  const y1 = texSym(y, 0)
  const limit = Math.floor(out.upper) + 1
  const ranges = (s: typeof x) => s.bounds.map((b, i) => (
    <li key={i}><Tex>{`${texSym(s, i)} \\in [${fmt(b.lower)},\\ ${fmt(b.upper)}]`}</Tex></li>
  ))
  return (
    <>
      <p>
        In neural network verification, the input is <strong>not</strong> a single data point, but rather a <strong>box</strong>—a continuous space
        where each variable can take any value within its own interval. Our goal is to determine every possible output
        the network could produce for any point inside that box.
      </p>
      {samples ? (
        <>
          {/* the idea in one picture: inputs from the box, pushed through the network */}
          <div className="io-figure">
            <figure>
              <figcaption>Input box</figcaption>
              <SamplePlot box={x.bounds} points={samples.inputs} name="x" />
              <ul className="bound-list">{ranges(x)}</ul>
            </figure>
            <div className="io-arrow" aria-hidden="true">
              <span>network</span>
              <svg viewBox="0 0 44 14"><path d="M2,7 H38" /><path d="M33,2.5 L40,7 L33,11.5" /></svg>
            </div>
            <figure>
              <figcaption>Outputs</figcaption>
              <SamplePlot box={y.bounds} points={samples.outputs} name="y" proven />
              <ul className="bound-list">{ranges(y)}</ul>
            </figure>
          </div>
        </>
      ) : (
        <ul className="bound-list">{ranges(x)}</ul>
      )}
      <h3>Abstract domains</h3>
      <p>
        Because an input box contains an <strong>infinite</strong> number of points, finding a network's exact outputs is computationally
        impossible. Instead, an abstract domain replaces it with a simpler description. By using a single interval for
        each output, we create an <strong>overapproximation</strong> that is guaranteed to contain every possible result.
        This boundary might be larger than necessary, but it never misses an output.
        For example, {samples ? "the outputs above show" : "the analysis on this page gives"} <Tex>{`${y1} \\in [${fmt(out.lower)},\\ ${fmt(out.upper)}]`}</Tex>, which is
        enough to prove that <Tex>{`${y1} < ${fmt(limit)}`}</Tex> for every input in the box. Testing sample inputs cannot provide
        this guarantee, because it only checks finitely many points and an untested input might produce a value that
        falls completely outside the range of your test results.
      </p>
      <p>
        To calculate these bounds, the abstract domain <strong>propagates</strong> the input box through each layer of
        the network. Every layer uses a rule that guarantees the <strong>overapproximation</strong> is maintained and no
        possible values are dropped. Different domains trade precision for computational cost. For instance, a domain
        that tracks exactly how neurons depend on one another yields tighter bounds, but it requires much more work to
        compute.
      </p>
      <p>
        {trace.domain === 'ibp' ? (
          <>{domain} represents each neuron using only a simple interval. It computes the bounds for each new layer based
          entirely on the intervals from the previous layer, completely ignoring the underlying dependencies between
          neurons.</>
        ) : trace.domain === 'deeppoly' ? (
          <>{domain} describes each neuron with linear lower and upper bounds defined by the preceding neurons. Tracing
          these bounds back to the inputs preserves the underlying dependencies between neurons. While it still
          propagates through the network layer by layer, preserving these mathematical relationships yields much tighter
          intervals.</>
        ) : (
          <>This page uses {domain}.</>
        )}
      </p>
      <p className="hint small muted">Use <kbd>→</kbd> or <em>Next</em> to proceed.</p>
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
