// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  getOperationsToCash: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    finance: {
      getOperationsToCash: mocks.getOperationsToCash,
    },
  },
}))

import { OperationsToCashPage } from './operations-to-cash-page'

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function emptyEnvelope() {
  return {
    summary: {
      stages: {
        READY_TO_BILL: { count: 0, totalCents: 0 },
        SENT_TO_FINANCE: { count: 0, totalCents: 0 },
        INVOICED: { count: 0, totalCents: 0 },
        PARTIALLY_COLLECTED: { count: 0, totalCents: 0 },
        COLLECTED: { count: 0, totalCents: 0 },
      },
      needsAttention: {
        overdueCount: 0,
        blockedCount: 0,
        overdueCents: 0,
        blockedCents: 0,
      },
    },
    items: [],
  }
}

afterEach(() => {
  cleanup()
  mocks.getOperationsToCash.mockReset()
})

describe('OperationsToCashPage', () => {
  it('renders all 5 stage cards with provider-neutral pt-BR labels', async () => {
    mocks.getOperationsToCash.mockResolvedValueOnce(emptyEnvelope())
    renderWithClient(<OperationsToCashPage />)

    expect(await screen.findByText('Pronto para faturar')).toBeTruthy()
    expect(screen.getByText('Enviado ao financeiro')).toBeTruthy()
    expect(screen.getByText('Faturado')).toBeTruthy()
    expect(screen.getByText('Recebimento parcial')).toBeTruthy()
    expect(screen.getByText('Recebido')).toBeTruthy()
  })

  it('hides the "needs attention" pane when there are no overdue or blocked SOs', async () => {
    mocks.getOperationsToCash.mockResolvedValueOnce(emptyEnvelope())
    renderWithClient(<OperationsToCashPage />)
    await screen.findByText('Pronto para faturar')
    expect(screen.queryByTestId('operations-to-cash-attention')).toBeNull()
  })

  it('renders the "needs attention" pane when overdue or blocked SOs exist', async () => {
    const envelope = emptyEnvelope()
    envelope.summary.needsAttention.overdueCount = 2
    envelope.summary.needsAttention.overdueCents = 50_000
    envelope.summary.needsAttention.blockedCount = 1
    envelope.summary.needsAttention.blockedCents = 10_000
    mocks.getOperationsToCash.mockResolvedValueOnce(envelope)

    renderWithClient(<OperationsToCashPage />)
    expect(await screen.findByText('Requer atenção')).toBeTruthy()
    expect(screen.getByText(/2 OS/)).toBeTruthy()
    expect(screen.getByText(/Bloqueadas/)).toBeTruthy()
  })

  it('shows the empty-state card when there are no billable items', async () => {
    mocks.getOperationsToCash.mockResolvedValueOnce(emptyEnvelope())
    renderWithClient(<OperationsToCashPage />)
    expect(
      await screen.findByText('Sem OS faturáveis no momento.'),
    ).toBeTruthy()
  })

  it('renders an error card when the query fails', async () => {
    mocks.getOperationsToCash.mockRejectedValueOnce(new Error('boom'))
    renderWithClient(<OperationsToCashPage />)
    expect(
      await screen.findByText('Não foi possível carregar o painel.'),
    ).toBeTruthy()
  })

  it('does not leak provider/ERP/policy vocabulary in the DOM', async () => {
    mocks.getOperationsToCash.mockResolvedValueOnce(emptyEnvelope())
    const { container } = renderWithClient(<OperationsToCashPage />)
    await screen.findByText('Pronto para faturar')
    expect(container.innerHTML).not.toMatch(
      /Conta Azul|ContaAzul|conta_azul|ERP|sale|pessoa|cobrança|release_after|manual_only|HELD_/i,
    )
  })
})
