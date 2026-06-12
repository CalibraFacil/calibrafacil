import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Delete02Icon,
  ArrowDown01Icon,
} from '@hugeicons/core-free-icons'

import type { MethodInputField } from './types'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MassCompositionCell } from './mass-composition-cell'
import {
  isMassCompositionValue,
  type MassCompositionOption,
  type MassCompositionTargetColumns,
  type MassCompositionValue,
} from './mass-composition-utils'
import {
  convertMassValue,
  isMassUnit,
  parseNumericValue,
  resolveWeighingRange,
  type MassUnit,
  type ResolvedWeighingRange,
  type WeighingRangeResolverTargetColumns,
} from './weighing-range-utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface CertifiedValueOption {
  label: string // e.g., "100g"
  value: number // e.g., 100.00015
  uncertainty: number // e.g., 0.0001
  unit: string
  standardName: string
}

interface TableInputRendererProps {
  field: MethodInputField
  value: Array<Record<string, unknown>>
  onChange: (value: Array<Record<string, unknown>>) => void
  disabled?: boolean
  certifiedValueOptions?: CertifiedValueOption[]
  massCompositionOptions?: MassCompositionOption[]
  assetSpecifications?: Record<string, unknown> | null
  phaseMode?:
    | 'before_and_after'
    | 'before_only'
    | 'after_only'
    | 'not_performed'
}

/**
 * Check if a column should show the certified values picker based on naming convention.
 * Matches common patterns for columns that hold reference standard values.
 */
const STANDARD_REF_PATTERNS = [
  'padrao',
  'padrão',
  'ref',
  'referencia',
  'referência',
  'standard',
  'certificado',
  'certified',
  'valor_padrao',
  'valor_ref',
]

function isStandardRefColumn(key: string, label: string): boolean {
  const normalized = `${key} ${label}`.toLowerCase()
  return STANDARD_REF_PATTERNS.some((pattern) => normalized.includes(pattern))
}

const COMPOSITION_TOTAL_TARGETS: Array<
  [keyof MassCompositionTargetColumns, keyof MassCompositionValue['totals']]
> = [
  ['certifiedValue', 'certifiedValue'],
  ['expandedUncertainty', 'expandedUncertainty'],
  ['maxError', 'maxError'],
  ['drift', 'drift'],
  ['buoyancy', 'buoyancy'],
]

const PANEL_HIDDEN_COMPOSITION_TARGETS: Array<
  keyof MassCompositionTargetColumns
> = [
  'certifiedValue',
  'compositionLabel',
  'expandedUncertainty',
  'maxError',
  'drift',
  'buoyancy',
]

type TableColumn = NonNullable<MethodInputField['columns']>[number]
type MeasurementColumnGroup = 'before' | 'after' | 'other'

const DEFAULT_ECCENTRICITY_LOAD_POINTS = {
  circular_platform: ['A', 'B', 'C', 'D', 'E'],
  road_scale: ['1', '2', '3', '4'],
} satisfies Record<
  NonNullable<MethodInputField['eccentricityIndicator']>['variant'] & string,
  string[]
>

function normalizeColumnText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function getMeasurementColumnGroup(
  column: TableColumn,
): MeasurementColumnGroup {
  if (column.phase === 'before') return 'before'
  if (column.phase === 'after') return 'after'

  const text = normalizeColumnText(`${column.key} ${column.label}`)

  if (text.includes('antes') && text.includes('leitura')) {
    return 'before'
  }

  if (text.includes('apos') && text.includes('leitura')) {
    return 'after'
  }

  return 'other'
}

function isColumnPhaseActive(
  column: TableColumn,
  phaseMode: NonNullable<TableInputRendererProps['phaseMode']>,
) {
  if (phaseMode === 'not_performed') return false
  if (!column.phase || column.phase === 'always') return true
  if (phaseMode === 'before_and_after') return true
  if (phaseMode === 'before_only') return column.phase === 'before'
  if (phaseMode === 'after_only') return column.phase === 'after'
  return true
}

function getEccentricityPointColumn(field: MethodInputField) {
  const configured = field.eccentricityIndicator?.pointColumn?.trim()
  if (configured) return configured

  return field.columns?.find((column) => {
    const text = normalizeColumnText(`${column.key} ${column.label}`)
    return text.includes('posicao') || text.includes('ponto')
  })?.key
}

