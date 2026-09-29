import type { FC, ReactNode } from 'react'
import type { Step, Trace } from '../types'

export interface StepProps {
  step: Step
  trace: Trace
}

/** How one step kind is explained. Domains register their own kinds
 *  (e.g. 'crown.backsub'); the shared 'input' / 'output' views are reused. */
export interface StepView {
  /** Plain text, used for tooltips. */
  title: (step: Step, trace: Trace) => string
  /** Rich heading for the explanation panel; defaults to `title`. */
  heading?: (step: Step, trace: Trace) => ReactNode
  Body: FC<StepProps>
}

export const DOMAIN_NAMES: Record<string, string> = {
  ibp: 'Interval Bound Propagation (IBP)',
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
