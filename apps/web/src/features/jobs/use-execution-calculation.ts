import { useCallback, useMemo } from 'react'
import { type CertifiedValueOption } from '@/components/method-runtime/table-input-renderer'
import type { MassCompositionOption } from '@/components/method-runtime/mass-composition-utils'
import type { StandardCertifiedValueOption } from '@/components/method-runtime/standard-value-utils'
import { normalizeMethodDataForStorage } from '@calibra-facil/shared/units'
import type {
  MethodInputField,
  MethodFormula,
  ValidationResult,
} from '@/components/method-runtime/types'
import { createMethodCalculationEngine } from '@/components/method-runtime/math-runtime'
import {
  buildCertifiedValueOptions,
  buildExecutionFormulaContext,
  buildMassCompositionOptions,
  buildStandardCertifiedValueOptions,
  evaluateExecutionFormulaResults,
  evaluateExecutionValidationResults,
  filterActiveCalculationItems,
  getCalculationFormulas,
  getCalculationValidations,
  getDisplayedFormulaResults,
  getOfficialCompiledExecution,
  normalizeExecutionFormData,
  type CalibrationPhaseSnapshot,
  type JobData,
  type ReferenceStandard,
} from '@/features/jobs/execution'
import { type ExecutionFormValues } from '@/features/jobs/execution-draft'
import type {
  AssetBaseMeasurementUnit,
  useAssetUnitConversion,
} from './use-asset-unit-conversion'
import type { useExecutionFieldModel } from './use-execution-field-model'

type UnitConversion = ReturnType<typeof useAssetUnitConversion>

/**
 * Everything the form derives from what the technician typed: normalized data,
 * the formula context, the live formula and validation results, and the option
 * lists the table inputs choose from.
 */
