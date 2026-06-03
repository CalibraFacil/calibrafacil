import {
  denormalizeAssetSpecificationsForDisplay,
  denormalizeMethodDataForDisplay,
  denormalizeMethodResultsForDisplay,
  formatCalibrationValue,
  resolveMassDisplayUnit,
  type MassUnit,
} from '@calibra-facil/shared'

import { isMassCompositionValue } from '@/components/method-runtime/mass-composition-utils'
import { normalizeMethodValidations } from '@/components/method-runtime/math-runtime'
import type { MethodInputType } from '@/components/method-runtime/types'
import {
  formatWeighingRangeSpec,
  isWeighingRangeSpecArray,
} from '@/components/method-runtime/weighing-range-utils'

export type JobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  GENERATING_PDF: 'Gerando PDF',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
  SUPERSEDED: 'Retificado',
}

export const JOB_STATUS_VARIANTS: Record<
  JobStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'secondary',
  IN_PROGRESS: 'default',
  REVIEW: 'outline',
  GENERATING_PDF: 'outline',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELED: 'secondary',
  SUPERSEDED: 'outline',
}

export type ReviewMethodColumn = {
  key: string
  label: string
  type: 'text' | 'number'
  unit?: string | null
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
  baseMeasurementUnit?: MassUnit | null
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
}

export type ReviewContextItem = {
  key: string
  label: string
  value: string
}

type AssetSpecDefinition = {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'weighing_ranges'
  unit?: string
}

function parseAssetSpecDefinitionType(
  type: string,
): AssetSpecDefinition['type'] {
  switch (type) {
    case 'number':
    case 'select':
    case 'weighing_ranges':
      return type
    default:
      return 'text'
  }
}

export const REVIEW_ACTION_BUTTON_CLASS =
  'min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,border-color,transform]'

export const REVIEW_SURFACE_CLASS =
  'min-w-0 rounded-2xl bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10'

export const PRIORITY_REVIEW_FIELD_KEYS = [
  'pontos_indicacao',
  'excentricidade',
  'repetibilidade',
]

export const PRIORITY_REVIEW_FORMULA_KEYS = [
  'erro_indicacao_antes',
  'margem_conformidade_antes',
  'erro_indicacao_apos',
  'margem_conformidade_apos',
  'incerteza_expandida_antes',
  'incerteza_expandida_apos',
  'maior_desvio_excentricidade_antes',
  'maior_desvio_excentricidade_apos',
  'maior_repetibilidade',
  'repetibilidade_desvio_apos',
]

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getFinancialVariant(status: string | null | undefined) {
  switch (status) {
    case 'PAID':
      return 'outline'
    case 'OVERDUE':
      return 'destructive'
    case 'ISSUED':
      return 'default'
    case 'DRAFT':
      return 'secondary'
    case 'UNBILLED':
    default:
      return 'secondary'
  }
}

export function formatReviewValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === '') return '-'
  if (isMassCompositionValue(value)) return value.label
  const formatted = formatCalibrationValue(value)
  return unit ? `${formatted} ${unit}` : formatted
}

export function buildReviewAssetSpecDefinitions(
  dataFields: ReviewMethodField[],
): AssetSpecDefinition[] {
  return [
    ...dataFields
      .filter((field) => field.source === 'asset_spec' && field.assetSpecKey)
      .map((field) => ({
        key: field.assetSpecKey!,
        label: field.label,
        type: parseAssetSpecDefinitionType(field.type),
        unit: field.unit ?? undefined,
      })),
    ...dataFields
      .filter((field) => field.weighingRangeResolver?.assetSpecKey)
      .map((field) => ({
        key: field.weighingRangeResolver!.assetSpecKey!,
        label: 'Faixas de pesagem e resolução',
        type: 'weighing_ranges' as const,
      })),
  ]
}

export function buildReviewEquipmentSpecItems({
  assetSpecDefinitions,
  displayAssetSpecs,
  displayUnitFor,
}: {
  assetSpecDefinitions: AssetSpecDefinition[]
  displayAssetSpecs: Record<string, unknown> | null | undefined
  displayUnitFor: (unit?: string | null) => string | undefined
}): ReviewContextItem[] {
  return assetSpecDefinitions
    .map((definition) => {
      const value = displayAssetSpecs?.[definition.key]
      if (value === null || value === undefined || value === '') return null

      const displayValue =
        definition.type === 'weighing_ranges' && isWeighingRangeSpecArray(value)
          ? value.map(formatWeighingRangeSpec).join(' | ')
          : definition.type === 'number'
            ? formatReviewValue(value, displayUnitFor(definition.unit))
            : String(value)

      return {
        key: definition.key,
        label: definition.label,
        value: displayValue,
      }
    })
    .filter((item): item is ReviewContextItem => Boolean(item))
}

