// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  listAutomaticSendRules: vi.fn(),
  createAutomaticSendRule: vi.fn(),
  updateAutomaticSendRule: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    finance: {
      listAutomaticSendRules: mocks.listAutomaticSendRules,
      createAutomaticSendRule: mocks.createAutomaticSendRule,
      updateAutomaticSendRule: mocks.updateAutomaticSendRule,
    },
  },
}))

import { AutomaticSendSettingsPage } from './automatic-send-page'

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  mocks.listAutomaticSendRules.mockReset()
  mocks.createAutomaticSendRule.mockReset()
  mocks.updateAutomaticSendRule.mockReset()
})

describe('AutomaticSendSettingsPage', () => {
  it('renders the page header', async () => {
    mocks.listAutomaticSendRules.mockResolvedValueOnce({ data: [] })
    renderWithClient(<AutomaticSendSettingsPage />)
    expect(await screen.findByText('Regras de envio automático')).toBeTruthy()
  })

  it('lists the org default + overrides separately', async () => {
    mocks.listAutomaticSendRules.mockResolvedValueOnce({
      data: [
        {
          id: 1,
          milestone: 'manual_only' as const,
          customerId: null,
          commercialAgreementId: null,
          serviceCategory: null,
          priority: 0,
          scope: 'organization' as const,
          archivedAt: null,
          createdAt: '2026-05-26T00:00:00.000Z',
          updatedAt: '2026-05-26T00:00:00.000Z',
        },
        {
          id: 2,
          milestone: 'certificate_approved' as const,
          customerId: 10,
          customerName: 'Cliente A',
          commercialAgreementId: null,
          serviceCategory: null,
          priority: 0,
          scope: 'customer' as const,
          archivedAt: null,
          createdAt: '2026-05-26T00:00:00.000Z',
          updatedAt: '2026-05-26T00:00:00.000Z',
        },
      ],
    })

    renderWithClient(<AutomaticSendSettingsPage />)
    expect(await screen.findByText('Cliente A')).toBeTruthy()
    expect(await screen.findByText('Regra padrão da organização')).toBeTruthy()
    const rows = await screen.findAllByTestId('automatic-send-rule-row')
    expect(rows).toHaveLength(1)
  })

  it('does not leak provider or ERP vocabulary in the DOM', async () => {
    mocks.listAutomaticSendRules.mockResolvedValueOnce({
      data: [
        {
          id: 1,
          milestone: 'certificate_approved' as const,
          customerId: 10,
          customerName: 'Cliente A',
          commercialAgreementId: null,
          serviceCategory: null,
          priority: 0,
          scope: 'customer' as const,
          archivedAt: null,
          createdAt: '2026-05-26T00:00:00.000Z',
          updatedAt: '2026-05-26T00:00:00.000Z',
        },
      ],
    })

    const { container } = renderWithClient(<AutomaticSendSettingsPage />)
    await screen.findByText('Cliente A')
    expect(container.innerHTML).not.toMatch(
      /Conta Azul|ContaAzul|conta_azul|ERP|sale|pessoa|cobrança/i,
    )
  })
})
