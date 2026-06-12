import {
  convertMassValue,
  normalizeMassUnit,
  type MassCompositionItem,
  type MassCompositionOption,
  type MassUnit,
} from './mass-composition-utils'

/**
 * Accent- and case-insensitive normalization for option/search matching.
 * Shared by the weight grid filter and its tests.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Builds a composition item from a selectable option, dropping the
 * display-only `optionLabel`. Mirrors the manual add flow in the cell.
 */
export function massCompositionItemFromOption(
  option: MassCompositionOption,
  quantity: number,
): MassCompositionItem {
  const { optionLabel: _optionLabel, ...item } = option
  return { ...item, quantity }
}

/** Converts an option's certified value into `targetUnit` (null if unsupported). */
export function optionValueIn(
  option: MassCompositionOption,
  targetUnit: MassUnit,
): number | null {
  return convertMassValue(option.value, option.unit, targetUnit)
}

function optionUncertaintyIn(
  option: MassCompositionOption,
  targetUnit: MassUnit,
): number {
  const converted = convertMassValue(
    option.uncertainty,
    option.unit,
    targetUnit,
  )
  return converted == null ? Number.POSITIVE_INFINITY : Math.abs(converted)
}

/**
 * Sorts options descending by converted value. Options with an unsupported
 * unit (null value) sink to the end but stay in the list. Stable tie-break:
 * lower converted uncertainty first, then original order.
 */
export function sortMassOptionsDesc(
  options: MassCompositionOption[],
  targetUnit: MassUnit,
): MassCompositionOption[] {
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const aValue = optionValueIn(a.option, targetUnit)
      const bValue = optionValueIn(b.option, targetUnit)

      if (aValue == null && bValue == null) return a.index - b.index
      if (aValue == null) return 1
      if (bValue == null) return -1
      if (aValue !== bValue) return bValue - aValue

      const aUnc = optionUncertaintyIn(a.option, targetUnit)
      const bUnc = optionUncertaintyIn(b.option, targetUnit)
      if (aUnc !== bUnc) return aUnc - bUnc

      return a.index - b.index
    })
    .map((entry) => entry.option)
}

export interface MassCompositionSuggestion {
  items: MassCompositionItem[]
  /** Total composed value, expressed in the target unit. */
  total: number
  /** total - target, in the target unit. */
  delta: number
  /** Whether the total matches the target within floating-point tolerance. */
  exact: boolean
}

interface SuggestionCandidate {
  option: MassCompositionOption
  value: number
  uncertainty: number
  availability: number
}

function relativeTolerance(target: number): number {
  return Math.max(Math.abs(target), 1) * 1e-9
}

function candidateAvailability(option: MassCompositionOption): number {
  if (
    option.compositionProfile === true &&
    typeof option.profileQuantityAvailable === 'number' &&
    Number.isFinite(option.profileQuantityAvailable)
  ) {
    return Math.max(0, Math.floor(option.profileQuantityAvailable))
  }
  return Number.POSITIVE_INFINITY
}

/**
 * Suggests a weight composition that reaches `target` (in `targetUnit`) using
 * the available options.
 *
 * Strategy: prefer a single exact-match option; otherwise a largest-first
 * greedy decomposition with one closest-over refinement step. This is NOT an
 * optimal knapsack solver — it is tuned for the canonical 1-2-5 weight series
 * where greedy is optimal, and the technician can always edit the result.
 */
