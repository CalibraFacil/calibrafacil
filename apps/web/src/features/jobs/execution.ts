import {
  convertMassValue,
  denormalizeMethodResultsForDisplay,
  formatCalibrationValue,
  isMassMeasurementUnit,
  resolveMassDisplayUnit,
  type MassUnit,
} from '@calibra-facil/shared'

import type {
  FormulaResult,
  MethodFormula,
  MethodInputField,
  MethodValidation,
  MethodVariableBinding,
  ValidationResult,
} from '@/components/method-runtime/types'
import {
  applyTableWeighingRangeResolvers,
  type CertifiedValueOption,
} from '@/components/method-runtime/table-input-renderer'
import {
  collectMassCompositionStandardIds,
  type MassCompositionOption,
} from '@/components/method-runtime/mass-composition-utils'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  isEccentricityIndicatorPosition,
  type EccentricityIndicatorVariant,
} from '@/components/eccentricity-indicator'
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

export interface ReferenceStandard {
  id: number
  name: string
  kind?: string
  type?: string | null
  serialNumber: string
  certificateNumber: string
  calibrationDate: string
  nextCalibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  distribution: string
  drift: number | null
  certifiedValues: Array<{
    nominal: string
    authentication?: string | null
    value: number
    uncertainty: number
    unit: string
    maxError?: number | null
    drift?: number | null
    buoyancy?: number | null
    coverageFactor?: number | null
    compositionProfile?: boolean
    profileKey?: string | null
    profileClass?: string | null
    profileQuantityAvailable?: number | null
  }> | null
  metrologyData?: {
    version: 1
    channels: Array<{
      key: string
      label: string
      quantity: string
      value?: number | null
      correction?: number | null
      uncertainty?: number | null
      unit: string
      coverageFactor?: number | null
      drift?: number | null
      notes?: string | null
      points?: Array<{
        reference?: number | null
        indication?: number | null
        meanReading?: number | null
        correction?: number | null
        uncertainty?: number | null
        unit: string
        coverageFactor?: number | null
        degreesOfFreedom?: number | null
        degreesOfFreedomOperator?: 'exact' | 'greater_than' | 'infinity'
        repeatability?: number | null
        metadata?: Record<string, unknown>
      }>
    }>
    massValues: Array<{
      nominal: string
      authentication?: string | null
      value: number
      uncertainty: number
      unit: string
      maxError?: number | null
      drift?: number | null
      buoyancy?: number | null
      coverageFactor?: number | null
    }>
    compositionProfiles: Array<unknown>
    notes?: string | null
  } | null
  status: string
  isExpired: boolean
  daysUntilExpiry: number
  certificateDocument?: ReferenceStandardCertificateDocument | null
}

export interface StandardSnapshotItem {
  id: number
  name: string
  type?: string | null
  kind?: string
  certificateNumber: string
  calibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  distribution: string
  drift: number | null
  certifiedValues: ReferenceStandard['certifiedValues']
  metrologyData?: ReferenceStandard['metrologyData']
  certificateDocument?: ReferenceStandardCertificateDocument | null
}

export interface ReferenceStandardCertificateDocument {
  documentId: number
  r2Key: string
  fileName: string
  fileSize: number
  sha256: string
  uploadedAt: string | Date
  certificateNumber: string
  calibrationDate: string | Date
  nextCalibrationDate: string | Date
}

export interface EnvironmentalSnapshotData {
  temperature: number | null
  humidity: number | null
  pressure: number | null
  recordedAt: string
  recordedBy: string
  limits: {
    temperature?: { min: number; max: number }
    humidity?: { min: number; max: number }
    pressure?: { min: number; max: number }
  } | null
  withinLimits: boolean
  outOfLimitsJustification: string | null
}

export type CalibrationLocationType = 'customer_site' | 'lab' | 'other'

export interface CalibrationLocationSnapshot {
  type: CalibrationLocationType
  addressText: string
  notes?: string | null
  recordedAt?: string
  recordedBy?: string
}

