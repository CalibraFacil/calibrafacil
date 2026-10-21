import { describe, expect, it } from 'vitest'

describe('test time zone', () => {
  it('runs in the laboratory time zone whatever the machine uses', () => {
    // UTC-3 all year (Brazil dropped daylight saving in 2019).
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(180)
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(180)
    expect(new Date(2026, 4, 20).toISOString()).toBe('2026-05-20T03:00:00.000Z')
  })
})
