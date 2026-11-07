import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type { MethodTemplateCatalogEntry } from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import { isRecord } from '@calibra-facil/shared/record'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  routeData,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import { METHOD_STATUS } from '@calibra-facil/schemas/machines'
import {
  type MethodAuditLogData,
  type MethodAuditLogRecord,
  type MethodDetail,
  type MethodEditData,
  type MethodsListData,
  type MethodsListQueryInput,
  type MethodStatus,
} from './types'
import { methodKeys } from '@/features/methods/keys'

export const METHODS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): MethodStatus | '' {
  return optionFromUrl(METHOD_STATUS.states, url?.searchParams.get('status'))
}

export function methodsListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: METHODS_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
  } satisfies MethodsListQueryInput
}

export function methodsListQueryOptions(input: MethodsListQueryInput) {
  return queryOptions({
    queryKey: methodKeys.list(input),
    queryFn: () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- method list DTOs need schema-backed normalization before this status-narrowing cast can be removed.
      calibraApi.methods.list({
        query: {
          page: input.page,
          limit: input.limit,
          query: input.search || undefined,
          status: input.statusFilter || undefined,
        },
      }) as Promise<MethodsListData>,
    placeholderData: keepPreviousDataInScope(
      methodKeys.listScope(input.organizationId),
    ),
  })
}

export function methodDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: methodKeys.detail(id),
    queryFn: () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- method detail DTOs need schema-backed normalization before this view-model cast can be removed.
      calibraApi.methods.get({ params: { id } }) as Promise<MethodDetail>,
  })
}

export function methodEditQueryOptions(id: string) {
  return queryOptions({
    queryKey: methodKeys.detail(id),
    queryFn: () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- method edit DTOs need schema-backed normalization before this builder-model cast can be removed.
      calibraApi.methods.get({ params: { id } }) as Promise<MethodEditData>,
  })
}

export function methodAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: methodKeys.audit(id),
    queryFn: async (): Promise<MethodAuditLogData> => {
      const log = await calibraApi.methods.audit({ params: { id } })
      return {
        data: log.data.map(
          (entry): MethodAuditLogRecord => ({
            ...entry,
            // The column is untyped JSON; the timeline reads it as a record.
            changes: isRecord(entry.changes) ? entry.changes : null,
          }),
        ),
      }
    },
  })
}

async function getMethodsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    methodsListQueryOptions(methodsListQueryInputFromUrl(organizationId, url)),
  ]
}

const methodsIndexRouteData = routeData((url?: URL) =>
  getMethodsIndexEssentialQueries(url),
)
export const loadMethodsIndexData = methodsIndexRouteData.load
export const prewarmMethodsIndex = methodsIndexRouteData.prewarm

const methodDetailRouteData = routeData((id: string) => [
  methodDetailQueryOptions(id),
  methodAuditLogQueryOptions(id),
])
export const loadMethodDetailData = methodDetailRouteData.load
export const prewarmMethodDetail = methodDetailRouteData.prewarm

const methodEditRouteData = routeData((id: string) => [
  methodEditQueryOptions(id),
])
export const loadMethodEditData = methodEditRouteData.load
export const prewarmMethodEdit = methodEditRouteData.prewarm

export function useMethodsListData({
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
  statusFilter: MethodStatus | ''
}) {
  return useQuery({
    ...methodsListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
      statusFilter,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useMethodDetailData(id: string) {
  return useQuery(methodDetailQueryOptions(id))
}

export function useMethodEditData(id: string) {
  return useQuery(methodEditQueryOptions(id))
}

export function useMethodAuditLogData(id: string) {
  return useQuery(methodAuditLogQueryOptions(id))
}

// --- From-template catalog (PR4) ----------------------------------------------
// The curated method-template catalog is a cloud-only read; it returns only
// governance-complete templates so the picker never renders a bare "trust-me"
// card.
function methodTemplatesQueryOptions() {
  return queryOptions({
    queryKey: methodKeys.templates,
    queryFn: (): Promise<MethodTemplateCatalogEntry[]> =>
      calibraApi.methods.listMethodTemplates(),
  })
}

export async function loadMethodTemplatesData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [methodTemplatesQueryOptions()])
}

export function useMethodTemplatesData() {
  return useQuery(methodTemplatesQueryOptions())
}
