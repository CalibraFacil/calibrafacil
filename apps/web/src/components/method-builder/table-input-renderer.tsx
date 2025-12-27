import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'

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

interface TableInputRendererProps {
  field: MethodInputField
  value: Array<Record<string, unknown>>
  onChange: (value: Array<Record<string, unknown>>) => void
  disabled?: boolean
}

export function TableInputRenderer({
  field,
  value,
  onChange,
  disabled = false,
}: TableInputRendererProps) {
  const rows = value || []
  const columns = field.columns || []

  const addRow = () => {
    const newRow: Record<string, unknown> = {}
    for (const col of columns) {
      newRow[col.key] = col.type === 'number' ? 0 : ''
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
                  {columns.map((col) => (
                    <TableCell key={col.key} className="p-1">
                      <Input
                        type={col.type}
                        step={col.type === 'number' ? 'any' : undefined}
                        value={row[col.key] != null ? String(row[col.key]) : ''}
                        onChange={(e) => {
                          const val = e.target.value
                          updateCell(
                            rowIndex,
                            col.key,
                            col.type === 'number'
                              ? val === ''
                                ? null
                                : parseFloat(val)
                              : val,
                          )
                        }}
                        disabled={disabled}
                        className="h-8"
                      />
                    </TableCell>
                  ))}
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
