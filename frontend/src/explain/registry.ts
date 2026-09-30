import type { FC, ReactNode } from 'react'
import type { DiagramFocus, Step, Trace } from '../types'

export interface StepProps {
  step: Step
  trace: Trace
  /** current sub-step (for views that define `subSteps`) and a way to jump */
  sub: number
  onSub: (k: number) => void
}

/** How one step kind is explained. Domains register their own kinds
 *  (e.g. 'crown.backsub'); the shared 'input' / 'output' views are reused. */
export interface StepView {
  /** Plain text, used for tooltips. */
  title: (step: Step, trace: Trace) => string
  /** Rich heading for the explanation panel; defaults to `title`. */
  heading?: (step: Step, trace: Trace) => ReactNode
  Body: FC<StepProps>
  /** Number of sub-steps Next walks through before the next step (default 1). */
  subSteps?: (step: Step) => number
  /** What the diagram highlights at a given sub-step. */
  focus?: (step: Step, trace: Trace, sub: number) => DiagramFocus | null
}

export const DOMAIN_NAMES: Record<string, string> = {
  ibp: 'Interval Bound Propagation (IBP)',
  deeppoly: 'DeepPoly (equivalently, CROWN)',
}

const VIEWS: Record<string, StepView> = {}

export function registerViews(views: Record<string, StepView>) {
  Object.assign(VIEWS, views)
}

export function viewFor(kind: string): StepView {
  return VIEWS[kind] ?? fallback
}

const fallback: StepView = {
  title: (step) => step.kind,
  Body: () => null,
}
