/**
 * Minimal dependency-free CSV parser for the migration importer (gap #12).
 *
 * Handles quoted fields, embedded delimiters/newlines, `""` escapes and CRLF.
 * Auto-detects the delimiter (`,` `;` or tab) from the header line — Brazilian
 * Excel exports default to `;`. Kept tiny on purpose: no new dependency (the repo
 * pins/forbids deps after supply-chain incidents).
 */

export type ParsedCsv = {
  headers: string[]
  rows: string[][]
  delimiter: string
}

const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const

function detectDelimiter(firstLine: string): string {
  let best = ','
  let bestCount = -1
  for (const candidate of CANDIDATE_DELIMITERS) {
    // Count only delimiters outside quotes on the header line.
    let count = 0
    let inQuotes = false
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === candidate && !inQuotes) count++
    }
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstNewline = text.indexOf('\n')
  const headerLine = firstNewline === -1 ? text : text.slice(0, firstNewline)
  const delimiter = detectDelimiter(headerLine)

  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      record.push(field)
      field = ''
    } else if (ch === '\n') {
      record.push(field)
      records.push(record)
      field = ''
      record = []
    } else {
      field += ch
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  // Drop blank lines (a single empty field).
  const nonEmpty = records.filter(
    (row) => !(row.length === 1 && row[0].trim() === ''),
  )
  if (nonEmpty.length === 0) return { headers: [], rows: [], delimiter }

  const [headerRow, ...dataRows] = nonEmpty
  return {
    headers: (headerRow ?? []).map((cell) => cell.trim()),
    rows: dataRows,
    delimiter,
  }
}

/**
 * Build objects keyed by target field from parsed rows + a mapping
 * (targetFieldKey → source header). Unmapped fields are emitted as "".
 */
export function applyMapping(
  parsed: ParsedCsv,
  mapping: Record<string, string>,
  fieldKeys: string[],
): Array<Record<string, string>> {
  const indexByHeader = new Map(
    parsed.headers.map((header, index) => [header, index] as const),
  )
  return parsed.rows.map((row) => {
    const mapped: Record<string, string> = {}
    for (const key of fieldKeys) {
      const header = mapping[key]
      const index = header ? indexByHeader.get(header) : undefined
      mapped[key] = index === undefined ? '' : (row[index] ?? '')
    }
    return mapped
  })
}
