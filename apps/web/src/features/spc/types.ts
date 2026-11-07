import type { SpcStatus } from '@calibra-facil/schemas/machines'

const SPC_CHART_TYPES = ['i_mr', 'xbar_r', 'cusum', 'ewma'] as const

export type { SpcStatus }
export type SpcChartType = (typeof SPC_CHART_TYPES)[number]
/** A rule hit signals a chart status: the two that call for attention. */
type SpcRuleSeverity = Extract<SpcStatus, 'trending' | 'out_of_control'>

export const SPC_CHART_TYPE_LABELS: Record<SpcChartType, string> = {
  i_mr: 'I-MR (individuais)',
  xbar_r: 'X̄-R (subgrupos)',
  cusum: 'CUSUM',
  ewma: 'EWMA',
}

type SpcChartParams = {
  baselineWindow?: number
  centerline?: number
  sigma?: number
  subgroupSize?: number
  cusumK?: number
  cusumH?: number
  ewmaLambda?: number
  ewmaK?: number
  enabledRules?: string[]
}

type SpcRuleHit = {
  rule: string
  severity: SpcRuleSeverity
  pointIndices: number[]
  description: string
}

type SpcEvaluationLimits = {
  centerline: number
  sigma: number
  ucl: number
  lcl: number
  secondaryUcl?: number | null
  secondaryLcl?: number | null
}

type SpcEvaluation = {
  engineVersion: string
  fingerprint: string
  status: SpcStatus
  sampleSize: number
  limits: SpcEvaluationLimits | null
  ruleHits: SpcRuleHit[]
  evaluatedAt: string | null
}

export type SpcChart = {
  id: number
  standardId: number
  standardName: string | null
  parameter: string
  chartType: SpcChartType
  params: SpcChartParams | null
  status: SpcStatus
  lastEvaluation: SpcEvaluation | null
  lastEvaluatedAt: string | null
  ncId: number | null
  capaId: number | null
  createdAt: string
  updatedAt: string
}

export type SpcChartListData = {
  data: SpcChart[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type SpcChartListQueryInput = {
  organizationId: string
  page: number
  standardId: number | undefined
  statusFilter: SpcStatus | ''
}

type SpcChartReading = {
  id: number
  value: number
  uncertainty: number | null
  measuredAt: string
  sourceJobId: number | null
  createdBy: string
}

export type SpcChartDetail = SpcChart & {
  readings: SpcChartReading[]
}

export type SpcEscalateResult = {
  message: string
  data: {
    chart: SpcChart
    capa: { id: number; capaNumber: string }
  }
}

/** Minimal reference-standard option list for the create-chart form. */
type SpcStandardOption = {
  id: number
  name: string
  serialNumber: string
}

export type SpcStandardOptionsData = {
  data: SpcStandardOption[]
}
