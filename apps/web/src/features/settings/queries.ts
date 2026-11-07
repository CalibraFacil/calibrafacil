import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { authClient } from '@calibra-facil/auth/client'
import type { ContaAzulCatalogKey } from '@calibra-facil/contracts'
import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import type {
  OrganizationInvitation,
  OrganizationMember,
  IntegrationRunItemsResponse,
  SyncTarget,
} from './types'
import type { IntegrationMappingsConfig } from '@calibra-facil/shared'
import {
  environmentalLimitKeys,
  integrationKeys,
  organizationKeys,
  settingsKeys,
} from '@/features/settings/keys'
import { assetKeys } from '@/features/assets/keys'
import { sessionKeys } from '@/lib/query-keys'

export type { ContaAzulCatalogKey }

function trustedApiValue<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Better Auth client responses are validated by the auth package contract.
  return value as T
}

export function apiKeysQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.apiKeys,
    queryFn: () => calibraApi.apiKeys.list(),
  })
}

export function ssoSettingsQueryOptions(organizationKey: string | null) {
  return queryOptions({
    queryKey: settingsKeys.ssoSettings(organizationKey),
    queryFn: () => calibraApi.sso.getProviders(),
  })
}

export function certificateNumberingProfileQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.certificateNumberingProfile,
    queryFn: () => calibraApi.certificateNumbering.getProfile(),
  })
}

export function signingCertificatesQueryOptions(unitId: number | null) {
  return queryOptions({
    queryKey: settingsKeys.signingCertificates(unitId),
    queryFn: () => calibraApi.signingCertificates.list(),
  })
}

export function mySignatureQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.mySignature,
    queryFn: () => calibraApi.signatures.getMine(),
  })
}

export function portalDomainQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.portalDomain,
    queryFn: () => calibraApi.portalDomains.get(),
  })
}

function emailDomainQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.emailDomain,
    queryFn: () => calibraApi.emailDomains.get(),
  })
}

export function environmentalLimitsQueryOptions(unitId: number | null) {
  return queryOptions({
    queryKey: environmentalLimitKeys.unit(unitId),
    queryFn: () => calibraApi.environmentalLimits.list(),
  })
}

function accreditedScopeQueryOptions(unitId: number | null) {
  return queryOptions({
    queryKey: settingsKeys.accreditedScope(unitId),
    queryFn: () => calibraApi.accreditedScope.list(),
  })
}

export function settingsAssetTypesQueryOptions() {
  return queryOptions({
    queryKey: assetKeys.types,
    queryFn: () => calibraApi.assetTypes.list(),
    staleTime: 60_000,
  })
}

export function notificationPreferencesQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.notificationPreferences,
    queryFn: () => calibraApi.notifications.getPreferences(),
  })
}

export function integrationsQueryOptions() {
  return queryOptions({
    queryKey: integrationKeys.all,
    queryFn: () => calibraApi.integrations.list(),
  })
}

export function contaAzulAppQueryOptions() {
  return queryOptions({
    queryKey: integrationKeys.contaAzulApp,
    queryFn: () => calibraApi.integrations.getContaAzulApp(),
  })
}

export function integrationRunItemsQueryOptions({
  integrationId,
  runId,
}: {
  integrationId: string | null
  runId: string | null
}) {
  return queryOptions({
    queryKey: integrationKeys.runItems(integrationId, runId),
    queryFn: () => {
      if (!integrationId || !runId) {
        return Promise.resolve({
          runId: '',
          target: 'customer',
          data: [],
          summary: {
            returnedCount: 0,
            statusCounts: {},
          },
        } satisfies IntegrationRunItemsResponse)
      }

      return calibraApi.integrations.listRunItems({
        params: { id: integrationId, runId },
      })
    },
    enabled: Boolean(integrationId && runId),
  })
}

export function contaAzulCatalogQueryOptions({
  catalog,
  enabled,
  id,
}: {
  catalog: ContaAzulCatalogKey
  enabled: boolean
  id: string
}) {
  return queryOptions({
    queryKey: integrationKeys.catalog(id, catalog),
    queryFn: () =>
      calibraApi.integrations.listContaAzulCatalog({
        params: { id, catalog },
      }),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function previewIntegrationSync({
  id,
  mappings,
  target,
}: {
  id: string
  mappings?: IntegrationMappingsConfig
  target: SyncTarget
}) {
  return calibraApi.integrations.previewSync({
    params: { id },
    body: { target, limit: 50, mappings },
  })
}

export function organizationUnitsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.units(organizationId),
    queryFn: () => calibraApi.units.listAdminUnits(),
  })
}

export function dashboardUnitsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: sessionKeys.dashboardUnitsOf(organizationId),
    queryFn: async () => {
      const response = await calibraApi.units.getDashboardUnits()
      if (!response) {
        throw new Error('Falha ao carregar contexto da unidade')
      }
      return response
    },
  })
}

export function organizationGovernanceMembersQueryOptions(
  organizationId: string,
) {
  return queryOptions({
    queryKey: organizationKeys.governanceMembers(organizationId),
    queryFn: () => calibraApi.units.listAdminMembers(),
  })
}