export type CalibrationPhaseMode =
  | 'before_and_after'
  | 'before_only'
  | 'after_only'
  | 'not_performed'
export type CalibrationPhase = 'before' | 'after'

export interface CalibrationPhaseSnapshot {
  blocks: Record<
    string,
    {
      mode: CalibrationPhaseMode
      reason?: string | null
    }
  >
  recordedAt?: string
  recordedBy?: string
}

export type CalibrationPhaseBlock = {
  key: string
  label: string
}

export type EnvironmentalFormData = {
  temperature: number | null
  humidity: number | null
  pressure: number | null
}

export interface AddressData {
  street?: string | null
  number?: string | null
  complement?: string | null
  neighbourhood?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
}

export interface AssetSnapshot {
  assetId: number
  assetTypeId: number
  assetTypeName: string
  assetTypeSlug: string
  baseMeasurementUnit?: MassUnit | null
  name: string
  tag: string
  serialNumber: string
  manufacturer: string | null
  model: string | null
  specifications: Record<string, unknown> | null
  capturedAt: string
}

export interface EffectiveLimits {
  temperatureMin: number | null
  temperatureMax: number | null
  humidityMin: number | null
  humidityMax: number | null
  pressureMin: number | null
  pressureMax: number | null
}

export interface JobData {
  id: number
  jobId: string
  status: string
  customerName: string
  customerAddress?: AddressData | null
  labName?: string | null
  labStreet?: string | null
  labNumber?: string | null
  labComplement?: string | null
  labNeighbourhood?: string | null
  labCity?: string | null
  labState?: string | null
  labCep?: string | null
  assetName: string
  assetTag: string
  unitId?: number | null
  assetTypeId: number
  serviceName: string
  methodSnapshot: {
    methodId: number
    methodName: string
    methodVersion: number
    compiledMethod?: CompiledMethodSnapshot | null
    methodFingerprint?: string | null
    engineVersion?: string | null
    engineOptionsFingerprint?: string | null
    normalizedMethodJson?: string | null
    publicationEvidence?: unknown
    dataFields: MethodInputField[]
    variableBindings?: MethodVariableBinding[]
    formulas: MethodFormula[]
    validations: MethodValidation[]
    uncertaintyParams: Array<unknown>
  }
  data: Record<string, unknown> | null
  results: Record<string, unknown> | null
  assetSnapshot?: AssetSnapshot | null
  standardsSnapshot?: StandardSnapshotItem[] | null
  environmentalSnapshot?: EnvironmentalSnapshotData | null
  calibrationLocationSnapshot?: CalibrationLocationSnapshot | null
  calibrationPhaseSnapshot?: CalibrationPhaseSnapshot | null
}

export interface CompiledMethodSnapshot {
  methodFingerprint: string
  engine?: {
    version?: string
    optionsFingerprint?: string
  }
  formulas?: Array<{
    key: string
    label?: string
    expression: string
    scope?: MethodFormula['scope']
    normalizedFormula?: string
    formulaFingerprint?: string
    variables?: string[]
    outputUnit?: string
    reporting?: MethodFormula['reporting']
    metadata?: Record<string, unknown>
  }>
  acceptanceCriteria?: Array<{
    key: string
    label?: string
    expression: string
    severity: 'info' | 'warning' | 'blocking'
    message: string
    normalizedFormula?: string
    criterionFingerprint?: string
    metadata?: Record<string, unknown>
  }>
  measurementModels?: Array<unknown>
}

export interface OfficialCompiledExecution {
  methodFingerprint?: string
  engineVersion?: string
  engineOptionsFingerprint?: string
  inputFingerprint?: string
  calculationFingerprint?: string
  resultFingerprint?: string
  diagnostics?: Array<unknown>
}

