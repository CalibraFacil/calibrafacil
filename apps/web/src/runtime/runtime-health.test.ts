import { describe, expect, it } from 'vitest'

import {
  buildRuntimeHealthSnapshot,
  classifyCloudReachability,
  classifyLocalRuntimeHealth,
  describeRuntimeHealth,
  isTransportFailureMessage,
  type RuntimeHealthInputs,
} from './runtime-health'

function inputs(
  overrides: Partial<RuntimeHealthInputs> = {},
): RuntimeHealthInputs {
  return {
    isDesktop: true,
    browserOnline: true,
    hasBridge: true,
    sync: {
      state: 'idle',
      lastSyncedAt: '2026-09-09T12:00:00.000Z',
      lastError: null,
      pendingOutboxCount: 0,
      conflictCount: 0,
    },
    ...overrides,
  }
}

describe('isTransportFailureMessage', () => {
  it('recognizes connectivity failures', () => {
    for (const message of [
      'Failed to fetch',
      'network request failed',
      'connect ECONNREFUSED 127.0.0.1:3000',
      'getaddrinfo ENOTFOUND cloud.calibrafacil.com',
      'Cloud pull failed with HTTP 502',
      'request timeout',
      'unable to verify the first certificate',
    ]) {
      expect(isTransportFailureMessage(message)).toBe(true)
    }
  })

  it('does not treat an authorization or validation answer as a connectivity failure', () => {
    // The cloud answered. Gating actions on these would hide the server's own
    // message behind a bogus "sem conexão".
    for (const message of [
      'Cloud push failed with HTTP 401',
      'Cloud push failed with HTTP 403',
      'Cloud push failed with HTTP 409',
      'Cloud push failed with HTTP 422',
      'Job já aprovado',
    ]) {
      expect(isTransportFailureMessage(message)).toBe(false)
    }
  })

  it('treats a missing message as no evidence', () => {
    expect(isTransportFailureMessage(null)).toBe(false)
    expect(isTransportFailureMessage(undefined)).toBe(false)
    expect(isTransportFailureMessage('')).toBe(false)
  })
})

describe('classifyCloudReachability', () => {
  it('never claims to observe the cloud in the browser', () => {
    expect(classifyCloudReachability(inputs({ isDesktop: false }))).toBe(
      'unknown',
    )
  })

  it('is unreachable when the OS reports no network', () => {
    expect(classifyCloudReachability(inputs({ browserOnline: false }))).toBe(
      'unreachable',
    )
  })

  it('does not treat a stopped local sync runtime as a cloud outage', () => {
    // `state: 'offline'` also means CALIBRA_SYNC_ENABLED=false, or the host
    // could not read the local server yet — neither says anything about the
    // cloud, which reaches the app through a separate proxy.
    expect(
      classifyCloudReachability(
        inputs({
          sync: { state: 'offline', lastSyncedAt: null, lastError: null },
        }),
      ),
    ).not.toBe('unreachable')
  })

  it('still reports unreachable when the OS says there is no network', () => {
    expect(
      classifyCloudReachability(
        inputs({
          browserOnline: false,
          sync: { state: 'offline', lastSyncedAt: null, lastError: null },
        }),
      ),
    ).toBe('unreachable')
  })

  it('is unreachable after a transport-shaped sync failure', () => {
    expect(
      classifyCloudReachability(
        inputs({
          sync: {
            state: 'error',
            lastSyncedAt: '2026-09-09T11:00:00.000Z',
            lastError: 'Failed to fetch',
          },
        }),
      ),
    ).toBe('unreachable')
  })

  it('stays reachable after a sync failure the cloud actually answered', () => {
    // A rejected push is a domain answer. Cloud actions must remain enabled so
    // the user sees the real reason.
    expect(
      classifyCloudReachability(
        inputs({
          sync: {
            state: 'error',
            lastSyncedAt: '2026-09-09T11:00:00.000Z',
            lastError: 'Cloud push failed with HTTP 409',
          },
        }),
      ),
    ).toBe('reachable')
  })

  it('is unreachable when the scheduler is retrying a transport failure', () => {
    expect(
      classifyCloudReachability(
        inputs({
          sync: {
            state: 'idle',
            lastSyncedAt: '2026-09-09T11:00:00.000Z',
            lastError: 'connect ECONNREFUSED 127.0.0.1:3000',
            scheduler: {
              running: true,
              paused: false,
              syncing: false,
              consecutiveFailures: 3,
              lastTrigger: 'poll',
              nextRunAt: '2026-09-09T12:00:20.000Z',
            },
          },
        }),
      ),
    ).toBe('unreachable')
  })

  it('ignores a stale transport error once the scheduler has recovered', () => {
    expect(
      classifyCloudReachability(
        inputs({
          sync: {
            state: 'idle',
            lastSyncedAt: '2026-09-09T12:00:00.000Z',
            lastError: 'Failed to fetch',
            scheduler: {
              running: true,
              paused: false,
              syncing: false,
              consecutiveFailures: 0,
              lastTrigger: 'poll',
              nextRunAt: '2026-09-09T12:02:00.000Z',
            },
          },
        }),
      ),
    ).toBe('reachable')
  })

  it('reports no evidence before the first successful sync', () => {
    expect(
      classifyCloudReachability(
        inputs({
          sync: { state: 'idle', lastSyncedAt: null, lastError: null },
        }),
      ),
    ).toBe('unknown')
  })
})

