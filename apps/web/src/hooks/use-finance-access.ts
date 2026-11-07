import { useQuery } from '@tanstack/react-query'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { calibraApi } from '@/utils/api'
import { isDesktopRuntime } from '@/runtime/desktop'

export function useFinanceAccess() {
  const { data: activeOrg } = useActiveOrganization()
  const isDesktop = isDesktopRuntime()

  return useQuery({
    queryKey: ['finance', 'access', activeOrg?.id ?? 'no-org'],
    enabled: isDesktop || Boolean(activeOrg?.id),
    queryFn: async () => calibraApi.access.getFinanceAccess(),
  })
}
