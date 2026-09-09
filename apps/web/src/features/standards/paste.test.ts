import { describe, expect, it } from 'vitest'

import { applyPastedCertifiedValues, parsePastedCertifiedValues } from './paste'
import type { StandardCertifiedValueFormData } from './forms'

function emptyRow(): StandardCertifiedValueFormData {
  return {
    nominal: '',
    authentication: '',
    value: '',
    uncertainty: '',
    unit: '',
    maxError: '',
    drift: '',
    buoyancy: '',
    coverageFactor: '',
  }
}

describe('parsePastedCertifiedValues', () => {
  it('reads a tab-delimited spreadsheet selection', () => {
    const result = parsePastedCertifiedValues({
      text: '1 kg\tOIML E2\t1000,00012\t0,00050\tg',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual([
      {
        nominal: '1 kg',
        authentication: 'OIML E2',
        value: '1000.00012',
        uncertainty: '0.00050',
        unit: 'g',
      },
    ])
  })

  // Only through the paste and into the form. Saving converts these to numbers
  // and the reload stringifies them, so "10,00000" persists as 10. Pre-existing
  // to this paste; see the note in paste.ts.
  it('keeps every significant figure, swapping only the decimal separator', () => {
    // The trailing zeros state the resolution of the calibration. Parsing to a
    // number would drop them and understate what the certificate says; the
    // separator changes only because a number input cannot render a comma.
    const result = parsePastedCertifiedValues({ text: '2 kg\tE2\t2000,000000' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows[0].value).toBe('2000.000000')
  })

  it('refuses a numeric cell it cannot parse rather than hide it', () => {
    // A thousands separator is ambiguous and a number input would render the
    // result blank, so the value would sit in state invisibly.
    const result = parsePastedCertifiedValues({ text: '1 kg\tE2\t1.000,50' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('separador decimal')
  })

  it('accepts semicolons, since pt-BR decimals use the comma', () => {
    const result = parsePastedCertifiedValues({
      text: '500 g;E2;500,0001;0,0002',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows[0]).toEqual({
      nominal: '500 g',
      authentication: 'E2',
      value: '500.0001',
      uncertainty: '0.0002',
    })
  })

  it('pastes a single column into the middle of the table', () => {
    const result = parsePastedCertifiedValues({
      text: '0,00050\n0,00060',
      startColumnIndex: 3,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual([
      { uncertainty: '0.00050' },
      { uncertainty: '0.00060' },
    ])
  })

  it('refuses a ragged selection rather than transcribe half a certificate', () => {
    const result = parsePastedCertifiedValues({
      text: '1 kg\tE2\t1000,0001\n2 kg\tE2',
    })

    expect(result.ok).toBe(false)
  })

  it('refuses a selection wider than the table can hold', () => {
    const result = parsePastedCertifiedValues({
      text: 'a\tb\tc',
      startColumnIndex: 7,
    })

    expect(result.ok).toBe(false)
  })

  it('refuses an empty paste', () => {
    expect(parsePastedCertifiedValues({ text: '   \n  ' }).ok).toBe(false)
  })
})

describe('applyPastedCertifiedValues', () => {
  it('grows the table when the paste is longer than what is there', () => {
    const next = applyPastedCertifiedValues({
      current: [emptyRow()],
      parsed: [{ nominal: '1 kg' }, { nominal: '2 kg' }, { nominal: '5 kg' }],
      createEmptyRow: emptyRow,
    })

    expect(next).toHaveLength(3)
    expect(next.map((row) => row.nominal)).toEqual(['1 kg', '2 kg', '5 kg'])
  })

  it('leaves columns the paste did not cover untouched', () => {
    const current = [{ ...emptyRow(), nominal: '1 kg', unit: 'g' }]

    const next = applyPastedCertifiedValues({
      current,
      parsed: [{ uncertainty: '0.0005' }],
      createEmptyRow: emptyRow,
    })

    expect(next[0].nominal).toBe('1 kg')
    expect(next[0].unit).toBe('g')
    expect(next[0].uncertainty).toBe('0.0005')
  })

  it('starts at the row the paste was dropped on', () => {
    const next = applyPastedCertifiedValues({
      current: [
        { ...emptyRow(), nominal: 'primeira' },
        { ...emptyRow(), nominal: 'segunda' },
      ],
      parsed: [{ nominal: '10 kg' }],
      startRowIndex: 1,
      createEmptyRow: emptyRow,
    })

    expect(next[0].nominal).toBe('primeira')
    expect(next[1].nominal).toBe('10 kg')
  })
})