function getEccentricityLoadPoints(field: MethodInputField) {
  const eccentricity = field.eccentricityIndicator
  if (!eccentricity?.enabled) return null

  const pointColumn = getEccentricityPointColumn(field)
  if (!pointColumn) return null

  const configuredPoints = eccentricity.loadPoints
    ?.map((point) => point.trim())
    .filter(Boolean)
  const variant = eccentricity.variant ?? 'circular_platform'
  const loadPoints =
    configuredPoints && configuredPoints.length > 0
      ? configuredPoints
      : DEFAULT_ECCENTRICITY_LOAD_POINTS[variant]

  return loadPoints.length > 0 ? { pointColumn, loadPoints } : null
}

function normalizePointValue(value: unknown) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
}

function applyEccentricityLoadPoints(
  field: MethodInputField,
  rows: Array<Record<string, unknown>>,
) {
  const config = getEccentricityLoadPoints(field)
  if (!config) return rows

  const rowsByPoint = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const point = normalizePointValue(row[config.pointColumn])
    if (point && !rowsByPoint.has(point)) {
      rowsByPoint.set(point, row)
    }
  }

  return config.loadPoints.map((point, index) => {
    const existing =
      rowsByPoint.get(normalizePointValue(point)) ?? rows[index] ?? {}
    return {
      ...existing,
      [config.pointColumn]: point,
    }
  })
}

function valuesMatch(current: unknown, expected: unknown): boolean {
  if (typeof current === 'number' && typeof expected === 'number') {
    return Math.abs(current - expected) < 1e-12
  }
  if (typeof current === 'string' && typeof expected === 'number') {
    const parsed = Number(current)
    return Number.isFinite(parsed) && Math.abs(parsed - expected) < 1e-12
  }
  return current === expected
}

function setRangeTargetValue(
  row: Record<string, unknown>,
  columns: MethodInputField['columns'] | undefined,
  targetColumns: WeighingRangeResolverTargetColumns,
  targetName: keyof WeighingRangeResolverTargetColumns,
  value: unknown,
  valueUnit?: string,
) {
  const targetKey = targetColumns[targetName]
  if (!targetKey) return

  if (typeof value === 'number' && valueUnit) {
    const targetColumn = columns?.find((col) => col.key === targetKey)
    const converted = targetColumn?.unit
      ? convertMassValue(value, valueUnit, targetColumn.unit)
      : value

    if (converted != null) {
      row[targetKey] = converted
    }
    return
  }

  row[targetKey] = value
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function getAssetResolutionFallback(
  assetSpecifications: Record<string, unknown> | null | undefined,
): Pick<ResolvedWeighingRange, 'resolution' | 'resolutionUnit'> | null {
  const resolution = parseNumber(assetSpecifications?.resolution)
  const resolutionUnit = assetSpecifications?.resolutionUnit ?? 'g'

  if (resolution == null || !isMassUnit(resolutionUnit)) {
    return null
  }

  return {
    resolution,
    resolutionUnit,
  }
}

function valuesAreEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) < 1e-12
  }

  return left === right
}

function rowsAreEqual(
  left: Array<Record<string, unknown>>,
  right: Array<Record<string, unknown>>,
) {
  return (
    left.length === right.length &&
    left.every((leftRow, rowIndex) => {
      const rightRow = right[rowIndex] ?? {}
      const keys = new Set([...Object.keys(leftRow), ...Object.keys(rightRow)])

      for (const key of keys) {
        if (!valuesAreEqual(leftRow[key], rightRow[key])) {
          return false
        }
      }

      return true
    })
  )
}

function getWeighingRangeResolver(field: MethodInputField) {
  return field.weighingRangeResolver?.enabled !== false
    ? field.weighingRangeResolver
    : undefined
}

function getConfiguredWeighingRanges(
  field: MethodInputField,
  assetSpecifications: Record<string, unknown> | null | undefined,
) {
  const weighingRangeResolver = getWeighingRangeResolver(field)

  return weighingRangeResolver?.assetSpecKey
    ? assetSpecifications?.[weighingRangeResolver.assetSpecKey]
    : null
}

