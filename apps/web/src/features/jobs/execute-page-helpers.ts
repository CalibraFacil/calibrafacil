import { type DatePickerPreset } from '@calibra-facil/ui/date-picker'
import {
  formatCalibrationValue,
  type AssetSpecificationFieldLike,
} from '@calibra-facil/shared'
import type {
  MethodInputField,
  ValidationResult,
} from '@/components/method-runtime/types'
import {
  evaluateExecutionFormulaResults,
  DEFAULT_PHASE_MODE,
  formatAddress,
  formatLabAddress,
  type CalibrationLocationSnapshot,
  type CalibrationLocationType,
  type CalibrationPhaseMode,
  type JobData,
} from '@/features/jobs/execution'
import { type ExecutionFormValues } from '@/features/jobs/execution-draft'

const MS_PER_DAY = 1000 * 60 * 60 * 24

export function formatDateForInput(date: Date): string {
  // Local Y/M/D, not toISOString() — a local-midnight calendar date east of UTC
  // would otherwise shift to the previous day and record the wrong calibration date.
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const PERFORMED_AT_PRESETS: readonly DatePickerPreset[] = [
  { label: 'Hoje', getDate: () => new Date() },
  { label: 'Ontem', getDate: () => new Date(Date.now() - MS_PER_DAY) },
  {
    label: 'Há 3 dias',
    getDate: () => new Date(Date.now() - 3 * MS_PER_DAY),
  },
  {
    label: 'Há uma semana',
    getDate: () => new Date(Date.now() - 7 * MS_PER_DAY),
  },
]

export function toAssetSpecificationFieldDefinition(
  field: MethodInputField,
): Array<AssetSpecificationFieldLike> {
  if (
    !field.assetSpecKey ||
    (field.type !== 'number' &&
      field.type !== 'text' &&
      field.type !== 'select')
  ) {
    return []
  }

  return [
    {
      key: field.assetSpecKey,
      type: field.type,
      unit: field.unit,
    },
  ]
}

export function toCalibrationPhaseMode(value: unknown): CalibrationPhaseMode {
  switch (value) {
    case 'before_only':
    case 'after_only':
    case 'not_performed':
    case 'before_and_after':
      return value
    default:
      return DEFAULT_PHASE_MODE
  }
}

export function toCalibrationLocationType(
  value: unknown,
): CalibrationLocationType {
  switch (value) {
    case 'customer_site':
    case 'lab':
    case 'other':
      return value
    default:
      return 'customer_site'
  }
}

export function toStringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function formatContextValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  return JSON.stringify(value)
}

export function buildInitialCalibrationLocation(
  job: JobData,
): CalibrationLocationSnapshot {
  const existing = job.calibrationLocationSnapshot
  if (existing?.addressText) return existing
  const customerAddress = formatAddress(job.customerAddress)
  const labAddress = formatLabAddress(job)
  const type: CalibrationLocationType = customerAddress
    ? 'customer_site'
    : labAddress
      ? 'lab'
      : 'other'
  return {
    type,
    addressText:
      type === 'customer_site'
        ? customerAddress
        : type === 'lab'
          ? labAddress
          : '',
  }
}

export function summarizeRequiredFields(
  manualFields: MethodInputField[],
  formData: Record<string, unknown>,
) {
  const requiredFields = manualFields.filter((field) => field.required)
  const completedRequiredFields = requiredFields.filter((field) => {
    const value = formData[field.key]
    return value !== undefined && value !== ''
  })
  const requiredCompletionPercent =
    requiredFields.length > 0
      ? Math.round(
          (completedRequiredFields.length / requiredFields.length) * 100,
        )
      : 100
  const requiredComplete =
    requiredFields.length > 0 &&
    completedRequiredFields.length >= requiredFields.length
  return {
    requiredFields,
    completedRequiredFields,
    requiredCompletionPercent,
    requiredComplete,
  }
}

export function countExecutionIssues({
  formulaResults,
  validationResults,
  envWarningCount,
  missingNotPerformedPhaseReasonCount,
}: {
  formulaResults: ReturnType<typeof evaluateExecutionFormulaResults>
  validationResults: ValidationResult[]
  envWarningCount: number
  missingNotPerformedPhaseReasonCount: number
}) {
  const formulaIssueCount = Object.values(formulaResults).filter(
    (result) => result.error,
  ).length
  const acceptanceIssueCount = validationResults.filter(
    (result) =>
      result.error || (result.severity === 'error' && result.passed === false),
  ).length
  return (
    formulaIssueCount +
    acceptanceIssueCount +
    envWarningCount +
    missingNotPerformedPhaseReasonCount
  )
}

export function getEnvironmentStatus(
  envWarningCount: number,
  environment: ExecutionFormValues['environment'],
) {
  return envWarningCount > 0
    ? 'Fora do limite'
    : environment.temperature != null ||
        environment.humidity != null ||
        environment.pressure != null
      ? 'Registrado'
      : 'Pendente'
}

export function buildAssetSpecSummaryItems({
  displayAssetSpecFields,
  job,
  convertCanonicalValueToDisplayUnit,
}: {
  displayAssetSpecFields: MethodInputField[]
  job: JobData
  convertCanonicalValueToDisplayUnit: (
    value: unknown,
    unit?: string | null,
  ) => unknown
}) {
  return displayAssetSpecFields.map((field) => {
    const rawValue = field.assetSpecKey
      ? job.assetSnapshot?.specifications?.[field.assetSpecKey]
      : undefined
    const value = convertCanonicalValueToDisplayUnit(rawValue, field.unit)

    return {
      key: field.key,
      label: field.label,
      unit: field.unit,
      value:
        value !== null && value !== undefined && value !== ''
          ? formatCalibrationValue(value)
          : '-',
    }
  })
}
