import type { MethodInputField } from '@/components/method-runtime/types'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  isEccentricityIndicatorPosition,
  type EccentricityIndicatorVariant,
} from '@/components/eccentricity-indicator'
import { type JobData } from './types'

const CIRCULAR_ECCENTRICITY_LOAD_POSITIONS = ['A', 'B', 'C', 'D', 'E']

const CIRCULAR_ECCENTRICITY_LOAD_POSITION_SET = new Set(
  CIRCULAR_ECCENTRICITY_LOAD_POSITIONS,
)

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
