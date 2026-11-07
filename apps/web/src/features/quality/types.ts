import type {
  CapaListItem,
  NonConformanceListItem,
  OotImpactAssessment,
  OotNotification,
} from '@calibra-facil/contracts'
import type {
  CorrectiveActionStatus,
  NonConformanceStatus,
} from '@calibra-facil/schemas/machines'

export const NON_CONFORMANCE_TYPES = [
  'work',
  'equipment',
  'documentation',
  'out_of_tolerance',
] as const

export type { NonConformanceStatus }
export type NonConformanceType = (typeof NON_CONFORMANCE_TYPES)[number]
export type NonConformanceDisposition =
  | 'rework'
  | 'scrap'
  | 'use_as_is'
  | 'concession'
  | null

// The non-conformance and CAPA DTOs are the contract's
// (`@calibra-facil/contracts`, `endpoints/non-conformances.ts` and
// `endpoints/capa.ts`); the names below are the views the pages use.
export type NonConformanceRow = NonConformanceListItem
export type OotNotificationData = OotNotification
export type OotImpactAssessmentData = OotImpactAssessment

export type NonConformanceListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: NonConformanceStatus | ''
  typeFilter: NonConformanceType | ''
}

export type NewNonConformanceJobsData = {
  data: Array<{
    id: number
    jobId: string
    status: string
  }>
}

export const CAPA_SEVERITIES = ['minor', 'major', 'critical'] as const

export const CAPA_CATEGORIES = [
  'method',
  'equipment',
  'personnel',
  'procedure',
  'environment',
  'other',
] as const

type CapaStatus = CorrectiveActionStatus
export type CapaSeverity = (typeof CAPA_SEVERITIES)[number]
export type CapaCategory = (typeof CAPA_CATEGORIES)[number]

export type CapaRow = CapaListItem

export type CapaListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: CapaStatus | ''
  severityFilter: CapaSeverity | ''
  categoryFilter: CapaCategory | ''
}

export type CapaResponsibleMembersData = {
  data?: Array<{
    id: string
    name: string
    role: string
  }>
}
