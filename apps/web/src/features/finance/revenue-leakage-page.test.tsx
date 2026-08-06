// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  getRevenueLeakage: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    finance: {
      getRevenueLeakage: mocks.getRevenueLeakage,
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...rest
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...rest}>{children}</a>
  ),
  createFileRoute: () => () => ({}),
}))

import { RevenueLeakagePage } from './revenue-leakage-page'

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

type LeakageAlert = {
  serviceOrderId: number
  serviceOrderPublicId: string
  serviceOrderNumber: string
  customer: { id: number; name: string }
  unit: { id: number; name: string }
  amountCents: number
  currency: string
  classes: string[]
  ageInDays: number
}

function emptyEnvelope() {
  const alerts: LeakageAlert[] = []
  return {
    summary: {
      classes: {
        STUCK_READY_TO_BILL: { count: 0, totalCents: 0 },
        STUCK_SENT_TO_FINANCE: { count: 0, totalCents: 0 },
        STUCK_INVOICED: { count: 0, totalCents: 0 },
        LONG_OVERDUE: { count: 0, totalCents: 0 },
        BLOCKED_TOO_LONG: { count: 0, totalCents: 0 },
      },
      totalAlerts: 0,
    },
    alerts,
  }
}

afterEach(() => {
  cleanup()
  mocks.getRevenueLeakage.mockReset()
})

describe('RevenueLeakagePage', () => {
  it('renders all 5 class chips with provider-neutral pt-BR labels', async () => {
    mocks.getRevenueLeakage.mockResolvedValueOnce(emptyEnvelope())
    renderWithClient(<RevenueLeakagePage />)

    expect(await screen.findByText('Vencido há mais de 14 dias')).toBeTruthy()
    expect(screen.getByText('Faturado sem recebimento')).toBeTruthy()
    expect(
      screen.getByText('Enviado ao financeiro sem fatura emitida'),
    ).toBeTruthy()
    expect(screen.getByText('Pronto para faturar há muito tempo')).toBeTruthy()
    expect(screen.getByText('Bloqueado há mais de 7 dias')).toBeTruthy()
  })

  it('shows the empty card when there are no alerts', async () => {
    mocks.getRevenueLeakage.mockResolvedValueOnce(emptyEnvelope())
    renderWithClient(<RevenueLeakagePage />)
    expect(
      await screen.findByText('Nenhum alerta de vazamento no momento.'),
    ).toBeTruthy()
  })

  it('renders alert rows with multiple classes', async () => {
    const envelope = emptyEnvelope()
    envelope.summary.classes.LONG_OVERDUE = { count: 1, totalCents: 50_000 }
    envelope.summary.classes.BLOCKED_TOO_LONG = {
      count: 1,
      totalCents: 50_000,
    }
    envelope.summary.totalAlerts = 1
    envelope.alerts.push({
      serviceOrderId: 42,
      serviceOrderPublicId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      serviceOrderNumber: 'OS-42',
      customer: { id: 10, name: 'Cliente A' },
      unit: { id: 1, name: 'Sede' },
      amountCents: 50_000,
      currency: 'BRL',
      classes: ['LONG_OVERDUE', 'BLOCKED_TOO_LONG'],
      ageInDays: 22,
    })
    mocks.getRevenueLeakage.mockResolvedValueOnce(envelope)

    renderWithClient(<RevenueLeakagePage />)
    expect(await screen.findByText(/OS-42 · Cliente A/)).toBeTruthy()
    expect(screen.getByText(/Há 22 dias/)).toBeTruthy()
    // header row + one data row
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(2)
  })

  it('renders an error card when the query fails', async () => {
    mocks.getRevenueLeakage.mockRejectedValueOnce(new Error('boom'))
    renderWithClient(<RevenueLeakagePage />)
    expect(
      await screen.findByText('Não foi possível carregar os alertas.'),
    ).toBeTruthy()
  })

  it('does not leak provider / ERP / policy vocabulary in the DOM', async () => {
    mocks.getRevenueLeakage.mockResolvedValueOnce(emptyEnvelope())
    const { container } = renderWithClient(<RevenueLeakagePage />)
    await screen.findByText('Vencido há mais de 14 dias')
    expect(container.innerHTML).not.toMatch(
      /Conta Azul|ContaAzul|conta_azul|ERP|sale|pessoa|cobrança|release_after|manual_only|HELD_/i,
    )
  })
})
