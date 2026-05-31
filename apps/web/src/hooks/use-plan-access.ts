import { useQuery } from '@tanstack/react-query'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import type { PlanAccessResponse } from '@calibra-facil/client-runtime'
import { calibraApi } from '@/utils/api'
import { isDesktopRuntime } from '@/runtime/desktop'

export type { PlanAccessResponse }

export function usePlanAccess({
  enabled = true,
  refetchOnWindowFocus,
}: { enabled?: boolean; refetchOnWindowFocus?: boolean } = {}) {
  const { data: activeOrg } = useActiveOrganization()
  const isDesktop = isDesktopRuntime()

  return useQuery({
    queryKey: ['billing', 'access', activeOrg?.id ?? 'no-org'],
    enabled: enabled && (isDesktop || Boolean(activeOrg?.id)),
    refetchOnWindowFocus,
    queryFn: async () => calibraApi.access.getPlanAccess(),
  })
}
