import type { QueryKey } from '@tanstack/react-query'

/**
 * What a job's lifecycle event changes, as query-key prefixes to refresh
 * (roadmap 2 F2, review 3.5). One map instead of a hand-picked list at each
 * call site: an approval also moves the asset's calibration dates, may open an
 * out-of-tolerance event for the customer and closes service-order work; an
 * amendment creates a new job and, when issued, supersedes the original.
 */
export type JobLifecycleEvent =
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'assigned'
  | 'submitted'
  | 'amended'
  | 'withdrawn'

const JOB_VIEWS: QueryKey[] = [['jobs'], ['dashboard'], ['jobs-for-nc']]

export const JOB_EVENT_EFFECTS: Record<JobLifecycleEvent, QueryKey[]> = {
  approved: [
    ...JOB_VIEWS,
    ['assets'],
    ['asset'],
    ['customer-oot-events'],
    ['service-order'],
    ['service-orders'],
    ['notifications'],
    ['finance'],
  ],
  rejected: [...JOB_VIEWS, ['notifications']],
  cancelled: [
    ...JOB_VIEWS,
    ['service-order'],
    ['service-orders'],
    ['visit'],
    ['visits'],
  ],
  assigned: [...JOB_VIEWS, ['notifications']],
  submitted: [...JOB_VIEWS, ['notifications']],
  amended: [...JOB_VIEWS, ['assets'], ['asset']],
  withdrawn: [...JOB_VIEWS, ['customer-oot-events'], ['asset']],
}

/** The prefixes to refresh after `event`. */
export function jobEventQueryKeys(event: JobLifecycleEvent): QueryKey[] {
  return JOB_EVENT_EFFECTS[event]
}