export function suggestMassComposition(
  target: number,
  targetUnit: MassUnit,
  options: MassCompositionOption[],
): MassCompositionSuggestion | null {
  if (!Number.isFinite(target) || target <= 0) return null

  const tol = relativeTolerance(target)

  const candidates: SuggestionCandidate[] = []
  for (const option of options) {
    const value = optionValueIn(option, targetUnit)
    if (value == null || value <= 0) continue
    const availability = candidateAvailability(option)
    if (availability < 1) continue
    candidates.push({
      option,
      value,
      uncertainty: optionUncertaintyIn(option, targetUnit),
      availability,
    })
  }

  if (candidates.length === 0) return null

  const buildResult = (
    entries: Array<{ candidate: SuggestionCandidate; quantity: number }>,
  ): MassCompositionSuggestion => {
    const items = entries.map(({ candidate, quantity }) =>
      massCompositionItemFromOption(candidate.option, quantity),
    )
    const total = entries.reduce(
      (sum, { candidate, quantity }) => sum + candidate.value * quantity,
      0,
    )
    const delta = total - target
    return { items, total, delta, exact: Math.abs(delta) <= tol }
  }

  // Exact single-option preference (a single 2 kg beats 2× 1 kg).
  const exactSingles = candidates
    .filter((candidate) => Math.abs(candidate.value - target) <= tol)
    .sort((a, b) => a.uncertainty - b.uncertainty)
  if (exactSingles[0]) {
    return buildResult([{ candidate: exactSingles[0], quantity: 1 }])
  }

  const sorted = [...candidates].sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value
    return a.uncertainty - b.uncertainty
  })

  const picks = new Map<SuggestionCandidate, number>()
  let remaining = target
  for (const candidate of sorted) {
    if (remaining <= tol) break
    const qty = Math.min(
      Math.floor((remaining + tol) / candidate.value),
      candidate.availability,
    )
    if (qty >= 1) {
      picks.set(candidate, qty)
      remaining -= qty * candidate.value
    }
  }

  // Closest-over refinement: if still short, adding one unit of the smallest
  // available weight may land closer to the target than staying under it.
  if (remaining > tol) {
    let best: SuggestionCandidate | null = null
    for (const candidate of sorted) {
      const used = picks.get(candidate) ?? 0
      if (used >= candidate.availability) continue
      if (best == null || candidate.value < best.value) {
        best = candidate
      }
    }
    if (best && Math.abs(remaining - best.value) < remaining) {
      picks.set(best, (picks.get(best) ?? 0) + 1)
      remaining -= best.value
    }
  }

  const entries = sorted
    .filter((candidate) => (picks.get(candidate) ?? 0) > 0)
    .map((candidate) => ({
      candidate,
      quantity: picks.get(candidate) ?? 0,
    }))

  if (entries.length === 0) return null

  return buildResult(entries)
}

export interface QuickAddQuery {
  quantity: number
  query: string
}

/**
 * Parses a quick-add search string. An explicit `Nx` / `N*` / `N×` prefix sets
 * the quantity; plain text (including bare digits like "10") is treated purely
 * as a filter query.
 */
export function parseQuickAdd(input: string): QuickAddQuery {
  const match = input.trim().match(/^(\d{1,3})\s*[x*×]\s*(.*)$/i)
  if (match) {
    const parsed = Number.parseInt(match[1], 10)
    return {
      quantity: Number.isInteger(parsed) ? Math.max(1, parsed) : 1,
      query: match[2],
    }
  }
  return { quantity: 1, query: input }
}

export type MassDeltaStatus = 'met' | 'short' | 'over' | 'unknown'

export interface MassDeltaDescription {
  status: MassDeltaStatus
  text: string
}

function formatDeltaNumber(value: number): string {
  return String(Number(value.toPrecision(10)))
}

/** Describes how a composed total compares to the target, in pt-BR. */
export function describeMassDelta(
  total: number,
  target: number | null,
  targetUnit: MassUnit,
): MassDeltaDescription {
  if (target == null || !Number.isFinite(target)) {
    return { status: 'unknown', text: '' }
  }

  const unit = normalizeMassUnit(targetUnit) ?? targetUnit
  const delta = total - target
  const tol = relativeTolerance(target)

  if (Math.abs(delta) <= tol) {
    return { status: 'met', text: 'Alvo atingido' }
  }
  if (delta < 0) {
    return {
      status: 'short',
      text: `Faltam ${formatDeltaNumber(target - total)} ${unit}`,
    }
  }
  return {
    status: 'over',
    text: `Excede em ${formatDeltaNumber(delta)} ${unit}`,
  }
}
