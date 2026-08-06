// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Calendar } from './calendar'

// react-day-picker defaults to en-US; the product is pt-BR everywhere, so the
// default locale is asserted here rather than left to each call site.
describe('Calendar locale', () => {
  it('renders the month caption in pt-BR', () => {
    const { container } = render(
      <Calendar mode="single" month={new Date(2026, 7, 5)} />,
    )

    expect(screen.getByText(/agosto 2026/i)).toBeTruthy()
    expect(screen.queryByText(/August 2026/i)).toBeNull()
    expect(
      container.querySelector('[data-slot=calendar]')?.getAttribute('lang'),
    ).toBe('pt-BR')
  })

  it('renders weekday headers in pt-BR', () => {
    const { container } = render(
      <Calendar mode="single" month={new Date(2026, 7, 5)} />,
    )

    const weekdays = [...container.querySelectorAll('thead th')].map((cell) =>
      (cell.textContent ?? '').trim().toLowerCase(),
    )

    expect(weekdays.length).toBeGreaterThan(0)
    // "Su Mo Tu We Th Fr Sa" was the bug; pt-BR abbreviations start with d/s/t/q.
    expect(weekdays.join(' ')).not.toMatch(/\b(su|mo|tu|we|th|fr|sa)\b/)
    expect(weekdays.some((day) => day.startsWith('d'))).toBe(true)
    expect(weekdays.some((day) => day.startsWith('q'))).toBe(true)
  })
})
