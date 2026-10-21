import { useSession } from '@calibra-facil/auth/client'

import { useDashboardContextState } from '@/contexts/dashboard-context'
import type { ExecutionDraftOwner } from '@/features/jobs/execution-draft'

/** Both ids are required: a draft with a missing scope is never stored. */
export function resolveExecutionDraftOwner(
  organizationId: string | null | undefined,
  userId: string | null | undefined,
): ExecutionDraftOwner | null {
  if (!organizationId || !userId) return null
  return { organizationId, userId }
}

/**
 * The organization + user a local execution draft belongs to, for the route
 * adapter to hand to the page. Null while either is still unknown.
 */
export function useExecutionDraftOwner(): ExecutionDraftOwner | null {
  const { activeOrganizationId } = useDashboardContextState()
  const { data: session } = useSession()

  return resolveExecutionDraftOwner(activeOrganizationId, session?.user.id)
}
