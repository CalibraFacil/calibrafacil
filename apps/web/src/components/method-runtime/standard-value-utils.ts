import { convertUnitValue, unitKind } from '@calibra-facil/shared/units'

import type { MethodTableColumn, StandardValueConfig } from './types'

export type { StandardValueConfig }

/**
 * A single discipline-agnostic certified-value option, derived from one
 * reference standard's `certifiedValues` entry. Unlike MassCompositionOption,
 * there is NO composition (one option fills one row), NO buoyancy, and NO
 * mass-unit model — values stay in whatever unit the certificate carries (after
 * the generic display-unit conversion applied at build time).
 */
export interface StandardCertifiedValueOption {
  standardId: number
  standardName: string
  certificateNumber: string
  certifiedValueIndex: number
  nominal: string
  value: number
  uncertainty: number
  coverageFactor: number
  drift: number | null
  unit: string
  optionLabel: string
}

/**
 * Match a calibration row's nominal against the certified-value options. The
 * (default and only) `matchBy` is `"nominal"`: case/whitespace-insensitive exact
 * match on the nominal label. Returns the first matching option, or null.
 */
export function matchStandardValueOption(
  options: StandardCertifiedValueOption[],
  nominal: unknown,
  _config?: StandardValueConfig,
): StandardCertifiedValueOption | null {
  const needle = normalizeNominal(nominal)
  if (needle === '') return null
  return (
    options.find((option) => normalizeNominal(option.nominal) === needle) ??
    null
  )
}

export function normalizeNominal(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Convert a value carried in `optionUnit` into `targetColumn`'s own unit. Generic
 * and kind-aware: a no-op when the kinds differ, units match, or no conversion is
 * available. Coverage factor (dimensionless) is never routed through here.
 */
function toColumnUnit(
  rawValue: number,
  optionUnit: string | undefined,
  targetColumn: MethodTableColumn | undefined,
): number {
  const columnUnit = targetColumn?.unit
  const kind = unitKind(columnUnit)
  if (
    kind == null ||
    unitKind(optionUnit) !== kind ||
    optionUnit === columnUnit
  ) {
    return rawValue
  }
  const converted = convertUnitValue(rawValue, optionUnit, columnUnit)
  return converted == null ? rawValue : Number(converted.toPrecision(12))
}

/**
 * Pure fill: produce the next row by writing a chosen certified value into the
 * `standard_value` column's configured target columns (value / U / k / drift).
 * The value column defaults to the `standard_value` column itself. Coverage
 * factor is dimensionless (never converted); value / U / drift convert into the
 * target column's unit. Cells stay editable \u2014 this is a convenience overlay, so
 * callers do not lock the targets.
 */
export function applyStandardValueOption({
  row,
  columnKey,
  columns,
  option,
}: {
  row: Record<string, unknown>
  columnKey: string
  columns: MethodTableColumn[]
  option: StandardCertifiedValueOption
}): Record<string, unknown> {
  const column = columns.find((candidate) => candidate.key === columnKey)
  const targetColumns = column?.standardValue?.targetColumns ?? {}
  const nextRow: Record<string, unknown> = { ...row }

  const assign = (
    targetKey: string | undefined,
    rawValue: number | null,
    convert: boolean,
  ) => {
    if (!targetKey || rawValue == null) return
    const targetColumn = columns.find(
      (candidate) => candidate.key === targetKey,
    )
    nextRow[targetKey] = convert
      ? toColumnUnit(rawValue, option.unit, targetColumn)
      : rawValue
  }

  assign(targetColumns.value ?? columnKey, option.value, true)
  assign(targetColumns.expandedUncertainty, option.uncertainty, true)
  assign(targetColumns.coverageFactor, option.coverageFactor, false)
  assign(targetColumns.drift, option.drift, true)

  return nextRow
}