export function organizationGovernanceActivityQueryOptions(
  organizationId: string,
) {
  return queryOptions({
    queryKey: organizationKeys.governanceActivity(organizationId),
    queryFn: () => calibraApi.units.listAdminActivity(),
  })
}

export function organizationMembersQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.members(organizationId),
    queryFn: async () => {
      const result = await authClient.organization.listMembers({
        query: { organizationId },
      })

      return trustedApiValue<OrganizationMember[]>(
        (result.data?.members ?? []).map((member) => ({
          ...member,
          createdAt: new Date(member.createdAt),
        })),
      )
    },
  })
}

export function organizationInvitationsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.invitations(organizationId),
    queryFn: async () => {
      const result = await authClient.organization.listInvitations({
        query: { organizationId },
      })

      return trustedApiValue<OrganizationInvitation[]>(
        (result.data ?? []).map((invitation) => ({
          ...invitation,
          expiresAt: new Date(invitation.expiresAt),
        })),
      )
    },
  })
}

export async function prewarmAuthenticationSettings(
  queryClient: QueryClient,
  organizationKey: string | null,
) {
  await prewarmRouteQueries(queryClient, [
    apiKeysQueryOptions(),
    organizationKey ? ssoSettingsQueryOptions(organizationKey) : null,
  ])
}

export async function prewarmCertificateNumberingSettings(
  queryClient: QueryClient,
) {
  await prewarmRouteQueries(queryClient, [
    certificateNumberingProfileQueryOptions(),
  ])
}

export async function prewarmCertificateSettings(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    signingCertificatesQueryOptions(null),
  ])
}

export async function prewarmSignatureSettings(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [mySignatureQueryOptions()])
}

export async function prewarmPortalDomainSettings(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [portalDomainQueryOptions()])
}

export async function prewarmEnvironmentSettings(
  queryClient: QueryClient,
  unitId: number | null,
) {
  await prewarmRouteQueries(queryClient, [
    settingsAssetTypesQueryOptions(),
    unitId ? environmentalLimitsQueryOptions(unitId) : null,
  ])
}

export async function prewarmNotificationSettings(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    notificationPreferencesQueryOptions(),
  ])
}

export function useApiKeysData() {
  return useQuery(apiKeysQueryOptions())
}

export function useSsoSettingsData({
  enabled,
  organizationKey,
}: {
  enabled: boolean
  organizationKey: string | null
}) {
  return useQuery({
    ...ssoSettingsQueryOptions(organizationKey),
    enabled,
  })
}

export function useCertificateNumberingProfileData() {
  return useQuery(certificateNumberingProfileQueryOptions())
}

export function useSigningCertificatesData({
  enabled,
  unitId,
}: {
  enabled: boolean
  unitId: number | null
}) {
  return useQuery({
    ...signingCertificatesQueryOptions(unitId),
    enabled,
  })
}

export function useMySignatureData() {
  return useQuery(mySignatureQueryOptions())
}

export function usePortalDomainData() {
  return useQuery(portalDomainQueryOptions())
}

export function useEmailDomainData() {
  return useQuery(emailDomainQueryOptions())
}

export function useEnvironmentalLimitsData({
  enabled,
  unitId,
}: {
  enabled: boolean
  unitId: number | null
}) {
  return useQuery({
    ...environmentalLimitsQueryOptions(unitId),
    enabled,
  })
}

export function useAccreditedScopeData({
  enabled,
  unitId,
}: {
  enabled: boolean
  unitId: number | null
}) {
  return useQuery({
    ...accreditedScopeQueryOptions(unitId),
    enabled,
  })
}

export function useSettingsAssetTypesData() {
  return useQuery(settingsAssetTypesQueryOptions())
}

export function useNotificationPreferencesData() {
  return useQuery(notificationPreferencesQueryOptions())
}

export function useIntegrationsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...integrationsQueryOptions(),
    enabled,
  })
}

export function useOrganizationUnitsData({
  enabled,
  organizationId,
}: {
  enabled: boolean
  organizationId: string
}) {
  return useQuery({
    ...organizationUnitsQueryOptions(organizationId),
    enabled,
  })
}

export function useDashboardUnitsData({
  enabled,
  organizationId,
}: {
  enabled: boolean
  organizationId: string
}) {
  return useQuery({
    ...dashboardUnitsQueryOptions(organizationId),
    enabled,
  })
}

export function useOrganizationGovernanceMembersData({
  enabled,
  organizationId,
}: {
  enabled: boolean
  organizationId: string
}) {
  return useQuery({
    ...organizationGovernanceMembersQueryOptions(organizationId),
    enabled,
  })
}

export function useOrganizationGovernanceActivityData({
  enabled,
  organizationId,
}: {
  enabled: boolean
  organizationId: string
}) {
  return useQuery({
    ...organizationGovernanceActivityQueryOptions(organizationId),
    enabled,
  })
}

export function useOrganizationMembersData({
  enabled,
  organizationId,
}: {
  enabled: boolean
  organizationId: string
}) {
  return useQuery({
    ...organizationMembersQueryOptions(organizationId),
    enabled,
  })
}

export function useOrganizationInvitationsData({
  enabled,
  organizationId,
}: {
  enabled: boolean
  organizationId: string
}) {
  return useQuery({
    ...organizationInvitationsQueryOptions(organizationId),
    enabled,
  })
}
