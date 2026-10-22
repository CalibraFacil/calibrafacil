// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DeadEventsSection } from '@/features/sync/components/dead-events-section'

const mocks = vi.hoisted(() => ({
  refreshSyncStatus: vi.fn(async () => undefined),
  listDeadEvents: vi.fn(),
  discardDeadEvent: vi.fn(),
  requeueDeadEvent: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/runtime/sync-status', () => ({
  useSyncStatus: () => ({
    isDesktop: true,
    refresh: mocks.refreshSyncStatus,
  }),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    sync: {
      listDeadEvents: mocks.listDeadEvents,
      discardDeadEvent: mocks.discardDeadEvent,
      requeueDeadEvent: mocks.requeueDeadEvent,
    },
  },
}))

const executionEvent = {
  eventId: 'event:execution-1',
  entityType: 'calibration_job',
  entityId: 'job:local-1',
  operation: 'submit_local_execution',
  errorCode: 'STANDARD_EXPIRED',
  errorMessage: 'Desktop execution references expired standards: P-01.',
  attemptCount: 1,
  occurredAt: '2026-05-10T12:00:00.000Z',
  deadAt: '2026-05-10T12:01:00.000Z',
  regulated: true,
}

const customerEvent = {
  eventId: 'event:customer-1',
  entityType: 'customer',
  entityId: 'customer:local-1',
  operation: 'create_local_customer',
  errorCode: 'UNSUPPORTED_SYNC_OPERATION',
  errorMessage: 'Sync operation is not supported by this server.',
  attemptCount: 1,
  occurredAt: '2026-05-10T12:00:00.000Z',
  deadAt: '2026-05-10T12:01:00.000Z',
  regulated: false,
}

describe('DeadEventsSection', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('REQ-OB-3: lists refused events with the reason in pt-BR', async () => {
    mocks.listDeadEvents.mockResolvedValue({
      data: [executionEvent, customerEvent],
      total: 2,
    })

    renderSection()

    expect(
      await screen.findByText('Calibração · Envio da execução para aprovação'),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Um padrão usado nesta calibração está com o certificado vencido.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Cliente · Cadastro de cliente')).toBeTruthy()
    expect(
      screen.getByText(
        'A nuvem não reconhece este tipo de alteração, provavelmente feita por uma versão antiga do aplicativo.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('STANDARD_EXPIRED')).toBeNull()
  })

  it('REQ-OB-3: renders nothing when no event was refused', async () => {
    mocks.listDeadEvents.mockResolvedValue({ data: [], total: 0 })

    const { container } = renderSection()

    await waitFor(() => expect(mocks.listDeadEvents).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('REQ-OB-3: discarding execution readings asks first, warning they stay only on this computer', async () => {
    mocks.listDeadEvents
      .mockResolvedValueOnce({ data: [executionEvent], total: 1 })
      .mockResolvedValueOnce({ data: [], total: 0 })
    mocks.discardDeadEvent.mockResolvedValue({
      data: executionEvent,
      syncStatus: {},
    })

    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }))

    expect(mocks.discardDeadEvent).not.toHaveBeenCalled()
    expect(
      screen.getByText(/As leituras ficam salvas somente neste computador/),
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'Descartar mesmo assim' }),
    )

    await waitFor(() => {
      expect(mocks.discardDeadEvent).toHaveBeenCalledWith('event:execution-1')
    })
    expect(mocks.refreshSyncStatus).toHaveBeenCalled()
  })

  it('REQ-OB-3: cancelling the warning keeps the event in the queue', async () => {
    mocks.listDeadEvents.mockResolvedValue({
      data: [executionEvent],
      total: 1,
    })

    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(mocks.discardDeadEvent).not.toHaveBeenCalled()
    expect(screen.queryByText(/somente neste computador/)).toBeNull()
  })

  it('REQ-OB-3: a plain event gets the lighter confirmation, without the readings warning', async () => {
    mocks.listDeadEvents.mockResolvedValue({
      data: [customerEvent],
      total: 1,
    })

    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }))

    expect(screen.queryByText(/leituras/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy()
  })

  it('REQ-OB-3: "Tentar novamente" puts the event back in the queue', async () => {
    mocks.listDeadEvents
      .mockResolvedValueOnce({ data: [executionEvent], total: 1 })
      .mockResolvedValueOnce({ data: [], total: 0 })
    mocks.requeueDeadEvent.mockResolvedValue({
      data: { eventId: 'event:execution-1' },
      syncStatus: {},
    })

    renderSection()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Tentar novamente' }),
    )

    await waitFor(() => {
      expect(mocks.requeueDeadEvent).toHaveBeenCalledWith('event:execution-1')
    })
    expect(mocks.refreshSyncStatus).toHaveBeenCalled()
  })
})

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <DeadEventsSection />
    </QueryClientProvider>,
  )
}
