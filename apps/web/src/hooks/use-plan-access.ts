import { useQuery } from '@tanstack/react-query'

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
  hasApi: boolean
  hasCustomDomain: boolean
  hasCustomTemplates: boolean
  hasSso: boolean
}

export function usePlanAccess() {
  return useQuery({
    queryKey: ['billing', 'access'],
    queryFn: async () => {
      const response = await api.api.billing.access.$get()
      if (!response.ok) {
        throw new Error('Erro ao carregar plano atual')
      }

      return response.json() as Promise<PlanAccessResponse>
    },
  })
}
