import { describe, expect, it, vi } from 'vitest'
import type { LocalPartitionActivationResult } from '@calibra-facil/contracts'

import {
  activateLocalPartition,
  toLocalDatabasePartition,
  type LocalPartitionBridge,
} from './local-partition'

const ana = { userId: 'user-ana', organizationId: 'org-1' }

function bridgeReturning(result: LocalPartitionActivationResult) {
  const activate = vi.fn(async () => result)
  const bridge: LocalPartitionBridge = { activateLocalPartition: activate }

  return { bridge, activate }
}

describe('toLocalDatabasePartition', () => {
  it('builds a partition from both halves', () => {
    expect(toLocalDatabasePartition(ana)).toEqual(ana)
  })

  it('refuses an account with no organization', () => {
    // Not "an organization-wide partition" — not a partition at all. Treating
    // it as one is how a cache ends up shared between organizations.
    expect(
      toLocalDatabasePartition({ userId: 'user-ana', organizationId: null }),
    ).toBeNull()
  })

  it('refuses an organization with no account', () => {
    expect(
      toLocalDatabasePartition({ userId: null, organizationId: 'org-1' }),
    ).toBeNull()
  })

  it('is null for a missing identity', () => {
    expect(toLocalDatabasePartition(null)).toBeNull()
    expect(toLocalDatabasePartition(undefined)).toBeNull()
  })
})

describe('activateLocalPartition', () => {
  it('passes the verification flag through untouched', async () => {
    // Reporting an unverified session as verified would defeat the host's
    // guard entirely, so this must never be inferred locally.
    const { bridge, activate } = bridgeReturning({ status: 'idle' })

    await activateLocalPartition({
      bridge,
      identity: ana,
      identityVerified: false,
    })

    expect(activate).toHaveBeenCalledWith({
      partition: ana,
      identityVerified: false,
    })
  })

  it('requires a cache reset when the host switched databases', async () => {
    const { bridge } = bridgeReturning({
      status: 'active',
      partition: ana,
      switched: true,
    })

    await expect(
      activateLocalPartition({ bridge, identity: ana, identityVerified: true }),
    ).resolves.toMatchObject({ requiresCacheReset: true })
  })

  it('does not reset when the same database stayed open', async () => {
    const { bridge } = bridgeReturning({
      status: 'active',
      partition: ana,
      switched: false,
    })

    await expect(
      activateLocalPartition({ bridge, identity: ana, identityVerified: true }),
    ).resolves.toMatchObject({ requiresCacheReset: false })
  })

  it('resets on a refusal, because what is cached is no longer served', async () => {
    const { bridge } = bridgeReturning({
      status: 'refused',
      reason: 'offline-switch-requires-authentication',
      message: 'Entre online para usar esta conta neste computador.',
    })

    await expect(
      activateLocalPartition({
        bridge,
        identity: ana,
        identityVerified: false,
      }),
    ).resolves.toMatchObject({ requiresCacheReset: true })
  })

  it('resets when the host could not open the partition', async () => {
    const { bridge } = bridgeReturning({
      status: 'failed',
      message: 'Não foi possível abrir os dados locais.',
    })

    await expect(
      activateLocalPartition({ bridge, identity: ana, identityVerified: true }),
    ).resolves.toMatchObject({ requiresCacheReset: true })
  })

  it('does not reset when there was nothing to open', async () => {
    const { bridge } = bridgeReturning({ status: 'idle' })

    await expect(
      activateLocalPartition({
        bridge,
        identity: null,
        identityVerified: false,
      }),
    ).resolves.toMatchObject({ requiresCacheReset: false })
  })
})
