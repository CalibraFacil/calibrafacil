import {
  type AcceptanceItem,
  type AdjustmentSummaryRow,
  type ReviewValidation,
} from './types'
import { arrayValueAt, numberFromUnknown, numericValues } from './job-values'

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
