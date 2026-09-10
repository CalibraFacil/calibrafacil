import { describe, expect, it, vi } from 'vitest'

import {
  getDataSourceIndicatorModel,
  isDesktopCloudOnlyUnavailableSnapshot,
  runDesktopManualSync,
  type DataSourceIndicatorSnapshot,
  syncCompletionClearedBlockers,
} from './sync-status-model'

describe('isDesktopCloudOnlyUnavailableSnapshot', () => {
  it('keeps web routes available regardless of offline signals', () => {
    expect(
      isDesktopCloudOnlyUnavailableSnapshot(
        { isDesktop: false, state: 'offline', lastSyncedAt: null },
        { isBrowserOnline: false },
      ),
    ).toBe(false)
  })

  it('blocks desktop cloud-only routes when the sync state is offline', () => {
    expect(
      isDesktopCloudOnlyUnavailableSnapshot({
        isDesktop: true,
        state: 'offline',
        lastSyncedAt: '2026-05-09T22:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('blocks desktop cloud-only routes when the cache has never bootstrapped after a sync error', () => {
    expect(
      isDesktopCloudOnlyUnavailableSnapshot({
        isDesktop: true,
        state: 'error',
        lastSyncedAt: null,
      }),
    ).toBe(true)
  })

  it('keeps desktop cloud-only routes available before bootstrap if the browser reports online', () => {
    expect(
      isDesktopCloudOnlyUnavailableSnapshot(
        {
          isDesktop: true,
          state: 'error',
          lastSyncedAt: null,
        },
        { isBrowserOnline: true },
      ),
    ).toBe(false)
  })

  it('keeps desktop cloud-only routes available after a sync error if cloud connectivity still appears online', () => {
    expect(
      isDesktopCloudOnlyUnavailableSnapshot(
        {
          isDesktop: true,
          state: 'error',
          lastSyncedAt: '2026-05-09T22:00:00.000Z',
        },
        { isBrowserOnline: true },
      ),
    ).toBe(false)
  })

  it('blocks desktop cloud-only routes immediately when the browser reports offline', () => {
    expect(
      isDesktopCloudOnlyUnavailableSnapshot(
        { isDesktop: true, state: 'idle', lastSyncedAt: null },
        { isBrowserOnline: false },
      ),
    ).toBe(true)
  })

  it('keeps desktop cloud-only routes available while idle and online', () => {
    expect(
      isDesktopCloudOnlyUnavailableSnapshot(
        { isDesktop: true, state: 'idle', lastSyncedAt: null },
        { isBrowserOnline: true },
      ),
    ).toBe(false)
  })
})

describe('getDataSourceIndicatorModel', () => {
  const baseSnapshot: DataSourceIndicatorSnapshot = {
    isDesktop: true,
    state: 'idle',
    lastSyncedAt: null,
    pendingOutboxCount: 0,
    conflictCount: 0,
  }

  it.each([
    [
      'cloud',
      {},
      {
        label: 'Nuvem',
        variant: 'secondary',
        dotClassName: 'bg-emerald-500',
      },
    ],
    [
      'local cache',
      { lastSyncedAt: '2026-05-09T22:00:00.000Z' },
      {
        label: 'Cache local',
        title: 'Fonte de dados: cache local',
        description: expect.stringContaining('segundo plano'),
        variant: 'secondary',
        dotClassName: 'bg-emerald-500',
      },
    ],
    [
      'syncing',
      { state: 'syncing' },
      {
        label: 'Sincronizando',
        variant: 'secondary',
        dotClassName: 'bg-blue-500',
      },
    ],
    [
      'pending outbox',
      { pendingOutboxCount: 2 },
      {
        label: 'Pendente',
        variant: 'outline',
        dotClassName: 'bg-amber-500',
      },
    ],
    [
      'offline cache',
      {
        state: 'offline',
        lastSyncedAt: '2026-05-09T22:00:00.000Z',
      },
      {
        label: 'Cache offline',
        variant: 'outline',
        dotClassName: 'bg-amber-500',
      },
    ],
    [
      'offline without cache',
      { state: 'offline' },
      {
        label: 'Cache indisponível',
        variant: 'destructive',
        dotClassName: 'bg-destructive',
      },
    ],
    [
      'error with cache',
      { state: 'error', lastSyncedAt: '2026-05-09T22:00:00.000Z' },
      {
        label: 'Atenção',
        description: expect.stringContaining('cache local mais recente'),
        variant: 'destructive',
        dotClassName: 'bg-destructive',
      },
    ],
    [
      'error before bootstrap',
      { state: 'error' },
      {
        label: 'Cache não pronto',
        variant: 'destructive',
        dotClassName: 'bg-destructive',
      },
    ],
    [
      'conflict',
      { state: 'conflict', conflictCount: 1 },
      {
        label: 'Conflitos',
        variant: 'destructive',
        dotClassName: 'bg-destructive',
      },
    ],
  ] as const)('models %s state', (_name, patch, expected) => {
    expect(
      getDataSourceIndicatorModel({
        ...baseSnapshot,
        ...patch,
      }),
    ).toMatchObject(expected)
  })
})

describe('runDesktopManualSync', () => {
  it('starts sync through the desktop bridge and refreshes status', async () => {
    const bridge = { startSync: vi.fn(async () => ({ ok: true })) }
    const refresh = vi.fn(async () => undefined)

    await runDesktopManualSync(bridge, refresh)

    expect(bridge.startSync).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh status when bridge sync start fails', async () => {
    const bridge = {
      startSync: vi.fn(async () => {
        throw new Error('sync failed')
      }),
    }
    const refresh = vi.fn(async () => undefined)

    await expect(runDesktopManualSync(bridge, refresh)).rejects.toThrow(
      'sync failed',
    )

    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes status and reports structured sync action failures', async () => {
    const bridge = {
      startSync: vi.fn(async () => ({
        ok: false,
        message: 'cloud sync routes are not deployed',
      })),
    }
    const refresh = vi.fn(async () => undefined)

    await expect(runDesktopManualSync(bridge, refresh)).rejects.toThrow(
      'cloud sync routes are not deployed',
    )

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('syncCompletionClearedBlockers', () => {
  const base = {
    lastSyncedAt: '2026-09-10T10:00:00.000Z',
    pendingOutboxCount: 3,
  }

  it('is false on the first snapshot, with nothing to compare', () => {
    expect(syncCompletionClearedBlockers(null, base)).toBe(false)
  })

  it('is true once the queue has drained', () => {
    // The pending count reaching zero is when an entity stops reporting local
    // changes — and when its cloud actions should become available.
    expect(
      syncCompletionClearedBlockers(base, { ...base, pendingOutboxCount: 0 }),
    ).toBe(true)
  })

  it('still refetches when a stuck row keeps the count above zero', () => {
    // `countPendingOutbox` includes permanently failed rows, so keying on
    // "count > 0" would disable every post-sync refetch until reload.
    expect(
      syncCompletionClearedBlockers(
        { lastSyncedAt: '2026-09-10T10:00:00.000Z', pendingOutboxCount: 1 },
        { lastSyncedAt: '2026-09-10T10:05:00.000Z', pendingOutboxCount: 1 },
      ),
    ).toBe(true)
  })

  it('stays quiet while a backlog is still draining', () => {
    // The scheduler runs every couple of seconds during a drain. Reacting to
    // each intermediate run would refetch every mounted query for the whole
    // drain — minutes of it after a day offline.
    expect(
      syncCompletionClearedBlockers(
        { lastSyncedAt: '2026-09-10T10:00:00.000Z', pendingOutboxCount: 90 },
        { lastSyncedAt: '2026-09-10T10:00:02.000Z', pendingOutboxCount: 40 },
      ),
    ).toBe(false)
  })

  it('is true when a run completed, even with nothing queued', () => {
    // A pull can change an entity's remote id or status without the outbox
    // being involved at all.
    expect(
      syncCompletionClearedBlockers(
        { lastSyncedAt: '2026-09-10T10:00:00.000Z', pendingOutboxCount: 0 },
        { lastSyncedAt: '2026-09-10T10:05:00.000Z', pendingOutboxCount: 0 },
      ),
    ).toBe(true)
  })

  it('is false for an unchanged snapshot', () => {
    // Status pushes repeat; refetching everything on each would be a loop.
    expect(syncCompletionClearedBlockers(base, { ...base })).toBe(false)
  })

  it('is false when new work was queued rather than drained', () => {
    expect(
      syncCompletionClearedBlockers(base, { ...base, pendingOutboxCount: 5 }),
    ).toBe(false)
  })

  it('is false before anything has ever synced', () => {
    expect(
      syncCompletionClearedBlockers(
        { lastSyncedAt: null, pendingOutboxCount: 2 },
        { lastSyncedAt: null, pendingOutboxCount: 2 },
      ),
    ).toBe(false)
  })
})
