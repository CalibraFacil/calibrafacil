// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  operation,
  type OperationTargetState,
  RuntimeHealthSnapshot,
} from '@calibra-facil/client-runtime'
import type { SyncStatusSnapshot } from '@calibra-facil/contracts'

import { SyncStatusProvider } from './sync-status'
import {
  useAvailability,
  useOperationAvailability,
  useRuntimeHealth,
} from './use-operation-availability'

const isDesktopRuntimeMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/runtime/desktop', () => ({
  isDesktopRuntime: isDesktopRuntimeMock,
}))

function bridgeWith(snapshot: SyncStatusSnapshot) {
  return {
    getSyncStatus: vi.fn(async () => snapshot),
    onSyncStatus: (listener: (value: SyncStatusSnapshot) => void) => {
      listener(snapshot)
      return () => {}
    },
  }
}

function syncSnapshot(
  overrides: Partial<SyncStatusSnapshot> = {},
): SyncStatusSnapshot {
  return {
    state: 'idle',
    pendingOutboxCount: 0,
    conflictCount: 0,
    lastSyncedAt: '2026-09-09T12:00:00.000Z',
    ...overrides,
  }
}

function Wrapper({
  children,
  isDesktop,
}: {
  children: ReactNode
  isDesktop: boolean
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return (
    <QueryClientProvider client={queryClient}>
      <SyncStatusProvider isDesktop={isDesktop}>{children}</SyncStatusProvider>
    </QueryClientProvider>
  )
}

function ApproveProbe({ target }: { target?: OperationTargetState }) {
  const availability = useOperationAvailability('jobs', 'approve', target)

  return (
    <output data-testid="probe">
      {availability.available
        ? `available:${availability.source}`
        : `blocked:${availability.reason}`}
    </output>
  )
}

const FINANCE_SECTION = [operation('finance', 'getOverview')] as const
const REFERENCE_SECTION = [operation('customers', 'get')] as const

function SectionProbe({
  operations,
  target,
}: {
  operations: Parameters<typeof useAvailability>[0]
  target?: OperationTargetState
}) {
  return (
    <output data-testid="section">
      {useAvailability(operations, target) ? 'shown' : 'hidden'}
    </output>
  )
}

function HealthProbe() {
  const health: RuntimeHealthSnapshot = useRuntimeHealth()

  return (
    <output data-testid="health">
      {`${health.isDesktop}:${health.cloud}:${health.localRuntime}:${health.localCacheBootstrapped}`}
    </output>
  )
}

function renderProbe(
  node: ReactNode,
  options: { isDesktop: boolean; snapshot?: SyncStatusSnapshot },
) {
  if (options.isDesktop) {
    isDesktopRuntimeMock.mockReturnValue(true)
    Object.defineProperty(window, 'calibraBridge', {
      configurable: true,
      value: bridgeWith(options.snapshot ?? syncSnapshot()),
    })
  }

  return render(<Wrapper isDesktop={options.isDesktop}>{node}</Wrapper>)
}

describe('useOperationAvailability', () => {
  beforeEach(() => {
    isDesktopRuntimeMock.mockReturnValue(false)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'calibraBridge')
    vi.clearAllMocks()
  })

  it('allows approving a job on a connected desktop', async () => {
    // PAR-05: this used to be denied outright by `!runtime.isDesktop`, which
    // sent the approver to the browser for a command the desktop can run.
    renderProbe(<ApproveProbe />, { isDesktop: true })

    expect(await screen.findByText('available:cloud')).toBeTruthy()
  })

  it('allows approving in the browser', () => {
    renderProbe(<ApproveProbe />, { isDesktop: false })

    expect(screen.getByTestId('probe').textContent).toBe('available:cloud')
  })

  it('blocks approving while the desktop has no network', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    renderProbe(<ApproveProbe />, { isDesktop: true })

    expect(await screen.findByText('blocked:cloud-unreachable')).toBeTruthy()
  })

  it('blocks approving a job whose readings are still queued locally', async () => {
    renderProbe(
      <ApproveProbe target={{ synced: true, hasPendingLocalChanges: true }} />,
      { isDesktop: true },
    )

    expect(
      await screen.findByText('blocked:entity-has-pending-changes'),
    ).toBeTruthy()
  })

  it('ignores an entity target in the browser, which has no outbox', () => {
    renderProbe(
      <ApproveProbe target={{ synced: false, hasPendingLocalChanges: true }} />,
      { isDesktop: false },
    )

    expect(screen.getByTestId('probe').textContent).toBe('available:cloud')
  })
})

describe('useAvailability', () => {
  beforeEach(() => {
    isDesktopRuntimeMock.mockReturnValue(false)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'calibraBridge')
    vi.clearAllMocks()
  })

  it('shows a cloud-only section in the browser', () => {
    renderProbe(<SectionProbe operations={FINANCE_SECTION} />, {
      isDesktop: false,
    })

    expect(screen.getByTestId('section').textContent).toBe('shown')
  })

  it('shows a cloud-only section on a connected desktop', async () => {
    // Finance used to be hidden by a bare `!isDesktopRuntime()` although its
    // calls reach the cloud through the hybrid client.
    renderProbe(<SectionProbe operations={FINANCE_SECTION} />, {
      isDesktop: true,
    })

    expect(await screen.findByText('shown')).toBeTruthy()
  })

  it('hides a cloud-only section while the desktop has no network', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    renderProbe(<SectionProbe operations={FINANCE_SECTION} />, {
      isDesktop: true,
    })

    expect(await screen.findByText('hidden')).toBeTruthy()
  })

  it('keeps a local-first reference section while the desktop has no network', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    renderProbe(<SectionProbe operations={REFERENCE_SECTION} />, {
      isDesktop: true,
    })

    expect(await screen.findByText('shown')).toBeTruthy()
  })

  it('hides a cloud section for a record that was created offline', async () => {
    renderProbe(
      <SectionProbe operations={FINANCE_SECTION} target={{ synced: false }} />,
      { isDesktop: true },
    )

    expect(await screen.findByText('hidden')).toBeTruthy()
  })
})

describe('useRuntimeHealth', () => {
  beforeEach(() => {
    isDesktopRuntimeMock.mockReturnValue(false)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'calibraBridge')
    vi.clearAllMocks()
  })

  it('reports a bootstrapped, connected desktop', async () => {
    renderProbe(<HealthProbe />, { isDesktop: true })

    expect(await screen.findByText('true:reachable:healthy:true')).toBeTruthy()
  })

  it('reports the browser as having no local runtime and no cache', () => {
    renderProbe(<HealthProbe />, { isDesktop: false })

    expect(screen.getByTestId('health').textContent).toBe(
      'false:unknown:unavailable:false',
    )
  })

  it('does not require the sync provider to be mounted', () => {
    // Public routes and isolated component tests render outside the shell;
    // throwing there would blank a page that has no sync surface anyway.
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <HealthProbe />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('health').textContent).toBe(
      'false:unknown:unavailable:false',
    )
  })
})
