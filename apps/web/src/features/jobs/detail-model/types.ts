import { type MeasurementUnit } from '@calibra-facil/shared/units'
import type { MethodInputType } from '@/components/method-runtime/types'

export type JobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

/**
 * §7.10 (#426): as-found conformity computed from the pre-adjustment margins.
 * NON_CONFORMING means the instrument arrived out of tolerance and the
 * customer may need to be notified.
 */
export type AsFoundConformity = 'CONFORMING' | 'NON_CONFORMING' | 'UNKNOWN'

export type ReviewMethodColumn = {
  key: string
  label: string
  type: 'text' | 'number'
  unit?: string | null
  phase?: string | null
}

export type ReviewMethodField = {
  key: string
  label: string
  type: MethodInputType
  unit?: string | null
  source?: string | null
  assetSpecKey?: string | null
  weighingRangeResolver?: {
    enabled?: boolean
    assetSpecKey?: string
  } | null
  columns?: ReviewMethodColumn[] | null
}

export type ReviewFormula = {
  outputKey: string
  expression?: string
  label?: string | null
  unit?: string | null
}

export type ReviewMethodSnapshot = {
  methodId?: number | null
  methodName?: string | null
  methodVersion?: number | null
  dataFields?: ReviewMethodField[] | null
  formulas?: ReviewFormula[] | null
  validations?: unknown[] | null
  accreditedScope?: boolean | null
}

export type ReviewStandardSnapshot = {
  id: number
  name: string
  type?: string | null
  certificateNumber: string
  calibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
}

export type ReviewAssetSnapshot = {
  baseMeasurementUnit?: MeasurementUnit | null
  specifications?: Record<string, unknown> | null
}

export type ApprovedJobRecordData = {
  id: number
  jobId: string
  status: string
  customerName: string | null
  assetName: string | null
  assetTag: string | null
  serviceName: string | null
  methodSnapshot: ReviewMethodSnapshot & {
    methodId: number
    methodName: string
    methodVersion: number
    dataFields: ReviewMethodField[]
    formulas: ReviewFormula[]
    validations: Array<unknown>
  }
  data: Record<string, unknown> | null
  results: Record<string, unknown> | null
  standardsSnapshot?: Array<
    ReviewStandardSnapshot & { drift: number | null }
  > | null
  assetSnapshot?: ReviewAssetSnapshot | null
  technicianName: string | null
  approvedBy: string | null
  approverName?: string | null
  approvedAt: string | null
  performedAt: string | null
  createdAt: string
  certificateUrl?: string | null
  labelUrl?: string | null
  supersededById?: number | null
  supersedesId?: number | null
  amendmentNumber?: number | null
  amendmentReason?: string | null
  supersededAt?: string | null
  asFoundConformity?: AsFoundConformity | null
  asFoundMargins?: number[] | null
  scopeOverrideJustification?: string | null
}

export type ReviewValidation = {
  leftExpression: string
  operator: string
  rightExpression: string
  message: string
  severity: 'error' | 'warning'
}

export type AdjustmentSummaryRow = {
  key: string
  point: unknown
  beforeReadings: unknown[]
  afterReadings: unknown[]
  beforeError: unknown
  afterError: unknown
  beforeMargin: number | null
  afterMargin: number | null
}

export type AcceptanceItem = {
  key: string
  message: string
  severity: 'error' | 'warning'
  status: 'ok' | 'error' | 'warning' | 'unknown'
}

export type ReviewJobDetailData = {
  methodSnapshot?: ReviewMethodSnapshot | null
  assetSnapshot?: ReviewAssetSnapshot | null
  standardsSnapshot?: ReviewStandardSnapshot[] | null
  data?: Record<string, unknown> | null
  results?: Record<string, unknown> | null
  environmentalSnapshot?: { withinLimits?: boolean | null } | null
  scopeComplianceStatus?: string | null
  scopeComplianceFindings?: ScopeComplianceFindingData[] | null
}

/**
 * Accredited-scope (CMC) finding frozen on the job by the server-side guard
 * (#427 — ISO/IEC 17025 §7.6/§7.8.3). Mirrors `ScopeComplianceFinding` in
 * `@calibra-facil/shared`, tolerant of missing fields on older records.
 */
export type ScopeComplianceFindingData = {
  kind?: string | null
  message?: string | null
}

export type ReviewContextItem = {
  key: string
  label: string
  value: string
}