describe('classifyLocalRuntimeHealth', () => {
  it('is healthy with a bridge on desktop', () => {
    expect(classifyLocalRuntimeHealth(inputs())).toBe('healthy')
  })

  it('is unavailable without the preload bridge', () => {
    expect(classifyLocalRuntimeHealth(inputs({ hasBridge: false }))).toBe(
      'unavailable',
    )
  })

  it('is unavailable when local status cannot be read', () => {
    expect(
      classifyLocalRuntimeHealth(inputs({ localStatusUnreadable: true })),
    ).toBe('unavailable')
  })

  it('is unavailable in the browser, which has no local runtime', () => {
    expect(classifyLocalRuntimeHealth(inputs({ isDesktop: false }))).toBe(
      'unavailable',
    )
  })
})

describe('buildRuntimeHealthSnapshot', () => {
  it('treats a sync timestamp as the bootstrap signal', () => {
    expect(buildRuntimeHealthSnapshot(inputs())).toMatchObject({
      isDesktop: true,
      cloud: 'reachable',
      localRuntime: 'healthy',
      localCacheBootstrapped: true,
    })
  })

  it('is never bootstrapped in the browser', () => {
    expect(
      buildRuntimeHealthSnapshot(inputs({ isDesktop: false })),
    ).toMatchObject({ localCacheBootstrapped: false })
  })

  it('carries pending and conflict counts through', () => {
    expect(
      buildRuntimeHealthSnapshot(
        inputs({
          sync: {
            state: 'conflict',
            lastSyncedAt: '2026-09-09T12:00:00.000Z',
            pendingOutboxCount: 4,
            conflictCount: 2,
          },
        }),
      ),
    ).toMatchObject({ pendingOutboxCount: 4, conflictCount: 2 })
  })
})

describe('describeRuntimeHealth', () => {
  it('says nothing in the browser', () => {
    expect(
      describeRuntimeHealth(
        buildRuntimeHealthSnapshot(inputs({ isDesktop: false })),
      ),
    ).toBeNull()
  })

  it('says nothing when a connected desktop is fully in sync', () => {
    expect(
      describeRuntimeHealth(buildRuntimeHealthSnapshot(inputs())),
    ).toBeNull()
  })

  it('reports the local runtime before anything else', () => {
    // A dead local process explains every other symptom, so it leads.
    expect(
      describeRuntimeHealth(
        buildRuntimeHealthSnapshot(
          inputs({
            hasBridge: false,
            browserOnline: false,
            sync: {
              state: 'conflict',
              lastSyncedAt: null,
              conflictCount: 3,
              pendingOutboxCount: 5,
            },
          }),
        ),
      ),
    ).toMatchObject({ tone: 'error' })
  })

  it('distinguishes offline-with-cache from offline-without-cache', () => {
    const withCache = describeRuntimeHealth(
      buildRuntimeHealthSnapshot(inputs({ browserOnline: false })),
    )
    const withoutCache = describeRuntimeHealth(
      buildRuntimeHealthSnapshot(
        inputs({
          browserOnline: false,
          sync: { state: 'idle', lastSyncedAt: null },
        }),
      ),
    )

    expect(withCache?.summary).toContain('sincronizados neste computador')
    expect(withoutCache?.summary).toContain('sem cache local')
  })

  it('reports pending work with singular and plural agreement', () => {
    const one = describeRuntimeHealth(
      buildRuntimeHealthSnapshot(
        inputs({
          sync: {
            state: 'idle',
            lastSyncedAt: '2026-09-09T12:00:00.000Z',
            pendingOutboxCount: 1,
          },
        }),
      ),
    )
    const many = describeRuntimeHealth(
      buildRuntimeHealthSnapshot(
        inputs({
          sync: {
            state: 'idle',
            lastSyncedAt: '2026-09-09T12:00:00.000Z',
            pendingOutboxCount: 3,
          },
        }),
      ),
    )

    expect(one?.summary).toBe('1 alteração local aguardando envio.')
    expect(many?.summary).toBe('3 alterações locais aguardando envio.')
  })
})