export function buildReviewSupportContextItems({
  dataFields,
  displayData,
  displayUnitFor,
  excludePriorityFields = false,
  excludeTableFields = false,
}: {
  dataFields: ReviewMethodField[]
  displayData: Record<string, unknown> | null | undefined
  displayUnitFor: (unit?: string | null) => string | undefined
  excludePriorityFields?: boolean
  excludeTableFields?: boolean
}): ReviewContextItem[] {
  return dataFields
    .filter((field) => field.source !== 'asset_spec')
    .filter(
      (field) =>
        !excludePriorityFields ||
        !PRIORITY_REVIEW_FIELD_KEYS.includes(field.key),
    )
    .filter((field) => !excludeTableFields || field.type !== 'table')
    .map((field) => {
      const value = displayData?.[field.key]
      if (value === null || value === undefined || value === '') return null

      return {
        key: field.key,
        label: field.label,
        value: formatReviewValue(value, displayUnitFor(field.unit)),
      }
    })
    .filter((item): item is ReviewContextItem => Boolean(item))
}

export function getApprovedReviewMeasurementFields(
  dataFields: ReviewMethodField[],
) {
  const nonAssetDataFields = dataFields.filter(
    (field) => field.source !== 'asset_spec',
  )
  const priorityMeasurementFields = nonAssetDataFields.filter((field) =>
    PRIORITY_REVIEW_FIELD_KEYS.includes(field.key),
  )

  return {
    nonAssetDataFields,
    measurementFields:
      priorityMeasurementFields.length > 0
        ? priorityMeasurementFields
        : nonAssetDataFields,
  }
}

export function buildApprovedRecordTimelineContextItems(
  job: Pick<ApprovedJobRecordData, 'approvedAt' | 'createdAt' | 'performedAt'>,
): ReviewContextItem[] {
  return [
    {
      key: 'createdAt',
      label: 'Criado',
      value: formatDateTime(job.createdAt),
    },
    {
      key: 'performedAt',
      label: 'Executado',
      value: formatDateTime(job.performedAt),
    },
    {
      key: 'approvedAt',
      label: 'Aprovado',
      value: formatDateTime(job.approvedAt),
    },
  ]
}

export function buildApprovedJobRecordModel(job: ApprovedJobRecordData) {
  const { methodSnapshot, data, results } = job
  const validations = normalizeMethodValidations(methodSnapshot.validations)
  const assetBaseMeasurementUnit =
    job.assetSnapshot?.baseMeasurementUnit ?? null
  const displayUnitFor = (unit?: string | null) =>
    resolveMassDisplayUnit(assetBaseMeasurementUnit, unit) ?? unit ?? undefined
  const displayData =
    denormalizeMethodDataForDisplay(
      data,
      methodSnapshot.dataFields,
      assetBaseMeasurementUnit,
    ) ?? data
  const displayResults =
    denormalizeMethodResultsForDisplay(
      results,
      methodSnapshot.formulas,
      assetBaseMeasurementUnit,
    ) ?? results
  const assetSpecDefinitions = buildReviewAssetSpecDefinitions(
    methodSnapshot.dataFields,
  )
  const displayAssetSpecs =
    denormalizeAssetSpecificationsForDisplay(
      job.assetSnapshot?.specifications,
      assetSpecDefinitions,
      assetBaseMeasurementUnit,
    ) ?? job.assetSnapshot?.specifications
  const equipmentSpecItems = buildReviewEquipmentSpecItems({
    assetSpecDefinitions,
    displayAssetSpecs,
    displayUnitFor,
  })
  const supportContextItems = buildReviewSupportContextItems({
    dataFields: methodSnapshot.dataFields,
    displayData,
    displayUnitFor,
    excludePriorityFields: true,
    excludeTableFields: true,
  })
  const timelineContextItems = buildApprovedRecordTimelineContextItems(job)
  const { measurementFields, nonAssetDataFields } =
    getApprovedReviewMeasurementFields(methodSnapshot.dataFields)

  const aposMargins = numericValues(displayResults?.margem_conformidade_apos)
  const pointsTotal = aposMargins.length
  const pointsWithin = aposMargins.filter((margin) => margin >= 0).length
  const expandedUncertainty = formatExpandedUncertainty(
    displayResults,
    methodSnapshot.formulas,
    displayUnitFor,
  )

  return {
    validations,
    assetBaseMeasurementUnit,
    displayUnitFor,
    displayData,
    displayResults,
    equipmentSpecItems,
    supportContextItems,
    timelineContextItems,
    approvedContextItems: [
      ...equipmentSpecItems,
      ...supportContextItems,
      ...timelineContextItems,
    ],
    nonAssetDataFields,
    measurementFields,
    pointsTotal,
    pointsWithin,
    expandedUncertainty,
  }
}