export function useExecutionCalculation({
  job,
  engine,
  standardsData,
  formData,
  selectedStandardIds,
  environment,
  calibrationPhases,
  assetBaseMeasurementUnit,
  assetSpecFields,
  manualFields,
  displayManualFields,
  displayAssetSpecifications,
  convertValueToDisplayUnit,
  displayUnitFor,
}: {
  job: JobData
  engine: ReturnType<typeof createMethodCalculationEngine>
  standardsData: Array<ReferenceStandard>
  formData: Record<string, unknown>
  selectedStandardIds: number[]
  environment: ExecutionFormValues['environment']
  calibrationPhases: CalibrationPhaseSnapshot
  assetBaseMeasurementUnit: AssetBaseMeasurementUnit
  assetSpecFields: MethodInputField[]
  manualFields: MethodInputField[]
  displayManualFields: MethodInputField[]
  displayAssetSpecifications: ReturnType<
    typeof useExecutionFieldModel
  >['displayAssetSpecifications']
  convertValueToDisplayUnit: UnitConversion['convertValueToDisplayUnit']
  displayUnitFor: UnitConversion['displayUnitFor']
}) {
  // Normalize form data before building formula context or sending payloads.
  const normalizeFormData = useCallback(
    (data: Record<string, unknown>) =>
      normalizeExecutionFormData({
        data,
        manualFields,
        displayManualFields,
        displayAssetSpecifications,
      }),
    [displayAssetSpecifications, displayManualFields, manualFields],
  )

  const parsedFormData = useMemo(
    () => normalizeFormData(formData),
    [formData, normalizeFormData],
  )

  const normalizedFormData = useMemo(() => {
    return (
      normalizeMethodDataForStorage(
        parsedFormData,
        job.methodSnapshot.dataFields,
        assetBaseMeasurementUnit,
      ).data ?? parsedFormData
    )
  }, [assetBaseMeasurementUnit, job.methodSnapshot.dataFields, parsedFormData])

  const missingAssetSpecFields = useMemo(
    () =>
      assetSpecFields.filter((field) => {
        if (!field.required) return false
        const key = field.assetSpecKey
        if (!key) return true
        const value = job.assetSnapshot?.specifications?.[key]
        return value === null || value === undefined || value === ''
      }),
    [assetSpecFields, job.assetSnapshot],
  )

  const selectedStandardsMissingCertificatePdf = useMemo(() => {
    const standardsById = new Map(
      standardsData.map((standard) => [standard.id, standard]),
    )
    return selectedStandardIds
      .map((standardId) => standardsById.get(standardId))
      .filter((standard): standard is ReferenceStandard => {
        if (!standard) return false
        return !standard.certificateDocument
      })
  }, [selectedStandardIds, standardsData])

  // Build scalar context for the hardened math engine.
  const context = useMemo(
    () =>
      buildExecutionFormulaContext({
        job,
        normalizedFormData,
        standardsData,
        selectedStandardIds,
        environment,
      }),
    [environment, job, normalizedFormData, selectedStandardIds, standardsData],
  )

  const officialExecution = useMemo(
    () => getOfficialCompiledExecution(job.results),
    [job.results],
  )
  const officialDiagnosticCount = Array.isArray(officialExecution?.diagnostics)
    ? officialExecution.diagnostics.length
    : 0
  const hasOfficialResults = officialExecution !== null
  const calculationFormulas = useMemo<MethodFormula[]>(
    () => getCalculationFormulas(job),
    [job],
  )

  const activeCalculationFormulas = useMemo(
    () => filterActiveCalculationItems(calculationFormulas, calibrationPhases),
    [calculationFormulas, calibrationPhases],
  )

  const calculationValidations = useMemo(
    () => getCalculationValidations(job),
    [job],
  )

  const activeCalculationValidations = useMemo(
    () =>
      filterActiveCalculationItems(calculationValidations, calibrationPhases),
    [calculationValidations, calibrationPhases],
  )

  // Evaluate formulas
  const formulaResults = useMemo(
    () =>
      evaluateExecutionFormulaResults({
        engine,
        job,
        context,
        normalizedFormData,
        activeCalculationFormulas,
        assetBaseMeasurementUnit,
      }),
    [
      activeCalculationFormulas,
      assetBaseMeasurementUnit,
      context,
      engine,
      job,
      normalizedFormData,
    ],
  )

  const displayedFormulaResults = useMemo(
    () =>
      getDisplayedFormulaResults({
        activeCalculationFormulas,
        assetBaseMeasurementUnit,
        formulaResults,
        jobResults: job.results,
      }),
    [
      activeCalculationFormulas,
      assetBaseMeasurementUnit,
      formulaResults,
      job.results,
    ],
  )

  // Evaluate validations
  const validationResults = useMemo(
    (): ValidationResult[] =>
      evaluateExecutionValidationResults({
        engine,
        context,
        formulaResults,
        activeCalculationValidations,
      }),
    [activeCalculationValidations, context, engine, formulaResults],
  )

  // Compute certified value options from all active standards
  const certifiedValueOptions = useMemo(
    (): CertifiedValueOption[] =>
      buildCertifiedValueOptions({
        standardsData,
        convertValueToDisplayUnit,
        displayUnitFor,
      }),
    [convertValueToDisplayUnit, displayUnitFor, standardsData],
  )

  const massCompositionOptions = useMemo(
    (): MassCompositionOption[] =>
      buildMassCompositionOptions({
        standardsData,
        convertValueToDisplayUnit,
        displayUnitFor,
      }),
    [convertValueToDisplayUnit, displayUnitFor, standardsData],
  )

  const standardCertifiedValueOptions = useMemo(
    (): StandardCertifiedValueOption[] =>
      buildStandardCertifiedValueOptions({
        standardsData,
        convertValueToDisplayUnit,
        displayUnitFor,
      }),
    [convertValueToDisplayUnit, displayUnitFor, standardsData],
  )

  return {
    parsedFormData,
    normalizedFormData,
    missingAssetSpecFields,
    selectedStandardsMissingCertificatePdf,
    context,
    officialExecution,
    officialDiagnosticCount,
    hasOfficialResults,
    activeCalculationFormulas,
    formulaResults,
    displayedFormulaResults,
    validationResults,
    certifiedValueOptions,
    massCompositionOptions,
    standardCertifiedValueOptions,
  }
}
