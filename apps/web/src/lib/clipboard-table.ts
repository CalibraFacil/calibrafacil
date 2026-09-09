/**
 * Splitting pasted spreadsheet text into a rectangular matrix of raw cells.
 *
 * Shared by the method-execution readings table and the reference-standard
 * certified-values table. It deliberately stops at strings: what a cell *means*
 * differs between those two callers, and one of them must not coerce.
 *
 * A method reading is a number the engine will consume, so that caller parses
 * to `number`. A certified value is a figure transcribed from the standard's
 * own calibration certificate, where "10,00000" and "10" are not the same
 * statement about the measurement, so that caller keeps the string exactly as
 * the laboratory typed it. Coercing there would silently drop significant
 * figures out of an uncertainty budget.
 */

export type ClipboardMatrix =
  | { ok: true; rows: string[][]; width: number }
  | { ok: false; error: string }

/**
 * Tab-delimited is the spreadsheet path. Semicolon is pt-BR CSV, where the
 * comma is already the decimal separator. A single column pastes as plain
 * newline-separated lines.
 */
export function parseClipboardMatrix(text: string): ClipboardMatrix {
  const normalizedText = text.replace(/\r\n?/g, '\n')
  const lines = normalizedText.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  // `every` is true for an empty array, so this covers "no lines at all" too.
  if (lines.every((line) => line.trim() === '')) {
    return { ok: false, error: 'Nada para colar.' }
  }

  const delimiter = lines.some((line) => line.includes('\t'))
    ? '\t'
    : lines.some((line) => line.includes(';'))
      ? ';'
      : null

  const rows = lines.map((line) => (delimiter ? line.split(delimiter) : [line]))

  const width = rows[0].length
  if (!rows.every((cells) => cells.length === width)) {
    return {
      ok: false,
      error:
        'O conteúdo colado tem um número irregular de colunas. Verifique a seleção na planilha.',
    }
  }

  return { ok: true, rows, width }
}
