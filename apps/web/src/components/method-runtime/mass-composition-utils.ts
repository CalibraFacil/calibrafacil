import {
  convertMassValue,
  isMassUnit,
  normalizeMassUnit,
  type MassUnit,
} from '@calibra-facil/shared'

// Re-exported so existing importers (mass-composition-suggest, etc.) keep their
// import site. Mass composition stays mass-only; these delegate to the shared
// kind-aware registry with mass pinned.
export { convertMassValue, isMassUnit, normalizeMassUnit, type MassUnit }

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
  uncertaintyMode?: 'expanded_rss' | 'expanded_arithmetic'
  quantityMode?: 'linear_per_item_then_rss' | 'profile_linear'
}

export interface MassCompositionItem {
  standardId: number
  standardIds?: number[]
  standardName: string
  certificateNumber: string
  certifiedValueIndex: number
  nominal: string
  authentication?: string | null
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
  profileQuantityAvailable?: number | null
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

export function isMassCompositionValue(
  value: unknown,
): value is MassCompositionValue {
  const record = toRecord(value)
  return (
    typeof value === 'object' &&
    value !== null &&
    record.kind === 'mass_standard_composition' &&
    Array.isArray(record.items)
  )
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value))
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

/**
 * Combine the calibrated reference weights of one composed mass standard into a
 * single conventional value + uncertainty.
 *
 * `uncertaintyMode` controls how the per-weight expanded uncertainties combine:
 *   - 'expanded_arithmetic' — arithmetic sum Σ(qᵢ·Uᵢ). Correct when the weights
 *     share traceability / systematic effects (the usual case for a weight set):
 *     they are positively correlated, so EURAMET cg-18 §7.1.2.1 and UKAS LAB 14
 *     §4.2.2 require the linear sum. Conservative (≥ RSS); never under-states.
 *   - 'expanded_rss' (default) — root-sum-square √(Σ(qᵢ·Uᵢ)²). Only valid when
 *     the weights' uncertainties are genuinely independent. Default preserves the
 *     historical behavior; see issue #506.
 */
export function buildMassCompositionValue(
  items: MassCompositionItem[],
  targetUnit: MassUnit = 'g',
  config: Pick<MassCompositionConfig, 'quantityMode' | 'uncertaintyMode'> = {},
): MassCompositionValue {
  const warnings: string[] = []
  let certifiedValue = 0
  let uncertaintySquares = 0
  let uncertaintySum = 0
  let hasConversionWarning = false
  const quantityMode = config.quantityMode ?? 'linear_per_item_then_rss'
  const uncertaintyMode = config.uncertaintyMode ?? 'expanded_rss'

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
    uncertaintySum += itemExpandedUncertainty

    if (
      quantityMode === 'profile_linear' &&
      item.compositionProfile === true &&
      typeof item.profileQuantityAvailable === 'number' &&
      Number.isFinite(item.profileQuantityAvailable) &&
      item.quantity > item.profileQuantityAvailable
    ) {
      warnings.push(
        `Quantidade ${item.quantity} excede a disponibilidade do perfil ${
          item.profileKey ?? item.nominal
        } (${item.profileQuantityAvailable}).`,
      )
    }
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
        : uncertaintyMode === 'expanded_arithmetic'
          ? uncertaintySum
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
      for (const child of Object.values(toRecord(value))) {
        visit(child)
      }
    }
  }

  visit(data)
  return Array.from(ids)
}
