import { commonViews } from './common'
import { ibpViews } from './ibp'
import { registerViews } from './registry'

registerViews(commonViews)
registerViews(ibpViews)

export { viewFor } from './registry'
export type { StepProps, StepView } from './registry'