function resolveRowWeighingRange(
  field: MethodInputField,
  row: Record<string, unknown>,
  assetSpecifications: Record<string, unknown> | null | undefined,
): ResolvedWeighingRange | null {
  const columns = field.columns || []
  const weighingRangeResolver = getWeighingRangeResolver(field)

  if (
    !weighingRangeResolver?.assetSpecKey ||
    !weighingRangeResolver.pointColumn
  ) {
    return null
  }

  const weighingRangePointColumn = columns.find(
    (col) => col.key === weighingRangeResolver.pointColumn,
  )

  return resolveWeighingRange(
    row[weighingRangeResolver.pointColumn],
    weighingRangeResolver.pointUnit ?? weighingRangePointColumn?.unit,
    assetSpecifications?.[weighingRangeResolver.assetSpecKey],
  )
}

function resolveMassCompositionTarget(
  field: MethodInputField,
  row: Record<string, unknown>,
): { value: number; unit: MassUnit } | null {
  const columns = field.columns || []
  const resolver = getWeighingRangeResolver(field)
  if (!resolver?.pointColumn) return null

  const numeric = parseNumericValue(row[resolver.pointColumn])
  if (numeric == null) return null

  const pointColumn = columns.find((col) => col.key === resolver.pointColumn)
  const unit = resolver.pointUnit ?? pointColumn?.unit
  if (!isMassUnit(unit)) return null

  return { value: numeric, unit }
}

export function applyTableWeighingRangeResolvers(
  field: MethodInputField,
  rows: Array<Record<string, unknown>>,
  assetSpecifications: Record<string, unknown> | null | undefined,
) {
  const columns = field.columns || []
  const weighingRangeResolver = getWeighingRangeResolver(field)

  if (!weighingRangeResolver || rows.length === 0) {
    return rows
  }

  const applyResolver = (row: Record<string, unknown>) => {
    const resolved = resolveRowWeighingRange(field, row, assetSpecifications)
    const targetColumns = weighingRangeResolver.targetColumns ?? {}
    const configuredRanges = getConfiguredWeighingRanges(
      field,
      assetSpecifications,
    )
    const hasConfiguredRanges =
      Array.isArray(configuredRanges) && configuredRanges.length > 0
    const resolutionSource =
      resolved ??
      (!hasConfiguredRanges
        ? getAssetResolutionFallback(assetSpecifications)
        : null)

    if (Object.keys(targetColumns).length === 0) {
      return row
    }

    if (!resolved && !resolutionSource && !hasConfiguredRanges) {
      return row
    }

    const nextRow = { ...row }
    if (resolved) {
      setRangeTargetValue(
        nextRow,
        columns,
        targetColumns,
        'rangeLabel',
        resolved.label,
      )
      setRangeTargetValue(
        nextRow,
        columns,
        targetColumns,
        'rangeMin',
        resolved.min,
        resolved.rangeUnit,
      )
      setRangeTargetValue(
        nextRow,
        columns,
        targetColumns,
        'rangeMax',
        resolved.max,
        resolved.rangeUnit,
      )
      setRangeTargetValue(
        nextRow,
        columns,
        targetColumns,
        'rangeUnit',
        resolved.rangeUnit,
      )
    } else {
      setRangeTargetValue(nextRow, columns, targetColumns, 'rangeLabel', '')
      setRangeTargetValue(nextRow, columns, targetColumns, 'rangeMin', null)
      setRangeTargetValue(nextRow, columns, targetColumns, 'rangeMax', null)
      setRangeTargetValue(nextRow, columns, targetColumns, 'rangeUnit', '')
    }

    if (!resolutionSource) {
      setRangeTargetValue(nextRow, columns, targetColumns, 'resolution', null)
      setRangeTargetValue(nextRow, columns, targetColumns, 'resolutionUnit', '')
      return nextRow
    }

    setRangeTargetValue(
      nextRow,
      columns,
      targetColumns,
      'resolution',
      resolutionSource.resolution,
      resolutionSource.resolutionUnit,
    )
    setRangeTargetValue(
      nextRow,
      columns,
      targetColumns,
      'resolutionUnit',
      resolutionSource.resolutionUnit,
    )

    return nextRow
  }

  const resolvedRows = rows.map((row) => applyResolver(row))
  return rowsAreEqual(rows, resolvedRows) ? rows : resolvedRows
}

const EMPTY_CERTIFIED_VALUE_OPTIONS: CertifiedValueOption[] = []
const EMPTY_MASS_COMPOSITION_OPTIONS: MassCompositionOption[] = []

