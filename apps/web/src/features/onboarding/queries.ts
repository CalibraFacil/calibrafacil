import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'

/**
 * The activation checklist is derived server-side on every call, so it is
 * cheap to refetch and must not be cached hard: a lab that publishes a method
 * in another tab should see that step tick over when they come back.
 */
export function activationChecklistQueryOptions() {
  return queryOptions({
    queryKey: ['onboarding', 'checklist'],
    queryFn: () => calibraApi.onboarding.getChecklist(),
    staleTime: 30_000,
  })
}

export function useActivationChecklist({ enabled = true } = {}) {
  return useQuery({ ...activationChecklistQueryOptions(), enabled })
}
