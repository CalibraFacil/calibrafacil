import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  CALIBRATION_REQUEST_STATUSES,
  type CalibrationRequestDetail,
  type CalibrationRequestsListData,
  type CalibrationRequestsListQueryInput,
  type CalibrationRequestStatus,
  type RequestConversionService,
  type RequestTechnician,
} from './types'

export const CALIBRATION_REQUESTS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): CalibrationRequestStatus | '' {
  return optionFromUrl(
    CALIBRATION_REQUEST_STATUSES,
    url?.searchParams.get('status'),
  )
}

export function calibrationRequestsListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: CALIBRATION_REQUESTS_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
  } satisfies CalibrationRequestsListQueryInput
}

export function calibrationRequestsListQueryOptions(
  input: CalibrationRequestsListQueryInput,
) {
  return queryOptions({
    queryKey: [
      'calibration-requests',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ],
    queryFn: () =>
      calibraApi.calibrationRequests.list<CalibrationRequestsListData>({
        page: input.page,
        limit: input.limit,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
      }),
  })
}

export function calibrationRequestDetailQueryOptions(
  organizationId: string,
  id: string | number,
) {
  return queryOptions({
    queryKey: ['calibration-request', organizationId, String(id)],
    queryFn: () =>
      calibraApi.calibrationRequests.get<CalibrationRequestDetail>(id),
  })
}

export function requestConversionServicesQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['services', organizationId, 'request-conversion'],
    queryFn: async (): Promise<{ data: RequestConversionService[] }> => {
      const firstPage = await calibraApi.services.list({
        page: 1,
        limit: 100,
        isActive: true,
      })

      if ((firstPage.pagination?.totalPages ?? 1) <= 1) {
        return { data: firstPage.data.map(toRequestConversionService) }
      }

      const remainingData = await Promise.all(
        Array.from(
          { length: (firstPage.pagination?.totalPages ?? 1) - 1 },
          (_, index) =>
            calibraApi.services.list({
              page: index + 2,
              limit: 100,
              isActive: true,
            }),
        ),
      )

      return {
        data: [
          ...firstPage.data.map(toRequestConversionService),
          ...remainingData.flatMap((page) =>
            page.data.map(toRequestConversionService),
          ),
        ],
      }
    },
  })
}

export function requestTechniciansQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['jobs', organizationId, 'technicians'],
    queryFn: (): Promise<{
      data: Array<RequestTechnician>
    }> => calibraApi.jobs.listTechnicians(),
  })
}

function toRequestConversionService(
  service: Awaited<ReturnType<typeof calibraApi.services.list>>['data'][number],
): RequestConversionService {
  return {
    id: service.id,
    name: service.name,
    assetTypeId: service.assetTypeId,
    methodId: service.methodId,
    methodStatus: service.methodStatus,
  }
}

export async function getRequestsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    calibrationRequestsListQueryOptions(
      calibrationRequestsListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

export async function loadRequestsIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getRequestsIndexEssentialQueries(url),
  )
}

export async function prewarmRequestsIndex(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(
    queryClient,
    await getRequestsIndexEssentialQueries(url),
  )
}

export async function getRequestDetailEssentialQueries(id: string | number) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    calibrationRequestDetailQueryOptions(organizationId, id),
    requestConversionServicesQueryOptions(organizationId),
    requestTechniciansQueryOptions(organizationId),
  ]
}

export async function prewarmRequestDetail(
  queryClient: QueryClient,
  id: string | number,
) {
  await prewarmRouteQueries(
    queryClient,
    await getRequestDetailEssentialQueries(id),
  )
}

export function useCalibrationRequestsListData({
  activeOrganizationId,
  enabled,
  page,
  limit,
  search,
  statusFilter,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  page: number
  limit: number
  search: string
  statusFilter: CalibrationRequestStatus | ''
}) {
  return useQuery({
    ...calibrationRequestsListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
      statusFilter,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useCalibrationRequestDetailData({
  activeOrganizationId,
  enabled,
  id,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  id: string | number
}) {
  return useQuery({
    ...calibrationRequestDetailQueryOptions(
      activeOrganizationId ?? 'no-org',
      id,
    ),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useRequestConversionServicesData({
  activeOrganizationId,
  enabled,
}: {
  activeOrganizationId: string | null
  enabled: boolean
}) {
  return useQuery({
    ...requestConversionServicesQueryOptions(activeOrganizationId ?? 'no-org'),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useRequestTechniciansData({
  activeOrganizationId,
  enabled,
}: {
  activeOrganizationId: string | null
  enabled: boolean
}) {
  return useQuery({
    ...requestTechniciansQueryOptions(activeOrganizationId ?? 'no-org'),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}
