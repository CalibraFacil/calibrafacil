import { describe, expect, it } from 'vitest'

import { buildAssetCalibrationStatus, formatDate } from './detail-model'

// Local noon "today". Exact day-count cases build their target dates from local
// components too, so the diffs stay timezone-independent.
const NOW = new Date(2026, 4, 25, 12, 0, 0)
const localDate = (year: number, month1: number, day: number) =>
  new Date(year, month1 - 1, day)

describe('buildAssetCalibrationStatus', () => {
  it('flags a comfortably future calibration as valid', () => {
    const status = buildAssetCalibrationStatus(
      { status: 'ACTIVE', nextCalibrationDate: localDate(2026, 12, 1) },
      NOW,
    )
    expect(status.level).toBe('valid')
    expect(status.tone).toBe('ok')
    expect(status.daysUntilNext).toBeGreaterThan(30)
  })

  it('flags a calibration within 30 days as due soon', () => {
    const status = buildAssetCalibrationStatus(
      { status: 'ACTIVE', nextCalibrationDate: localDate(2026, 6, 10) },
      NOW,
    )
    expect(status.level).toBe('due_soon')
    expect(status.tone).toBe('warning')
    expect(status.daysUntilNext).toBe(16)
  })

  it('treats a calibration due today as due soon with a tailored message', () => {
    const status = buildAssetCalibrationStatus(
      { status: 'ACTIVE', nextCalibrationDate: localDate(2026, 5, 25) },
      NOW,
    )
    expect(status.level).toBe('due_soon')
    expect(status.daysUntilNext).toBe(0)
    expect(status.description).toContain('hoje')
  })

  it('flags a past calibration as overdue with a negative day count', () => {
    const status = buildAssetCalibrationStatus(
      { status: 'ACTIVE', nextCalibrationDate: localDate(2026, 5, 20) },
      NOW,
    )
    expect(status.level).toBe('overdue')
    expect(status.tone).toBe('critical')
    expect(status.daysUntilNext).toBe(-5)
    expect(status.description).toContain('5 dias')
  })

  it('singularizes the overdue message for a one-day lapse', () => {
    const status = buildAssetCalibrationStatus(
      { status: 'ACTIVE', nextCalibrationDate: localDate(2026, 5, 24) },
      NOW,
    )
    expect(status.description).toContain('1 dia.')
  })

  it('returns unscheduled when no next calibration is set', () => {
    const status = buildAssetCalibrationStatus(
      { status: 'ACTIVE', nextCalibrationDate: null },
      NOW,
    )
    expect(status.level).toBe('unscheduled')
    expect(status.daysUntilNext).toBeNull()
  })

  it('marks scrapped instruments as retired regardless of dates', () => {
    const status = buildAssetCalibrationStatus(
      { status: 'SCRAPPED', nextCalibrationDate: localDate(2027, 1, 1) },
      NOW,
    )
    expect(status.level).toBe('retired')
    expect(status.daysUntilNext).toBeNull()
  })
})

describe('formatDate', () => {
  it('renders an em dash for empty or invalid values', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('not-a-date')).toBe('—')
  })

  it('formats valid dates in pt-BR', () => {
    expect(formatDate(new Date(2026, 4, 25))).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })
})
