import {
  formatCalibrationValue,
  isMassMeasurementUnit,
} from '@calibra-facil/shared'
import {
  canonicalUnitFor,
  convertUnitDelta,
  convertUnitValue,
  denormalizeMethodResultsForDisplay,
  resolveDisplayUnit,
  unitKind,
  type MeasurementUnit,
} from '@calibra-facil/shared/units'
import type {
  FormulaResult,
  MethodFormula,
  MethodValidation,
  ValidationResult,
} from '@/components/method-runtime/types'
import {
  buildFormulaContext,
  effectiveVariableBindings,
  evaluateFormulaRows,
  evaluateFormulaScalar,
  evaluateStructuredValidation,
  normalizeMethodValidations,
  type FormulaContext,
  type FormulaScalar,
  type createMethodCalculationEngine,
} from '@/components/method-runtime/math-runtime'
import {
  type CalibrationPhaseSnapshot,
  type EnvironmentalFormData,
  type JobData,
  type ReferenceStandard,
} from './types'
import {
  getOfficialCompiledExecution,
  readCompiledMethodSnapshot,
} from './official-execution'
import { isPhaseActive } from './phases'

/**
 * The weighing-range resolver's `pointUnit` is a mass unit in practice (the
 * contract types it as any measurement unit, as the API stores it). Resolve it
 * to the asset's base unit when both are mass; otherwise keep the original
 * literal (a non-mass base unit never retargets a mass weighing-range point).
 */
export function resolvePointDisplayUnit(
  baseMeasurementUnit: MeasurementUnit | null | undefined,
  pointUnit: MeasurementUnit | undefined,
): MeasurementUnit | undefined {
  const displayUnit = resolveDisplayUnit(baseMeasurementUnit, pointUnit)
  return isMassMeasurementUnit(displayUnit) ? displayUnit : pointUnit
}

export function buildExecutionFormulaContext({
  job,
  normalizedFormData,
  standardsData,
  selectedStandardIds,
  environment,
}: {
  job: JobData
  normalizedFormData: Record<string, unknown>
  standardsData: ReferenceStandard[]
  selectedStandardIds: number[]
  environment: EnvironmentalFormData
}): FormulaContext {
  const sourceData: Record<string, unknown> = {}

  for (const field of job.methodSnapshot.dataFields) {
    if (field.source === 'asset_spec') {
      const key = field.assetSpecKey
      const value = key ? job.assetSnapshot?.specifications?.[key] : undefined
      if (value !== undefined && value !== null && value !== '') {
        sourceData[field.key] = value
      }
      continue
    }

    const value = normalizedFormData[field.key]
    if (value !== undefined && value !== '') {
      sourceData[field.key] = value
    }
  }

  // Standards are reported in the asset's quantity kind; convert their certified
  // values/uncertainties into that kind's canonical unit so the formula context
  // stays unit-consistent. Absolute readings use convertUnitValue; uncertainty
  // and drift are deltas and use convertUnitDelta (identical to value for mass).
  const assetBaseMeasurementUnit =
    job.assetSnapshot?.baseMeasurementUnit ?? null
  const assetKind = unitKind(assetBaseMeasurementUnit)
  const canonicalUnit = assetKind ? canonicalUnitFor(assetKind) : null
  const sameKindAsAsset = (unit: unknown) =>
    assetKind != null && unitKind(unit) === assetKind

  const standardsById = new Map(
    standardsData.map((standard) => [standard.id, standard]),
  )
  const selectedStandards = selectedStandardIds
    .map((standardId) => standardsById.get(standardId))
    .filter((standard): standard is ReferenceStandard => Boolean(standard))
    .map((standard) => ({
      id: standard.id,
      metrologyData: standard.metrologyData ?? null,
      uncertainty:
        standard.uncertainty != null &&
        canonicalUnit &&
        sameKindAsAsset(standard.uncertaintyUnit)
          ? convertUnitDelta(
              standard.uncertainty,
              standard.uncertaintyUnit,
              canonicalUnit,
            )
          : standard.uncertainty,
      coverageFactor: standard.coverageFactor,
      drift:
        standard.drift != null &&
        canonicalUnit &&
        sameKindAsAsset(standard.certifiedValues?.[0]?.unit)
          ? (convertUnitDelta(
              standard.drift,
              standard.certifiedValues?.[0]?.unit,
              canonicalUnit,
            ) ?? standard.drift)
          : standard.drift,
      certifiedValues:
        standard.certifiedValues?.map((certifiedValue) => ({
          nominal: certifiedValue.nominal,
          authentication: certifiedValue.authentication,
          value:
            canonicalUnit && sameKindAsAsset(certifiedValue.unit)
              ? (convertUnitValue(
                  certifiedValue.value,
                  certifiedValue.unit,
                  canonicalUnit,
                ) ?? certifiedValue.value)
              : certifiedValue.value,
          uncertainty:
            canonicalUnit && sameKindAsAsset(certifiedValue.unit)
              ? (convertUnitDelta(
                  certifiedValue.uncertainty,
                  certifiedValue.unit,
                  canonicalUnit,
                ) ?? certifiedValue.uncertainty)
              : certifiedValue.uncertainty,
        })) ?? null,
    }))

  return buildFormulaContext(job.methodSnapshot, {
    data: sourceData,
    environment,
    standards: selectedStandards,
  })
}

