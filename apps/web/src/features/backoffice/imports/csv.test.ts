import { describe, expect, it } from 'vitest'

import { applyMapping, parseCsv } from './csv'

describe('parseCsv', () => {
  it('parses a simple comma file with headers', () => {
    const result = parseCsv('tag,name\nBAL-1,Balança\nBAL-2,Paquímetro')
    expect(result.delimiter).toBe(',')
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

  it('handles quoted fields with embedded delimiters and escaped quotes', () => {
    const result = parseCsv('tag,name\n"BAL,1","Diz ""olá"""')
    expect(result.rows).toEqual([['BAL,1', 'Diz "olá"']])
  })

  it('handles quoted fields with embedded newlines', () => {
    const result = parseCsv('tag,name\nBAL-1,"linha 1\nlinha 2"')
    expect(result.rows).toEqual([['BAL-1', 'linha 1\nlinha 2']])
  })

  it('handles CRLF line endings and drops blank lines', () => {
    const result = parseCsv('tag,name\r\nBAL-1,Balança\r\n\r\n')
    expect(result.headers).toEqual(['tag', 'name'])
    expect(result.rows).toEqual([['BAL-1', 'Balança']])
  })

  it('returns empty result for empty input', () => {
    expect(parseCsv('   ')).toEqual({ headers: [], rows: [], delimiter: ',' })
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