export function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function desktopCloudActionError() {
  return new Error(
    'Esta ação exige validação online na API da nuvem. Sincronize o job e conclua pelo ambiente web.',
  )
}

export function arrayValueAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined
}

export function numericValues(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => numericValues(item))
  }

  const parsed = numberFromUnknown(value)
  return parsed == null ? [] : [parsed]
}

export function buildAdjustmentSummaryRows({
  indicationRows,
  displayReviewResults,
}: {
  indicationRows: Array<Record<string, unknown>>
  displayReviewResults: Record<string, unknown> | null | undefined
}): AdjustmentSummaryRow[] {
  return indicationRows.map((row, index) => {
    const beforeMargin = numberFromUnknown(
      arrayValueAt(displayReviewResults?.margem_conformidade_antes, index),
    )
    const afterMargin = numberFromUnknown(
      arrayValueAt(displayReviewResults?.margem_conformidade_apos, index),
    )
    return {
      key: `${index}-${String(row.valor_padrao ?? '')}`,
      point: row.valor_padrao,
      beforeReadings: [
        row.antes_leitura_1,
        row.antes_leitura_2,
        row.antes_leitura_3,
      ],
      afterReadings: [
        row.apos_leitura_1,
        row.apos_leitura_2,
        row.apos_leitura_3,
      ],
      beforeError: arrayValueAt(
        displayReviewResults?.erro_indicacao_antes,
        index,
      ),
      afterError: arrayValueAt(
        displayReviewResults?.erro_indicacao_apos,
        index,
      ),
      beforeMargin,
      afterMargin,
    }
  })
}

export function buildAcceptanceItems({
  validations,
  displayReviewData,
  displayReviewResults,
}: {
  validations: ReviewValidation[]
  displayReviewData: Record<string, unknown> | null | undefined
  displayReviewResults: Record<string, unknown> | null | undefined
}): AcceptanceItem[] {
  return validations.map((validation, index) => {
    const expression = `${validation.leftExpression} ${validation.operator} ${validation.rightExpression}`
    let status: AcceptanceItem['status'] = 'unknown'

    if (expression.includes('margem_conformidade_antes')) {
      const margins = numericValues(
        displayReviewResults?.margem_conformidade_antes,
      )
      status =
        margins.length === 0
          ? 'unknown'
          : margins.every((margin) => margin >= 0)
            ? 'ok'
            : 'error'
    } else if (expression.includes('margem_conformidade_apos')) {
      const margins = numericValues(
        displayReviewResults?.margem_conformidade_apos,
      )
      status =
        margins.length === 0
          ? 'unknown'
          : margins.every((margin) => margin >= 0)
            ? 'ok'
            : 'error'
    } else if (
      expression.includes('maior_desvio_excentricidade_apos') &&
      expression.includes('tolerancia_maxima')
    ) {
      const deviations = numericValues(
        displayReviewResults?.maior_desvio_excentricidade_apos,
      )
      const tolerance = numberFromUnknown(displayReviewData?.tolerancia_maxima)
      status =
        deviations.length === 0 || tolerance == null
          ? 'unknown'
          : deviations.every((deviation) => deviation <= tolerance)
            ? 'ok'
            : 'error'
    } else if (validation.severity === 'warning') {
      status = 'warning'
    }

    return {
      key: `${expression}-${index}`,
      message: validation.message,
      severity: validation.severity,
      status,
    }
  })
}

export type JobVerdictLevel =
  | 'conforme'
  | 'nao_conforme'
  | 'atencao'
  | 'incompleto'

