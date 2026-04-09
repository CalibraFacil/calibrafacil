import { useQuery } from '@tanstack/react-query'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { api } from '@/utils/api'

export interface FinanceAccessResponse {
  planId: string
  planName: string
  status: string
  entitlements: string[]
  hasFinancialModule: boolean
  hasCustomIntegrations: boolean
  canReadFinancial: boolean
  canManageFinancial: boolean
  canExportFinancial: boolean
  role: string
}

export function useFinanceAccess() {
  const { data: activeOrg } = useActiveOrganization()

  return useQuery({
    queryKey: ['finance', 'access', activeOrg?.id ?? 'no-org'],
    enabled: Boolean(activeOrg?.id),
    queryFn: async () => {
      const response = await api.api.finance.access.$get()
      if (!response.ok) {
        throw new Error('Erro ao carregar acesso financeiro')
      }

      return response.json() as Promise<FinanceAccessResponse>
    },
  })
}
