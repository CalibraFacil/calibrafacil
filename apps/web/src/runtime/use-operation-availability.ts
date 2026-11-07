import { useMemo } from 'react'
import {
  evaluateOperationAvailability,
  evaluateOperationsAvailability,
  type CalibraApiMethod,
  type CalibraApiNamespace,
  type OperationAvailability,
  type OperationRef,
  type OperationTargetState,
  type RuntimeHealthSnapshot,
} from '@calibra-facil/client-runtime'

import { isDesktopRuntime } from '@/runtime/desktop'
import {
  useBrowserOnlineStatus,
  useOptionalSyncStatus,
} from '@/runtime/sync-status'
import { buildRuntimeHealthSnapshot } from '@/runtime/runtime-health'

/**
 * The single place a feature asks "can the user do this right now, and if not
 * why". Replaces `!runtime.isDesktop` checks: those denied cloud actions on a
 * perfectly connected desktop, and gave the user no reason and no next step.
 *
 * This answers *availability* only. Permissions stay where they are — the
 * server decides those, and this hook must never be read as a substitute for
 * them.
 */
export function useRuntimeHealth(): RuntimeHealthSnapshot {
  const sync = useOptionalSyncStatus()
  // Outside the dashboard shell there is no sync surface to read; the host is
  // still whatever it is, so detect it directly rather than claiming browser.
  const isDesktop = sync?.isDesktop ?? isDesktopRuntime()
  const browserOnline = useBrowserOnlineStatus(isDesktop)
  const hasBridge =
    typeof window !== 'undefined' && Boolean(window.calibraBridge)
  const state = sync?.state ?? 'idle'
  const lastSyncedAt = sync?.lastSyncedAt ?? null
  const lastError = sync?.lastError ?? null
  const scheduler = sync?.scheduler ?? null
  const pendingOutboxCount = sync?.pendingOutboxCount ?? 0
  const conflictCount = sync?.conflictCount ?? 0

  return useMemo(
    () =>
      buildRuntimeHealthSnapshot({
        isDesktop,
        browserOnline,
        hasBridge,
        sync: {
          state,
          lastSyncedAt,
          lastError,
          scheduler,
          pendingOutboxCount,
          conflictCount,
        },
      }),
    [
      browserOnline,
      conflictCount,
      hasBridge,
      isDesktop,
      lastError,
      lastSyncedAt,
      pendingOutboxCount,
      scheduler,
      state,
    ],
  )
}

export function useOperationAvailability<
  TNamespace extends CalibraApiNamespace,
>(
  namespace: TNamespace,
  method: CalibraApiMethod<TNamespace>,
  target?: OperationTargetState,
): OperationAvailability {
  const health = useRuntimeHealth()
  const targetSynced = target?.synced
  const targetPending = target?.hasPendingLocalChanges

  return useMemo(
    () =>
      evaluateOperationAvailability({
        namespace,
        method,
        health,
        target:
          targetSynced === undefined && targetPending === undefined
            ? undefined
            : { synced: targetSynced, hasPendingLocalChanges: targetPending },
      }),
    [health, method, namespace, targetPending, targetSynced],
  )
}

/**
 * Whether a section can be shown: true when every method it renders from or
 * acts through can run in this runtime right now (`operation('finance',
 * 'getOverview')`). Use this instead of `!isDesktopRuntime()` to hide or show
 * a feature: a section appears exactly when its calls can run, so a cloud-only
 * module is listed on a connected desktop and hidden only while the cloud is
 * unreachable, and a method that becomes local-first in the data-policy
 * registry needs no edit here. `isDesktopRuntime()` stays for "which runtime"
 * questions (transport, desktop auth, window chrome).
 */
export function useAvailability(
  operations: readonly [OperationRef, ...OperationRef[]],
  target?: OperationTargetState,
): boolean {
  const health = useRuntimeHealth()
  const targetSynced = target?.synced
  const targetPending = target?.hasPendingLocalChanges

  return useMemo(
    () =>
      evaluateOperationsAvailability({
        operations,
        health,
        target:
          targetSynced === undefined && targetPending === undefined
            ? undefined
            : { synced: targetSynced, hasPendingLocalChanges: targetPending },
      }).available,
    [health, operations, targetPending, targetSynced],
  )
}
