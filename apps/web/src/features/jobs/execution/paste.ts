import { parseNumericValue } from '@calibra-facil/shared/units'
import type { MethodTableColumn } from '@/components/method-runtime/types'
import { parseClipboardMatrix } from '@/lib/clipboard-table'

export function toRecordArray(
  value: unknown[],
): Array<Record<string, unknown>> {
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    return [Object.fromEntries(Object.entries(item))]
  })
}

export function isNumericString(value: string) {
  return /^-?\d*\.?\d+$/.test(value)
}

/**
 * Structured / calculated table columns whose value is not a free-entry scalar
 * (a reference-standard composition or certified-value binding). Bulk paste is
 * refused for these so a raw pasted number can never clobber a structured cell.
 */
function isBulkPasteBlockedColumn(column: MethodTableColumn): boolean {
  return (
    column.role === 'mass_standard_composition' ||
    column.role === 'standard_value'
  )
}

export type ParsePastedReadingsResult =
  | {
      ok: true
      rows: Array<Record<string, unknown>>
      rowCount: number
      columnCount: number
    }
  | { ok: false; error: string }

/**
 * Pure parser for a bulk paste into the method-execution readings table.
 *
 * Splits tab-delimited (spreadsheet/TSV — the primary path), semicolon-delimited
 * (pt-BR CSV, since comma is the decimal separator) or single-column
 * newline-only clipboard text into a rows × columns matrix, then validates it
 * against the method's column schema starting at `startColumnIndex`:
 *
 * - number columns parse pt-BR/dot decimals via the shared `parseNumericValue`
 *   (same semantics as the cell editor); empty cells become `null`.
 * - text columns keep the trimmed string.
 *
 * The paste is REJECTED (never partially applied) when it is empty, ragged,
 * wider than the table can hold from the start column, targets a structured
 * column, or contains a non-numeric value in a number column. Rejection returns
 * `{ ok: false }` so the caller can flag it and leave existing readings intact.
 *
 * Each returned row only carries the keys for the columns it covers — the caller
 * merges them into existing rows via {@link applyPastedReadings}.
 */
export function parsePastedReadings({
  text,
  columns,
  startColumnIndex = 0,
}: {
  text: string
  columns: MethodTableColumn[]
  startColumnIndex?: number
}): ParsePastedReadingsResult {
  if (columns.length === 0) {
    return { ok: false, error: 'A tabela não possui colunas definidas.' }
  }

  if (startColumnIndex < 0 || startColumnIndex >= columns.length) {
    return { ok: false, error: 'Coluna de destino inválida para a colagem.' }
  }

  const clipboard = parseClipboardMatrix(text)
  if (!clipboard.ok) {
    return { ok: false, error: clipboard.error }
  }
  const { rows: matrix, width } = clipboard

  if (startColumnIndex + width > columns.length) {
    return {
      ok: false,
      error:
        'O conteúdo colado tem mais colunas do que a tabela comporta a partir desta coluna.',
    }
  }

  const targetColumns = columns.slice(
    startColumnIndex,
    startColumnIndex + width,
  )

  const blockedColumn = targetColumns.find(isBulkPasteBlockedColumn)
  if (blockedColumn) {
    return {
      ok: false,
      error: `Não é possível colar valores na coluna "${blockedColumn.label}" (preenchida automaticamente).`,
    }
  }

  const rows: Array<Record<string, unknown>> = []
  for (const cells of matrix) {
    const row: Record<string, unknown> = {}
    for (let columnOffset = 0; columnOffset < width; columnOffset++) {
      const column = targetColumns[columnOffset]
      const rawCell = cells[columnOffset] ?? ''
      const trimmed = rawCell.trim()

      if (column.type === 'number') {
        if (trimmed === '') {
          row[column.key] = null
          continue
        }
        const parsed = parseNumericValue(trimmed)
        if (parsed == null) {
          return {
            ok: false,
            error: `Valor não numérico na coluna "${column.label}": "${trimmed}".`,
          }
        }
        row[column.key] = parsed
        continue
      }

      row[column.key] = trimmed
    }
    rows.push(row)
  }

  return { ok: true, rows, rowCount: rows.length, columnCount: width }
}

/**
 * Pure merge of parsed bulk-paste rows into the existing readings, starting at
 * `startRowIndex`. Existing cells outside the pasted region are preserved; rows
 * beyond the current length are created blank (number → `null`, text → `''`,
 * matching the "Adicionar Linha" initializer) before the parsed cells overlay
 * them. Never mutates the input arrays or row objects.
 */
export function applyPastedReadings({
  existingRows,
  parsedRows,
  startRowIndex,
  columns,
}: {
  existingRows: Array<Record<string, unknown>>
  parsedRows: Array<Record<string, unknown>>
  startRowIndex: number
  columns: MethodTableColumn[]
}): Array<Record<string, unknown>> {
  const blankRow = (): Record<string, unknown> =>
    Object.fromEntries(
      columns.map((column) => [
        column.key,
        column.type === 'number' ? null : '',
      ]),
    )

  const totalLength = Math.max(
    existingRows.length,
    startRowIndex + parsedRows.length,
  )

  const result: Array<Record<string, unknown>> = []
  for (let rowIndex = 0; rowIndex < totalLength; rowIndex++) {
    const existing = existingRows[rowIndex]
    result.push(existing ? { ...existing } : blankRow())
  }

  parsedRows.forEach((parsedRow, parsedIndex) => {
    const targetIndex = startRowIndex + parsedIndex
    result[targetIndex] = { ...result[targetIndex], ...parsedRow }
  })

  return result
}
