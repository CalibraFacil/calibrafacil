export const NON_CONFORMANCE_STATUSES = [
  'open',
  'under_review',
  'resolved',
] as const

export const NON_CONFORMANCE_TYPES = [
  'work',
  'equipment',
  'documentation',
] as const

export type NonConformanceStatus = (typeof NON_CONFORMANCE_STATUSES)[number]
export type NonConformanceType = (typeof NON_CONFORMANCE_TYPES)[number]
export type NonConformanceDisposition =
  | 'rework'
  | 'scrap'
  | 'use_as_is'
  | 'concession'
  | null

export type NonConformanceRow = {
  id: number
  ncNumber: string
  jobId: number | null
  type: NonConformanceType
  description: string
  detectedBy: string
  detectedByName: string | null
  detectedAt: string
  disposition: NonConformanceDisposition
  status: NonConformanceStatus
  capaId: number | null
  ageDays: number
  createdAt: string
}

export type NonConformanceListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: NonConformanceStatus | ''
  typeFilter: NonConformanceType | ''
}

export type NonConformanceListData = {
  data: NonConformanceRow[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type NonConformanceSummaryData = {
  byStatus: Array<{ status: string; count: number }>
  byType: Array<{ type: string; count: number }>
  ageBrackets: { lessThan7Days: number; moreThan30Days: number }
}

export type NonConformanceDetail = {
  id: number
  ncNumber: string
  jobId: number | null
  type: NonConformanceType
  description: string
  detectedBy: string
  detectedByName: string | null
  detectedAt: string
  disposition: Exclude<NonConformanceDisposition, null> | null
  dispositionJustification?: string | null
  dispositionApproverName?: string | null
  dispositionApprovedAt?: string | null
  correctionTaken?: string | null
  resolverName?: string | null
  resolvedAt?: string | null
  status: NonConformanceStatus
  capaId: number | null
  ageDays: number
  job?: {
    id: number
    jobId: string
    status: string
  } | null
  capa?: {
    id: number
    capaNumber: string
    status: string
    dueDate: string | null
    rootCauseAnalysis: string | null
    actionPlan: string | null
  } | null
}

export type NonConformanceAuditLogEntry = {
  id: number
  action: string
  changes: unknown
  performedBy: string
  performedAt: string
  reason: string | null
}

export type NonConformanceAuditLogData = {
  data: Array<NonConformanceAuditLogEntry>
}

export type NewNonConformanceJobsData = {
  data: Array<{
    id: number
    jobId: string
    status: string
  }>
}

export const CAPA_STATUSES = [
  'OPEN',
  'INVESTIGATION',
  'IMPLEMENTATION',
  'VERIFICATION',
  'CLOSED',
] as const

export const CAPA_SEVERITIES = ['minor', 'major', 'critical'] as const

export const CAPA_CATEGORIES = [
  'method',
  'equipment',
  'personnel',
  'procedure',
  'environment',
  'other',
] as const

export type CapaStatus = (typeof CAPA_STATUSES)[number]
export type CapaSeverity = (typeof CAPA_SEVERITIES)[number]
export type CapaCategory = (typeof CAPA_CATEGORIES)[number]

export type CapaRow = {
  id: number
  capaNumber: string
  title: string
  source: string
  type: string
  severity: string
  category: string
  status: string
  responsibleName: string | null
  dueDate: string | null
  ageDays: number
  isOverdue: boolean | null
  createdAt: string
}

export type CapaListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: CapaStatus | ''
  severityFilter: CapaSeverity | ''
  categoryFilter: CapaCategory | ''
}

export type CapaListData = {
  data: CapaRow[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type CapaSummaryData = {
  byStatus: Array<{ status: string; count: number }>
  bySeverity: Array<{ severity: string; count: number }>
  byCategory: Array<{ category: string; count: number }>
  overdue: number
  effectivenessRate: number
  totalClosed: number
}

export type CapaDetail = {
  id: number
  capaNumber: string
  organizationId: string
  source: string
  sourceReference: string | null
  title: string
  description: string
  detectionDate: string | null
  type: string
  severity: string
  category: string
  rootCauseAnalysis: string | null
  rootCauseAnalysisMethod: string | null
  actionPlan: string | null
  preventiveMeasures: string | null
  responsibleId: string | null
  dueDate: string | null
  implementationEvidence: string | null
  implementedAt: string | null
  investigationCompletedAt: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  verificationNotes: string | null
  effectivenessConfirmed: boolean | null
  status: string
  closedAt: string | null
  closedBy: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  responsibleName: string | null
  verifiedByName: string | null
  closedByName: string | null
  createdByName: string | null
  linkedNCs: Array<{
    id: number
    ncNumber: string
    type: string
    description: string
    status: string
    detectedAt: string
  }>
  ageDays: number
  isOverdue: boolean | null
}

export type CapaAuditLogEntry = {
  id: number
  capaId: number
  action: string
  changes: unknown
  performedBy: string
  performedAt: string
  ipAddress: string | null
  reason: string | null
  performedByName: string | null
}

export type CapaAuditLogData = {
  data: Array<CapaAuditLogEntry>
}

export type CapaResponsibleMembersData = {
  data?: Array<{
    id: string
    name: string
    role: string
  }>
}
