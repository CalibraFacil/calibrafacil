import { queryOptions, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import type { Job } from './-components/columns'

export type JobsListStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'

export type JobsListData = {
  data: Array<Job>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type JobsListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: JobsListStatus | ''
}

const JOBS_LIST_LIMIT = 20

export async function fetchJobsList(input: JobsListQueryInput) {
  return calibraApi.jobs.list({
    page: input.page,
    limit: JOBS_LIST_LIMIT,
    query: input.search || undefined,
    status: input.statusFilter || undefined,
  })
}

export function jobsListQueryOptions(input: JobsListQueryInput) {
  return queryOptions({
    queryKey: [
      'jobs',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ],
    queryFn: () => fetchJobsList(input),
  })
}

export async function getJobsIndexEssentialQueries() {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    jobsListQueryOptions({
      organizationId,
      page: 1,
      search: '',
      statusFilter: '',
    }),
  ]
}

export async function loadJobsIndexData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, await getJobsIndexEssentialQueries())
}

export async function prewarmJobsIndex(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, await getJobsIndexEssentialQueries())
}