const CIRCULAR_ECCENTRICITY_LOAD_POSITIONS = ['A', 'B', 'C', 'D', 'E']
const CIRCULAR_ECCENTRICITY_LOAD_POSITION_SET = new Set(
  CIRCULAR_ECCENTRICITY_LOAD_POSITIONS,
)

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value))
}

function toRecordArray(value: unknown[]): Array<Record<string, unknown>> {
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    return [Object.fromEntries(Object.entries(item))]
  })
}

function toOfficialCompiledExecution(
  value: unknown,
): OfficialCompiledExecution | null {
  const record = toRecord(value)
  if (Object.keys(record).length === 0) {
    return null
  }

  return {
    methodFingerprint:
      typeof record.methodFingerprint === 'string'
        ? record.methodFingerprint
        : undefined,
    engineVersion:
      typeof record.engineVersion === 'string'
        ? record.engineVersion
        : undefined,
    engineOptionsFingerprint:
      typeof record.engineOptionsFingerprint === 'string'
        ? record.engineOptionsFingerprint
        : undefined,
    inputFingerprint:
      typeof record.inputFingerprint === 'string'
        ? record.inputFingerprint
        : undefined,
    calculationFingerprint:
      typeof record.calculationFingerprint === 'string'
        ? record.calculationFingerprint
        : undefined,
    resultFingerprint:
      typeof record.resultFingerprint === 'string'
        ? record.resultFingerprint
        : undefined,
    diagnostics: Array.isArray(record.diagnostics)
      ? record.diagnostics
      : undefined,
  }
}

function resolveDisplayMassUnit(
  baseMeasurementUnit: MassUnit | null | undefined,
  unit: MassUnit | undefined,
) {
  const displayUnit = resolveMassDisplayUnit(baseMeasurementUnit, unit)
  return isMassMeasurementUnit(displayUnit) ? displayUnit : unit
}

export function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function getEccentricityIndicatorVariant(
  field: MethodInputField | undefined,
): EccentricityIndicatorVariant | null {
  if (!field?.eccentricityIndicator?.enabled) return null
  return field.eccentricityIndicator.variant ?? 'circular_platform'
}

export function getCircularEccentricityLoadPositions(
  field: MethodInputField,
  rows: Array<Record<string, unknown>>,
) {
  const positionColumn = field.columns?.find((column) => {
    const text = normalizeText(`${column.key} ${column.label}`)
    return text.includes('posicao') || text.includes('ponto')
  })

  if (!positionColumn) return undefined

  const positions = new Set<string>()
  for (const row of rows) {
    const value = String(row[positionColumn.key] ?? '')
      .trim()
      .toUpperCase()
    if (CIRCULAR_ECCENTRICITY_LOAD_POSITION_SET.has(value)) {
      positions.add(value)
    }
  }

  return positions.size > 0 ? [...positions] : undefined
}

export function getAssetIndicatorPosition(job: JobData) {
  const variant =
    getEccentricityIndicatorVariant(
      job.methodSnapshot.dataFields.find(
        (field) => field.eccentricityIndicator?.enabled,
      ),
    ) ?? undefined

  const assetValue =
    job.assetSnapshot?.specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY]
  if (isEccentricityIndicatorPosition(assetValue, variant)) {
    return assetValue
  }

  return null
}

export function resolveSelectedIndicatorPosition(
  assetIndicatorPosition: unknown,
  variant: EccentricityIndicatorVariant | null | undefined,
) {
  return isEccentricityIndicatorPosition(
    assetIndicatorPosition,
    variant ?? undefined,
  )
    ? assetIndicatorPosition
    : null
}

function isNumericString(value: string) {
  return /^-?\d*\.?\d+$/.test(value)
}

