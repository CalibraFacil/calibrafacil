import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { ensureRouteQueries, prewarmRouteQueries } from '@/lib/route-data'
import type {
  BackofficeAuditLogData,
  BackofficeAuditLogFilters,
  BackofficeCommercialContext,
  BackofficeCommercialOrganizationsData,
  BackofficeIntegrationHealthData,
  BackofficeOrganizationDetail,
  BackofficeOrganizationOptionsData,
  BackofficeOrganizationsData,
  BackofficeSupportQueueData,
  BackofficeUserFilters,
  BackofficeUsersData,
} from './types'

const BACKOFFICE_ACCESS_STALE_TIME_MS = 30_000

export function getBackofficeAccess() {
  return calibraApi.backoffice.getAccess()
}

export function backofficeAccessQueryOptions(
  scope: string,
  sessionKey = 'route',
) {
  return queryOptions({
    queryKey: ['backoffice', 'access', scope, sessionKey],
    queryFn: getBackofficeAccess,
    staleTime: BACKOFFICE_ACCESS_STALE_TIME_MS,
    retry: false,
  })
}

export function backofficeOrganizationsQueryOptions(
  scope: 'summary' | 'list' = 'list',
) {
  const key =
    scope === 'list'
      ? ['backoffice', 'organizations']
      : ['backoffice', 'organizations', scope]

  return queryOptions({
    queryKey: key,
    queryFn: () =>
      calibraApi.backoffice.listOrganizations<BackofficeOrganizationsData>(),
  })
}

export function backofficeOrganizationOptionsQueryOptions() {
  return queryOptions({
    queryKey: ['backoffice', 'organizations', 'options'],
    queryFn: () =>
      calibraApi.backoffice.listOrganizations<BackofficeOrganizationOptionsData>(),
  })
}

export function backofficeOrganizationDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['backoffice', 'organizations', id],
    queryFn: () =>
      calibraApi.backoffice.getOrganization<BackofficeOrganizationDetail>(id),
  })
}

export function backofficeSupportQueueQueryOptions(
  scope: 'summary' | 'list' | 'customer-success' = 'list',
) {
  const key =
    scope === 'list'
      ? ['backoffice', 'support', 'queue']
      : ['backoffice', 'support', 'queue', scope]

  return queryOptions({
    queryKey: key,
    queryFn: () =>
      calibraApi.backoffice.getSupportQueue<BackofficeSupportQueueData>(),
  })
}

export function backofficeUsersQueryOptions(filters: BackofficeUserFilters) {
  return queryOptions({
    queryKey: [
      'backoffice',
      'users',
      {
        search: filters.search,
        organizationId: filters.organizationId,
        platformRole: filters.platformRole,
        membershipScope: filters.membershipScope,
      },
    ],
    queryFn: () =>
      calibraApi.backoffice.listUsers<BackofficeUsersData>({
        search: filters.search || undefined,
        organizationId: filters.organizationId || undefined,
        platformRole: filters.platformRole,
        membershipScope: filters.membershipScope,
      }),
  })
}

export function backofficeCommercialOrganizationsQueryOptions(search = '') {
  return queryOptions({
    queryKey: ['backoffice', 'commercial', 'organizations', search],
    queryFn: () =>
      calibraApi.backoffice.commercial.listOrganizations<BackofficeCommercialOrganizationsData>(
        search,
      ),
  })
}

export function backofficeCommercialContextQueryOptions(
  organizationId: string,
) {
  return queryOptions({
    queryKey: ['backoffice', 'commercial', 'context', organizationId],
    queryFn: () =>
      calibraApi.backoffice.commercial.getContext<BackofficeCommercialContext>(
        organizationId,
      ),
    enabled: Boolean(organizationId),
  })
}

export async function loadBackofficeIndexData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeOrganizationsQueryOptions('summary'),
    backofficeSupportQueueQueryOptions('summary'),
  ])
}

export async function prewarmBackofficeIndex(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeOrganizationsQueryOptions('summary'),
    backofficeSupportQueueQueryOptions('summary'),
  ])
}

