import { formatCalibrationValue } from '@calibra-facil/shared'
import {
  type AcceptanceItem,
  type AdjustmentSummaryRow,
  type ReviewFormula,
} from './types'
import { numericValues } from './job-values'

export type JobVerdictLevel =
  | 'conforme'
  | 'nao_conforme'
  | 'atencao'
  | 'incompleto'
  /** Data and results exist, but no point tolerance and no acceptance
   * criterion was evaluated: nothing supports a conformity statement. */
  | 'nao_avaliado'

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
  } else if (pointsTotal === 0 && input.acceptanceItems.length === 0) {
    level = 'nao_avaliado'
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