export type JobVerdict = {
  level: JobVerdictLevel
  pointsTotal: number
  pointsWithin: number
  pointsOutOfTolerance: number
  criteriaTotal: number
  criteriaPassed: number
  criteriaFailed: number
  criteriaWarning: number
  environment: 'within' | 'out' | 'unknown'
  standardsCount: number
  hasData: boolean
  hasResults: boolean
  expandedUncertainty: string | null
}

/**
 * Formats the worst-case expanded uncertainty (U) from stored results, so the
 * verdict band can surface a single conservative number. Returns null when no
 * uncertainty was computed for the job.
 */
export function formatExpandedUncertainty(
  displayResults: Record<string, unknown> | null | undefined,
  formulas: ReviewFormula[],
  displayUnitFor: (unit?: string | null) => string | undefined,
): string | null {
  const formulasByOutputKey = new Map(
    formulas.map((formula) => [formula.outputKey, formula]),
  )
  for (const key of ['incerteza_expandida_apos', 'incerteza_expandida_antes']) {
    const values = numericValues(displayResults?.[key])
    if (values.length === 0) continue

    const max = Math.max(...values.map((value) => Math.abs(value)))
    const unit = displayUnitFor(formulasByOutputKey.get(key)?.unit)
    return `±${formatCalibrationValue(max)}${unit ? ` ${unit}` : ''}`
  }

  return null
}

function marginIsWithin(margin: number | null): boolean {
  return margin != null && margin >= 0
}

/**
 * Derives the at-a-glance approval verdict from data already computed for the
 * review screen. Conformance is decided by acceptance criteria and per-point
 * tolerance margins; environment/warnings only downgrade a pass to "atenção".
 */
export function buildJobVerdictModel(input: {
  acceptanceItems: AcceptanceItem[]
  adjustmentSummaryRows: AdjustmentSummaryRow[]
  reviewHasData: boolean
  reviewHasResults: boolean
  standardsCount: number
  environmentWithinLimits: boolean | null | undefined
  expandedUncertainty: string | null
}): JobVerdict {
  const pointMargins = input.adjustmentSummaryRows.map(
    (row) => row.afterMargin ?? row.beforeMargin,
  )
  const pointsTotal = pointMargins.length
  const pointsWithin = pointMargins.filter(marginIsWithin).length
  const pointsOutOfTolerance = pointMargins.filter(
    (margin) => margin != null && margin < 0,
  ).length

  const criteriaFailed = input.acceptanceItems.filter(
    (item) => item.status === 'error',
  ).length
  const criteriaWarning = input.acceptanceItems.filter(
    (item) => item.status === 'warning',
  ).length
  const criteriaPassed = input.acceptanceItems.filter(
    (item) => item.status === 'ok',
  ).length

  const environment =
    input.environmentWithinLimits == null
      ? 'unknown'
      : input.environmentWithinLimits
        ? 'within'
        : 'out'

  let level: JobVerdictLevel
  if (!input.reviewHasData || !input.reviewHasResults) {
    level = 'incompleto'
  } else if (criteriaFailed > 0 || pointsOutOfTolerance > 0) {
    level = 'nao_conforme'
  } else if (criteriaWarning > 0 || environment === 'out') {
    level = 'atencao'
  } else {
    level = 'conforme'
  }

  return {
    level,
    pointsTotal,
    pointsWithin,
    pointsOutOfTolerance,
    criteriaTotal: input.acceptanceItems.length,
    criteriaPassed,
    criteriaFailed,
    criteriaWarning,
    environment,
    standardsCount: input.standardsCount,
    hasData: input.reviewHasData,
    hasResults: input.reviewHasResults,
    expandedUncertainty: input.expandedUncertainty,
  }
}

