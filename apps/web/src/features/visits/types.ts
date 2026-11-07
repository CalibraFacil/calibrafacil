import type { VisitReschedulePreferredWindow } from '@calibra-facil/contracts'

// The visit DTOs are the contract's (`@calibra-facil/contracts`,
// `endpoints/visits.ts`).
export type {
  VisitDetail,
  VisitDetailJob,
  VisitPendingRescheduleRequest,
  VisitReschedulePreferredWindow,
  VisitStatus,
} from '@calibra-facil/contracts'

export const PREFERRED_PERIOD_LABELS: Record<
  VisitReschedulePreferredWindow['period'],
  string
> = {
  MORNING: 'Manhã',
  AFTERNOON: 'Tarde',
  ANY: 'Qualquer horário',
}
