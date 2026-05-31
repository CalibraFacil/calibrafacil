// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ContaAzulScheduleResponse,
  ContaAzulScheduleRow,
} from '@/features/settings/types'
import { AutomaticSyncPanel } from './conta-azul-tabs'

function scheduleRow(
  input: Partial<ContaAzulScheduleRow> = {},
): ContaAzulScheduleRow {
  return {
    enabled: true,
    intervalMinutes: 30,
    lastErrorAt: null,
    lastErrorMessage: null,
    lastSuccessAt: null,
    nextDueAt: null,
    ...input,
  }
}

function schedule(
  paymentStatusPolling: ContaAzulScheduleRow,
): ContaAzulScheduleResponse {
  return {
    paymentStatusPolling,
    payables: scheduleRow(),
    fiscalDocuments: scheduleRow({
      enabled: false,
    }),
    protocols: scheduleRow(),
    driftChecks: scheduleRow(),
  }
}

function renderPanel(data: ContaAzulScheduleResponse) {
  return render(
    <AutomaticSyncPanel
      scheduleState={{
        data,
        isError: false,
        isLoading: false,
      }}
    />,
  )
}

describe('AutomaticSyncPanel', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each([
    [
      'disabled',
      scheduleRow({ enabled: false }),
      'Status do pagamento: desabilitada',
      'Desabilitado',
    ],
    [
      'awaiting_first_run',
      scheduleRow(),
      'Status do pagamento: aguardando primeira execução',
      'Aguardando',
    ],
    [
      'healthy',
      scheduleRow({
        lastSuccessAt: '2026-05-26T12:00:00.000Z',
        nextDueAt: '2026-05-26T12:30:00.000Z',
      }),
      'Status do pagamento: execução automática saudável',
      'OK',
    ],
    [
      'failed',
      scheduleRow({
        lastErrorAt: '2026-05-26T12:20:00.000Z',
        lastErrorMessage: 'Tempo limite excedido',
        lastSuccessAt: '2026-05-26T12:00:00.000Z',
        nextDueAt: null,
      }),
      'Status do pagamento: última execução falhou',
      'Falhou',
    ],
    [
      'stuck',
      scheduleRow({
        lastSuccessAt: '2026-05-25T10:00:00.000Z',
        nextDueAt: '2026-05-25T10:30:00.000Z',
      }),
      'Status do pagamento: execução automática atrasada',
      'Atrasado',
    ],
  ])(
    'renders the %s state with text and aria-label',
    (_state, row, aria, label) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z'))

      renderPanel(schedule(row))

      const list = screen.getByRole('list', {
        name: 'Sincronização automática',
      })
      const paymentRow = within(list)
        .getByText('Status do pagamento')
        .closest('li')

      expect(paymentRow).not.toBeNull()
      expect(within(paymentRow!).getByLabelText(aria)).toBeTruthy()
      expect(within(paymentRow!).getByText(label)).toBeTruthy()
      expect(
        within(paymentRow!).getByText('Status do pagamento').textContent,
      ).not.toContain('Conta Azul')
      expect(
        within(paymentRow!).getByText('Recebíveis e parcelas em aberto.')
          .textContent,
      ).not.toContain('Conta Azul')
    },
  )

  it('renders failed rows without a misleading next scheduled time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T12:30:00.000Z'))

    renderPanel(
      schedule(
        scheduleRow({
          lastErrorAt: '2026-05-26T12:20:00.000Z',
          lastErrorMessage: 'Conta Azul recusou: token expirado',
          lastSuccessAt: '2026-05-26T12:00:00.000Z',
          nextDueAt: null,
        }),
      ),
    )

    const paymentRow = screen.getByText('Status do pagamento').closest('li')
    expect(paymentRow).not.toBeNull()
    expect(paymentRow!.textContent).toContain('Próxima execução: —')
    expect(paymentRow!.textContent).not.toContain('Próxima execução: em ~')
    expect(paymentRow!.textContent).toContain('Conta Azul recusou')
  })

  it('renders loading and error branches without row layout shifts', () => {
    const { rerender } = render(
      <AutomaticSyncPanel
        scheduleState={{
          isError: false,
          isLoading: true,
        }}
      />,
    )

    expect(
      screen.getByRole('list', { name: 'Sincronização automática' }).children,
    ).toHaveLength(5)

    rerender(
      <AutomaticSyncPanel
        scheduleState={{
          isError: true,
          isLoading: false,
        }}
      />,
    )

    expect(
      screen.getByText('Não foi possível carregar a agenda automática.'),
    ).toBeTruthy()
  })

  it('shows error captions only when the schedule row has an error message', () => {
    renderPanel(
      schedule(
        scheduleRow({
          lastErrorAt: '2026-05-26T12:20:00.000Z',
          lastErrorMessage: 'Token expirado',
        }),
      ),
    )

    expect(screen.getByText('Token expirado')).toBeTruthy()
    expect(screen.queryByText('Conta Azul')).toBeNull()
  })
})
