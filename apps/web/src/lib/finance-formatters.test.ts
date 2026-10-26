import { describe, expect, it } from 'vitest'

import { formatFinanceDate, moneyFieldError } from './finance-formatters'

describe('formatFinanceDate (REQ-DATE-007)', () => {
  it('shows a due date stored at UTC midnight on the day that was typed', () => {
    // 20/05 at UTC midnight is the evening of 19/05 in Sao Paulo.
    expect(formatFinanceDate('2026-05-20T00:00:00.000Z')).toBe('20/05/2026')
    expect(formatFinanceDate(new Date('2026-05-20T00:00:00.000Z'))).toBe(
      '20/05/2026',
    )
  })

  it('shows a real moment on the laboratory day it happened', () => {
    // 23:30 -03:00 on 20/05 is 02:30Z on the 21st.
    expect(formatFinanceDate('2026-05-21T02:30:00.000Z')).toBe('20/05/2026')
    expect(formatFinanceDate('2026-05-20T15:00:00.000Z')).toBe('20/05/2026')
  })

  it('has a label for a missing or invalid value', () => {
    expect(formatFinanceDate(null)).toBe('Sem data')
    expect(formatFinanceDate('nope')).toBe('Sem data')
  })
})

describe('moneyFieldError', () => {
  it('is null for blank text and for anything that reads as an amount', () => {
    expect(moneyFieldError('')).toBeNull()
    expect(moneyFieldError('  ')).toBeNull()
    expect(moneyFieldError('1.234,56')).toBeNull()
    expect(moneyFieldError('12.50')).toBeNull()
  })

  it('explains text that does not read as an amount', () => {
    expect(moneyFieldError('abc')).toMatch(/inválido/)
    expect(moneyFieldError('1.234.56')).toMatch(/ambíguo/)
    expect(moneyFieldError('-5')).toMatch(/negativo/)
    expect(moneyFieldError('-5', { allowNegative: true })).toBeNull()
  })
})
