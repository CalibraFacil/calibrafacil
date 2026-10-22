// @vitest-environment jsdom

import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncStatusSnapshot } from '@calibra-facil/contracts'

import type { ServiceOrderDetail } from './types'

// Offline mode keeps the service-order detail page readable (Q13: reference
// reads), but saving a quote draft, recording the execution and issuing the
// delivery document are online-only. Rendering the real page on a desktop with
// no connection must show those actions disabled, not let them fail with a
// network error.

const orderMock = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/runtime/desktop', () => ({ isDesktopRuntime: () => true }))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    materials: { list: async () => ({ data: [] }) },
    serviceOrders: {},
  },
}))

vi.mock('@/features/service-orders/queries', () => ({
  getServiceOrderDeliveryDocumentUrl: vi.fn(),
  getServiceOrderIntakeDocumentUrl: vi.fn(),
  getServiceOrderTagDocumentUrl: vi.fn(),
  useServiceOrderDetailData: () => ({ data: orderMock.current }),
  useServiceOrderMaterialsData: () => ({
    data: { data: [] },
    isLoading: false,
  }),
  useServiceOrderCommunicationsData: () => ({
    data: { data: [] },
    isPending: false,
    isError: false,
  }),
  useServiceOrderFinancialStatusData: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

import { SyncStatusProvider } from '@/runtime/sync-status'
import { ServiceOrderDetailPage } from './detail-page'

function bridgeWith(snapshot: SyncStatusSnapshot) {
  return {
    getSyncStatus: vi.fn(async () => snapshot),
    onSyncStatus: (listener: (value: SyncStatusSnapshot) => void) => {
      listener(snapshot)
      return () => {}
    },
  }
}

function order(overrides: Partial<ServiceOrderDetail>): ServiceOrderDetail {
  return {
    id: 42,
    publicId: 'os-public-42',
    serviceOrderNumber: 'OS-2026-0042',
    customerId: 1,
    assetId: 2,
    status: 'under_evaluation',
    priority: 'normal',
    statusLabel: 'Em avaliação',
    customerName: 'Acme Lab',
    assetName: 'Balança 01',
    claimedDefect: 'Não liga',
    intakeCondition: 'Sem danos',
    openedAt: '2026-01-15T10:00:00.000Z',
    evaluations: [
      {
        id: 1,
        diagnosis: 'Fonte danificada',
        recommendedAction: 'repair',
        requiresQuote: true,
        requiresClientApproval: true,
        calibrationRecommended: false,
        evaluatedAt: '2026-01-15T11:00:00.000Z',
      },
    ],
    quotes: [],
    execution: null,
    deliveryDocuments: [],
    events: [],
    ...overrides,
  }
}

function renderPage(
  fixture: ServiceOrderDetail,
  tab: string,
  connectivity: 'online' | 'offline',
) {
  orderMock.current = fixture
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: connectivity === 'online',
  })
  Object.defineProperty(window, 'calibraBridge', {
    configurable: true,
    value: bridgeWith({
      state: connectivity === 'online' ? 'idle' : 'offline',
      pendingOutboxCount: 0,
      conflictCount: 0,
      lastSyncedAt: '2026-09-09T12:00:00.000Z',
    }),
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SyncStatusProvider isDesktop>
        <ServiceOrderDetailPage
          publicId={fixture.publicId}
          conflictReturn={{}}
        />
      </SyncStatusProvider>
    </QueryClientProvider>,
  )

  // Radix/Base UI tabs switch on mousedown + click.
  const trigger = within(view.container).getByRole('tab', {
    name: new RegExp(`^\\d?${tab}`),
  })
  fireEvent.mouseDown(trigger)
  fireEvent.click(trigger)

  return view
}

function actionButton(name: string): HTMLButtonElement {
  const button = screen.getByRole('button', { name })
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`${name} is not a button`)
  }
  return button
}

const SCENARIOS = [
  {
    action: 'Salvar rascunho',
    tab: 'Orçamento',
    fixture: () => order({ status: 'under_evaluation' }),
  },
  {
    action: 'Iniciar execução',
    tab: 'Execução',
    fixture: () => order({ status: 'quote_approved' }),
  },
  {
    action: 'Finalizar execução',
    tab: 'Execução',
    fixture: () =>
      order({
        status: 'repair_in_progress',
        execution: {
          id: 7,
          startedAt: '2026-01-16T09:00:00.000Z',
          finishedAt: null,
          calibrationRequiredAfterRepair: false,
          items: [],
        },
      }),
  },
  {
    action: 'Gerar comprovante de entrega',
    tab: 'Entrega',
    fixture: () => order({ status: 'ready_for_pickup' }),
  },
] as const

describe('service-order detail page on a disconnected desktop (Q13)', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'calibraBridge')
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'calibraBridge')
  })

  it.each(SCENARIOS)(
    '"$action" is enabled while connected (control)',
    async ({ action, tab, fixture }) => {
      renderPage(fixture(), tab, 'online')

      expect(
        (await screen.findByRole('button', { name: action })).hasAttribute(
          'disabled',
        ),
      ).toBe(false)
    },
  )

  it.each(SCENARIOS)(
    '"$action" is disabled with no connection',
    async ({ action, tab, fixture }) => {
      renderPage(fixture(), tab, 'offline')

      await screen.findByRole('button', { name: action })
      expect(actionButton(action).disabled).toBe(true)
    },
  )

  it('keeps the page itself readable offline', async () => {
    renderPage(order({ status: 'ready_for_pickup' }), 'Entrega', 'offline')

    expect(await screen.findByText('OS-2026-0042')).toBeTruthy()
  })
})
