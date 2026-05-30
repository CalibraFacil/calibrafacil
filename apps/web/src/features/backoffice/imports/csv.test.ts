import { describe, expect, it } from 'vitest'

import { applyMapping, parseCsv } from './csv'

describe('parseCsv (papaparse wrapper)', () => {
  it('shapes the first row as headers and the rest as positional rows', () => {
    const result = parseCsv('tag,name\nBAL-1,Balança\nBAL-2,Paquímetro')
    expect(result.headers).toEqual(['tag', 'name'])
    expect(result.rows).toEqual([
      ['BAL-1', 'Balança'],
      ['BAL-2', 'Paquímetro'],
    ])
  })

  it('auto-detects the semicolon delimiter (BR Excel)', () => {
    const result = parseCsv('tag;name;model\nBAL-1;Balança;XPE205')
    expect(result.delimiter).toBe(';')
    expect(result.headers).toEqual(['tag', 'name', 'model'])
    expect(result.rows).toEqual([['BAL-1', 'Balança', 'XPE205']])
  })

  it('handles quoted fields with embedded delimiters and newlines', () => {
    const result = parseCsv('tag,name\n"BAL,1","linha 1\nlinha 2"')
    expect(result.rows).toEqual([['BAL,1', 'linha 1\nlinha 2']])
  })

  it('skips empty lines', () => {
    const result = parseCsv('tag,name\nBAL-1,Balança\n\n')
    expect(result.rows).toEqual([['BAL-1', 'Balança']])
  })

  it('returns empty headers/rows for blank input', () => {
    const result = parseCsv('   ')
    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
  })
})

describe('applyMapping', () => {
  it('maps source columns onto target field keys, filling unmapped with empty', () => {
    const parsed = parseCsv('Etiqueta,Descrição\nBAL-1,Balança')
    const mapped = applyMapping(
      parsed,
      { tag: 'Etiqueta', name: 'Descrição' },
      ['tag', 'name', 'serialNumber'],
    )
    expect(mapped).toEqual([{ tag: 'BAL-1', name: 'Balança', serialNumber: '' }])
  })
})
