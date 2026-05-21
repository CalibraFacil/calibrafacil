import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  type EffectiveEnvironmentalLimitsData,
  JOBS_LIST_STATUSES,
  type JobTechniciansData,
  type JobsListData,
  type JobsListQueryInput,
  type JobsListStatus,
  type NewJobAssetsData,
  type NewJobCustomersData,
  type NewJobServicesData,
  type ReferenceStandardsData,
} from './types'

const JOBS_LIST_LIMIT = 20

export async function fetchJobsList(
  input: JobsListQueryInput,
): Promise<JobsListData> {
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

export function jobDetailQueryOptions<TJob = unknown>({
  id,
  apiJobId = id,
}: {
  id: string
  apiJobId?: string
}) {
  return queryOptions({
    queryKey: ['jobs', id],
    queryFn: () => calibraApi.jobs.get<TJob>(apiJobId),
  })
}

export function jobTechniciansQueryOptions() {
  return queryOptions({
    queryKey: ['jobs', 'technicians'],
    queryFn: (): Promise<JobTechniciansData> =>
      calibraApi.jobs.listTechnicians(),
  })
}

export function newJobCustomersQueryOptions(search = '') {
  return queryOptions({
    queryKey: ['customers', 'search', search],
    queryFn: (): Promise<NewJobCustomersData> =>
      calibraApi.customers.list({
        page: 1,
        limit: 50,
        query: search || undefined,
      }),
    staleTime: 30_000,
  })
}

export function newJobCustomerAssetsQueryOptions(customerId: number | null) {
  return queryOptions({
    queryKey: ['assets', 'customer', customerId],
    queryFn: () => {
      if (!customerId) {
        return Promise.resolve({ data: [] } satisfies NewJobAssetsData)
      }

      return calibraApi.assets.list({
        page: 1,
        limit: 100,
        customerId,
      })
    },
  })
}

export function newJobServicesQueryOptions(assetTypeId: number | null) {
  return queryOptions({
    queryKey: ['services', 'for-job', assetTypeId],
    queryFn: (): Promise<NewJobServicesData> =>
      calibraApi.services.list({
        page: 1,
        limit: 100,
        isActive: true,
        assetTypeId: assetTypeId ?? undefined,
      }),
  })
}

export function activeReferenceStandardsQueryOptions<TStandard = unknown>() {
  return queryOptions({
    queryKey: ['standards', 'active'],
    queryFn: (): Promise<ReferenceStandardsData<TStandard>> =>
      calibraApi.jobs.listStandards<TStandard>(),
  })
}

export function effectiveEnvironmentalLimitsQueryOptions<TLimits = unknown>({
  assetTypeId,
  unitId,
}: {
  assetTypeId: number | null | undefined
  unitId: number | null | undefined
}) {
  return queryOptions({
    queryKey: ['environmental-limits', 'effective', assetTypeId, unitId],
    queryFn: (): Promise<EffectiveEnvironmentalLimitsData<TLimits>> =>
      calibraApi.jobs.getEffectiveEnvironmentalLimits<TLimits>(assetTypeId!, {
        unitId,
      }),
    staleTime: 60_000,
  })
}

export async function getJobCertificateDownloadUrl(jobId: number | string) {
  const data = await calibraApi.jobs.getCertificateDownloadUrl(jobId)
  return data.url
}

export function jobCertificateDownloadUrlQueryOptions({
  certificateUrl,
  jobId,
}: {
  certificateUrl: string | null | undefined
  jobId: number | string
}) {
  return queryOptions({
    queryKey: ['jobs', jobId, 'certificate-download-url', certificateUrl],
    queryFn: () => getJobCertificateDownloadUrl(jobId),
    retry: false,
  })
}

export async function getJobLabelDownloadUrl(jobId: number | string) {
  const data = await calibraApi.jobs.getLabelDownloadUrl(jobId)
  return data.url
}

function statusFromUrl(url?: URL): JobsListStatus | '' {
  return optionFromUrl(JOBS_LIST_STATUSES, url?.searchParams.get('status'))
}

export function jobsListQueryInputFromUrl(organizationId: string, url?: URL) {
  return {
    organizationId,
    page: pageFromUrl(url),
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
  } satisfies JobsListQueryInput
}

export async function getJobsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [jobsListQueryOptions(jobsListQueryInputFromUrl(organizationId, url))]
}

export async function loadJobsIndexData(queryClient: QueryClient, url?: URL) {
  await ensureRouteQueries(queryClient, await getJobsIndexEssentialQueries(url))
}

export async function prewarmJobsIndex(queryClient: QueryClient, url?: URL) {
  await prewarmRouteQueries(
    queryClient,
    await getJobsIndexEssentialQueries(url),
  )
}

export async function prewarmNewJob(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    newJobCustomersQueryOptions(),
    jobTechniciansQueryOptions(),
  ])
}

export async function prewarmJobDetail(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [
    jobDetailQueryOptions({ id }),
    jobTechniciansQueryOptions(),
  ])
}

export async function prewarmJobExecute(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [
    jobDetailQueryOptions({ id }),
    activeReferenceStandardsQueryOptions(),
  ])
}

export function useJobDetailData<TJob = unknown>({
  id,
  apiJobId = id,
  refetchWhileGeneratingPdf = false,
}: {
  id: string
  apiJobId?: string
  refetchWhileGeneratingPdf?: boolean
}) {
  return useQuery({
    ...jobDetailQueryOptions<TJob>({ id, apiJobId }),
    refetchInterval: refetchWhileGeneratingPdf
      ? (query) => {
          const status = getJobStatus(query.state.data)
          return status === 'GENERATING_PDF' ? 2_000 : false
        }
      : false,
  })
}

function getJobStatus(data: unknown) {
  if (typeof data !== 'object' || data === null || !('status' in data)) {
    return undefined
  }

  return typeof data.status === 'string' ? data.status : undefined
}

export function useJobTechniciansData({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    ...jobTechniciansQueryOptions(),
    enabled,
  })
}

export function useNewJobCustomersData(search = '') {
  return useQuery(newJobCustomersQueryOptions(search))
}

export function useNewJobCustomerAssetsData({
  customerId,
  enabled,
}: {
  customerId: number | null
  enabled: boolean
}) {
  return useQuery({
    ...newJobCustomerAssetsQueryOptions(customerId),
    enabled,
  })
}

export function useNewJobServicesData({
  assetTypeId,
  enabled,
}: {
  assetTypeId: number | null
  enabled: boolean
}) {
  return useQuery({
    ...newJobServicesQueryOptions(assetTypeId),
    enabled,
  })
}

export function useActiveReferenceStandardsData<TStandard = unknown>() {
  return useQuery(activeReferenceStandardsQueryOptions<TStandard>())
}

export function useEffectiveEnvironmentalLimitsData<TLimits = unknown>({
  assetTypeId,
  unitId,
  enabled,
}: {
  assetTypeId: number | null | undefined
  unitId: number | null | undefined
  enabled: boolean
}) {
  return useQuery({
    ...effectiveEnvironmentalLimitsQueryOptions<TLimits>({
      assetTypeId,
      unitId,
    }),
    enabled,
  })
}

export function useJobCertificateDownloadUrlData({
  certificateUrl,
  enabled,
  jobId,
}: {
  certificateUrl: string | null | undefined
  enabled: boolean
  jobId: number | string
}) {
  return useQuery({
    ...jobCertificateDownloadUrlQueryOptions({ certificateUrl, jobId }),
    enabled,
  })
}