export function buildJobReviewModel(
  job: ReviewJobDetailData | null | undefined,
) {
  const methodSnapshot = job?.methodSnapshot ?? {}
  const reviewDataFields = methodSnapshot.dataFields ?? []
  const reviewFormulas = methodSnapshot.formulas ?? []
  const reviewValidations = normalizeMethodValidations(
    methodSnapshot.validations ?? [],
  )
  const reviewAssetBaseUnit = job?.assetSnapshot?.baseMeasurementUnit ?? null
  const reviewStandards = job?.standardsSnapshot ?? []
  const displayUnitForReview = (unit?: string | null) =>
    resolveMassDisplayUnit(reviewAssetBaseUnit, unit) ?? unit ?? undefined
  const assetSpecDefinitions = buildReviewAssetSpecDefinitions(reviewDataFields)
  const displayAssetSpecs =
    denormalizeAssetSpecificationsForDisplay(
      job?.assetSnapshot?.specifications,
      assetSpecDefinitions,
      reviewAssetBaseUnit,
    ) ?? job?.assetSnapshot?.specifications
  const equipmentSpecItems = buildReviewEquipmentSpecItems({
    assetSpecDefinitions,
    displayAssetSpecs,
    displayUnitFor: displayUnitForReview,
  })

  const displayReviewData =
    denormalizeMethodDataForDisplay(
      job?.data,
      reviewDataFields,
      reviewAssetBaseUnit,
    ) ?? job?.data
  const displayReviewResults =
    denormalizeMethodResultsForDisplay(
      job?.results,
      reviewFormulas,
      reviewAssetBaseUnit,
    ) ?? job?.results

  const reviewHasData =
    reviewDataFields.length > 0 &&
    !!displayReviewData &&
    Object.keys(displayReviewData).length > 0
  const reviewHasResults =
    reviewFormulas.length > 0 &&
    !!displayReviewResults &&
    Object.keys(displayReviewResults).length > 0
  const criticalReviewFields = reviewDataFields.filter((field) =>
    PRIORITY_REVIEW_FIELD_KEYS.includes(field.key),
  )
  const supportContextItems = buildReviewSupportContextItems({
    dataFields: reviewDataFields,
    displayData: displayReviewData,
    displayUnitFor: displayUnitForReview,
    excludePriorityFields: true,
  })
  const reviewContextItems = [...equipmentSpecItems, ...supportContextItems]
  const priorityReviewFormulas = reviewFormulas
    .filter((formula) =>
      PRIORITY_REVIEW_FORMULA_KEYS.includes(formula.outputKey),
    )
    .sort(
      (a, b) =>
        PRIORITY_REVIEW_FORMULA_KEYS.indexOf(a.outputKey) -
        PRIORITY_REVIEW_FORMULA_KEYS.indexOf(b.outputKey),
    )
  const supportingReviewFormulas = reviewFormulas.filter(
    (formula) => !PRIORITY_REVIEW_FORMULA_KEYS.includes(formula.outputKey),
  )
  const orderedReviewFormulas = [
    ...priorityReviewFormulas,
    ...supportingReviewFormulas,
  ]
  const indicationRows = Array.isArray(displayReviewData?.pontos_indicacao)
    ? displayReviewData.pontos_indicacao.flatMap((row) =>
        row && typeof row === 'object' && !Array.isArray(row)
          ? [Object.fromEntries(Object.entries(row))]
          : [],
      )
    : []
  const adjustmentSummaryRows = buildAdjustmentSummaryRows({
    indicationRows,
    displayReviewResults,
  })
  const acceptanceItems = buildAcceptanceItems({
    validations: reviewValidations,
    displayReviewData,
    displayReviewResults,
  })
  const environmentalWarning =
    job?.environmentalSnapshot && !job.environmentalSnapshot.withinLimits
      ? {
          key: 'environmental-limits',
          message: 'Condições ambientais fora dos limites do método.',
          severity: 'warning' as const,
          status: 'warning' as const,
        }
      : null
  const quickAlertItems = environmentalWarning
    ? [...acceptanceItems, environmentalWarning]
    : acceptanceItems

  const expandedUncertainty = formatExpandedUncertainty(
    displayReviewResults,
    reviewFormulas,
    displayUnitForReview,
  )
  const verdict = buildJobVerdictModel({
    acceptanceItems,
    adjustmentSummaryRows,
    reviewHasData,
    reviewHasResults,
    standardsCount: reviewStandards.length,
    environmentWithinLimits: job?.environmentalSnapshot?.withinLimits ?? null,
    expandedUncertainty,
  })

  return {
    reviewDataFields,
    reviewFormulas,
    reviewValidations,
    reviewStandards,
    displayUnitForReview,
    displayReviewData,
    displayReviewResults,
    reviewHasData,
    reviewHasResults,
    criticalReviewFields,
    reviewContextItems,
    orderedReviewFormulas,
    adjustmentSummaryRows,
    acceptanceItems,
    quickAlertItems,
    expandedUncertainty,
    verdict,
  }
}
