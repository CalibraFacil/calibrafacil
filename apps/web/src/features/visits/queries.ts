import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import type { VisitDetail, VisitsListData, VisitStatus } from './types'

const VISITS_LIST_LIMIT = 20

function visitsListQueryOptions(input: {
  organizationId: string
  page: number
  status: VisitStatus | ''
  mine: boolean
  rescheduleRequested?: boolean
}) {
  return queryOptions({
    queryKey: [
      'visits',
      input.organizationId,
      input.page,
      input.status,
      input.mine,
      Boolean(input.rescheduleRequested),
    ],
    queryFn: () =>
      calibraApi.visits.list<VisitsListData>({
        page: input.page,
        limit: VISITS_LIST_LIMIT,
        status: input.status || undefined,
        mine: input.mine || undefined,
        rescheduleRequested: input.rescheduleRequested || undefined,
      }),
    placeholderData: keepPreviousDataInScope(['visits', input.organizationId]),
  })
}

function visitDetailQueryOptions(visitId: number) {
  return queryOptions({
    queryKey: ['visit', visitId],
    queryFn: () => calibraApi.visits.get<VisitDetail>(visitId),
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
