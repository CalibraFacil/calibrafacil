// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  listDrift: vi.fn(),
  acknowledgeDrift: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    integrations: {
      listDrift: mocks.listDrift,
      acknowledgeDrift: mocks.acknowledgeDrift,
    },
  },
}))

import { IntegrationDriftQueuePage } from './drift-queue-page'

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  mocks.listDrift.mockReset()
  mocks.acknowledgeDrift.mockReset()
})

describe('IntegrationDriftQueuePage', () => {
  it('renders an empty state when no drift rows exist', async () => {
    mocks.listDrift.mockResolvedValueOnce({ data: [] })
    renderWithClient(<IntegrationDriftQueuePage />)

    expect(
      await screen.findByText('Nenhuma divergência pendente.'),
    ).toBeTruthy()
  })

  it('renders drift rows with provider-neutral target label', async () => {
    mocks.listDrift.mockResolvedValueOnce({
      data: [
        {
          linkId: 'lnk-1',
          integrationId: 'int-1',
          providerLabel: 'Conta Azul',
          target: 'sale',
          targetLabel: 'Venda',
          localEntityId: 'sale:1',
          remoteEntityId: 'r-1',
          remoteDisplayId: null,
          driftStatus: 'REMOTE_MISSING' as const,
          driftCheckedAt: '2026-05-26T00:00:00.000Z',
          driftReason: 'not_found',
          lastSyncedAt: '2026-05-25T12:00:00.000Z',
        },
      ],
    })

    renderWithClient(<IntegrationDriftQueuePage />)

    const rows = await screen.findAllByTestId('drift-row')
    expect(rows).toHaveLength(1)
    expect(screen.getByText('Venda')).toBeTruthy()
    expect(screen.getByText('Remoto ausente')).toBeTruthy()
    expect(screen.getByText(/sale:1/)).toBeTruthy()
  })

  it('renders an error card when the query fails', async () => {
    mocks.listDrift.mockRejectedValueOnce(new Error('boom'))
    renderWithClient(<IntegrationDriftQueuePage />)

    expect(
      await screen.findByText('Não foi possível carregar a fila de divergências.'),
    ).toBeTruthy()
  })
})
