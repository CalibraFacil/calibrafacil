import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import type { VisitStatus } from './types'
import { visitKeys } from '@/features/visits/keys'

const VISITS_LIST_LIMIT = 20

function visitsListQueryOptions(input: {
  organizationId: string
  page: number
  status: VisitStatus | ''
  mine: boolean
  rescheduleRequested?: boolean
}) {
  return queryOptions({
    queryKey: visitKeys.list(input),
    queryFn: () =>
      calibraApi.visits.list({
        query: {
          page: input.page,
          limit: VISITS_LIST_LIMIT,
          status: input.status || undefined,
          mine: input.mine || undefined,
          rescheduleRequested: input.rescheduleRequested || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      visitKeys.listScope(input.organizationId),
    ),
  })
}

function visitDetailQueryOptions(visitId: number) {
  return queryOptions({
    queryKey: visitKeys.detail(visitId),
    queryFn: () => calibraApi.visits.get({ params: { id: visitId } }),
  })
}

export function useVisitDetailData({
  visitId,
  enabled,
}: {
  visitId: number
  enabled: boolean
}) {
  return useQuery({
    ...visitDetailQueryOptions(visitId),
    enabled,
  })
}

export function useVisitsListData({
  activeOrganizationId,
  enabled,
  page,
  status,
  mine,
  rescheduleRequested,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  page: number
  status: VisitStatus | ''
  mine: boolean
  rescheduleRequested?: boolean
}) {
  return useQuery({
    ...visitsListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      status,
      mine,
      rescheduleRequested,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}
