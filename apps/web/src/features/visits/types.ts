export const VISIT_STATUSES = [
  'PROPOSED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const

export type VisitStatus = (typeof VISIT_STATUSES)[number]

export type VisitAddress = {
  cep?: string
  number?: string
  street?: string
  complement?: string
  neighbourhood?: string
  city?: string
  state?: string
} | null

export type VisitListItem = {
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

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  PROPOSED: 'Proposta',
  CONFIRMED: 'Confirmada',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
}

export const VISIT_STATUS_VARIANTS: Record<
  VisitStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PROPOSED: 'secondary',
  CONFIRMED: 'default',
  IN_PROGRESS: 'default',
  COMPLETED: 'outline',
  CANCELLED: 'destructive',
}

export function formatVisitAddress(address: VisitAddress): string {
  if (!address) return ''
  const street = [address.street, address.number].filter(Boolean).join(', ')
  const region = [address.neighbourhood, address.city, address.state]
    .filter(Boolean)
    .join(' - ')
  return [street, address.complement, region, address.cep]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}
