import { useQuery } from '@tanstack/react-query'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { calibraApi } from '@/utils/api'
import { operation } from '@calibra-facil/client-runtime'
import { isDesktopRuntime } from '@/runtime/desktop'
import { useAvailability } from '@/runtime/use-operation-availability'

const FINANCE_MODULE = [
  operation('access', 'getFinanceAccess'),
  operation('finance', 'getOverview'),
] as const

/**
 * Whether the finance module can run in this runtime right now. On a desktop
 * it is a cloud module: listed while the cloud is reachable, hidden while it
 * is not. Authorization (owner/admin) is separate and stays with the caller.
 */
export function useFinanceModuleAvailable() {
  return useAvailability(FINANCE_MODULE)
}

export function useFinanceAccess() {
  const { data: activeOrg } = useActiveOrganization()
  // Which runtime: a desktop session has no cloud organization to wait for.
  const isDesktop = isDesktopRuntime()

  return useQuery({
    queryKey: ['finance', 'access', activeOrg?.id ?? 'no-org'],
    enabled: isDesktop || Boolean(activeOrg?.id),
    queryFn: async () => calibraApi.access.getFinanceAccess(),
  })
}
