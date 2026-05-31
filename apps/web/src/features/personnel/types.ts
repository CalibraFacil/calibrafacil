export const COMPETENCE_STATUSES = [
  'REQUESTED',
  'TRAINING_ASSIGNED',
  'IN_TRAINING',
  'PENDING_EVALUATION',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'CANCELLED',
] as const

export type CompetenceStatus = (typeof COMPETENCE_STATUSES)[number]

export type CompetenceRow = {
  id: number
  userId: string
  userName: string
  assetTypeId: number | null
  assetTypeName: string | null
  scopeDescription: string
  status: CompetenceStatus
  qualifiedAt: string | null
  expiresAt: string | null
  notes: string | null
  createdAt: string
}

export type CompetencesListData = {
  data: Array<CompetenceRow>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type CompetencesListQueryInput = {
  organizationId: string
  page: number
  limit: number
  statusFilter: CompetenceStatus | ''
}

export type CompetencesMatrixData = {
  technicians: Array<{ userId: string; userName: string; role: string }>
  assetTypes: Array<{ id: number; name: string }>
  competences: Array<{
    id: number
    userId: string
    assetTypeId: number | null
    status: CompetenceStatus
    expiresAt: string | null
  }>
}

export type TrainingType = 'internal' | 'external' | 'ojt' | 'proficiency_test'

export type CompetenceTrainingRecord = {
  id: number
  title: string
  type: string
  status: string
  provider?: string | null
  description?: string | null
  startDate: string
  endDate: string | null
  hoursCompleted?: number | null
  score?: number | null
  passingScore?: number | null
  passed?: boolean | null
}

export type CompetenceDetail = {
  id: number
  organizationId: string
  userId: string
  userName: string | null
  userEmail: string | null
  assetTypeId: number | null
  assetTypeName: string | null
  scopeDescription: string
  status: CompetenceStatus
  qualifiedAt: string | null
  expiresAt: string | null
  certificateR2Key: string | null
  certificateFileName: string | null
  notes: string | null
  requestedBy: string
  requestedByName: string | null
  evaluatedBy: string | null
  evaluatedByName: string | null
  approvedBy: string | null
  approvedByName: string | null
  createdAt: string
  updatedAt: string
  trainingRecords: Array<CompetenceTrainingRecord>
}

export type AssignableTrainingRecord = {
  id: number
  userId: string
  competenceId: number | null
  title: string
  type: TrainingType
  status: string
  provider: string | null
  startDate: string
  endDate: string | null
  hoursCompleted: number | null
}

export type AssignableTrainingRecordsData = {
  data: Array<AssignableTrainingRecord>
}

export type CompetenceAuditLogRecord = {
  id: number
  action: string
  changes: Record<string, unknown> | null
  performedBy: string
  performedByName: string
  performedAt: string
  reason: string | null
}

export type CompetenceAuditLogData = Array<CompetenceAuditLogRecord>
