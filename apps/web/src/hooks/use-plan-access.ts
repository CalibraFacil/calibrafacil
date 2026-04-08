import { useQuery } from '@tanstack/react-query'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { api } from '@/utils/api'

export interface PlanAccessResponse {
  planId: string
  planName: string
  status: string
  limits: {
    certificates: number
    users: number
    storage: number
  }
  entitlements: string[]
  hasFinancial: boolean
  hasFinancialModule: boolean
  canManageBilling: boolean
  hasApi: boolean
  hasCustomDomain: boolean
  hasCustomTemplates: boolean
  hasSso: boolean
}

export function usePlanAccess() {
  const { data: activeOrg } = useActiveOrganization()

  return useQuery({
    queryKey: ['billing', 'access', activeOrg?.id ?? 'no-org'],
    enabled: Boolean(activeOrg?.id),
    queryFn: async () => {
      const response = await api.api.billing.access.$get()
      if (!response.ok) {
        throw new Error('Erro ao carregar plano atual')
      }

      return response.json() as Promise<PlanAccessResponse>
    },
  })
}