export function normalizeExecutionFormData({
  data,
  manualFields,
  displayManualFields,
  displayAssetSpecifications,
}: {
  data: Record<string, unknown>
  manualFields: MethodInputField[]
  displayManualFields: MethodInputField[]
  displayAssetSpecifications: Record<string, unknown> | null | undefined
}): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  const manualFieldsByKey = new Map(
    manualFields.map((field) => [field.key, field]),
  )
  const displayFieldsByKey = new Map(
    displayManualFields.map((field) => [field.key, field]),
  )

  for (const [key, value] of Object.entries(data)) {
    const field = manualFieldsByKey.get(key)
    const displayField = displayFieldsByKey.get(key)
    if (!field) {
      continue
    }

    if (Array.isArray(value)) {
      const normalizedRows = value.map((row) => {
        if (typeof row === 'object' && row !== null) {
          const normalizedRow: Record<string, unknown> = {}
          for (const [cellKey, cellValue] of Object.entries(toRecord(row))) {
            normalizedRow[cellKey] =
              typeof cellValue === 'string' && isNumericString(cellValue)
                ? parseFloat(cellValue)
                : cellValue
          }
          return normalizedRow
        }
        return row
      })
      normalized[key] =
        field.type === 'table'
          ? applyTableWeighingRangeResolvers(
              displayField ?? field,
              toRecordArray(normalizedRows),
              displayAssetSpecifications,
            )
          : normalizedRows
    } else if (typeof value === 'string' && isNumericString(value)) {
      normalized[key] = parseFloat(value)
    } else {
      normalized[key] = value
    }
  }

  return normalized
}

export function buildSelectedStandardPayload(
  selectedStandardIds: number[],
  normalizedData: Record<string, unknown>,
) {
  return Array.from(
    new Set([
      ...selectedStandardIds,
      ...collectMassCompositionStandardIds(normalizedData),
    ]),
  )
}

export function buildEnvironmentPayload(environment: EnvironmentalFormData) {
  if (
    environment.temperature == null &&
    environment.humidity == null &&
    environment.pressure == null
  ) {
    return undefined
  }
  return environment
}

export function buildCalibrationLocationPayload(
  calibrationLocation: CalibrationLocationSnapshot,
) {
  return {
    type: calibrationLocation.type,
    addressText: calibrationLocation.addressText,
    notes: calibrationLocation.notes ?? null,
  }
}

export function buildCalibrationPhasesPayload({
  phaseBlocks,
  calibrationPhases,
}: {
  phaseBlocks: CalibrationPhaseBlock[]
  calibrationPhases: CalibrationPhaseSnapshot
}) {
  return phaseBlocks.length > 0
    ? {
        blocks: Object.fromEntries(
          phaseBlocks.map((block) => [
            block.key,
            {
              mode:
                calibrationPhases.blocks[block.key]?.mode ?? DEFAULT_PHASE_MODE,
              reason: calibrationPhases.blocks[block.key]?.reason ?? null,
            },
          ]),
        ),
      }
    : undefined
}

export function buildExecutionMutationPayload({
  selectedStandardIds,
  normalizedData,
  formulaResults,
  environment,
  calibrationLocation,
  calibrationPhases,
  performedAt,
  backdateReason,
}: {
  selectedStandardIds: number[]
  normalizedData: Record<string, unknown>
  formulaResults: Record<string, FormulaResult>
  environment: EnvironmentalFormData | undefined
  calibrationLocation: ReturnType<typeof buildCalibrationLocationPayload>
  calibrationPhases: ReturnType<typeof buildCalibrationPhasesPayload>
  performedAt?: string
  backdateReason?: string
}) {
  return {
    selectedStandardIds: buildSelectedStandardPayload(
      selectedStandardIds,
      normalizedData,
    ),
    data: normalizedData,
    results: Object.fromEntries(
      Object.entries(formulaResults)
        .filter(([, result]) => result.value !== undefined)
        .map(([key, result]) => [key, result.value]),
    ),
    environment,
    calibrationLocation,
    calibrationPhases,
    ...(performedAt !== undefined ? { performedAt } : {}),
    ...(backdateReason !== undefined ? { backdateReason } : {}),
  }
}

