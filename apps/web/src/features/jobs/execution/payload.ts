import {
  validateCalibrationLocationForSubmit,
  validateCalibrationPhasesForSubmit,
} from '@calibra-facil/schemas'
import type {
  FormulaResult,
  MethodInputField,
} from '@/components/method-runtime/types'
import { applyTableWeighingRangeResolvers } from '@/components/method-runtime/table-input-renderer'
import { collectMassCompositionStandardIds } from '@/components/method-runtime/mass-composition-utils'
import { toRecord } from './official-execution'
import { isNumericString, toRecordArray } from './paste'
import {
  type CalibrationLocationSnapshot,
  type CalibrationPhaseBlock,
  type CalibrationPhaseSnapshot,
  type EffectiveLimits,
  type EnvironmentalFormData,
} from './types'
import { DEFAULT_PHASE_MODE, phaseBlockKey } from './phases'

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
  // The submit's own rule (shared with the cloud and the desktop store), asked
  // one block at a time so the form can name the ones that fail.
  return phaseBlocks.filter((block) => {
    const snapshot = calibrationPhases.blocks[block.key]
    return (
      snapshot !== undefined &&
      validateCalibrationPhasesForSubmit({
        blocks: { [block.key]: snapshot },
      }) !== null
    )
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
  const hasCalibrationLocation =
    validateCalibrationLocationForSubmit(calibrationLocation) === null
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
