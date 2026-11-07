import type { QueryKey } from '@tanstack/react-query'

import { assetKeys } from '@/features/assets/keys'
import { customerKeys } from '@/features/customers/keys'
import { dashboardKeys } from '@/features/dashboard/keys'
import { financeKeys } from '@/features/finance/keys'
import { notificationKeys } from '@/features/notifications/keys'
import { serviceOrderKeys } from '@/features/service-orders/keys'
import { visitKeys } from '@/features/visits/keys'
import { jobKeys } from './keys'

/**
 * What a job's lifecycle event changes, as query-key prefixes to refresh. One
 * map instead of a hand-picked list at each call site: an approval also moves the asset's calibration dates, may open an
 * out-of-tolerance event for the customer and closes service-order work; an
 * amendment creates a new job and, when issued, supersedes the original.
 * The prefixes come from each feature's key factory, never a retyped array.
 */
export type JobLifecycleEvent =
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'assigned'
  | 'submitted'
  | 'amended'
  | 'withdrawn'

const JOB_VIEWS: QueryKey[] = [
  jobKeys.all,
  dashboardKeys.all,
  jobKeys.forNonConformance,
]

export const JOB_EVENT_EFFECTS: Record<JobLifecycleEvent, QueryKey[]> = {
  approved: [
    ...JOB_VIEWS,
    ...assetKeys.prefixes,
    customerKeys.ootEventsAll,
    ...serviceOrderKeys.prefixes,
    notificationKeys.all,
    financeKeys.all,
  ],
  rejected: [...JOB_VIEWS, notificationKeys.all],
  cancelled: [
    ...JOB_VIEWS,
    ...serviceOrderKeys.prefixes,
    ...visitKeys.prefixes,
  ],
  assigned: [...JOB_VIEWS, notificationKeys.all],
  submitted: [...JOB_VIEWS, notificationKeys.all],
  amended: [...JOB_VIEWS, ...assetKeys.prefixes],
  withdrawn: [...JOB_VIEWS, customerKeys.ootEventsAll, assetKeys.details],
}

/** The prefixes to refresh after `event`. */
export function jobEventQueryKeys(event: JobLifecycleEvent): QueryKey[] {
  return JOB_EVENT_EFFECTS[event]
}
