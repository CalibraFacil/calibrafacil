import type { PtOverallStatus } from '@calibra-facil/schemas/machines'

export const PT_ACTIVITY_TYPES = [
  'proficiency_test',
  'interlab_comparison',
] as const

const SCORE_TYPES = ['en', 'z', 'z_prime', 'zeta'] as const

type PtStatus = PtOverallStatus
export type PtActivityType = (typeof PT_ACTIVITY_TYPES)[number]
export type PtScoreType = (typeof SCORE_TYPES)[number]
type PtVerdict = Exclude<PtStatus, 'pending'>

export const PT_ACTIVITY_TYPE_LABELS: Record<PtActivityType, string> = {
  proficiency_test: 'Ensaio de proficiência',
  interlab_comparison: 'Comparação interlaboratorial',
}

export const SCORE_TYPE_LABELS: Record<PtScoreType, string> = {
  en: 'En',
  z: 'z',
  z_prime: 'z′',
  zeta: 'ζ',
}

export type PtRound = {
  id: number
  activityType: PtActivityType
  provider: string
  providerAccreditation: string | null
  ptRound: string
  scopePart: string
  metrologyKind: string | null
  standardId: number | null
  standardName: string | null
  registrationDate: string | null
  participationDate: string | null
  resultReportedAt: string | null
  overallStatus: PtStatus
  capaId: number | null
  createdAt: string
  updatedAt: string
}

export type PtListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: PtStatus | ''
  activityTypeFilter: PtActivityType | ''
}

export type PtListData = {
  data: PtRound[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type PtSummaryData = {
  total: number
  pending: number
  satisfactory: number
  questionable: number
  unsatisfactory: number
  planItems: number
  planOverdue: number
  planDueSoon: number
}

export type PtResultPoint = {
  label: string
  unit: string | null
  labValue: number
  labUncertainty: number | null
  refValue: number
  refUncertainty: number | null
  sigmaPt: number | null
  scoreType: PtScoreType
  score: number | null
  verdict: PtVerdict | null
}

export type PtDetail = PtRound & {
  results: PtResultPoint[] | null
  notes: string | null
  createdBy: string
  createdByName: string | null
}

type PtAuditLogEntry = {
  id: number
  action: string
  changes: unknown
  performedBy: string
  performedByName: string | null
  performedAt: string
  reason: string | null
}

export type PtAuditLogData = {
  data: PtAuditLogEntry[]
}

export type PtPlanItem = {
  id: number
  scopePart: string
  riskJustification: string | null
  frequencyMonths: number
  lastSatisfactoryAt: string | null
  nextDueAt: string | null
  createdAt: string
  updatedAt: string
}

export type PtPlanData = {
  data: PtPlanItem[]
}

/** Minimal reference-standard option list for the create-round form. */
type PtStandardOption = {
  id: number
  name: string
  serialNumber: string
}

export type PtStandardOptionsData = {
  data: PtStandardOption[]
}
