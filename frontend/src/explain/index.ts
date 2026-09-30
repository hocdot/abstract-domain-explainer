import { commonViews } from './common'
import { deeppolyViews } from './deeppoly'
import { ibpViews } from './ibp'
import { registerViews } from './registry'

registerViews(commonViews)
registerViews(ibpViews)
registerViews(deeppolyViews)

export { viewFor } from './registry'
export type { StepProps, StepView } from './registry'
