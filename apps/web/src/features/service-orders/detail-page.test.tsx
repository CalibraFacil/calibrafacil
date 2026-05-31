// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServiceOrderFinancialStatusBlock } from './detail-page'
import type { ServiceOrderFinancialStatus } from '@calibra-facil/shared'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a data-to={to} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

describe('ServiceOrderFinancialStatusBlock', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders loading state with a scoped live region', () => {
    render(
      <ServiceOrderFinancialStatusBlock
        status={null}
        loading
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('Carregando status financeiro...')).toBeTruthy()
    expect(
      screen
        .getByText('Carregando status financeiro...')
        .closest('[aria-live="polite"]'),
    ).toBeTruthy()
  })

  it('renders error state and retries inline', () => {
    const onRetry = vi.fn()

    render(
      <ServiceOrderFinancialStatusBlock
        status={null}
        loading={false}
        error={new Error('failed')}
        onRetry={onRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders nothing for an empty status response', () => {
    const { container } = render(
      <ServiceOrderFinancialStatusBlock
        status={null}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(container.textContent).toBe('')
  })

  it('renders provider-neutral primary status text and router reconnect links', () => {
    const { container } = render(
      <ServiceOrderFinancialStatusBlock
        status={financialStatus()}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('heading', {
        name: /Status financeiro/,
        level: 3,
      }),
    ).toBeTruthy()
    expect(screen.getByText('Aguardando confirmação de pagamento')).toBeTruthy()
    expect(screen.getByText('Em aberto')).toBeTruthy()
    expect(screen.getByText('Vencido')).toBeTruthy()
    expect(screen.getByText('Recebido')).toBeTruthy()
    expect(screen.getByText('Última atualização')).toBeTruthy()
    expect(screen.getByText(/R\$\s*500,00/)).toBeTruthy()
    expect(
      screen
        .getByRole('link', {
          name: 'Reconectar',
        })
        .getAttribute('data-to'),
    ).toBe('/dashboard/settings/integrations#financial-erp')
    expect(
      screen.getByRole('link', { name: 'Reconectar' }).textContent,
    ).not.toContain('Conta Azul')
    expect(container.textContent).not.toContain('AWAITING_PAYMENT')
  })

  it('hides empty financial metrics when the order is only ready for billing', () => {
    render(
      <ServiceOrderFinancialStatusBlock
        status={financialStatus({
          status: 'READY_FOR_BILLING',
          label: 'Pronto para faturar',
          description: 'Sem atividade financeira para esta OS.',
          readinessStatus: 'READY',
          billingDocument: null,
          amountCents: 0,
          providerEvidence: null,
        })}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Sem atividade financeira para esta OS.'),
    ).toBeTruthy()
    expect(screen.queryByText('Em aberto')).toBeNull()
    expect(screen.queryByText('Sem parcelas registradas')).toBeNull()
  })

  it('hides financial metrics when provider status is unavailable', () => {
    render(
      <ServiceOrderFinancialStatusBlock
        status={financialStatus({
          status: 'STATUS_UNAVAILABLE',
          label: 'Status indisponível',
          description: 'Atualização pendente.',
        })}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('Atualização pendente.')).toBeTruthy()
    expect(screen.queryByText('Em aberto')).toBeNull()
  })

  it('only highlights the overdue tile when there is an overdue balance', () => {
    const { rerender } = render(
      <ServiceOrderFinancialStatusBlock
        status={financialStatus()}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    const overdueLabel = screen.getByText('Vencido')
    expect(
      overdueLabel.parentElement
        ?.querySelector('dd')
        ?.classList.contains('text-destructive'),
    ).toBe(false)

    rerender(
      <ServiceOrderFinancialStatusBlock
        status={financialStatus({
          status: 'OVERDUE',
          label: 'Em atraso',
          installments: [
            {
              id: 71,
              installmentNumber: 1,
              status: 'OVERDUE',
              label: 'Em atraso',
              amountCents: 25000,
              currency: 'BRL',
              dueDate: '2026-05-20T00:00:00.000Z',
              paidAt: null,
              paymentMethod: null,
            },
          ],
        })}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(
      screen
        .getByText('Vencido')
        .parentElement?.querySelector('dd')
        ?.classList.contains('text-destructive'),
    ).toBe(true)
  })
})

function financialStatus(
  overrides: Partial<ServiceOrderFinancialStatus> = {},
): ServiceOrderFinancialStatus {
  return {
    serviceOrderId: 1,
    serviceOrderNumber: 'OS-1',
    status: 'AWAITING_PAYMENT',
    label: 'Aguardando confirmação de pagamento',
    description: 'Sincronizado',
    readinessStatus: 'SENT',
    blockers: [],
    amountCents: 50000,
    currency: 'BRL',
    billingDocument: {
      id: 10,
      documentNumber: 'FIN-10',
      status: 'ISSUED',
      exportStatus: 'EXPORTED',
      issuedAt: '2026-05-20T00:00:00.000Z',
      dueDate: '2026-06-20T00:00:00.000Z',
      totalCents: 50000,
      currency: 'BRL',
    },
    installments: [
      {
        id: 70,
        installmentNumber: 1,
        status: 'OPEN',
        label: 'Aguardando pagamento',
        amountCents: 50000,
        currency: 'BRL',
        dueDate: '2026-06-20T00:00:00.000Z',
        paidAt: null,
        paymentMethod: null,
      },
    ],
    installmentsSummary: {
      total: 1,
      totalCents: 50000,
      paidCents: 0,
      openCents: 50000,
      overdueCents: 0,
      paidCount: 0,
      openCount: 1,
      overdueCount: 0,
      voidCount: 0,
    },
    receipts: [],
    fiscalDocument: {
      availability: 'NONE',
      label: 'Sem documento fiscal vinculado',
      number: null,
      issuedAt: null,
      accessKey: null,
      xmlAvailable: false,
      consultationOnly: true,
      lastSyncedAt: null,
    },
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
    ...overrides,
  }
}
