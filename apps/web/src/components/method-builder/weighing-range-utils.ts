export type MassUnit = 'mg' | 'g' | 'kg'

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
  rangeUnit: MassUnit
  resolution: number
  resolutionUnit: MassUnit
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
  pointUnit?: MassUnit
  targetColumns?: WeighingRangeResolverTargetColumns
}

const MASS_UNIT_FACTORS_TO_G: Record<MassUnit, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
}

export function isMassUnit(unit: unknown): unit is MassUnit {
  return unit === 'mg' || unit === 'g' || unit === 'kg'
}

export function convertMassValue(
  value: number,
  fromUnit: string | undefined,
  toUnit: string | undefined,
): number | null {
  if (!isMassUnit(fromUnit) || !isMassUnit(toUnit)) return null
  return (
    (value * MASS_UNIT_FACTORS_TO_G[fromUnit]) / MASS_UNIT_FACTORS_TO_G[toUnit]
  )
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

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function hasRangeBoundaryMatch(
  pointValue: number,
  range: WeighingRangeSpec,
  pointUnit: MassUnit,
): boolean {
  if (!isMassUnit(range.rangeUnit)) return false

  const min =
    range.min == null
      ? null
      : convertMassValue(range.min, range.rangeUnit, pointUnit)
  const max =
    range.max == null
      ? null
      : convertMassValue(range.max, range.rangeUnit, pointUnit)

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
  if (numericPointValue == null || !isMassUnit(pointUnit)) return null
  if (!isWeighingRangeSpecArray(ranges)) return null

  for (const range of ranges) {
    if (
      !isMassUnit(range.rangeUnit) ||
      !isMassUnit(range.resolutionUnit) ||
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
      rangeUnit: range.rangeUnit,
      resolution: range.resolution,
      resolutionUnit: range.resolutionUnit,
    }
  }

  return null
}

export function buildFallbackRangeLabel(range: WeighingRangeSpec): string {
  const unit = isMassUnit(range.rangeUnit) ? range.rangeUnit : ''
  const min = range.min == null ? '0' : String(range.min)
  const max = range.max == null ? 'acima' : String(range.max)
  return `${min} a ${max}${unit ? ` ${unit}` : ''}`
}

export function formatWeighingRangeSpec(range: WeighingRangeSpec): string {
  const label = range.label?.trim() || buildFallbackRangeLabel(range)
  const rangeUnit = isMassUnit(range.rangeUnit) ? range.rangeUnit : ''
  const resolutionUnit = isMassUnit(range.resolutionUnit)
    ? range.resolutionUnit
    : ''
  const min = range.min == null ? '0' : String(range.min)
  const max = range.max == null ? 'acima' : String(range.max)
  const resolution =
    range.resolution == null
      ? 'resolução não informada'
      : `resolução ${range.resolution}${resolutionUnit ? ` ${resolutionUnit}` : ''}`

  return `${label}: ${min} a ${max}${rangeUnit ? ` ${rangeUnit}` : ''}, ${resolution}`
}
