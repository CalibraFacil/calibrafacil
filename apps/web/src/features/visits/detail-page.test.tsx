// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VisitRescheduleRequestBanner } from './detail-page'
import type { VisitPendingRescheduleRequest } from './types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a data-to={to} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

const REQUEST: VisitPendingRescheduleRequest = {
  id: 7,
  reason: 'Planta parada nesta semana',
  preferredWindows: [
    { date: '2026-08-10', period: 'MORNING' },
    { date: '2026-08-11', period: 'ANY' },
  ],
  createdAt: '2026-07-10T12:00:00.000Z',
  requestedByName: 'Maria do Cliente',
}

describe('VisitRescheduleRequestBanner (#739)', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the requester, reason and preferred windows', () => {
    render(
      <VisitRescheduleRequestBanner
        request={REQUEST}
        currentScheduledAt="2026-08-01T12:00:00.000Z"
        busy={false}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    )

    expect(screen.getByText('Cliente solicitou reagendamento')).toBeTruthy()
    expect(
      screen.getByText(/Maria do Cliente.*Planta parada nesta semana/),
    ).toBeTruthy()
    expect(screen.getByText(/Janelas preferidas/)).toBeTruthy()
  })

  it('prefills the accept date with the first preferred window and accepts with it', () => {
    const onAccept = vi.fn()
    render(
      <VisitRescheduleRequestBanner
        request={REQUEST}
        currentScheduledAt="2026-08-01T12:00:00.000Z"
        busy={false}
        onAccept={onAccept}
        onDecline={vi.fn()}
      />,
    )

    const dateInput = screen.getByLabelText('Nova data')
    expect(dateInput).toHaveProperty('value', '2026-08-10')

    fireEvent.click(screen.getByText('Aceitar e reagendar'))
    expect(onAccept).toHaveBeenCalledWith('2026-08-10')
  })

  it('falls back to the current visit date when the request has no windows', () => {
    render(
      <VisitRescheduleRequestBanner
        request={{ ...REQUEST, preferredWindows: [] }}
        currentScheduledAt="2026-08-01T12:00:00.000Z"
        busy={false}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    )

    const dateInput = screen.getByLabelText('Nova data')
    expect(dateInput).toHaveProperty('value', '2026-08-01')
  })

  it('disables actions while a mutation is running', () => {
    render(
      <VisitRescheduleRequestBanner
        request={REQUEST}
        currentScheduledAt={null}
        busy={true}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    )

    const accept = screen.getByText('Aceitar e reagendar').closest('button')
    const decline = screen.getByText('Recusar').closest('button')
    expect(accept?.disabled).toBe(true)
    expect(decline?.disabled).toBe(true)
  })
})
