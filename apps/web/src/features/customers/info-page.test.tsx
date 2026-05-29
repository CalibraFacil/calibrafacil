// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CustomerFinancialTimelineBlock } from './info-page'
import type { CustomerFinancialTimelineDocument } from '@calibra-facil/shared'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a data-to={to} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

describe('CustomerFinancialTimelineBlock', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the loading state politely', () => {
    render(
      <CustomerFinancialTimelineBlock
        documents={[]}
        summary={null}
        freshness={null}
        loading
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Carregando linha do tempo financeira...'),
    ).toBeTruthy()
  })

  it('renders the error state and retries inline', () => {
    const onRetry = vi.fn()

    render(
      <CustomerFinancialTimelineBlock
        documents={[]}
        summary={null}
        freshness={null}
        loading={false}
        error={new Error('failed')}
        onRetry={onRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders the empty state without raw provider details', () => {
    const { container } = render(
      <CustomerFinancialTimelineBlock
        documents={[]}
        summary={{
          scope: 'recent_documents',
          scopeLabel: 'Unidade Matriz',
          limit: 30,
          isTruncated: false,
          documents: 0,
          totalDocuments: 0,
          openCents: 0,
          overdueCents: 0,
          receivedCents: 0,
        }}
        freshness={{
          status: 'local_only',
          lastSyncedAt: null,
          label: 'Status local',
        }}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(
      screen.getByText(
        'Nenhum documento financeiro registrado para este cliente.',
      ),
    ).toBeTruthy()
    expect(container.textContent).not.toContain('Conta Azul')
    expect(container.textContent).not.toContain('AWAITING_PAYMENT')
  })

  it('renders summary balances and keeps provider names in evidence only', () => {
    const { container } = render(
      <CustomerFinancialTimelineBlock
        documents={[timelineDocument()]}
        summary={{
          scope: 'recent_documents',
          scopeLabel: 'Unidade Matriz',
          limit: 30,
          isTruncated: false,
          documents: 1,
          totalDocuments: 1,
          openCents: 80000,
          overdueCents: 20000,
          receivedCents: 40000,
        }}
        freshness={{
          status: 'fresh',
          lastSyncedAt: '2026-05-20T00:00:00.000Z',
          label: 'Sincronizado',
        }}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('Em aberto')).toBeTruthy()
    expect(screen.getByText(/R\$\s*800,00/)).toBeTruthy()
    expect(screen.getByText('Vencido')).toBeTruthy()
    expect(screen.getByText(/R\$\s*200,00/)).toBeTruthy()
    expect(screen.getByText('Resumo financeiro: Unidade Matriz.')).toBeTruthy()
    expect(screen.getByText(/Sincronizado em 20\/05\/2026/)).toBeTruthy()
    expect(screen.getByText('Aguardando confirmação de pagamento')).toBeTruthy()
    expect(
      screen
        .getByRole('link', {
          name: 'Reconectar',
        })
        .getAttribute('data-to'),
    ).toBe('/dashboard/settings/integrations#financial-erp')
    expect(screen.queryByRole('link', { name: /conta azul/i })).toBeNull()
    expect(
      screen.getByText('Reconecte Conta Azul para atualizar o status'),
    ).toBeTruthy()
    expect(container.textContent).not.toContain('AWAITING_PAYMENT')
    expect(container.textContent).not.toContain(
      'Sem documento fiscal vinculado',
    )
  })

  it('renders visible and total document counts when the timeline is truncated', () => {
    render(
      <CustomerFinancialTimelineBlock
        documents={[timelineDocument()]}
        summary={{
          scope: 'recent_documents',
          scopeLabel: 'Unidade Matriz',
          limit: 30,
          isTruncated: true,
          documents: 30,
          totalDocuments: 45,
          openCents: 80000,
          overdueCents: 20000,
          receivedCents: 40000,
        }}
        freshness={{
          status: 'fresh',
          lastSyncedAt: '2026-05-20T00:00:00.000Z',
          label: 'Sincronizado',
        }}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('30 de 45')).toBeTruthy()
    expect(
      screen.getByText(
        'Mostrando os 30 de 45 documentos financeiros mais recentes.',
      ),
    ).toBeTruthy()
  })
})

function timelineDocument(): CustomerFinancialTimelineDocument {
  return {
    id: 10,
    documentNumber: 'FIN-10',
    status: 'ISSUED',
    exportStatus: 'EXPORTED',
    continuityStatus: 'AWAITING_PAYMENT',
    label: 'Aguardando confirmação de pagamento',
    issueDate: '2026-05-20T00:00:00.000Z',
    dueDate: '2026-06-20T00:00:00.000Z',
    totalCents: 120000,
    currency: 'BRL',
    unit: { id: 7, name: 'Matriz' },
    installments: [],
    receipts: [
      {
        id: 1,
        installmentId: 1,
        receivedAt: '2026-06-01T00:00:00.000Z',
        amountCents: 40000,
        paymentMethod: 'PIX',
        reference: null,
      },
    ],
    fiscalDocuments: [],
    freshness: {
      status: 'fresh',
      lastSyncedAt: '2026-05-20T00:00:00.000Z',
      label: 'Sincronizado',
    },
    providerEvidence: {
      label: 'Reconecte Conta Azul para atualizar o status',
      integrationState: 'disconnected',
      reconnectPath: '/dashboard/settings/integrations#financial-erp',
    },
  }
}
