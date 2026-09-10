import type {
  LocalDatabasePartition,
  LocalPartitionActivationResult,
} from '@calibra-facil/contracts'

/**
 * Tells the desktop host which account's local database to open, and reacts to
 * what it decides.
 *
 * The renderer *asks*; it does not assert. The host owns the decision because
 * the renderer's idea of who is signed in comes from a session it cannot
 * independently verify — which is exactly the claim that must not be enough to
 * open another account's offline calibration records.
 *
 * Two obligations on this side:
 *
 * - **Report verification honestly.** `identityVerified` is true only when
 *   this attempt reached the cloud. A session restored from a cookie cache is
 *   not verification, and marking it as such would defeat the whole guard.
 * - **Drop everything on a switch.** A different database is now open, so
 *   every cached query, and anything rendered from one, belongs to the
 *   previous account.
 */
export type LocalPartitionBridge = {
  activateLocalPartition(request: {
    partition: LocalDatabasePartition | null
    identityVerified: boolean
  }): Promise<LocalPartitionActivationResult>
}

export type PartitionIdentity = {
  userId: string | null | undefined
  organizationId: string | null | undefined
}

/**
 * A partition needs both halves. An account without an organization is not
 * "an organization-wide partition" — it is not a partition at all, and
 * treating it as one is how a cache ends up shared.
 */
export function toLocalDatabasePartition(
  identity: PartitionIdentity | null | undefined,
): LocalDatabasePartition | null {
  if (!identity?.userId || !identity.organizationId) return null

  return {
    userId: identity.userId,
    organizationId: identity.organizationId,
  }
}

export type ActivateLocalPartitionOutcome = LocalPartitionActivationResult & {
  /** Cached data must be discarded before anything else renders. */
  requiresCacheReset: boolean
}

export async function activateLocalPartition({
  bridge,
  identity,
  identityVerified,
}: {
  bridge: LocalPartitionBridge
  identity: PartitionIdentity | null | undefined
  identityVerified: boolean
}): Promise<ActivateLocalPartitionOutcome> {
  const result = await bridge.activateLocalPartition({
    partition: toLocalDatabasePartition(identity),
    identityVerified,
  })

  return {
    ...result,
    // A refusal or a failure also has to clear: whatever is cached came from a
    // database the host has just declined to keep serving to this identity.
    requiresCacheReset:
      result.status === 'refused' ||
      result.status === 'failed' ||
      (result.status === 'active' && result.switched),
  }
}
