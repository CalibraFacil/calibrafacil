import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { SyncReconcileResult } from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'

/**
 * What to run after a cloud command whose entity is read back local-first.
 *
 * On desktop, `jobs.get` and `serviceOrders.get` answer from SQLite once the
 * cache has bootstrapped. Invalidating the query after a cloud approval
 * therefore re-reads the *pre-approval* row and the screen appears not to have
 * changed — the class of bug that made "just remove the isDesktop guard" an
 * unsafe change on its own.
 *
 * So: reconcile first (push queued writes, pull canonical state), then
 * invalidate. Reconciliation never throws; if it could not complete, the
 * command still happened and the caller gets `reconciled: false` so it can say
 * "salvo, sincronizando" instead of reporting a failure that did not occur.
 */
export async function reconcileAfterCloudCommand(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
): Promise<SyncReconcileResult> {
  const result = await calibraApi.sync.reconcile()

  await Promise.all(
    queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  )

  return result
}

/**
 * The hint to append to a success message when the cloud command landed but
 * the local cache has not caught up yet. `null` when there is nothing to warn
 * about, so callers can keep their normal copy.
 */
export function describeReconcileLag(result: SyncReconcileResult) {
  if (result.reconciled) return null
  // The browser has no cache to lag behind; staying quiet is correct there.
  if (result.reason === 'browser-has-no-local-cache') return null

  return 'A ação foi registrada na nuvem. Os dados locais deste computador serão atualizados na próxima sincronização.'
}
