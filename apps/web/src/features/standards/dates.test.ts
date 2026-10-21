import { describe, expect, it } from 'vitest'

import { formatStandardDate, standardDateInputValue } from './dates'

describe('formatStandardDate (REQ-DATE-007)', () => {
  it('shows a calibration date stored at UTC midnight on the day that was typed', () => {
    // 15/10 at UTC midnight is 21:00 on 14/10 in Sao Paulo.
    expect(formatStandardDate('2026-10-15T00:00:00.000Z')).toBe('15/10/2026')
    expect(formatStandardDate(new Date('2026-10-15T00:00:00.000Z'))).toBe(
      '15/10/2026',
    )
    // What `new Date(value).toLocaleDateString('pt-BR')` printed before.
    expect(
      new Date('2026-10-15T00:00:00.000Z').toLocaleDateString('pt-BR'),
    ).toBe('14/10/2026')
  })

  it('shows a recall window that ends now on the laboratory day', () => {
    // Default recall window end: an instant at 23:30 -03:00 on 15/10.
    expect(formatStandardDate('2026-10-16T02:30:00.000Z')).toBe('15/10/2026')
  })

  it('shows a dash when there is no date', () => {
    expect(formatStandardDate(null)).toBe('—')
    expect(formatStandardDate('nope')).toBe('—')
  })
})

describe('standardDateInputValue (REQ-DATE-007)', () => {
  it('fills the recall window fields with the days the bounds name', () => {
    // From: the standard's calibration date, at UTC midnight.
    expect(standardDateInputValue('2026-10-15T00:00:00.000Z')).toBe(
      '2026-10-15',
    )
    // To typed as end of day (23:59:59.999Z) and to defaulted to now (23:30 -03:00).
    expect(standardDateInputValue('2026-10-20T23:59:59.999Z')).toBe(
      '2026-10-20',
    )
    expect(standardDateInputValue('2026-10-21T02:30:00.000Z')).toBe(
      '2026-10-20',
    )
  })
})
