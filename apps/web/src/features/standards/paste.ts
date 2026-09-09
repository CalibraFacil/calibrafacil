import { parseNumericValue } from '@calibra-facil/shared'

import { parseClipboardMatrix } from '@/lib/clipboard-table'

import type { StandardCertifiedValueFormData } from './forms'

/**
 * Bulk paste for the certified values of a reference standard.
 *
 * A 20-piece weight set is 20 rows of figures transcribed from the standard's
 * own calibration certificate. Typing them cell by cell is the single largest
 * data-entry cost in setting a laboratory up, and it is pure transcription: the
 * lab already has the numbers, in a document, usually already in a spreadsheet.
 *
 * Values stay strings through the paste itself, so what the laboratory pasted
 * is what appears in the form. The one rewrite is the decimal separator: the
 * numeric cells render as `type="number"`, which cannot display a comma, so a
 * pt-BR "1000,00012" becomes "1000.00012". That is a change of notation, not of
 * value. A numeric cell that will not parse rejects the whole paste rather than
 * land in state where the input cannot show it, which is what a thousands
 * separator would otherwise do.
 *
 * ⚠️ Trailing zeros do NOT survive a save. `parseStandardForm` converts these
 * fields with `optionalNumber` and the reload maps them back with
 * `.toString()`, so a certified "10,00000" is stored as the number 10 and
 * reloads as "10". That is pre-existing behaviour of the standard form, not
 * something this paste introduced, and it is a real question for a certified
 * value: the trailing zeros state the resolution of the calibration. Fixing it
 * means persisting the transcribed representation alongside the number, which
 * is a schema change and a decision, not a tidy-up.
 */

/** The certified-value columns, in the order the table renders them. */
export const CERTIFIED_VALUE_PASTE_COLUMNS = [
  'nominal',
  'authentication',
  'value',
  'uncertainty',
  'unit',
  'maxError',
  'drift',
  'buoyancy',
  'coverageFactor',
] as const satisfies readonly (keyof StandardCertifiedValueFormData)[]

export type CertifiedValuePasteColumn =
  (typeof CERTIFIED_VALUE_PASTE_COLUMNS)[number]

/** Rendered as number inputs, so they cannot hold a comma. */
const NUMERIC_CERTIFIED_VALUE_COLUMNS: ReadonlySet<CertifiedValuePasteColumn> =
  new Set([
    'value',
    'uncertainty',
    'maxError',
    'drift',
    'buoyancy',
    'coverageFactor',
  ])

export type ParsedCertifiedValuePaste =
  | {
      ok: true
      /** One partial row per pasted line, keyed by the columns it covered. */
      rows: Array<Partial<StandardCertifiedValueFormData>>
      columnCount: number
    }
  | { ok: false; error: string }

/**
 * Parse pasted text into partial certified-value rows, starting at
 * `startColumnIndex` so a lab can paste a single column (just the uncertainties,
 * say) into the middle of the table.
 *
 * Rejected as a whole rather than partially applied, so a mis-selected range
 * never leaves half a certificate transcribed.
 */
export function parsePastedCertifiedValues({
  text,
  startColumnIndex = 0,
}: {
  text: string
  startColumnIndex?: number
}): ParsedCertifiedValuePaste {
  if (
    startColumnIndex < 0 ||
    startColumnIndex >= CERTIFIED_VALUE_PASTE_COLUMNS.length
  ) {
    return { ok: false, error: 'Coluna de destino inválida para a colagem.' }
  }

  const clipboard = parseClipboardMatrix(text)
  if (!clipboard.ok) {
    return { ok: false, error: clipboard.error }
  }

  if (
    startColumnIndex + clipboard.width >
    CERTIFIED_VALUE_PASTE_COLUMNS.length
  ) {
    return {
      ok: false,
      error:
        'O conteúdo colado tem mais colunas do que a tabela comporta a partir desta coluna.',
    }
  }

  const targetColumns = CERTIFIED_VALUE_PASTE_COLUMNS.slice(
    startColumnIndex,
    startColumnIndex + clipboard.width,
  )

  const rows: Array<Partial<StandardCertifiedValueFormData>> = []

  for (const cells of clipboard.rows) {
    const row: Partial<StandardCertifiedValueFormData> = {}

    for (const [columnOffset, column] of targetColumns.entries()) {
      const cell = (cells[columnOffset] ?? '').trim()

      if (cell === '' || !NUMERIC_CERTIFIED_VALUE_COLUMNS.has(column)) {
        row[column] = cell
        continue
      }

      const parsed = parseNumericValue(cell)
      if (parsed === null) {
        return {
          ok: false,
          error: `"${cell}" não é um número válido. Use ponto ou vírgula como separador decimal, sem separador de milhar.`,
        }
      }

      // Keep the digits the laboratory transcribed, swap only the separator.
      row[column] = cell.replace(',', '.')
    }

    rows.push(row)
  }

  return { ok: true, rows, columnCount: clipboard.width }
}

/**
 * Merge parsed rows over the existing ones, growing the table when the paste is
 * longer than what is there. Columns the paste did not cover keep their current
 * value, so pasting one column never blanks the rest of a row.
 */
export function applyPastedCertifiedValues({
  current,
  parsed,
  startRowIndex = 0,
  createEmptyRow,
}: {
  current: StandardCertifiedValueFormData[]
  parsed: Array<Partial<StandardCertifiedValueFormData>>
  startRowIndex?: number
  createEmptyRow: () => StandardCertifiedValueFormData
}): StandardCertifiedValueFormData[] {
  const next = [...current]

  parsed.forEach((patch, offset) => {
    const targetIndex = startRowIndex + offset
    while (next.length <= targetIndex) {
      next.push(createEmptyRow())
    }
    next[targetIndex] = { ...next[targetIndex], ...patch }
  })

  return next
}
