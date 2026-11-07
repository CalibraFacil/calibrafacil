import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
  routeData,
} from '@/lib/route-data'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  JOBS_LIST_STATUSES,
  type JobTechniciansData,
  type JobsListData,
  type JobsListQueryInput,
  type JobsListStatus,
  type NewJobAssetsData,
  type NewJobServicesData,
} from './types'
import { environmentalLimitKeys } from '@/features/settings/keys'
import { jobKeys } from '@/features/jobs/keys'
import { customerPickerQueryOptions } from '@/features/customers/queries'
import { assetKeys } from '@/features/assets/keys'
import { serviceKeys } from '@/features/services/keys'
import { standardKeys } from '@/features/standards/keys'

const JOBS_LIST_LIMIT = 20

async function fetchJobsList(input: JobsListQueryInput): Promise<JobsListData> {
  return calibraApi.jobs.list({
    query: {
      page: input.page,
      limit: JOBS_LIST_LIMIT,
      query: input.search || undefined,
      status: input.statusFilter || undefined,
    },
  })
}

export function jobsListQueryOptions(input: JobsListQueryInput) {
  return queryOptions({
    queryKey: jobKeys.list(input),
    queryFn: () => fetchJobsList(input),
    placeholderData: keepPreviousDataInScope(
      jobKeys.listScope(input.organizationId),
    ),
  })
}

export function jobDetailQueryOptions({
  id,
  apiJobId = id,
}: {
  id: string
  apiJobId?: string
}) {
  return queryOptions({
    queryKey: jobKeys.detail(id),
    queryFn: () => calibraApi.jobs.get({ params: { id: apiJobId } }),
  })
}

export function jobTechniciansQueryOptions() {
  return queryOptions({
    queryKey: jobKeys.technicians,
    queryFn: (): Promise<JobTechniciansData> =>
      calibraApi.jobs.listTechnicians(),
  })
}

export function newJobCustomersQueryOptions(search = '') {
  return customerPickerQueryOptions(search)
}

export function newJobCustomerAssetsQueryOptions(customerId: number | null) {
  return queryOptions({
    queryKey: assetKeys.forCustomer(customerId),
    queryFn: (): Promise<NewJobAssetsData> => {
      if (!customerId) {
        return Promise.resolve({ data: [] } satisfies NewJobAssetsData)
      }

      return calibraApi.assets.list({
        query: {
          page: 1,
          limit: 100,
          customerId,
        },
      })
    },
  })
}

export function newJobServicesQueryOptions(assetTypeId: number | null) {
  return queryOptions({
    queryKey: serviceKeys.forJob(assetTypeId),
    queryFn: (): Promise<NewJobServicesData> =>
      calibraApi.services.list({
        query: {
          page: 1,
          limit: 100,
          isActive: true,
          assetTypeId: assetTypeId ?? undefined,
        },
      }),
  })
}

export function activeReferenceStandardsQueryOptions() {
  return queryOptions({
    queryKey: standardKeys.active,
    queryFn: () =>
      calibraApi.standards.list({ query: { status: 'ACTIVE', limit: 100 } }),
  })
}

function compositionProfilesQueryOptions() {
  return queryOptions({
    queryKey: standardKeys.compositionProfiles,
    queryFn: () => calibraApi.standards.listCompositionProfiles(),
  })
}

export function effectiveEnvironmentalLimitsQueryOptions({
  assetTypeId,
  unitId,
}: {
  assetTypeId: number | null | undefined
  unitId: number | null | undefined
}) {
  return queryOptions({
    queryKey: environmentalLimitKeys.effective(assetTypeId, unitId),
    queryFn: () =>
      calibraApi.environmentalLimits.effective({
        params: { assetTypeId: assetTypeId! },
        query: unitId ? { unitId: String(unitId) } : {},
      }),
    staleTime: 60_000,
  })
}

export async function getJobCertificateDownloadUrl(jobId: number | string) {
  const data = await calibraApi.jobs.getCertificateDownloadUrl({
    params: { id: jobId },
  })
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
    queryKey: jobKeys.certificateDownloadUrl(jobId, certificateUrl),
    queryFn: () => getJobCertificateDownloadUrl(jobId),
    retry: false,
  })
}

export async function getJobLabelDownloadUrl(jobId: number | string) {
  const data = await calibraApi.jobs.getLabelDownloadUrl({
    params: { id: jobId },
  })
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

async function getJobsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [jobsListQueryOptions(jobsListQueryInputFromUrl(organizationId, url))]
}

const jobsIndexRouteData = routeData((url?: URL) =>
  getJobsIndexEssentialQueries(url),
)
export const loadJobsIndexData = jobsIndexRouteData.load
export const prewarmJobsIndex = jobsIndexRouteData.prewarm

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

export function useJobDetailData({
  id,
  apiJobId = id,
  refetchWhileGeneratingPdf = false,
}: {
  id: string
  apiJobId?: string
  refetchWhileGeneratingPdf?: boolean
}) {
  return useQuery({
    ...jobDetailQueryOptions({ id, apiJobId }),
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

export function useActiveReferenceStandardsData() {
  return useQuery(activeReferenceStandardsQueryOptions())
}

export function useCompositionProfilesData() {
  return useQuery(compositionProfilesQueryOptions())
}

export function useEffectiveEnvironmentalLimitsData({
  assetTypeId,
  unitId,
  enabled,
}: {
  assetTypeId: number | null | undefined
  unitId: number | null | undefined
  enabled: boolean
}) {
  return useQuery({
    ...effectiveEnvironmentalLimitsQueryOptions({
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
