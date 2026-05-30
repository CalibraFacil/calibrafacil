import Papa from 'papaparse'

/**
 * CSV handling for the migration importer (gap #12). Parsing is delegated to
 * papaparse (delimiter auto-detection, quotes, embedded newlines, CRLF) — we only
 * keep the thin "first row = headers" shaping and the column→field mapping here.
 */

export type ParsedCsv = {
  headers: string[]
  rows: string[][]
  delimiter: string
}

export function parseCsv(input: string): ParsedCsv {
  const result = Papa.parse<string[]>(input, {
    skipEmptyLines: 'greedy',
    // header:false → rows come back as positional string arrays.
  })
  const data = result.data
  const delimiter = result.meta.delimiter || ','
  if (data.length === 0) return { headers: [], rows: [], delimiter }

  const [headerRow, ...dataRows] = data
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