export function findMissingNotPerformedPhaseReasons({
  phaseBlocks,
  calibrationPhases,
}: {
  phaseBlocks: CalibrationPhaseBlock[]
  calibrationPhases: CalibrationPhaseSnapshot
}) {
  return phaseBlocks.filter((block) => {
    const snapshot = calibrationPhases.blocks[block.key]
    return snapshot?.mode === 'not_performed' && !snapshot.reason?.trim()
  })
}

export function buildEnvironmentWarnings({
  environment,
  envLimits,
}: {
  environment: EnvironmentalFormData
  envLimits: EffectiveLimits | null
}) {
  const warnings: string[] = []
  if (envLimits && environment.temperature != null) {
    if (
      envLimits.temperatureMin != null &&
      envLimits.temperatureMax != null &&
      (environment.temperature < envLimits.temperatureMin ||
        environment.temperature > envLimits.temperatureMax)
    ) {
      warnings.push(
        `Temperatura fora da faixa (${envLimits.temperatureMin} – ${envLimits.temperatureMax} °C)`,
      )
    }
  }
  if (envLimits && environment.humidity != null) {
    if (
      envLimits.humidityMin != null &&
      envLimits.humidityMax != null &&
      (environment.humidity < envLimits.humidityMin ||
        environment.humidity > envLimits.humidityMax)
    ) {
      warnings.push(
        `Umidade fora da faixa (${envLimits.humidityMin} – ${envLimits.humidityMax} %RH)`,
      )
    }
  }
  if (envLimits && environment.pressure != null) {
    if (
      envLimits.pressureMin != null &&
      envLimits.pressureMax != null &&
      (environment.pressure < envLimits.pressureMin ||
        environment.pressure > envLimits.pressureMax)
    ) {
      warnings.push(
        `Pressão fora da faixa (${envLimits.pressureMin} – ${envLimits.pressureMax} hPa)`,
      )
    }
  }
  return warnings
}

export function canSubmitExecution({
  manualFields,
  formData,
  calibrationPhases,
  missingAssetSpecFields,
  calibrationLocation,
  missingNotPerformedPhaseReasons,
}: {
  manualFields: MethodInputField[]
  formData: Record<string, unknown>
  calibrationPhases: CalibrationPhaseSnapshot
  missingAssetSpecFields: MethodInputField[]
  calibrationLocation: CalibrationLocationSnapshot
  missingNotPerformedPhaseReasons: CalibrationPhaseBlock[]
}) {
  const hasRequiredFields = manualFields
    .filter((field) => field.required)
    .every((field) => {
      const blockKey = phaseBlockKey(field)
      if (
        blockKey &&
        calibrationPhases.blocks[blockKey]?.mode === 'not_performed'
      ) {
        return true
      }
      const value = formData[field.key]
      return value !== undefined && value !== ''
    })
  const hasRequiredAssetSpecs = missingAssetSpecFields.length === 0
  const hasCalibrationLocation = calibrationLocation.addressText.trim() !== ''
  const hasNotPerformedReasons = missingNotPerformedPhaseReasons.length === 0
  return (
    hasRequiredFields &&
    hasRequiredAssetSpecs &&
    hasCalibrationLocation &&
    hasNotPerformedReasons
  )
}

