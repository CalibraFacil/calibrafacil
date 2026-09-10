// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ getCashForecast: vi.fn() }))

vi.mock('@/utils/api', () => ({
  calibraApi: { finance: { getCashForecast: mocks.getCashForecast } },
}))

import { CashForecastPage } from './cash-forecast-page'

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function emptyEnvelope() {
  return {
    buckets: {
      OVERDUE: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      THIS_WEEK: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      NEXT_WEEK: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      IN_30_DAYS: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      IN_60_DAYS: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      IN_90_DAYS: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
    },
    totals: { confirmedCents: 0, projectedCents: 0, overdueCents: 0 },
  }
}

afterEach(() => {
  cleanup()
  mocks.getCashForecast.mockReset()
})

describe('CashForecastPage', () => {
  it('renders all 5 forward bucket cards with provider-neutral labels', async () => {
    mocks.getCashForecast.mockResolvedValueOnce(emptyEnvelope())
    renderWithClient(<CashForecastPage />)
    expect(await screen.findByText('Esta semana')).toBeTruthy()
    expect(screen.getByText('Próxima semana')).toBeTruthy()
    expect(screen.getByText('Em 30 dias')).toBeTruthy()
    expect(screen.getByText('Em 60 dias')).toBeTruthy()
    expect(screen.getByText('Em 90 dias')).toBeTruthy()
  })

  it('hides the overdue chip when there are no overdue cents', async () => {
    mocks.getCashForecast.mockResolvedValueOnce(emptyEnvelope())
    renderWithClient(<CashForecastPage />)
    await screen.findByText('Esta semana')
    expect(screen.queryByTestId('cash-forecast-overdue')).toBeNull()
  })

  it('shows the overdue chip when totals.overdueCents > 0', async () => {
    const env = emptyEnvelope()
    env.totals.overdueCents = 50_000
    env.buckets.OVERDUE = {
      confirmedCents: 50_000,
      projectedCents: 0,
      confirmedCount: 2,
    }
    mocks.getCashForecast.mockResolvedValueOnce(env)
    renderWithClient(<CashForecastPage />)
    expect(await screen.findByTestId('cash-forecast-overdue')).toBeTruthy()
  })

  it('renders an error card when the query fails', async () => {
    mocks.getCashForecast.mockRejectedValueOnce(new Error('boom'))
    renderWithClient(<CashForecastPage />)
    expect(
      await screen.findByText('Não foi possível carregar a previsão.'),
    ).toBeTruthy()
  })

  it('does not leak provider / ERP / policy vocabulary in the DOM', async () => {
    mocks.getCashForecast.mockResolvedValueOnce(emptyEnvelope())
    const { container } = renderWithClient(<CashForecastPage />)
    await screen.findByText('Esta semana')
    expect(container.innerHTML).not.toMatch(
      /Conta Azul|ContaAzul|conta_azul|ERP|sale|pessoa|cobrança|release_after|manual_only|HELD_/i,
    )
  })
})
