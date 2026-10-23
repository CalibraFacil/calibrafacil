import {
  denormalizeMethodDataForDisplay,
  denormalizeMethodResultsForDisplay,
  denormalizeSpecificationsForDisplay,
  resolveDisplayUnit,
} from '@calibra-facil/shared/units'
import { normalizeMethodValidations } from '@/components/method-runtime/math-runtime'
import { type AcceptanceItem, type ReviewJobDetailData } from './types'
import {
  buildReviewAssetSpecDefinitions,
  buildReviewEquipmentSpecItems,
  buildReviewSupportContextItems,
} from './approved-record'
import {
  PRIORITY_REVIEW_FIELD_KEYS,
  PRIORITY_REVIEW_FORMULA_KEYS,
} from './display'
import { buildAcceptanceItems, buildAdjustmentSummaryRows } from './adjustments'
import { buildJobVerdictModel, formatExpandedUncertainty } from './verdict'

/**
 * Signer-facing warnings from the frozen accredited-scope (CMC) verdict.
 * One item per server finding when available, else a single generic warning
 * for the adverse status. PASS/NOT_EVALUATED/absent produce nothing.
 */
export function buildScopeComplianceWarnings(
  job: ReviewJobDetailData | null | undefined,
): AcceptanceItem[] {
  const status = job?.scopeComplianceStatus
  const findings = job?.scopeComplianceFindings ?? []

  // The guard ran but could not check anything — an accredited certificate
  // would issue unverified. Never silent: the signer must check manually.
  if (status === 'NOT_EVALUATED') {
    return [
      {
        key: 'scope-compliance-not-evaluated',
        message:
          'O escopo acreditado (CMC) não pôde ser verificado automaticamente para este job. Confira os pontos e a incerteza manualmente contra o escopo antes de assinar.',
        severity: 'warning',
        status: 'warning',
      },
    ]
  }

  // On PASS, only partial-coverage notes surface (points the gate had to
  // skip); on adverse statuses every finding surfaces.
  const relevant =
    status === 'OUT_OF_SCOPE' || status === 'U_BELOW_CMC'
      ? findings
      : status === 'PASS'
        ? findings.filter((finding) => finding?.kind === 'not_evaluated')
        : []
  const findingMessages = relevant.flatMap((finding) =>
    finding?.message ? [finding.message] : [],
  )
  if (findingMessages.length > 0) {
    return findingMessages.map((message, index) => ({
      key: `scope-compliance-${index}`,
      message,
      severity: 'warning' as const,
      status: 'warning' as const,
    }))
  }
  if (status !== 'OUT_OF_SCOPE' && status !== 'U_BELOW_CMC') return []
  return [
    {
      key: 'scope-compliance',
      message:
        status === 'OUT_OF_SCOPE'
          ? 'Ponto calibrado fora do escopo acreditado (CMC).'
          : 'Incerteza reportada menor que a CMC do escopo acreditado.',
      severity: 'warning',
      status: 'warning',
    },
  ]
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
    resolveDisplayUnit(reviewAssetBaseUnit, unit) ?? unit ?? undefined
  const assetSpecDefinitions = buildReviewAssetSpecDefinitions(reviewDataFields)
  const displayAssetSpecs =
    denormalizeSpecificationsForDisplay(
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
  // Accredited-scope (CMC) guard (#427 Phase 0): the server classifies at
  // submit/approve; here we only surface the frozen verdict to the signer.
  // Warn-only — never blocks the approval.
  const scopeComplianceWarnings = buildScopeComplianceWarnings(job)
  const quickAlertItems = [
    ...acceptanceItems,
    ...(environmentalWarning ? [environmentalWarning] : []),
    ...scopeComplianceWarnings,
  ]

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
