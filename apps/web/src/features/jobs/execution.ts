import {
  formatCalibrationValue,
  isMassMeasurementUnit,
  type MassUnit,
} from '@calibra-facil/shared'
import {
  canonicalUnitFor,
  convertUnitDelta,
  convertUnitValue,
  denormalizeMethodResultsForDisplay,
  parseNumericValue,
  resolveDisplayUnit,
  unitKind,
  type MeasurementUnit,
} from '@calibra-facil/shared/units'
import type { MassCompositionProfileDto } from '@calibra-facil/client-runtime'

import type {
  FormulaResult,
  MethodFormula,
  MethodInputField,
  MethodTableColumn,
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
import { parseClipboardMatrix } from '@/lib/clipboard-table'
import type { StandardCertifiedValueOption } from '@/components/method-runtime/standard-value-utils'
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
  model?: string | null
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
  baseMeasurementUnit?: MeasurementUnit | null
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
  /** ISO timestamp of the recorded calibration execution date, if set. */
  performedAt?: string | null
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
  /** ISO/IEC 17025 §7.8.2.1(n) — deviations from the method as executed. */
  methodDeviations?: string | null
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

/**
 * The weighing-range resolver's `pointUnit` is mass-only by type. Resolve it to
 * the asset's base unit when both are mass; otherwise keep the original literal
 * (a non-mass base unit never retargets a mass weighing-range point).
 */
function resolvePointDisplayUnit(
  baseMeasurementUnit: MeasurementUnit | null | undefined,
  pointUnit: MassUnit | undefined,
): MassUnit | undefined {
  const displayUnit = resolveDisplayUnit(baseMeasurementUnit, pointUnit)
  return isMassMeasurementUnit(displayUnit) ? displayUnit : pointUnit
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

/**
 * Structured / calculated table columns whose value is not a free-entry scalar
 * (a reference-standard composition or certified-value binding). Bulk paste is
 * refused for these so a raw pasted number can never clobber a structured cell.
 */
function isBulkPasteBlockedColumn(column: MethodTableColumn): boolean {
  return (
    column.role === 'mass_standard_composition' ||
    column.role === 'standard_value'
  )
}

export type ParsePastedReadingsResult =
  | {
      ok: true
      rows: Array<Record<string, unknown>>
      rowCount: number
      columnCount: number
    }
  | { ok: false; error: string }

/**
 * Pure parser for a bulk paste into the method-execution readings table.
 *
 * Splits tab-delimited (spreadsheet/TSV — the primary path), semicolon-delimited
 * (pt-BR CSV, since comma is the decimal separator) or single-column
 * newline-only clipboard text into a rows × columns matrix, then validates it
 * against the method's column schema starting at `startColumnIndex`:
 *
 * - number columns parse pt-BR/dot decimals via the shared `parseNumericValue`
 *   (same semantics as the cell editor); empty cells become `null`.
 * - text columns keep the trimmed string.
 *
 * The paste is REJECTED (never partially applied) when it is empty, ragged,
 * wider than the table can hold from the start column, targets a structured
 * column, or contains a non-numeric value in a number column. Rejection returns
 * `{ ok: false }` so the caller can flag it and leave existing readings intact.
 *
 * Each returned row only carries the keys for the columns it covers — the caller
 * merges them into existing rows via {@link applyPastedReadings}.
 */
export function parsePastedReadings({
  text,
  columns,
  startColumnIndex = 0,
}: {
  text: string
  columns: MethodTableColumn[]
  startColumnIndex?: number
}): ParsePastedReadingsResult {
  if (columns.length === 0) {
    return { ok: false, error: 'A tabela não possui colunas definidas.' }
  }

  if (startColumnIndex < 0 || startColumnIndex >= columns.length) {
    return { ok: false, error: 'Coluna de destino inválida para a colagem.' }
  }

  const clipboard = parseClipboardMatrix(text)
  if (!clipboard.ok) {
    return { ok: false, error: clipboard.error }
  }
  const { rows: matrix, width } = clipboard

  if (startColumnIndex + width > columns.length) {
    return {
      ok: false,
      error:
        'O conteúdo colado tem mais colunas do que a tabela comporta a partir desta coluna.',
    }
  }

  const targetColumns = columns.slice(
    startColumnIndex,
    startColumnIndex + width,
  )

  const blockedColumn = targetColumns.find(isBulkPasteBlockedColumn)
  if (blockedColumn) {
    return {
      ok: false,
      error: `Não é possível colar valores na coluna "${blockedColumn.label}" (preenchida automaticamente).`,
    }
  }

  const rows: Array<Record<string, unknown>> = []
  for (const cells of matrix) {
    const row: Record<string, unknown> = {}
    for (let columnOffset = 0; columnOffset < width; columnOffset++) {
      const column = targetColumns[columnOffset]
      const rawCell = cells[columnOffset] ?? ''
      const trimmed = rawCell.trim()

      if (column.type === 'number') {
        if (trimmed === '') {
          row[column.key] = null
          continue
        }
        const parsed = parseNumericValue(trimmed)
        if (parsed == null) {
          return {
            ok: false,
            error: `Valor não numérico na coluna "${column.label}": "${trimmed}".`,
          }
        }
        row[column.key] = parsed
        continue
      }

      row[column.key] = trimmed
    }
    rows.push(row)
  }

  return { ok: true, rows, rowCount: rows.length, columnCount: width }
}

/**
 * Pure merge of parsed bulk-paste rows into the existing readings, starting at
 * `startRowIndex`. Existing cells outside the pasted region are preserved; rows
 * beyond the current length are created blank (number → `null`, text → `''`,
 * matching the "Adicionar Linha" initializer) before the parsed cells overlay
 * them. Never mutates the input arrays or row objects.
 */
export function applyPastedReadings({
  existingRows,
  parsedRows,
  startRowIndex,
  columns,
}: {
  existingRows: Array<Record<string, unknown>>
  parsedRows: Array<Record<string, unknown>>
  startRowIndex: number
  columns: MethodTableColumn[]
}): Array<Record<string, unknown>> {
  const blankRow = (): Record<string, unknown> =>
    Object.fromEntries(
      columns.map((column) => [
        column.key,
        column.type === 'number' ? null : '',
      ]),
    )

  const totalLength = Math.max(
    existingRows.length,
    startRowIndex + parsedRows.length,
  )

  const result: Array<Record<string, unknown>> = []
  for (let rowIndex = 0; rowIndex < totalLength; rowIndex++) {
    const existing = existingRows[rowIndex]
    result.push(existing ? { ...existing } : blankRow())
  }

  parsedRows.forEach((parsedRow, parsedIndex) => {
    const targetIndex = startRowIndex + parsedIndex
    result[targetIndex] = { ...result[targetIndex], ...parsedRow }
  })

  return result
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
  methodDeviations,
}: {
  selectedStandardIds: number[]
  normalizedData: Record<string, unknown>
  formulaResults: Record<string, FormulaResult>
  environment: EnvironmentalFormData | undefined
  calibrationLocation: ReturnType<typeof buildCalibrationLocationPayload>
  calibrationPhases: ReturnType<typeof buildCalibrationPhasesPayload>
  performedAt?: string
  backdateReason?: string
  methodDeviations?: string | null
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
    // §7.8.2.1(n). Always sent from the worksheet so clearing the box clears
    // the stored value; the API treats absent as "leave untouched".
    methodDeviations: methodDeviations?.trim() || null,
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

export function getDisplayedFormulaResults({
  activeCalculationFormulas,
  assetBaseMeasurementUnit,
  formulaResults,
  jobResults,
}: {
  activeCalculationFormulas: MethodFormula[]
  assetBaseMeasurementUnit: MeasurementUnit | null | undefined
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

/**
 * Discipline-agnostic per-row certified-value options. This is the core of
 * buildMassCompositionOptions WITHOUT the mass-only bits: no composition
 * profiles, no buoyancy, no `isMassMeasurementUnit`/mass-unit gating. Each
 * non-profile certifiedValue of each standard becomes one option carrying
 * { value, uncertainty, coverageFactor (falling back to standard.coverageFactor),
 * drift, unit }, converted to the asset display unit via the same generic
 * helpers. Used to fill `role:"standard_value"` columns for any quantity
 * (force/voltage/frequency/etc.).
 *
 * Kept fully separate from the mass path: buildMassCompositionOptions is left
 * byte-identical.
 */
export function buildStandardCertifiedValueOptions({
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
}): StandardCertifiedValueOption[] {
  const options: StandardCertifiedValueOption[] = []

  for (const standard of standardsData) {
    if (!standard.certifiedValues?.length) continue

    standard.certifiedValues.forEach((certifiedValue, certifiedValueIndex) => {
      // Composition profiles are a mass-only concept; skip them in the generic
      // path (one option fills one row).
      if (certifiedValue.compositionProfile === true) return

      const coverageFactor =
        certifiedValue.coverageFactor ?? standard.coverageFactor
      const drift = certifiedValue.drift ?? standard.drift
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
      const displayDrift =
        drift == null
          ? null
          : convertValueToDisplayUnit(drift, certifiedValue.unit)

      options.push({
        standardId: standard.id,
        standardName: standard.name,
        certificateNumber: standard.certificateNumber,
        certifiedValueIndex,
        nominal: certifiedValue.nominal,
        value:
          typeof displayValue === 'number'
            ? displayValue
            : certifiedValue.value,
        uncertainty:
          typeof displayUncertainty === 'number'
            ? displayUncertainty
            : certifiedValue.uncertainty,
        coverageFactor,
        drift: typeof displayDrift === 'number' ? displayDrift : null,
        unit: displayUnit,
        optionLabel: `${certifiedValue.nominal} - ${standard.name} (${standard.certificateNumber})`,
      })
    })
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

const MASS_PROFILE_CLASS_RE = /\b([EFM][12])\b/i

/** Derive the mass class (M1/M2/F1/…) from a standard's model label. */
export function classOfStandard(standard: {
  model?: string | null
}): string | null {
  const match = standard.model?.match(MASS_PROFILE_CLASS_RE)
  return match ? match[1].toUpperCase() : null
}

/**
 * Reconstitute the composition-profile buildup entries onto each standard's
 * certifiedValues from the normalized mass_composition_profile catalog (profiles
 * no longer live in certified_values). Each standard receives the catalog
 * profiles of its own class, in the legacy CertifiedValue shape — so
 * buildMassCompositionOptions and its standardIds aggregation stay byte-identical
 * to the pre-normalization behavior.
 */
export function attachCompositionProfiles(
  standards: ReferenceStandard[],
  profiles: MassCompositionProfileDto[],
): ReferenceStandard[] {
  if (!profiles.length) return standards
  const byClass = new Map<
    string,
    NonNullable<ReferenceStandard['certifiedValues']>
  >()
  for (const profile of profiles) {
    const list = byClass.get(profile.profileClass) ?? []
    list.push({
      nominal: profile.nominal,
      value: profile.value,
      uncertainty: profile.uncertainty,
      unit: profile.unit,
      maxError: profile.maxError,
      drift: profile.drift,
      buoyancy: profile.buoyancy,
      coverageFactor: profile.coverageFactor,
      compositionProfile: true,
      profileKey: profile.profileKey,
      profileClass: profile.profileClass,
      profileQuantityAvailable: profile.quantityAvailable,
    })
    byClass.set(profile.profileClass, list)
  }
  return standards.map((standard) => {
    const cls = classOfStandard(standard)
    const classProfiles = cls ? byClass.get(cls) : undefined
    if (!classProfiles?.length) return standard
    const real = (standard.certifiedValues ?? []).filter(
      (value) => value.compositionProfile !== true,
    )
    return { ...standard, certifiedValues: [...real, ...classProfiles] }
  })
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
  baseMeasurementUnit: MeasurementUnit | null | undefined,
): MethodInputField {
  if (!baseMeasurementUnit) {
    return field
  }

  return {
    ...field,
    unit: resolveDisplayUnit(baseMeasurementUnit, field.unit),
    weighingRangeResolver: field.weighingRangeResolver
      ? {
          ...field.weighingRangeResolver,
          pointUnit: resolvePointDisplayUnit(
            baseMeasurementUnit,
            field.weighingRangeResolver.pointUnit,
          ),
        }
      : field.weighingRangeResolver,
    columns: field.columns?.map((column) => ({
      ...column,
      unit: resolveDisplayUnit(baseMeasurementUnit, column.unit),
      massComposition: column.massComposition
        ? {
            ...column.massComposition,
            // Mass composition is mass-only: only retarget when the asset's base
            // unit is itself a mass unit.
            targetUnit:
              column.massComposition.targetUnit &&
              isMassMeasurementUnit(column.massComposition.targetUnit) &&
              isMassMeasurementUnit(baseMeasurementUnit)
                ? baseMeasurementUnit
                : column.massComposition.targetUnit,
          }
        : column.massComposition,
    })),
  }
}
