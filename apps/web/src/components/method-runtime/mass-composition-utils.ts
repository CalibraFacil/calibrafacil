export type MassUnit = 'mg' | 'g' | 'kg'

export interface MassCompositionTargetColumns {
  certifiedValue?: string
  compositionLabel?: string
  expandedUncertainty?: string
  maxError?: string
  drift?: string
  buoyancy?: string
}

export interface MassCompositionConfig {
  targetUnit?: MassUnit
  optionSource?: 'certified_values' | 'composition_profiles'
  targetColumns?: MassCompositionTargetColumns
  uncertaintyMode?: 'expanded_rss'
  quantityMode?: 'linear_per_item_then_rss'
}

export interface MassCompositionItem {
  standardId: number
  standardIds?: number[]
  standardName: string
  certificateNumber: string
  certifiedValueIndex: number
  nominal: string
  quantity: number
  value: number
  uncertainty: number
  unit: string
  coverageFactor: number
  maxError?: number | null
  drift?: number | null
  buoyancy?: number | null
  compositionProfile?: boolean
  profileKey?: string | null
  profileClass?: string | null
}

export interface MassCompositionValue {
  kind: 'mass_standard_composition'
  targetUnit: MassUnit
  label: string
  items: MassCompositionItem[]
  totals: {
    certifiedValue: number
    expandedUncertainty: number | null
    maxError: number | null
    drift: number | null
    buoyancy: number | null
  }
  warnings: string[]
}

export interface MassCompositionOption extends Omit<
  MassCompositionItem,
  'quantity'
> {
  optionLabel: string
}

const SUPPORTED_UNITS = new Set<MassUnit>(['mg', 'g', 'kg'])

export function isMassUnit(unit: string): unit is MassUnit {
  return SUPPORTED_UNITS.has(unit.trim().toLowerCase() as MassUnit)
}

export function normalizeMassUnit(unit: string): MassUnit | null {
  const normalized = unit.trim().toLowerCase()
  return isMassUnit(normalized) ? normalized : null
}

export function convertMassValue(
  value: number,
  fromUnit: string,
  toUnit: MassUnit,
): number | null {
  const normalizedFrom = normalizeMassUnit(fromUnit)
  if (!normalizedFrom) return null

  const valueInGrams =
    normalizedFrom === 'mg'
      ? value / 1000
      : normalizedFrom === 'kg'
        ? value * 1000
        : value

  if (toUnit === 'mg') return valueInGrams * 1000
  if (toUnit === 'kg') return valueInGrams / 1000
  return valueInGrams
}

export function isMassCompositionValue(
  value: unknown,
): value is MassCompositionValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'mass_standard_composition' &&
    Array.isArray((value as { items?: unknown }).items)
  )
}

export function formatMassCompositionLabel(
  items: MassCompositionItem[],
): string {
  return items
    .map((item) =>
      item.compositionProfile
        ? `${item.quantity} x ${item.profileKey ?? item.nominal}`
        : `${item.quantity} x ${item.nominal} ${item.standardName}`,
    )
    .join(' + ')
}

export function buildMassCompositionValue(
  items: MassCompositionItem[],
  targetUnit: MassUnit = 'g',
): MassCompositionValue {
  const warnings: string[] = []
  let certifiedValue = 0
  let uncertaintySquares = 0
  let hasConversionWarning = false

  const unsupportedUnits = new Set<string>()

  for (const item of items) {
    const convertedValue = convertMassValue(item.value, item.unit, targetUnit)
    const convertedUncertainty = convertMassValue(
      item.uncertainty,
      item.unit,
      targetUnit,
    )

    if (convertedValue == null || convertedUncertainty == null) {
      unsupportedUnits.add(item.unit)
      hasConversionWarning = true
      continue
    }

    certifiedValue += item.quantity * convertedValue
    const itemExpandedUncertainty = item.quantity * convertedUncertainty
    uncertaintySquares += itemExpandedUncertainty ** 2
  }

  for (const unit of unsupportedUnits) {
    warnings.push(
      `Unidade ${unit} não suportada para composição de massa. Use mg, g ou kg.`,
    )
  }

  const totalOptional = (
    key: 'maxError' | 'drift' | 'buoyancy',
    label: string,
  ): number | null => {
    if (items.length === 0) return null

    let total = 0
    for (const item of items) {
      const raw = item[key]
      if (raw == null || raw === undefined) {
        warnings.push(
          `${label} indisponível para ${item.nominal} ${item.standardName}.`,
        )
        return null
      }

      const converted = convertMassValue(raw, item.unit, targetUnit)
      if (converted == null) {
        unsupportedUnits.add(item.unit)
        return null
      }

      total += item.quantity * Math.abs(converted)
    }
    return total
  }

  return {
    kind: 'mass_standard_composition',
    targetUnit,
    label: formatMassCompositionLabel(items),
    items,
    totals: {
      certifiedValue,
      expandedUncertainty: hasConversionWarning
        ? null
        : Math.sqrt(uncertaintySquares),
      maxError: totalOptional('maxError', 'Erro máximo'),
      drift: totalOptional('drift', 'Deriva'),
      buoyancy: totalOptional('buoyancy', 'Empuxo'),
    },
    warnings,
  }
}

export function collectMassCompositionStandardIds(
  data: Record<string, unknown>,
): number[] {
  const ids = new Set<number>()

  const visit = (value: unknown) => {
    if (isMassCompositionValue(value)) {
      for (const item of value.items) {
        const standardIds = Array.isArray(item.standardIds)
          ? item.standardIds
          : []
        if (standardIds.length > 0) {
          for (const id of standardIds) ids.add(id)
        } else {
          ids.add(item.standardId)
        }
      }
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) {
        visit(child)
      }
    }
  }

  visit(data)
  return Array.from(ids)
}
