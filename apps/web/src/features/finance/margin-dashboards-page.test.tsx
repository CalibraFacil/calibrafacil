// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ getMarginDashboards: vi.fn() }))

vi.mock('@/utils/api', () => ({
  calibraApi: { finance: { getMarginDashboards: mocks.getMarginDashboards } },
}))

import { MarginDashboardsPage } from './margin-dashboards-page'

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  mocks.getMarginDashboards.mockReset()
})

describe('MarginDashboardsPage', () => {
  it('renders the empty card when there are no rows', async () => {
    mocks.getMarginDashboards.mockResolvedValueOnce({
      byCustomer: [],
      byService: [],
    })
    renderWithClient(<MarginDashboardsPage />)
    expect(await screen.findByText('Sem dados de margem ainda.')).toBeTruthy()
  })

  it('renders rows with revenue / cost / margin / percent / OS columns', async () => {
    mocks.getMarginDashboards.mockResolvedValueOnce({
      byCustomer: [
        {
          entityId: 1,
          entityName: 'Cliente A',
          revenueCents: 100_000,
          outsourcedCostCents: 30_000,
          partsCostCents: 12_000,
          marginCents: 58_000,
          marginPercent: 58,
          serviceOrderCount: 3,
        },
      ],
      byService: [],
    })
    renderWithClient(<MarginDashboardsPage />)
    expect(await screen.findByText('Cliente A')).toBeTruthy()
    // header row + one data row
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(2)
    // both cost columns render: outsourced and parts COGS
    expect(screen.getByText('Terceiros')).toBeTruthy()
    expect(screen.getByText('Peças')).toBeTruthy()
  })

  it('renders an error card when the query fails', async () => {
    mocks.getMarginDashboards.mockRejectedValueOnce(new Error('boom'))
    renderWithClient(<MarginDashboardsPage />)
    expect(
      await screen.findByText('Não foi possível carregar o painel de margens.'),
    ).toBeTruthy()
  })

  it('does not leak provider / ERP / policy vocabulary in the DOM', async () => {
    mocks.getMarginDashboards.mockResolvedValueOnce({
      byCustomer: [
        {
          entityId: 1,
          entityName: 'Cliente A',
          revenueCents: 100_000,
          outsourcedCostCents: 30_000,
          partsCostCents: 12_000,
          marginCents: 58_000,
          marginPercent: 58,
          serviceOrderCount: 3,
        },
      ],
      byService: [],
    })
    const { container } = renderWithClient(<MarginDashboardsPage />)
    await screen.findByText('Cliente A')
    expect(container.innerHTML).not.toMatch(
      /Conta Azul|ContaAzul|conta_azul|ERP|sale|pessoa|cobrança|release_after|manual_only|HELD_/i,
    )
  })
})
