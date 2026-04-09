import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons'

import type { MethodInputField } from './types'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  label: string       // e.g., "100g"
  value: number       // e.g., 100.00015
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

export function TableInputRenderer({
  field,
  value,
  onChange,
  disabled = false,
  certifiedValueOptions = [],
}: TableInputRendererProps) {
  const rows = value || []
  const columns = field.columns || []
  const hasCertifiedValues = certifiedValueOptions.length > 0

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
    newRows[rowIndex] = { ...newRows[rowIndex], [colKey]: cellValue }
    onChange(newRows)
  }

  if (columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Tabela sem colunas definidas.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="border rounded overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              {columns.map((col) => (
                <TableHead key={col.key}>
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
              rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  <TableCell className="text-center text-muted-foreground">
                    {rowIndex + 1}
                  </TableCell>
                  {columns.map((col) => {
                    // Show picker only for number columns with standard/reference-related names
                    const showPicker =
                      col.type === 'number' &&
                      hasCertifiedValues &&
                      isStandardRefColumn(col.key, col.label)

                    return (
                      <TableCell key={col.key} className="p-1">
                        {showPicker ? (
                          <NumberCellWithPicker
                            value={row[col.key]}
                            onChange={(val) => updateCell(rowIndex, col.key, val)}
                            onBlur={(val) => updateCell(rowIndex, col.key, val)}
                            disabled={disabled}
                            certifiedValueOptions={certifiedValueOptions}
                          />
                        ) : col.type === 'number' ? (
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={row[col.key] != null ? String(row[col.key]) : ''}
                            onChange={(e) => {
                              const val = e.target.value
                              // Allow empty, numbers, decimal points, and negative sign
                              if (val === '' || /^-?\d*[.,]?\d*$/.test(val)) {
                                const normalized = val.replace(',', '.')
                                updateCell(rowIndex, col.key, normalized === '' ? null : normalized)
                              }
                            }}
                            onBlur={(e) => {
                              // Parse to number on blur if valid
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
                            disabled={disabled}
                            className="h-8"
                          />
                        ) : (
                          <Input
                            type={col.type}
                            value={row[col.key] != null ? String(row[col.key]) : ''}
                            onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                            disabled={disabled}
                            className="h-8"
                          />
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
                      <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
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

