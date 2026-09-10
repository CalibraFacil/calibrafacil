import { describe, expect, it } from 'vitest'
import type { ActivateLocalPartitionOutcome } from './local-partition'

import { resolveLocalPartitionGate } from './use-local-partition'

const ana = { userId: 'user-ana', organizationId: 'org-1' }

function gate(
  overrides: Partial<Parameters<typeof resolveLocalPartitionGate>[0]> = {},
) {
  return resolveLocalPartitionGate({
    isDesktop: true,
    isPending: false,
    outcome: undefined,
    error: null,
    ...overrides,
  })
}

function outcome(
  value: ActivateLocalPartitionOutcome,
): ActivateLocalPartitionOutcome {
  return value
}

describe('resolveLocalPartitionGate', () => {
  it('never blocks the browser, which has no local database', () => {
    expect(gate({ isDesktop: false, isPending: true })).toEqual({
      state: 'ready',
    })
  })

  it('holds the dashboard while the host is deciding', () => {
    // Rendering before the right database is open is the defect this exists
    // to prevent.
    expect(gate({ isPending: true })).toEqual({ state: 'pending' })
  })

  it('holds the dashboard when there is no result yet', () => {
    expect(gate({ isPending: false, outcome: undefined })).toEqual({
      state: 'pending',
    })
  })

  it('opens once the host reports an active partition', () => {
    expect(
      gate({
        outcome: outcome({
          status: 'active',
          partition: ana,
          switched: false,
          requiresCacheReset: false,
        }),
      }),
    ).toEqual({ state: 'ready' })
  })

  it('opens after a switch, since the cache was already cleared', () => {
    expect(
      gate({
        outcome: outcome({
          status: 'active',
          partition: ana,
          switched: true,
          requiresCacheReset: true,
        }),
      }),
    ).toEqual({ state: 'ready' })
  })

  it('blocks with the host reason when activation was refused', () => {
    expect(
      gate({
        outcome: outcome({
          status: 'refused',
          reason: 'offline-switch-requires-authentication',
          message: 'Entre online para usar esta conta neste computador.',
          requiresCacheReset: true,
        }),
      }),
    ).toEqual({
      state: 'blocked',
      message: 'Entre online para usar esta conta neste computador.',
    })
  })

  it('blocks when the host could not open the partition', () => {
    expect(
      gate({
        outcome: outcome({
          status: 'failed',
          message: 'Não foi possível abrir os dados locais.',
          requiresCacheReset: true,
        }),
      }),
    ).toMatchObject({ state: 'blocked' })
  })

  it('blocks on an unexpected error rather than falling open', () => {
    // A thrown activation must not be read as permission to render.
    expect(gate({ error: new Error('ipc down') })).toMatchObject({
      state: 'blocked',
    })
  })

  it('treats idle as ready, since nothing was opened to guard', () => {
    // No identity and no prior grant: the sign-in guard handles this, not the
    // partition gate.
    expect(
      gate({ outcome: outcome({ status: 'idle', requiresCacheReset: false }) }),
    ).toEqual({ state: 'ready' })
  })
})
