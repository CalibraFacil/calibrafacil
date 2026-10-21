import { describe, expect, it } from 'vitest'

import {
  buildVisitAcceptRescheduleInput,
  buildVisitConfirmInput,
  buildVisitRescheduleInput,
  formatVisitDay,
  visitDateInputValue,
} from './forms'

describe('visit schedule dates (REQ-DATE-005)', () => {
  it('sends the typed day as an instant that still reads as that day', () => {
    // Bare "2026-08-10" is UTC midnight on the server: 09/08 21:00 in Brazil.
    const { scheduledAt } = buildVisitRescheduleInput('2026-08-10')
    expect(scheduledAt).not.toBe('2026-08-10')
    expect(scheduledAt).toBe('2026-08-10T15:00:00.000Z')
    expect(visitDateInputValue(scheduledAt)).toBe('2026-08-10')
    expect(
      new Date(scheduledAt ?? '').toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }),
    ).toBe('10/08/2026')
  })

  it('confirms with the same instant and the chosen technician', () => {
    expect(buildVisitConfirmInput('2026-08-10', 'tech-1')).toEqual({
      scheduledAt: '2026-08-10T15:00:00.000Z',
      technicianId: 'tech-1',
    })
    expect(buildVisitConfirmInput('', '')).toEqual({
      scheduledAt: null,
      technicianId: null,
    })
  })

  it('accepts a reschedule request with an instant, or not at all without a day', () => {
    expect(buildVisitAcceptRescheduleInput('2026-08-11')).toEqual({
      scheduledAt: '2026-08-11T15:00:00.000Z',
    })
    expect(buildVisitAcceptRescheduleInput('')).toBeNull()
  })
})

describe('visits stored at UTC midnight (REQ-DATE-007)', () => {
  // Visits scheduled before the day started travelling as local noon were
  // saved as the bare day: 10/08 at UTC midnight is 21:00 on 09/08 in Brazil.
  const stored = '2026-08-10T00:00:00.000Z'

  it('lists the visit on the day that was scheduled', () => {
    expect(formatVisitDay(stored)).toBe('10 de ago. de 2026')
    // A visit saved with the noon instant reads the same.
    expect(formatVisitDay('2026-08-10T15:00:00.000Z')).toBe(
      '10 de ago. de 2026',
    )
    expect(formatVisitDay(null)).toBe('A confirmar')
  })

  it('fills the reschedule field with the scheduled day, not the evening before', () => {
    expect(visitDateInputValue(stored)).toBe('2026-08-10')
    expect(visitDateInputValue('2026-08-10T15:00:00.000Z')).toBe('2026-08-10')
    expect(visitDateInputValue(null)).toBe('')
  })
})