export function TableInputRenderer({
  field,
  value,
  onChange,
  disabled = false,
  certifiedValueOptions = EMPTY_CERTIFIED_VALUE_OPTIONS,
  massCompositionOptions = EMPTY_MASS_COMPOSITION_OPTIONS,
  assetSpecifications,
  phaseMode = 'before_and_after',
}: TableInputRendererProps) {
  const eccentricityLoadPointConfig = getEccentricityLoadPoints(field)
  const hasFixedLoadPoints = Boolean(eccentricityLoadPointConfig)
  const rows = applyTableWeighingRangeResolvers(
    field,
    applyEccentricityLoadPoints(field, value || []),
    assetSpecifications,
  )
  const columns = field.columns || []
  const weighingRangeResolver = getWeighingRangeResolver(field)
  const configuredRanges = getConfiguredWeighingRanges(
    field,
    assetSpecifications,
  )
  const hasConfiguredRanges =
    Array.isArray(configuredRanges) && configuredRanges.length > 0
  const shouldUsePanelRows =
    columns.length > 5 ||
    columns.some((col) => col.role === 'mass_standard_composition')
  const panelColumnGroups = {
    primary: columns.filter(
      (column) => getMeasurementColumnGroup(column) === 'other',
    ),
    before: columns.filter(
      (column) => getMeasurementColumnGroup(column) === 'before',
    ),
    after: columns.filter(
      (column) => getMeasurementColumnGroup(column) === 'after',
    ),
  }
  const shouldGroupReadings =
    panelColumnGroups.before.length > 0 && panelColumnGroups.after.length > 0
  const panelHiddenColumnKeys = new Set<string>()
  for (const column of columns) {
    if (column.role !== 'mass_standard_composition') continue

    const targetColumns = column.massComposition?.targetColumns ?? {}
    for (const targetName of PANEL_HIDDEN_COMPOSITION_TARGETS) {
      const targetKey = targetColumns[targetName]
      if (targetKey && targetKey !== column.key) {
        panelHiddenColumnKeys.add(targetKey)
      }
    }
  }
  for (const targetKey of Object.values(
    weighingRangeResolver?.targetColumns ?? {},
  )) {
    if (targetKey && targetKey !== weighingRangeResolver?.pointColumn) {
      panelHiddenColumnKeys.add(targetKey)
    }
  }
  const isPanelVisibleColumn = (column: TableColumn) =>
    !panelHiddenColumnKeys.has(column.key)
  const hasCertifiedValues = certifiedValueOptions.length > 0

  const addRow = () => {
    const newRow: Record<string, unknown> = {}
    for (const col of columns) {
      newRow[col.key] = col.type === 'number' ? null : ''
    }
    onChange([...rows, newRow])
  }

  const removeRow = (index: number) => {
    if (hasFixedLoadPoints) return
    onChange(rows.filter((_, i) => i !== index))
  }

  const updateCell = (rowIndex: number, colKey: string, cellValue: unknown) => {
    const newRows = [...rows]
    newRows[rowIndex] = applyTableWeighingRangeResolvers(
      field,
      [
        {
          ...newRows[rowIndex],
          [colKey]: cellValue,
        },
      ],
      assetSpecifications,
    )[0] ?? {
      ...newRows[rowIndex],
      [colKey]: cellValue,
    }
    onChange(newRows)
  }

  const updateMassComposition = (
    rowIndex: number,
    colKey: string,
    composition: MassCompositionValue | null,
  ) => {
    const col = columns.find((column) => column.key === colKey)
    const targetColumns = col?.massComposition?.targetColumns ?? {}
    const currentRow = rows[rowIndex] ?? {}
    const previousComposition = isMassCompositionValue(currentRow[colKey])
      ? currentRow[colKey]
      : null
    const nextRow: Record<string, unknown> = { ...currentRow }

    if (!composition) {
      nextRow[colKey] = ''

      if (previousComposition) {
        const labelTarget = targetColumns.compositionLabel
        if (
          labelTarget &&
          labelTarget !== colKey &&
          valuesMatch(nextRow[labelTarget], previousComposition.label)
        ) {
          nextRow[labelTarget] = ''
        }

        for (const [targetName, totalKey] of COMPOSITION_TOTAL_TARGETS) {
          const targetKey = targetColumns[targetName]
          const previousTotal = previousComposition.totals[totalKey]
          if (
            targetKey &&
            previousTotal != null &&
            valuesMatch(nextRow[targetKey], previousTotal)
          ) {
            nextRow[targetKey] = null
          }
        }
      }
    } else {
      nextRow[colKey] = composition

      const labelTarget = targetColumns.compositionLabel
      if (labelTarget && labelTarget !== colKey) {
        nextRow[labelTarget] = composition.label
      }

      for (const [targetName, totalKey] of COMPOSITION_TOTAL_TARGETS) {
        const targetKey = targetColumns[targetName]
        const total = composition.totals[totalKey]
        if (targetKey && total != null) {
          nextRow[targetKey] = total
        }
      }
    }

    const newRows = [...rows]
    newRows[rowIndex] =
      applyTableWeighingRangeResolvers(
        field,
        [nextRow],
        assetSpecifications,
      )[0] ?? nextRow
    onChange(newRows)
  }

  const getCalculatedTargets = (row: Record<string, unknown>) => {
    const targets = new Set<string>()

    for (const col of columns) {
      if (col.role !== 'mass_standard_composition') continue
      const cellValue = row[col.key]
      const composition = isMassCompositionValue(cellValue) ? cellValue : null
      if (!composition) continue

      const targetColumns = col.massComposition?.targetColumns ?? {}
      const labelTarget = targetColumns.compositionLabel
      if (labelTarget && labelTarget !== col.key) {
        targets.add(labelTarget)
      }

      for (const [targetName, totalKey] of COMPOSITION_TOTAL_TARGETS) {
        const targetKey = targetColumns[targetName]
        if (targetKey && composition.totals[totalKey] != null) {
          targets.add(targetKey)
        }
      }
    }

    const resolvedRange = resolveRowWeighingRange(
      field,
      row,
      assetSpecifications,
    )
    const resolutionFallback = !hasConfiguredRanges
      ? getAssetResolutionFallback(assetSpecifications)
      : null
    if (resolvedRange || resolutionFallback) {
      const targetColumns = weighingRangeResolver?.targetColumns ?? {}
      const targetKeys = resolvedRange
        ? Object.values(targetColumns)
        : [targetColumns.resolution, targetColumns.resolutionUnit]

      for (const targetKey of targetKeys) {
        if (targetKey) targets.add(targetKey)
      }
    }

    return targets
  }

  if (columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Tabela sem colunas definidas.
      </p>
    )
  }

  if (phaseMode === 'not_performed') {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
        Bloco marcado como não executado. As leituras deste bloco não são
        necessárias.
      </div>
    )
  }

  const renderCellInput = (
    row: Record<string, unknown>,
    rowIndex: number,
    col: TableColumn,
    calculatedTargets: Set<string>,
  ) => {
    const isCalculatedTarget = calculatedTargets.has(col.key)
    const isFixedLoadPoint =
      eccentricityLoadPointConfig?.pointColumn === col.key
    const isInactivePhaseColumn = !isColumnPhaseActive(col, phaseMode)
    const cellValue = row[col.key]
    const showPicker =
      col.type === 'number' &&
      hasCertifiedValues &&
      isStandardRefColumn(col.key, col.label)

    if (col.role === 'mass_standard_composition') {
      const prevValue = rowIndex > 0 ? rows[rowIndex - 1]?.[col.key] : undefined
      const previousComposition = isMassCompositionValue(prevValue)
        ? prevValue
        : null
      return (
        <MassCompositionCell
          value={row[col.key]}
          onChange={(val) => updateMassComposition(rowIndex, col.key, val)}
          options={massCompositionOptions}
          config={col.massComposition}
          disabled={disabled || isInactivePhaseColumn}
          presentation={shouldUsePanelRows ? 'field' : 'cell'}
          target={resolveMassCompositionTarget(field, row)}
          previousComposition={previousComposition}
        />
      )
    }

    if (isInactivePhaseColumn) {
      return (
        <Input
          type="text"
          value="x"
          disabled
          className="h-8 w-full bg-muted/60 text-center text-muted-foreground"
          title="Etapa não aplicável para esta calibração"
        />
      )
    }

    if (showPicker) {
      return (
        <NumberCellWithPicker
          value={row[col.key]}
          onChange={(val) => updateCell(rowIndex, col.key, val)}
          onBlur={(val) => updateCell(rowIndex, col.key, val)}
          disabled={disabled || isCalculatedTarget}
          certifiedValueOptions={certifiedValueOptions}
        />
      )
    }

    if (col.type === 'number') {
      return (
        <Input
          type="text"
          inputMode="decimal"
          value={row[col.key] != null ? String(row[col.key]) : ''}
          onChange={(e) => {
            const val = e.target.value
            if (val === '' || /^-?\d*[.,]?\d*$/.test(val)) {
              const normalized = val.replace(',', '.')
              updateCell(
                rowIndex,
                col.key,
                normalized === '' ? null : normalized,
              )
            }
          }}
          onBlur={(e) => {
            const val = e.target.value.replace(',', '.')
            if (val !== '' && val !== '-' && val !== '.') {
              const parsed = parseFloat(val)
              if (!isNaN(parsed)) {
                updateCell(rowIndex, col.key, parsed)
              }
            } else if (val === '' || val === '-' || val === '.') {
              updateCell(rowIndex, col.key, null)
            }
          }}
          disabled={disabled || isCalculatedTarget || isFixedLoadPoint}
          className={`h-8 w-full ${isCalculatedTarget || isFixedLoadPoint ? 'bg-muted/50' : ''}`}
          title={
            isFixedLoadPoint
              ? 'Ponto de carga definido pelo método'
              : isCalculatedTarget
                ? 'Valor calculado automaticamente'
                : undefined
          }
        />
      )
    }

    return (
      <Input
        type={col.type}
        value={
          isMassCompositionValue(cellValue)
            ? cellValue.label
            : cellValue != null
              ? String(cellValue)
              : ''
        }
        onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
        disabled={disabled || isCalculatedTarget || isFixedLoadPoint}
        className={`h-8 w-full ${isCalculatedTarget || isFixedLoadPoint ? 'bg-muted/50' : ''}`}
        title={
          isFixedLoadPoint
            ? 'Ponto de carga definido pelo método'
            : isCalculatedTarget
              ? 'Valor calculado automaticamente'
              : undefined
        }
      />
    )
  }

  const renderPanelColumn = (
    row: Record<string, unknown>,
    rowIndex: number,
    col: TableColumn,
    calculatedTargets: Set<string>,
  ) => {
    const isComposition = col.role === 'mass_standard_composition'

    return (
      <div
        key={col.key}
        className={
          isComposition
            ? 'min-w-0 space-y-1 md:col-span-2 xl:col-span-3'
            : 'min-w-0 space-y-1'
        }
      >
        <label className="text-xs font-medium text-muted-foreground">
          {col.label}
          {col.unit && <span className="font-normal"> ({col.unit})</span>}
        </label>
        {renderCellInput(row, rowIndex, col, calculatedTargets)}
      </div>
    )
  }

  const renderReadingGroup = (
    title: string,
    groupColumns: TableColumn[],
    row: Record<string, unknown>,
    rowIndex: number,
    calculatedTargets: Set<string>,
  ) => {
    if (groupColumns.length === 0) return null

    return (
      <div className="rounded-xl bg-muted/30 p-3 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <div className="grid gap-2">
          {groupColumns.map((col) =>
            renderPanelColumn(row, rowIndex, col, calculatedTargets),
          )}
        </div>
      </div>
    )
  }

  if (shouldUsePanelRows) {
    return (
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Nenhuma linha adicionada
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row, rowIndex) => {
              const calculatedTargets = getCalculatedTargets(row)
              const loadPoint = eccentricityLoadPointConfig
                ? String(row[eccentricityLoadPointConfig.pointColumn] ?? '')
                : ''

              return (
                <div
                  key={rowIndex}
                  className="rounded-xl bg-background p-4 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.09)]"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-sm font-medium tabular-nums">
                        {rowIndex + 1}
                      </span>
                      <span className="text-sm font-medium">
                        {loadPoint
                          ? `Ponto ${loadPoint}`
                          : `Ponto ${rowIndex + 1}`}
                      </span>
                    </div>
                    {!hasFixedLoadPoints && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(rowIndex)}
                        disabled={disabled}
                        className="h-10 w-10 active:scale-[0.96]"
                      >
                        <HugeiconsIcon
                          icon={Delete02Icon}
                          className="h-4 w-4"
                        />
                      </Button>
                    )}
                  </div>

                  {shouldGroupReadings ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {panelColumnGroups.primary.map((col) =>
                          isPanelVisibleColumn(col)
                            ? renderPanelColumn(
                                row,
                                rowIndex,
                                col,
                                calculatedTargets,
                              )
                            : null,
                        )}
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        {renderReadingGroup(
                          'Antes do ajuste',
                          panelColumnGroups.before,
                          row,
                          rowIndex,
                          calculatedTargets,
                        )}
                        {renderReadingGroup(
                          'Após o ajuste',
                          panelColumnGroups.after,
                          row,
                          rowIndex,
                          calculatedTargets,
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {columns.map((col) =>
                        isPanelVisibleColumn(col)
                          ? renderPanelColumn(
                              row,
                              rowIndex,
                              col,
                              calculatedTargets,
                            )
                          : null,
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!hasFixedLoadPoints && (
          <Button
            variant="outline"
            size="sm"
            onClick={addRow}
            disabled={disabled}
          >
            <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
            Adicionar Linha
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border">
        <Table className="min-w-max">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              {columns.map((col) => (
                <TableHead key={col.key} className="min-w-32 whitespace-nowrap">
                  {col.label}
                  {col.unit && (
                    <span className="text-muted-foreground font-normal ml-1">
                      ({col.unit})
                    </span>
                  )}
                </TableHead>
              ))}
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 2}
                  className="text-center text-muted-foreground py-4"
                >
                  Nenhuma linha adicionada
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, rowIndex) => {
                const calculatedTargets = getCalculatedTargets(row)

                return (
                  <TableRow key={rowIndex}>
                    <TableCell className="text-center text-muted-foreground">
                      {rowIndex + 1}
                    </TableCell>
                    {columns.map((col) => {
                      return (
                        <TableCell key={col.key} className="min-w-32 p-1">
                          {renderCellInput(
                            row,
                            rowIndex,
                            col,
                            calculatedTargets,
                          )}
                        </TableCell>
                      )
                    })}
                    <TableCell className="p-1">
                      {!hasFixedLoadPoints && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow(rowIndex)}
                          disabled={disabled}
                          className="h-8 w-8"
                        >
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            className="h-4 w-4"
                          />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      {!hasFixedLoadPoints && (
        <Button
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={disabled}
        >
          <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
          Adicionar Linha
        </Button>
      )}
    </div>
  )
}

/**
 * Number cell with certified values picker
 */
function NumberCellWithPicker({
  value,
  onChange,
  onBlur,
  disabled,
  certifiedValueOptions,
}: {
  value: unknown
  onChange: (val: number | string | null) => void
  onBlur?: (val: number | null) => void
  disabled: boolean
  certifiedValueOptions: CertifiedValueOption[]
}) {
  const [open, setOpen] = useState(false)

  // Group options by standard name
  const groupedOptions = certifiedValueOptions.reduce<
    Record<string, CertifiedValueOption[]>
  >((acc, opt) => {
    if (!acc[opt.standardName]) {
      acc[opt.standardName] = []
    }
    acc[opt.standardName].push(opt)
    return acc
  }, {})

  return (
    <div className="flex gap-1">
      <Input
        type="text"
        inputMode="decimal"
        value={value != null ? String(value) : ''}
        onChange={(e) => {
          const val = e.target.value
          // Allow empty, numbers, decimal points, and negative sign
          if (val === '' || /^-?\d*[.,]?\d*$/.test(val)) {
            const normalized = val.replace(',', '.')
            onChange(normalized === '' ? null : normalized)
          }
        }}
        onBlur={(e) => {
          // Parse to number on blur if valid
          const val = e.target.value.replace(',', '.')
          if (val !== '' && val !== '-' && val !== '.') {
            const parsed = parseFloat(val)
            if (!isNaN(parsed)) {
              onBlur?.(parsed)
            }
          } else {
            onBlur?.(null)
          }
        }}
        disabled={disabled}
        className="h-8 flex-1"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={(props) => (
            <Button
              {...props}
              variant="ghost"
              size="icon"
              disabled={disabled}
              className="h-8 w-8 shrink-0"
              title="Inserir valor certificado"
            >
              <HugeiconsIcon icon={ArrowDown01Icon} className="h-4 w-4" />
            </Button>
          )}
        />
        <PopoverContent align="end" className="w-64 p-2">
          <div className="space-y-2 max-h-48 overflow-auto">
            {Object.entries(groupedOptions).map(([standardName, options]) => (
              <div key={standardName}>
                <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                  {standardName}
                </p>
                {options.map((opt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm flex justify-between items-center"
                    onClick={() => {
                      onChange(opt.value)
                      setOpen(false)
                    }}
                  >
                    <span>{opt.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {opt.value.toFixed(5)} {opt.unit}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