export function getCalculationFormulas(job: JobData): MethodFormula[] {
  const compiledFormulas = readCompiledMethodSnapshot(
    job.methodSnapshot.compiledMethod,
  )?.formulas
  if (compiledFormulas?.length) {
    return compiledFormulas.map((formula) => ({
      outputKey: formula.key,
      expression: formula.expression,
      scope: formula.scope,
      label: formula.label,
      unit: formula.outputUnit,
      reporting: formula.reporting,
      metadata: formula.metadata,
    }))
  }
  return job.methodSnapshot.formulas
}

export function getCalculationValidations(job: JobData): MethodValidation[] {
  const compiledCriteria = readCompiledMethodSnapshot(
    job.methodSnapshot.compiledMethod,
  )?.acceptanceCriteria
  if (compiledCriteria?.length) {
    return compiledCriteria.map((criterion) => ({
      ...normalizeMethodValidations([
        {
          expression: criterion.expression,
          message: criterion.message,
          severity: criterion.severity === 'blocking' ? 'error' : 'warning',
          metadata: criterion.metadata,
        },
      ])[0],
      message: criterion.message,
      severity: criterion.severity === 'blocking' ? 'error' : 'warning',
      metadata: criterion.metadata,
    }))
  }
  return normalizeMethodValidations(job.methodSnapshot.validations)
}

export function filterActiveCalculationItems<
  T extends { metadata?: Record<string, unknown> },
>(items: T[], calibrationPhases: CalibrationPhaseSnapshot) {
  return items.filter((item) => isPhaseActive(item.metadata, calibrationPhases))
}

export function evaluateExecutionFormulaResults({
  engine,
  job,
  context,
  normalizedFormData,
  activeCalculationFormulas,
  assetBaseMeasurementUnit,
}: {
  engine: ReturnType<typeof createMethodCalculationEngine>
  job: JobData
  context: FormulaContext
  normalizedFormData: Record<string, unknown>
  activeCalculationFormulas: MethodFormula[]
  assetBaseMeasurementUnit: MeasurementUnit | null | undefined
}) {
  const results: Record<string, FormulaResult> = {}
  const runningContext: FormulaContext = { ...context }
  const rawResultValues: Record<string, FormulaScalar | FormulaScalar[]> = {}
  const arraySourceTables = new Map<string, string>()

  for (const binding of effectiveVariableBindings(job.methodSnapshot)) {
    if (binding.source === 'table_column') {
      arraySourceTables.set(binding.key, binding.fieldKey)
    }
  }

  for (const formula of activeCalculationFormulas) {
    const tableKey =
      formula.scope?.kind === 'table_row' ? formula.scope.tableKey : null
    const rows = tableKey ? normalizedFormData[tableKey] : null
    const result =
      tableKey && Array.isArray(rows)
        ? evaluateFormulaRows(
            engine,
            formula.expression,
            runningContext,
            rows.length,
            tableKey,
            arraySourceTables,
          )
        : evaluateFormulaScalar(engine, formula.expression, runningContext)

    if (result.success) {
      const rawValue = 'values' in result ? result.values : result.value
      rawResultValues[formula.outputKey] = rawValue
      runningContext[formula.outputKey] = rawValue
      if (tableKey) {
        arraySourceTables.set(formula.outputKey, tableKey)
      }
    } else {
      results[formula.outputKey] = {
        error: result.error,
        errorCode: result.errorCode,
      }
    }
  }

  const displayResultValues =
    denormalizeMethodResultsForDisplay(
      rawResultValues,
      activeCalculationFormulas,
      assetBaseMeasurementUnit,
    ) ?? rawResultValues

  for (const formula of activeCalculationFormulas) {
    const rawValue = rawResultValues[formula.outputKey]
    if (rawValue === undefined) {
      continue
    }

    results[formula.outputKey] = {
      value: rawValue,
      displayValue: formatCalibrationValue(
        displayResultValues[formula.outputKey] ?? rawValue,
        { wrapArrays: true },
      ),
    }
  }

  return results
}

