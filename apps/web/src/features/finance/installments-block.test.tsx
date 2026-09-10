// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  FinancialInstallmentStatus,
  FinancialInstallmentsSummary,
} from '@calibra-facil/shared'

import { InstallmentsBlock } from './installments-block'

function summary(
  overrides: Partial<FinancialInstallmentsSummary> = {},
): FinancialInstallmentsSummary {
  return {
    total: 0,
    totalCents: 0,
    paidCents: 0,
    openCents: 0,
    overdueCents: 0,
    paidCount: 0,
    openCount: 0,
    overdueCount: 0,
    voidCount: 0,
    ...overrides,
  }
}

function row(
  overrides: Partial<FinancialInstallmentStatus>,
): FinancialInstallmentStatus {
  return {
    id: 1,
    installmentNumber: 1,
    status: 'OPEN',
    label: 'Aguardando pagamento',
    amountCents: 10_000,
    currency: 'BRL',
    dueDate: '2026-06-10T00:00:00.000Z',
    paidAt: null,
    paymentMethod: null,
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('InstallmentsBlock', () => {
  it('renders nothing when there are no installments', () => {
    const { container } = render(
      <InstallmentsBlock installments={[]} summary={summary()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders summary chips and per-installment rows for a mixed list', () => {
    render(
      <InstallmentsBlock
        installments={[
          row({ id: 1, installmentNumber: 1, status: 'PAID' }),
          row({
            id: 2,
            installmentNumber: 2,
            status: 'OPEN',
            amountCents: 5_000,
          }),
          row({
            id: 3,
            installmentNumber: 3,
            status: 'OVERDUE',
            amountCents: 7_000,
          }),
        ]}
        summary={summary({
          total: 3,
          totalCents: 22_000,
          paidCents: 10_000,
          openCents: 12_000,
          overdueCents: 7_000,
          paidCount: 1,
          openCount: 1,
          overdueCount: 1,
        })}
      />,
    )

    expect(screen.getByText(/1 de 3 pagas/)).toBeTruthy()
    expect(screen.getByText(/R\$\s?120,00 em aberto/)).toBeTruthy()
    expect(screen.getByText(/R\$\s?70,00 em atraso/)).toBeTruthy()
    expect(screen.getAllByTestId('installment-row')).toHaveLength(3)
  })

  it('omits the overdue chip when overdueCount is 0', () => {
    render(
      <InstallmentsBlock
        installments={[row({ status: 'PAID' })]}
        summary={summary({
          total: 1,
          totalCents: 10_000,
          paidCents: 10_000,
          paidCount: 1,
        })}
      />,
    )
    expect(screen.queryByText(/em atraso/)).toBeNull()
  })

  it('keeps VOID rows in the list with strikethrough styling', () => {
    render(
      <InstallmentsBlock
        installments={[row({ status: 'VOID' })]}
        summary={summary({ total: 1, voidCount: 1 })}
      />,
    )
    const rows = screen.getAllByTestId('installment-row')
    expect(rows[0]?.className).toMatch(/line-through/)
  })

  it('renders provider-neutral DOM (no Conta Azul / ERP / policy vocabulary)', () => {
    const { container } = render(
      <InstallmentsBlock
        installments={[
          row({ id: 1, installmentNumber: 1, status: 'PAID' }),
          row({ id: 2, installmentNumber: 2, status: 'OPEN' }),
          row({ id: 3, installmentNumber: 3, status: 'OVERDUE' }),
        ]}
        summary={summary({
          total: 3,
          paidCount: 1,
          openCount: 1,
          overdueCount: 1,
          openCents: 10_000,
          overdueCents: 10_000,
        })}
      />,
    )
    expect(container.innerHTML).not.toMatch(
      /Conta Azul|ContaAzul|conta_azul|ERP|sale|pessoa|cobrança/i,
    )
  })

  it('truncates to maxRows and shows a count note', () => {
    const installments = Array.from({ length: 5 }, (_, i) =>
      row({ id: i + 1, installmentNumber: i + 1 }),
    )
    render(
      <InstallmentsBlock
        installments={installments}
        summary={summary({ total: 5, openCount: 5, openCents: 50_000 })}
        maxRows={3}
      />,
    )
    expect(screen.getAllByTestId('installment-row')).toHaveLength(3)
    expect(screen.getByText(/Mostrando 3 de 5 parcelas/)).toBeTruthy()
  })
})
