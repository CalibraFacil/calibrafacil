import { useMemo } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { createCollection, useLiveQuery } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

import {
  fetchJobsList,
  jobsListQueryOptions,
  type JobsListQueryInput,
  type JobsListStatus,
} from './-index.data'

function createJobsListCollection(
  queryClient: QueryClient,
  input: JobsListQueryInput,
) {
  const options = jobsListQueryOptions(input)

  return createCollection(
    queryCollectionOptions({
      id: [
        'jobs-list',
        input.organizationId,
        input.page,
        input.search,
        input.statusFilter,
      ].join(':'),
      queryKey: options.queryKey,
      queryFn: () => fetchJobsList(input),
      select: (data) => data.data,
      queryClient,
      getKey: (job) => job.id,
    }),
  )
}

export function useJobsListData({
  activeOrganizationId,
  enabled,
  page,
  search,
  statusFilter,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  page: number
  search: string
  statusFilter: JobsListStatus | ''
}) {
  const queryClient = useQueryClient()
  const organizationId = activeOrganizationId ?? 'no-org'
  const canLoad = Boolean(activeOrganizationId) && enabled
  const queryInput = useMemo(
    () => ({
      organizationId,
      page,
      search,
      statusFilter,
    }),
    [organizationId, page, search, statusFilter],
  )
  const jobsCollection = useMemo(
    () =>
      canLoad ? createJobsListCollection(queryClient, queryInput) : undefined,
    [canLoad, queryClient, queryInput],
  )

  const queryResult = useQuery({
    ...jobsListQueryOptions(queryInput),
    enabled: canLoad,
  })
  const liveJobs = useLiveQuery(() => jobsCollection, [jobsCollection])

  return {
    ...queryResult,
    data: queryResult.data
      ? {
          ...queryResult.data,
          data: liveJobs.data ?? queryResult.data.data,
        }
      : queryResult.data,
    isLoading: queryResult.isLoading || liveJobs.isLoading,
  }
}
