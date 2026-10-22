import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import type { SyncStatusSnapshot } from '@calibra-facil/contracts'

import { SyncStatusProvider } from '@/runtime/sync-status'

/**
 * Renders `node` the way the dashboard shell would on a desktop that is
 * connected to, or cut off from, the cloud. Tests that use it must also mock
 * `@/runtime/desktop` so `isDesktopRuntime()` answers true.
 */
export function renderOnDesktop(
  node: ReactNode,
  connectivity: 'online' | 'offline',
) {
  const snapshot: SyncStatusSnapshot = {
    state: connectivity === 'online' ? 'idle' : 'offline',
    pendingOutboxCount: 0,
    conflictCount: 0,
    lastSyncedAt: '2026-09-09T12:00:00.000Z',
  }

  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: connectivity === 'online',
  })
  Object.defineProperty(window, 'calibraBridge', {
    configurable: true,
    value: {
      getSyncStatus: vi.fn(async () => snapshot),
      onSyncStatus: (listener: (value: SyncStatusSnapshot) => void) => {
        listener(snapshot)
        return () => {}
      },
    },
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SyncStatusProvider isDesktop>{node}</SyncStatusProvider>
    </QueryClientProvider>,
  )
}

export function forgetDesktopBridge() {
  Reflect.deleteProperty(window, 'calibraBridge')
}
