import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authClient } from '@calibra-facil/auth/client'

import { isDesktopRuntime } from '@/runtime/desktop'
import {
  verificationAuthorizes,
  verifyCloudIdentity,
} from '@/runtime/desktop-identity'
import {
  activateLocalPartition,
  type ActivateLocalPartitionOutcome,
} from '@/runtime/local-partition'

export const LOCAL_PARTITION_QUERY_ROOT = 'local-partition'

/**
 * Opens the local database for the account and organization on screen, and
 * blocks the dashboard until the host says it may.
 *
 * A query rather than an effect, for the same reason as the notification
 * bridge: the activation is keyed on (account, organization), so making it a
 * query gets re-running on change, a loading state to block on, and a failure
 * state to render — with no `useEffect`, which this codebase bans.
 *
 * The cache reset is the load-bearing part. When the host reports it opened a
 * *different* database, everything React Query is holding came from the
 * previous account and must not survive into the next render.
 */
export function useLocalPartition({
  userId,
  organizationId,
}: {
  userId: string | null | undefined
  organizationId: string | null | undefined
}) {
  const queryClient = useQueryClient()
  const isDesktop = isDesktopRuntime()

  return useQuery({
    queryKey: [
      LOCAL_PARTITION_QUERY_ROOT,
      userId ?? 'no-user',
      organizationId ?? 'no-org',
    ],
    enabled: isDesktop && Boolean(userId) && Boolean(organizationId),
    // Re-verifying on every focus would put a blocking round trip in front of
    // ordinary navigation; the host re-checks ownership on every open anyway.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async (): Promise<ActivateLocalPartitionOutcome> => {
      const bridge = window.calibraBridge
      if (!bridge) {
        return { status: 'idle', requiresCacheReset: false }
      }

      const identity = await verifyCloudIdentity(() =>
        authClient.getSession({ query: { disableCookieCache: true } }),
      )

      // Verification is bound to the partition being requested, not merely to
      // "some session was valid": the requested account and organization come
      // from renderer state that can lag an account change, and the server's
      // active organization is the only membership proof available here.
      const authorized =
        userId !== undefined &&
        userId !== null &&
        organizationId !== undefined &&
        organizationId !== null &&
        verificationAuthorizes(identity, { userId, organizationId })

      const outcome = await activateLocalPartition({
        bridge,
        identity: { userId, organizationId },
        identityVerified: authorized,
      })

      if (outcome.requiresCacheReset) {
        // Everything except this activation itself: clearing our own key would
        // cancel the query mid-flight and re-enter here.
        queryClient.removeQueries({
          predicate: (query) =>
            query.queryKey[0] !== LOCAL_PARTITION_QUERY_ROOT,
        })
      }

      return outcome
    },
  })
}

/**
 * What the dashboard should do with the activation result.
 *
 * Kept separate from the hook so the decision is testable without React: on
 * desktop, a dashboard that renders before the right database is open is the
 * defect this whole change exists to prevent.
 */
export type LocalPartitionGate =
  | { state: 'ready' }
  | { state: 'pending' }
  | { state: 'blocked'; message: string }

export function resolveLocalPartitionGate({
  isDesktop,
  isPending,
  outcome,
  error,
}: {
  isDesktop: boolean
  isPending: boolean
  outcome: ActivateLocalPartitionOutcome | undefined
  error: unknown
}): LocalPartitionGate {
  // The browser has no local database to partition.
  if (!isDesktop) return { state: 'ready' }

  if (error) {
    return {
      state: 'blocked',
      message:
        'Não foi possível preparar os dados locais desta conta neste computador.',
    }
  }

  if (isPending || !outcome) return { state: 'pending' }

  if (outcome.status === 'refused' || outcome.status === 'failed') {
    return { state: 'blocked', message: outcome.message }
  }

  return { state: 'ready' }
}
