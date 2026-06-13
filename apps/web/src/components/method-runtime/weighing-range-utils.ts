import {
  convertUnitValue,
  decimalsForResolution,
  parseNumericValue,
  unitKind,
} from '@calibra-facil/shared/units'

// Re-exported so existing importers keep their import site stable. These now
// come from the kind-aware registry (mass stays byte-identical).
export { decimalsForResolution, parseNumericValue }

export type WeighingRangeSpec = {
  label?: string
  min?: number | null
  max?: number | null
  rangeUnit?: string
  resolution?: number | null
  resolutionUnit?: string
}

export type ResolvedWeighingRange = {
  label: string
  min: number | null
  max: number | null
  rangeUnit: string
  resolution: number
  resolutionUnit: string
}

export type WeighingRangeResolverTargetColumns = {
  rangeLabel?: string
  rangeMin?: string
  rangeMax?: string
  rangeUnit?: string
  resolution?: string
  resolutionUnit?: string
}

export type WeighingRangeResolverConfig = {
  enabled?: boolean
  assetSpecKey?: string
  pointColumn?: string
  pointUnit?: string
  targetColumns?: WeighingRangeResolverTargetColumns
}

/** Whether two unit tokens belong to the same (recognized) quantity kind. */
function sameKind(a: unknown, b: unknown): boolean {
  const kindA = unitKind(a)
  return kindA != null && kindA === unitKind(b)
}

export function isWeighingRangeSpecArray(
  value: unknown,
): value is WeighingRangeSpec[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        ('min' in item || 'max' in item || 'resolution' in item),
    )
  )
}

function hasRangeBoundaryMatch(
  pointValue: number,
  range: WeighingRangeSpec,
  pointUnit: string | undefined,
): boolean {
  if (!sameKind(range.rangeUnit, pointUnit)) return false

  const min =
    range.min == null
      ? null
      : convertUnitValue(range.min, range.rangeUnit, pointUnit)
  const max =
    range.max == null
      ? null
      : convertUnitValue(range.max, range.rangeUnit, pointUnit)

  if (range.min != null && min == null) return false
  if (range.max != null && max == null) return false
  if (min != null && pointValue < min) return false
  if (max != null && pointValue > max) return false

  return true
}

export function resolveWeighingRange(
  pointValue: unknown,
  pointUnit: string | undefined,
  ranges: unknown,
): ResolvedWeighingRange | null {
  const numericPointValue = parseNumericValue(pointValue)
  if (numericPointValue == null || unitKind(pointUnit) == null) return null
  if (!isWeighingRangeSpecArray(ranges)) return null

  for (const range of ranges) {
    if (
      !sameKind(range.rangeUnit, pointUnit) ||
      !sameKind(range.resolutionUnit, pointUnit) ||
      typeof range.resolution !== 'number' ||
      !Number.isFinite(range.resolution)
    ) {
      continue
    }

    if (!hasRangeBoundaryMatch(numericPointValue, range, pointUnit)) {
      continue
    }

    return {
      label: range.label?.trim() || buildFallbackRangeLabel(range),
      min: range.min ?? null,
      max: range.max ?? null,
      rangeUnit: range.rangeUnit ?? '',
      resolution: range.resolution,
      resolutionUnit: range.resolutionUnit ?? '',
    }
  }

  return null
}

export function buildFallbackRangeLabel(range: WeighingRangeSpec): string {
  const unit = unitKind(range.rangeUnit) != null ? range.rangeUnit : ''
  const min = range.min == null ? '0' : String(range.min)
  const max = range.max == null ? 'acima' : String(range.max)
  return `${min} a ${max}${unit ? ` ${unit}` : ''}`
}

export function formatWeighingRangeSpec(range: WeighingRangeSpec): string {
  const label = range.label?.trim() || buildFallbackRangeLabel(range)
  const rangeUnit = unitKind(range.rangeUnit) != null ? range.rangeUnit : ''
  const resolutionUnit =
    unitKind(range.resolutionUnit) != null ? range.resolutionUnit : ''
  const min = range.min == null ? '0' : String(range.min)
  const max = range.max == null ? 'acima' : String(range.max)
  const resolution =
    range.resolution == null
      ? 'resolução não informada'
      : `resolução ${range.resolution}${resolutionUnit ? ` ${resolutionUnit}` : ''}`

  return `${label}: ${min} a ${max}${rangeUnit ? ` ${rangeUnit}` : ''}, ${resolution}`
}