export function isExecutionEditable(status: string) {
  return ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(status)
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
        isMassMeasurementUnit(standard.uncertaintyUnit)
          ? convertMassValue(
              standard.uncertainty,
              standard.uncertaintyUnit,
              'g',
            )
          : standard.uncertainty,
      coverageFactor: standard.coverageFactor,
      drift:
        standard.drift != null && standard.certifiedValues?.[0]?.unit
          ? (convertMassValue(
              standard.drift,
              standard.certifiedValues[0].unit,
              'g',
            ) ?? standard.drift)
          : standard.drift,
      certifiedValues:
        standard.certifiedValues?.map((certifiedValue) => ({
          nominal: certifiedValue.nominal,
          authentication: certifiedValue.authentication,
          value: isMassMeasurementUnit(certifiedValue.unit)
            ? (convertMassValue(
                certifiedValue.value,
                certifiedValue.unit,
                'g',
              ) ?? certifiedValue.value)
            : certifiedValue.value,
          uncertainty: isMassMeasurementUnit(certifiedValue.unit)
            ? (convertMassValue(
                certifiedValue.uncertainty,
                certifiedValue.unit,
                'g',
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

export function getOfficialCompiledExecution(
  results: Record<string, unknown> | null,
): OfficialCompiledExecution | null {
  const value = results?.__compiledExecution
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return toOfficialCompiledExecution(value)
}

export function getCalculationFormulas(job: JobData): MethodFormula[] {
  const compiledFormulas = job.methodSnapshot.compiledMethod?.formulas
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
  const compiledCriteria = job.methodSnapshot.compiledMethod?.acceptanceCriteria
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
  assetBaseMeasurementUnit: MassUnit | null | undefined
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

export function getDisplayedFormulaResults({
  activeCalculationFormulas,
  assetBaseMeasurementUnit,
  formulaResults,
  jobResults,
}: {
  activeCalculationFormulas: MethodFormula[]
  assetBaseMeasurementUnit: MassUnit | null | undefined
  formulaResults: Record<string, FormulaResult>
  jobResults: Record<string, unknown> | null
}) {
  if (!getOfficialCompiledExecution(jobResults) || !jobResults) {
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

export function buildCertifiedValueOptions({
  standardsData,
  convertValueToDisplayUnit,
  displayUnitFor,
}: {
  standardsData: ReferenceStandard[]
  convertValueToDisplayUnit: (
    value: number,
    unit?: string | null,
  ) => number | unknown
  displayUnitFor: (unit?: string | null) => string | undefined
}): CertifiedValueOption[] {
  const options: CertifiedValueOption[] = []

  for (const standard of standardsData) {
    if (!standard.certifiedValues) continue

    for (const certifiedValue of standard.certifiedValues) {
      if (certifiedValue.compositionProfile) continue
      const displayValue = convertValueToDisplayUnit(
        certifiedValue.value,
        certifiedValue.unit,
      )
      const displayUncertainty = convertValueToDisplayUnit(
        certifiedValue.uncertainty,
        certifiedValue.unit,
      )
      const displayUnit =
        displayUnitFor(certifiedValue.unit) ?? certifiedValue.unit
      options.push({
        label: certifiedValue.nominal,
        value:
          typeof displayValue === 'number'
            ? displayValue
            : certifiedValue.value,
        uncertainty:
          typeof displayUncertainty === 'number'
            ? displayUncertainty
            : certifiedValue.uncertainty,
        unit: displayUnit,
        standardName: standard.name,
      })
    }
  }

  return options
}

export function buildMassCompositionOptions({
  standardsData,
  convertValueToDisplayUnit,
  displayUnitFor,
}: {
  standardsData: ReferenceStandard[]
  convertValueToDisplayUnit: (
    value: number,
    unit?: string | null,
  ) => number | unknown
  displayUnitFor: (unit?: string | null) => string | undefined
}): MassCompositionOption[] {
  const individualOptions: MassCompositionOption[] = []
  const profileOptions = new Map<string, MassCompositionOption>()

  for (const standard of standardsData) {
    if (!standard.certifiedValues?.length) continue

    standard.certifiedValues.forEach((certifiedValue, certifiedValueIndex) => {
      const coverageFactor =
        certifiedValue.coverageFactor ?? standard.coverageFactor
      const drift = certifiedValue.drift ?? standard.drift
      const isProfile = certifiedValue.compositionProfile === true
      const profileKey = certifiedValue.profileKey ?? certifiedValue.nominal
      const displayUnit =
        displayUnitFor(certifiedValue.unit) ?? certifiedValue.unit
      const displayValue = convertValueToDisplayUnit(
        certifiedValue.value,
        certifiedValue.unit,
      )
      const displayUncertainty = convertValueToDisplayUnit(
        certifiedValue.uncertainty,
        certifiedValue.unit,
      )
      const displayMaxError =
        certifiedValue.maxError == null
          ? null
          : convertValueToDisplayUnit(
              certifiedValue.maxError,
              certifiedValue.unit,
            )
      const displayDrift =
        drift == null
          ? null
          : convertValueToDisplayUnit(drift, certifiedValue.unit)
      const displayBuoyancy =
        certifiedValue.buoyancy == null
          ? null
          : convertValueToDisplayUnit(
              certifiedValue.buoyancy,
              certifiedValue.unit,
            )

      if (isProfile) {
        const key = `${profileKey}:${displayUnit}`
        const existing = profileOptions.get(key)
        const existingIds = existing?.standardIds ?? []
        const standardIds = Array.from(new Set([...existingIds, standard.id]))

        profileOptions.set(key, {
          standardId: standardIds[0] ?? standard.id,
          standardIds,
          standardName: 'Perfil de composição',
          certificateNumber: 'Rastreabilidade via padrões selecionados',
          certifiedValueIndex,
          nominal: certifiedValue.nominal,
          authentication: certifiedValue.authentication,
          value:
            typeof displayValue === 'number'
              ? displayValue
              : certifiedValue.value,
          uncertainty:
            typeof displayUncertainty === 'number'
              ? displayUncertainty
              : certifiedValue.uncertainty,
          unit: displayUnit,
          coverageFactor,
          maxError:
            typeof displayMaxError === 'number' ? displayMaxError : null,
          drift: typeof displayDrift === 'number' ? displayDrift : null,
          buoyancy:
            typeof displayBuoyancy === 'number' ? displayBuoyancy : null,
          compositionProfile: true,
          profileKey,
          profileClass: certifiedValue.profileClass ?? null,
          profileQuantityAvailable:
            certifiedValue.profileQuantityAvailable ?? null,
          optionLabel: `${profileKey} - perfil de composição`,
        })
        return
      }

      individualOptions.push({
        standardId: standard.id,
        standardName: standard.name,
        certificateNumber: standard.certificateNumber,
        certifiedValueIndex,
        nominal: certifiedValue.nominal,
        authentication: certifiedValue.authentication,
        value:
          typeof displayValue === 'number'
            ? displayValue
            : certifiedValue.value,
        uncertainty:
          typeof displayUncertainty === 'number'
            ? displayUncertainty
            : certifiedValue.uncertainty,
        unit: displayUnit,
        coverageFactor,
        maxError: typeof displayMaxError === 'number' ? displayMaxError : null,
        drift: typeof displayDrift === 'number' ? displayDrift : null,
        buoyancy: typeof displayBuoyancy === 'number' ? displayBuoyancy : null,
        optionLabel: `${certifiedValue.nominal} - ${standard.name} (${standard.certificateNumber})`,
      })
    })
  }

  return [...individualOptions, ...profileOptions.values()]
}

export const JOB_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
}

export const DEFAULT_PHASE_MODE: CalibrationPhaseMode = 'before_and_after'

export function previewFormulaErrorMessage(result: FormulaResult): string {
  if (!result.error) return ''

  if (result.errorCode === 'UNKNOWN_IDENTIFIER') {
    return 'Aguardando entrada ou resultado dependente.'
  }

  if (/missing a required variable/i.test(result.error)) {
    return 'Aguardando entrada ou resultado dependente.'
  }

  if (/allowed function whitelist/i.test(result.error)) {
    return 'Função disponível apenas na execução oficial do método compilado.'
  }

  return result.error
}

export function phaseModeLabel(mode: CalibrationPhaseMode) {
  switch (mode) {
    case 'before_only':
      return 'Somente antes'
    case 'after_only':
      return 'Somente após'
    case 'not_performed':
      return 'Não executado'
    case 'before_and_after':
    default:
      return 'Antes e após'
  }
}

export function phaseBlockKey(field: MethodInputField) {
  return field.phaseBlockKey?.trim() || null
}

export function phaseBlockLabel(field: MethodInputField) {
  return field.phaseBlockLabel?.trim() || field.label
}

export function collectPhaseBlocks(fields: MethodInputField[]) {
  const blocks: Array<{ key: string; label: string }> = []
  const seen = new Set<string>()
  for (const field of fields) {
    const key = phaseBlockKey(field)
    if (!key || seen.has(key)) continue
    seen.add(key)
    blocks.push({ key, label: phaseBlockLabel(field) })
  }
  return blocks
}

export function defaultCalibrationPhases(
  fields: MethodInputField[],
  existing: CalibrationPhaseSnapshot | null | undefined,
): CalibrationPhaseSnapshot {
  const blocks: CalibrationPhaseSnapshot['blocks'] = {}
  for (const block of collectPhaseBlocks(fields)) {
    blocks[block.key] = {
      mode: existing?.blocks?.[block.key]?.mode ?? DEFAULT_PHASE_MODE,
      reason: existing?.blocks?.[block.key]?.reason ?? null,
    }
  }
  return {
    blocks,
    recordedAt: existing?.recordedAt,
    recordedBy: existing?.recordedBy,
  }
}

export function isPhaseActive(
  metadata: Record<string, unknown> | undefined,
  phases: CalibrationPhaseSnapshot,
) {
  const block = metadata?.phaseBlock
  const phase = metadata?.phase
  if (
    typeof block === 'string' &&
    phases.blocks[block]?.mode === 'not_performed'
  ) {
    return false
  }
  if (typeof block !== 'string' || (phase !== 'before' && phase !== 'after')) {
    return true
  }
  return isBlockPhaseActive(phases.blocks[block]?.mode, phase)
}

export function isBlockPhaseActive(
  mode: CalibrationPhaseMode | undefined,
  phase: CalibrationPhase,
) {
  const effectiveMode = mode ?? DEFAULT_PHASE_MODE
  if (effectiveMode === 'before_and_after') return true
  if (effectiveMode === 'before_only') return phase === 'before'
  if (effectiveMode === 'after_only') return phase === 'after'
  if (effectiveMode === 'not_performed') return false
  return true
}

export function formatAddress(address: AddressData | null | undefined) {
  if (!address) return ''
  return [
    address.street,
    address.number,
    address.complement,
    address.neighbourhood,
    address.city,
    address.state,
    address.cep,
  ]
    .filter(Boolean)
    .join(', ')
}

export function formatLabAddress(job: JobData) {
  return formatAddress({
    street: job.labStreet,
    number: job.labNumber,
    complement: job.labComplement,
    neighbourhood: job.labNeighbourhood,
    city: job.labCity,
    state: job.labState,
    cep: job.labCep,
  })
}

export function resolveFieldForDisplay(
  field: MethodInputField,
  baseMeasurementUnit: MassUnit | null | undefined,
): MethodInputField {
  if (!baseMeasurementUnit) {
    return field
  }

  return {
    ...field,
    unit: resolveMassDisplayUnit(baseMeasurementUnit, field.unit),
    weighingRangeResolver: field.weighingRangeResolver
      ? {
          ...field.weighingRangeResolver,
          pointUnit:
            resolveDisplayMassUnit(
              baseMeasurementUnit,
              field.weighingRangeResolver.pointUnit,
            ) ?? field.weighingRangeResolver.pointUnit,
        }
      : field.weighingRangeResolver,
    columns: field.columns?.map((column) => ({
      ...column,
      unit: resolveMassDisplayUnit(baseMeasurementUnit, column.unit),
      massComposition: column.massComposition
        ? {
            ...column.massComposition,
            targetUnit:
              column.massComposition.targetUnit &&
              isMassMeasurementUnit(column.massComposition.targetUnit)
                ? baseMeasurementUnit
                : column.massComposition.targetUnit,
          }
        : column.massComposition,
    })),
  }
}
