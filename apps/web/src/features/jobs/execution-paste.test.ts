import { describe, expect, it } from 'vitest'

import type { MethodTableColumn } from '@/components/method-runtime/types'

import { applyPastedReadings, parsePastedReadings } from './execution'

function col(
  key: string,
  overrides: Partial<MethodTableColumn> = {},
): MethodTableColumn {
  return {
    key,
    label: overrides.label ?? key,
    type: overrides.type ?? 'number',
    ...overrides,
  }
}

const NUMBER_PAIR: MethodTableColumn[] = [
  col('nominal', { label: 'Nominal' }),
  col('leitura', { label: 'Leitura' }),
]

function expectOk(result: ReturnType<typeof parsePastedReadings>) {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`)
  }
  return result
}

describe('REQ-DOM-INP-001 parsePastedReadings fills rows and columns', () => {
  it('REQ-DOM-INP-001 parses a tab-delimited matrix into structured numeric rows', () => {
    const result = parsePastedReadings({
      text: '10\t20\n11\t21\n12\t22',
      columns: NUMBER_PAIR,
    })

    const ok = expectOk(result)
    expect(ok.rows).toEqual([
      { nominal: 10, leitura: 20 },
      { nominal: 11, leitura: 21 },
      { nominal: 12, leitura: 22 },
    ])
    expect(ok.rowCount).toBe(3)
    expect(ok.columnCount).toBe(2)
  })

  it('REQ-DOM-INP-001 parses pt-BR comma decimals into numbers', () => {
    const result = parsePastedReadings({
      text: '10,5\t20,25\n-3,75\t0,001',
      columns: NUMBER_PAIR,
    })

    const ok = expectOk(result)
    expect(ok.rows).toEqual([
      { nominal: 10.5, leitura: 20.25 },
      { nominal: -3.75, leitura: 0.001 },
    ])
  })

  it('REQ-DOM-INP-001 fills a single number column from a newline-only paste', () => {
    const result = parsePastedReadings({
      text: '1\n2\n3',
      columns: [col('leitura')],
    })

    const ok = expectOk(result)
    expect(ok.rows).toEqual([{ leitura: 1 }, { leitura: 2 }, { leitura: 3 }])
    expect(ok.columnCount).toBe(1)
  })

  it('REQ-DOM-INP-001 starts filling at the requested column offset', () => {
    const columns = [
      col('ponto', { label: 'Ponto', type: 'text' }),
      col('antes', { label: 'Antes' }),
      col('apos', { label: 'Após' }),
    ]

    const result = parsePastedReadings({
      text: '10\t11\n20\t21',
      columns,
      startColumnIndex: 1,
    })

    const ok = expectOk(result)
    expect(ok.rows).toEqual([
      { antes: 10, apos: 11 },
      { antes: 20, apos: 21 },
    ])
    // The offset (text) column is intentionally left untouched by the parser.
    expect(ok.rows[0]).not.toHaveProperty('ponto')
  })

  it('REQ-DOM-INP-001 keeps text columns as strings and parses number columns', () => {
    const columns = [
      col('posicao', { label: 'Posição', type: 'text' }),
      col('valor', { label: 'Valor' }),
    ]

    const result = parsePastedReadings({
      text: 'A\t12,5\nB\t13,0',
      columns,
    })

    const ok = expectOk(result)
    expect(ok.rows).toEqual([
      { posicao: 'A', valor: 12.5 },
      { posicao: 'B', valor: 13 },
    ])
  })

  it('REQ-DOM-INP-001 normalizes CRLF line endings and drops a trailing empty line', () => {
    const result = parsePastedReadings({
      text: '10\t20\r\n11\t21\r\n',
      columns: NUMBER_PAIR,
    })

    const ok = expectOk(result)
    expect(ok.rows).toEqual([
      { nominal: 10, leitura: 20 },
      { nominal: 11, leitura: 21 },
    ])
  })

  it('REQ-DOM-INP-001 treats empty/partial cells in number columns as null', () => {
    const result = parsePastedReadings({
      text: '10\t\n\t20',
      columns: NUMBER_PAIR,
    })

    const ok = expectOk(result)
    expect(ok.rows).toEqual([
      { nominal: 10, leitura: null },
      { nominal: null, leitura: 20 },
    ])
  })

  it('REQ-DOM-INP-001 accepts a semicolon-delimited (pt-BR CSV) matrix', () => {
    const result = parsePastedReadings({
      text: '10;20\n11;21',
      columns: NUMBER_PAIR,
    })

    const ok = expectOk(result)
    expect(ok.rows).toEqual([
      { nominal: 10, leitura: 20 },
      { nominal: 11, leitura: 21 },
    ])
  })
})

describe('REQ-DOM-INP-002 parsePastedReadings rejects schema mismatches', () => {
  it('REQ-DOM-INP-002 rejects ragged rows with inconsistent column counts', () => {
    const result = parsePastedReadings({
      text: '10\t20\n11\t21\t22',
      columns: NUMBER_PAIR,
    })

    expect(result.ok).toBe(false)
  })

  it('REQ-DOM-INP-002 rejects content wider than the table can hold', () => {
    const result = parsePastedReadings({
      text: '10\t20\t30',
      columns: NUMBER_PAIR,
    })

    expect(result.ok).toBe(false)
  })

  it('REQ-DOM-INP-002 rejects content that overflows past the start column', () => {
    const result = parsePastedReadings({
      text: '10\t20',
      columns: NUMBER_PAIR,
      startColumnIndex: 1,
    })

    expect(result.ok).toBe(false)
  })

  it('REQ-DOM-INP-002 rejects a non-numeric value in a number column and names it', () => {
    const result = parsePastedReadings({
      text: '10\tabc',
      columns: NUMBER_PAIR,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Leitura')
    }
  })

  it('REQ-DOM-INP-002 rejects pasting into a mass-composition column', () => {
    const columns = [
      col('composicao', {
        label: 'Composição',
        type: 'number',
        role: 'mass_standard_composition',
      }),
      col('leitura', { label: 'Leitura' }),
    ]

    const result = parsePastedReadings({
      text: '100\t20',
      columns,
    })

    expect(result.ok).toBe(false)
  })

  it('REQ-DOM-INP-002 rejects pasting into a standard_value column', () => {
    const columns = [
      col('padrao', {
        label: 'Padrão',
        type: 'number',
        role: 'standard_value',
      }),
      col('leitura', { label: 'Leitura' }),
    ]

    const result = parsePastedReadings({ text: '100\t20', columns })

    expect(result.ok).toBe(false)
  })

  it('REQ-DOM-INP-002 rejects empty/whitespace-only paste', () => {
    expect(parsePastedReadings({ text: '', columns: NUMBER_PAIR }).ok).toBe(
      false,
    )
    expect(
      parsePastedReadings({ text: '   \n  ', columns: NUMBER_PAIR }).ok,
    ).toBe(false)
  })

  it('REQ-DOM-INP-002 rejects when the table has no columns', () => {
    expect(parsePastedReadings({ text: '10\t20', columns: [] }).ok).toBe(false)
  })
})

describe('REQ-DOM-INP-002 applyPastedReadings preserves existing readings', () => {
  it('REQ-DOM-INP-002 overlays parsed cells without touching other columns', () => {
    const existing = [
      { ponto: 'A', antes: 1, apos: 2 },
      { ponto: 'B', antes: 3, apos: 4 },
    ]
    const columns = [
      col('ponto', { label: 'Ponto', type: 'text' }),
      col('antes', { label: 'Antes' }),
      col('apos', { label: 'Após' }),
    ]

    const merged = applyPastedReadings({
      existingRows: existing,
      parsedRows: [
        { antes: 10, apos: 20 },
        { antes: 30, apos: 40 },
      ],
      startRowIndex: 0,
      columns,
    })

    expect(merged).toEqual([
      { ponto: 'A', antes: 10, apos: 20 },
      { ponto: 'B', antes: 30, apos: 40 },
    ])
  })

  it('REQ-DOM-INP-002 does not mutate the existing rows (pure merge)', () => {
    const existing = [{ nominal: 1, leitura: 2 }]
    const snapshot = structuredClone(existing)

    applyPastedReadings({
      existingRows: existing,
      parsedRows: [{ nominal: 9, leitura: 9 }],
      startRowIndex: 0,
      columns: NUMBER_PAIR,
    })

    expect(existing).toEqual(snapshot)
  })

  it('REQ-DOM-INP-001 extends the table with blank rows when the paste overflows', () => {
    const merged = applyPastedReadings({
      existingRows: [{ nominal: 1, leitura: 2 }],
      parsedRows: [
        { nominal: 10, leitura: 20 },
        { nominal: 11, leitura: 21 },
        { nominal: 12, leitura: 22 },
      ],
      startRowIndex: 0,
      columns: NUMBER_PAIR,
    })

    expect(merged).toEqual([
      { nominal: 10, leitura: 20 },
      { nominal: 11, leitura: 21 },
      { nominal: 12, leitura: 22 },
    ])
  })

  it('REQ-DOM-INP-001 fills blank rows for a mid-table paste and initializes new cells', () => {
    const columns = [
      col('ponto', { label: 'Ponto', type: 'text' }),
      col('leitura', { label: 'Leitura' }),
    ]

    const merged = applyPastedReadings({
      existingRows: [{ ponto: 'A', leitura: 1 }],
      parsedRows: [{ leitura: 50 }, { leitura: 60 }],
      startRowIndex: 1,
      columns,
    })

    expect(merged).toEqual([
      { ponto: 'A', leitura: 1 },
      { ponto: '', leitura: 50 },
      { ponto: '', leitura: 60 },
    ])
  })

  it('REQ-DOM-INP-001 fills an empty table from a paste at row 0', () => {
    const merged = applyPastedReadings({
      existingRows: [],
      parsedRows: [
        { nominal: 10, leitura: 20 },
        { nominal: 11, leitura: 21 },
      ],
      startRowIndex: 0,
      columns: NUMBER_PAIR,
    })

    expect(merged).toEqual([
      { nominal: 10, leitura: 20 },
      { nominal: 11, leitura: 21 },
    ])
  })
})
