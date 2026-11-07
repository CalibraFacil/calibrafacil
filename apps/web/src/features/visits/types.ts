import type { Address } from '@calibra-facil/shared/address'
import type { VisitStatus } from '@calibra-facil/schemas/machines'

export type { VisitStatus }

type VisitAddress = Address | null

type VisitListItem = {
  id: number
  status: VisitStatus
  scheduledAt: string | null
  address: VisitAddress
  customerId: number
  customerName: string
  technicianId: string | null
  technicianName: string | null
  sourceRequestId: number | null
  createdAt: string
  assetCount: number
  customerConfirmedAt: string | null
  rescheduleRequested: boolean
}

export type VisitsListData = {
  data: Array<VisitListItem>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type VisitDetailJob = {
  jobId: number
  jobCode: string
  status: string
  assetName: string
  assetTag: string
}

export type VisitReschedulePreferredWindow = {
  /** ISO yyyy-mm-dd */
  date: string
  period: 'MORNING' | 'AFTERNOON' | 'ANY'
  note?: string
}

export type VisitPendingRescheduleRequest = {
  id: number
  reason: string | null
  preferredWindows: Array<VisitReschedulePreferredWindow>
  createdAt: string
  requestedByName: string | null
}

export type VisitDetail = {
  id: number
  status: VisitStatus
  scheduledAt: string | null
  scheduledEndAt: string | null
  address: VisitAddress
  notes: string | null
  customerId: number
  customerName: string
  technicianId: string | null
  technicianName: string | null
  sourceRequestId: number | null
  createdAt: string
  confirmedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  customerConfirmedAt: string | null
  jobs: Array<VisitDetailJob>
  pendingRescheduleRequest: VisitPendingRescheduleRequest | null
}

export const PREFERRED_PERIOD_LABELS: Record<
  VisitReschedulePreferredWindow['period'],
  string
> = {
  MORNING: 'Manhã',
  AFTERNOON: 'Tarde',
  ANY: 'Qualquer horário',
}
