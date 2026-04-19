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
  resolveWeighingRange,
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

export function TableInputRenderer({
  field,
  value,
  onChange,
  disabled = false,
  certifiedValueOptions = [],
  massCompositionOptions = [],
  assetSpecifications,
}: TableInputRendererProps) {
  const rows = value || []
  const columns = field.columns || []
  const shouldUsePanelRows =
    columns.length > 5 ||
    columns.some((col) => col.role === 'mass_standard_composition')
  const hasCertifiedValues = certifiedValueOptions.length > 0
  const weighingRangeResolver =
    field.weighingRangeResolver?.enabled !== false
      ? field.weighingRangeResolver
      : undefined
  const weighingRangePointColumn = columns.find(
    (col) => col.key === weighingRangeResolver?.pointColumn,
  )

  const resolveRowWeighingRange = (
    row: Record<string, unknown>,
  ): ResolvedWeighingRange | null => {
    if (
      !weighingRangeResolver?.assetSpecKey ||
      !weighingRangeResolver.pointColumn
    ) {
      return null
    }

    return resolveWeighingRange(
      row[weighingRangeResolver.pointColumn],
      weighingRangeResolver.pointUnit ?? weighingRangePointColumn?.unit,
      assetSpecifications?.[weighingRangeResolver.assetSpecKey],
    )
  }

  const applyWeighingRangeResolver = (row: Record<string, unknown>) => {
    const resolved = resolveRowWeighingRange(row)
    const targetColumns = weighingRangeResolver?.targetColumns ?? {}
    if (!resolved || Object.keys(targetColumns).length === 0) {
      return row
    }

    const nextRow = { ...row }
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
    setRangeTargetValue(
      nextRow,
      columns,
      targetColumns,
      'resolution',
      resolved.resolution,
      resolved.resolutionUnit,
    )
    setRangeTargetValue(
      nextRow,
      columns,
      targetColumns,
      'resolutionUnit',
      resolved.resolutionUnit,
    )

    return nextRow
  }

  const addRow = () => {
    const newRow: Record<string, unknown> = {}
    for (const col of columns) {
      newRow[col.key] = col.type === 'number' ? null : ''
    }
    onChange([...rows, newRow])
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index))
  }

  const updateCell = (rowIndex: number, colKey: string, cellValue: unknown) => {
    const newRows = [...rows]
    newRows[rowIndex] = applyWeighingRangeResolver({
      ...newRows[rowIndex],
      [colKey]: cellValue,
    })
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
    newRows[rowIndex] = applyWeighingRangeResolver(nextRow)
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

    const resolvedRange = resolveRowWeighingRange(row)
    if (resolvedRange) {
      const targetColumns = weighingRangeResolver?.targetColumns ?? {}
      for (const targetKey of Object.values(targetColumns)) {
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

  const renderCellInput = (
    row: Record<string, unknown>,
    rowIndex: number,
    col: NonNullable<MethodInputField['columns']>[number],
    calculatedTargets: Set<string>,
  ) => {
    const isCalculatedTarget = calculatedTargets.has(col.key)
    const cellValue = row[col.key]
    const showPicker =
      col.type === 'number' &&
      hasCertifiedValues &&
      isStandardRefColumn(col.key, col.label)

    if (col.role === 'mass_standard_composition') {
      return (
        <MassCompositionCell
          value={row[col.key]}
          onChange={(val) => updateMassComposition(rowIndex, col.key, val)}
          options={massCompositionOptions}
          config={col.massComposition}
          disabled={disabled}
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
          disabled={disabled || isCalculatedTarget}
          className={`h-8 w-full ${isCalculatedTarget ? 'bg-muted/50' : ''}`}
          title={
            isCalculatedTarget ? 'Valor calculado automaticamente' : undefined
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
        disabled={disabled || isCalculatedTarget}
        className={`h-8 w-full ${isCalculatedTarget ? 'bg-muted/50' : ''}`}
        title={
          isCalculatedTarget ? 'Valor calculado automaticamente' : undefined
        }
      />
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

              return (
                <div key={rowIndex} className="rounded-md border p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-md bg-muted text-sm font-medium">
                        {rowIndex + 1}
                      </span>
                      <span className="text-sm font-medium">
                        Ponto {rowIndex + 1}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(rowIndex)}
                      disabled={disabled}
                      className="h-8 w-8"
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {columns.map((col) => {
                      const isComposition =
                        col.role === 'mass_standard_composition'
                      return (
                        <div
                          key={col.key}
                          className={
                            isComposition
                              ? 'space-y-1 md:col-span-2 xl:col-span-1'
                              : 'space-y-1'
                          }
                        >
                          <label className="text-xs font-medium text-muted-foreground">
                            {col.label}
                            {col.unit && (
                              <span className="font-normal"> ({col.unit})</span>
                            )}
                          </label>
                          {renderCellInput(
                            row,
                            rowIndex,
                            col,
                            calculatedTargets,
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={disabled}
        >
          <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
          Adicionar Linha
        </Button>
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
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      <Button variant="outline" size="sm" onClick={addRow} disabled={disabled}>
        <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
        Adicionar Linha
      </Button>
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
  const groupedOptions = certifiedValueOptions.reduce(
    (acc, opt) => {
      if (!acc[opt.standardName]) {
        acc[opt.standardName] = []
      }
      acc[opt.standardName].push(opt)
      return acc
    },
    {} as Record<string, CertifiedValueOption[]>,
  )

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