export async function loadBackofficeOrganizationsData(
  queryClient: QueryClient,
) {
  await ensureRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeOrganizationsQueryOptions('list'),
  ])
}

export async function prewarmBackofficeOrganizations(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeOrganizationsQueryOptions('list'),
  ])
}

export async function loadBackofficeOrganizationDetailData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeOrganizationDetailQueryOptions(id),
  ])
}

export async function prewarmBackofficeOrganizationDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeOrganizationDetailQueryOptions(id),
  ])
}

export async function loadBackofficeSupportData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeSupportQueueQueryOptions('list'),
  ])
}

export async function prewarmBackofficeSupport(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeSupportQueueQueryOptions('list'),
  ])
}

export async function prewarmBackofficeUsers(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeOrganizationOptionsQueryOptions(),
  ])
}

export async function loadBackofficeUsersData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeOrganizationOptionsQueryOptions(),
  ])
}

export async function prewarmBackofficeCommercialCheckouts(
  queryClient: QueryClient,
  url: URL,
) {
  const organizationId = url.searchParams.get('organizationId') ?? ''

  await prewarmRouteQueries(queryClient, [
    backofficeAccessQueryOptions('layout'),
    backofficeCommercialOrganizationsQueryOptions(''),
    organizationId
      ? backofficeCommercialContextQueryOptions(organizationId)
      : null,
  ])
}

export function useBackofficeAccessData({
  enabled,
  sessionKey,
  scope,
}: {
  enabled: boolean
  sessionKey?: string | null
  scope: string
}) {
  return useQuery({
    ...backofficeAccessQueryOptions(scope, sessionKey ?? 'anonymous'),
    enabled,
  })
}

export function useBackofficeOrganizationsData(
  scope: 'summary' | 'list' = 'list',
) {
  return useQuery(backofficeOrganizationsQueryOptions(scope))
}

export function useBackofficeOrganizationOptionsData() {
  return useQuery(backofficeOrganizationOptionsQueryOptions())
}

export function useBackofficeOrganizationDetailData(id: string) {
  return useQuery(backofficeOrganizationDetailQueryOptions(id))
}

export function useBackofficeSupportQueueData(
  scope: 'summary' | 'list' | 'customer-success' = 'list',
) {
  return useQuery(backofficeSupportQueueQueryOptions(scope))
}

export function useBackofficeUsersData(filters: BackofficeUserFilters) {
  return useQuery(backofficeUsersQueryOptions(filters))
}

export function useBackofficeCommercialOrganizationsData(search = '') {
  return useQuery(backofficeCommercialOrganizationsQueryOptions(search))
}

export function useBackofficeCommercialContextData(
  organizationId: string | null,
) {
  return useQuery(backofficeCommercialContextQueryOptions(organizationId ?? ''))
}

export function backofficeAuditLogQueryOptions(
  filters: BackofficeAuditLogFilters,
) {
  const query: Record<string, string | number> = {}
  if (filters.search) query.search = filters.search
  if (filters.entityType) query.entityType = filters.entityType
  if (filters.action) query.action = filters.action
  if (filters.actorUserId) query.actorUserId = filters.actorUserId
  if (filters.limit) query.limit = filters.limit

  return queryOptions({
    queryKey: ['backoffice', 'audit-log', query],
    queryFn: () =>
      calibraApi.backoffice.listAuditLog<BackofficeAuditLogData>(query),
  })
}

export function useBackofficeAuditLogData(filters: BackofficeAuditLogFilters) {
  return useQuery(backofficeAuditLogQueryOptions(filters))
}

export function backofficeIntegrationHealthQueryOptions() {
  return queryOptions({
    queryKey: ['backoffice', 'integrations', 'health'],
    queryFn: () =>
      calibraApi.backoffice.getIntegrationHealth<BackofficeIntegrationHealthData>(),
  })
}

export function useBackofficeIntegrationHealthData() {
  return useQuery(backofficeIntegrationHealthQueryOptions())
}
