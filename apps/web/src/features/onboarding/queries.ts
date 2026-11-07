import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { onboardingKeys } from '@/features/onboarding/keys'

/**
 * The activation checklist is derived server-side on every call, so it is
 * cheap to refetch and must not be cached hard: a lab that publishes a method
 * in another tab should see that step tick over when they come back.
 */
function activationChecklistQueryOptions() {
  return queryOptions({
    queryKey: onboardingKeys.checklist,
    queryFn: () => calibraApi.onboarding.getChecklist(),
    staleTime: 30_000,
  })
}

export function useActivationChecklist({ enabled = true } = {}) {
  return useQuery({ ...activationChecklistQueryOptions(), enabled })
}