/**
 * Where the results the execute screen shows come from (roadmap 2 F1, review
 * 3.5): the server's official computation of the SAVED readings, or the local
 * recompute of what is on screen. With unsaved edits the official numbers no
 * longer belong to the readings shown, so the local preview is shown instead
 * (and labelled as unsaved), never the stale server values under "Oficial".
 */
export type ExecutionResultsSource = 'official' | 'unsaved_preview' | 'preview'

export function executionResultsSource({
  jobResults,
  unsavedEdits,
}: {
  jobResults: Record<string, unknown> | null
  unsavedEdits: boolean
}): ExecutionResultsSource {
  if (!getOfficialCompiledExecution(jobResults)) return 'preview'
  return unsavedEdits ? 'unsaved_preview' : 'official'
}

export function getDisplayedFormulaResults({
  activeCalculationFormulas,
  assetBaseMeasurementUnit,
  formulaResults,
  jobResults,
  unsavedEdits = false,
}: {
  activeCalculationFormulas: MethodFormula[]
  assetBaseMeasurementUnit: MeasurementUnit | null | undefined
  formulaResults: Record<string, FormulaResult>
  jobResults: Record<string, unknown> | null
  /** The readings on screen differ from the saved ones. */
  unsavedEdits?: boolean
}) {
  if (
    executionResultsSource({ jobResults, unsavedEdits }) !== 'official' ||
    !jobResults
  ) {
    return formulaResults
  }

  const officialRawResults: Record<string, FormulaScalar | FormulaScalar[]> = {}
  for (const formula of activeCalculationFormulas) {
    const value = jobResults[formula.outputKey]
    if (
      typeof value === 'number' ||
      typeof value === 'string' ||
      (Array.isArray(value) &&
        value.every(
          (item) => typeof item === 'number' || typeof item === 'string',
        ))
    ) {
      officialRawResults[formula.outputKey] = value
    }
  }

  const officialDisplayResults =
    denormalizeMethodResultsForDisplay(
      officialRawResults,
      activeCalculationFormulas,
      assetBaseMeasurementUnit,
    ) ?? officialRawResults

  const results: Record<string, FormulaResult> = {}
  for (const formula of activeCalculationFormulas) {
    const rawValue = officialRawResults[formula.outputKey]
    if (rawValue === undefined) continue

    results[formula.outputKey] = {
      value: rawValue,
      displayValue: formatCalibrationValue(
        officialDisplayResults[formula.outputKey] ?? rawValue,
        { wrapArrays: true },
      ),
    }
  }

  return results
}

export function evaluateExecutionValidationResults({
  engine,
  context,
  formulaResults,
  activeCalculationValidations,
}: {
  engine: ReturnType<typeof createMethodCalculationEngine>
  context: FormulaContext
  formulaResults: Record<string, FormulaResult>
  activeCalculationValidations: MethodValidation[]
}): ValidationResult[] {
  const fullContext = { ...context }
  for (const [key, result] of Object.entries(formulaResults)) {
    if (result.value !== undefined) {
      fullContext[key] = result.value
    }
  }

  return activeCalculationValidations.map((validation) => {
    const result = evaluateStructuredValidation(engine, validation, fullContext)
    return {
      leftExpression: validation.leftExpression,
      operator: validation.operator,
      rightExpression: validation.rightExpression,
      message: validation.message,
      severity: validation.severity,
      passed: result.passed,
      error: result.error,
      errorCode: result.errorCode,
    }
  })
}
