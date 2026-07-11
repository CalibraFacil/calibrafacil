export const SPC_STATUSES = [
  'insufficient_data',
  'in_control',
  'trending',
  'out_of_control',
] as const

export const SPC_CHART_TYPES = ['i_mr', 'xbar_r', 'cusum', 'ewma'] as const

export type SpcStatus = (typeof SPC_STATUSES)[number]
export type SpcChartType = (typeof SPC_CHART_TYPES)[number]
export type SpcRuleSeverity = 'trending' | 'out_of_control'

export const SPC_STATUS_LABELS: Record<SpcStatus, string> = {
  insufficient_data: 'Dados insuficientes',
  in_control: 'Sob controle',
  trending: 'Tendência',
  out_of_control: 'Fora de controle',
}

export const SPC_CHART_TYPE_LABELS: Record<SpcChartType, string> = {
  i_mr: 'I-MR (individuais)',
  xbar_r: 'X̄-R (subgrupos)',
  cusum: 'CUSUM',
  ewma: 'EWMA',
}

export type SpcChartParams = {
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

export type SpcRuleHit = {
  rule: string
  severity: SpcRuleSeverity
  pointIndices: number[]
  description: string
}

export type SpcEvaluationLimits = {
  centerline: number
  sigma: number
  ucl: number
  lcl: number
  secondaryUcl?: number | null
  secondaryLcl?: number | null
}

export type SpcEvaluation = {
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

export type SpcChartReading = {
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

export type SpcReading = {
  id: number
  standardId: number
  parameter: string
  value: number
  uncertainty: number | null
  measuredAt: string
  sourceJobId: number | null
  createdBy: string
  createdByName: string | null
  createdAt: string
}

export type SpcReadingsListData = {
  data: SpcReading[]
}

export type SpcEscalateResult = {
  message: string
  data: {
    chart: SpcChart
    capa: { id: number; capaNumber: string }
  }
}

/** Minimal reference-standard option list for the create-chart form. */
export type SpcStandardOption = {
  id: number
  name: string
  serialNumber: string
}

export type SpcStandardOptionsData = {
  data: SpcStandardOption[]
}
