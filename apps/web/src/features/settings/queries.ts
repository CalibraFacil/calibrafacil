import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { authClient } from '@calibra-facil/auth/client'
import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import type {
  ApiKeysData,
  OrganizationGovernanceActivityData,
  OrganizationGovernanceMembersData,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationUnitsData,
  SettingsBillingPaymentsData,
  SettingsBillingSubscriptionData,
  SettingsCertificateNumberingData,
  SettingsEnvironmentalLimitsData,
  SettingsIntegrationsData,
  ContaAzulCatalogResponse,
  SettingsNotificationPreferencesData,
  SettingsPortalDomainData,
  SettingsSigningCertificatesData,
  SettingsSignatureData,
  SettingsSsoData,
  IntegrationRunItemsResponse,
  SyncPreviewResponse,
  SyncTarget,
  UnitContextResponse,
} from './types'
import type { IntegrationMappingsConfig } from '@calibra-facil/shared'

export type ContaAzulCatalogKey =
  | 'accounts'
  | 'balances'
  | 'categories'
  | 'cost-centers'
  | 'dre-categories'
  | 'product-categories'
  | 'product-cest'
  | 'product-ecommerce-brands'
  | 'product-ecommerce-categories'
  | 'product-ncm'
  | 'products'
  | 'product-units'
  | 'sellers'
  | 'services'
  | 'transfers'

function trustedApiResult<T>(promise: Promise<unknown>): Promise<T> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- typed API facade methods lag behind the route-specific response contracts.
  return promise as Promise<T>
}

function trustedApiValue<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Better Auth client responses are validated by the auth package contract.
  return value as T
}

export function apiKeysQueryOptions() {
  return queryOptions({
    queryKey: ['api-keys'],
    queryFn: () => trustedApiResult<ApiKeysData>(calibraApi.apiKeys.list()),
  })
}

export function ssoSettingsQueryOptions(organizationKey: string | null) {
  return queryOptions({
    queryKey: ['sso-settings', organizationKey ?? 'no-org'],
    queryFn: () =>
      trustedApiResult<SettingsSsoData>(calibraApi.sso.getProviders()),
  })
}

export function certificateNumberingProfileQueryOptions() {
  return queryOptions({
    queryKey: ['certificate-numbering-profile'],
    queryFn: () =>
      trustedApiResult<SettingsCertificateNumberingData>(
        calibraApi.certificateNumbering.getProfile(),
      ),
  })
}

export function signingCertificatesQueryOptions(unitId: number | null) {
  return queryOptions({
    queryKey: ['signing-certificates', unitId ?? 'no-unit'],
    queryFn: () =>
      trustedApiResult<SettingsSigningCertificatesData>(
        calibraApi.signingCertificates.list(),
      ),
  })
}

export function mySignatureQueryOptions() {
  return queryOptions({
    queryKey: ['my-signature'],
    queryFn: () =>
      trustedApiResult<SettingsSignatureData>(calibraApi.signatures.getMine()),
  })
}

export function portalDomainQueryOptions() {
  return queryOptions({
    queryKey: ['portal-domain'],
    queryFn: () =>
      trustedApiResult<SettingsPortalDomainData>(
        calibraApi.portalDomains.get(),
      ),
  })
}

export function environmentalLimitsQueryOptions(unitId: number | null) {
  return queryOptions({
    queryKey: ['environmental-limits', unitId ?? 'no-unit'],
    queryFn: () =>
      trustedApiResult<SettingsEnvironmentalLimitsData>(
        calibraApi.environmentalLimits.list(),
      ),
  })
}

export function settingsAssetTypesQueryOptions() {
  return queryOptions({
    queryKey: ['asset-types'],
    queryFn: () => calibraApi.assetTypes.list(),
    staleTime: 60_000,
  })
}

export function billingSubscriptionQueryOptions() {
  return queryOptions({
    queryKey: ['billing', 'subscription'],
    queryFn: () =>
      trustedApiResult<SettingsBillingSubscriptionData>(
        calibraApi.billing.getSubscription(),
      ),
  })
}

export function billingPaymentsQueryOptions() {
  return queryOptions({
    queryKey: ['billing', 'payments'],
    queryFn: () =>
      trustedApiResult<SettingsBillingPaymentsData>(
        calibraApi.billing.listPayments({
          limit: 10,
          offset: 0,
        }),
      ),
  })
}

export function notificationPreferencesQueryOptions() {
  return queryOptions({
    queryKey: ['notification-preferences'],
    queryFn: () =>
      trustedApiResult<SettingsNotificationPreferencesData>(
        calibraApi.notifications.getPreferences(),
      ),
  })
}

export function integrationsQueryOptions() {
  return queryOptions({
    queryKey: ['integrations'],
    queryFn: () => calibraApi.integrations.list<SettingsIntegrationsData>(),
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
    queryKey: [
      'integrations',
      integrationId ?? 'no-integration',
      'runs',
      runId ?? 'no-run',
      'items',
    ],
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

      return calibraApi.integrations.listRunItems<IntegrationRunItemsResponse>(
        integrationId,
        runId,
      )
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
    queryKey: ['integrations', id, 'conta-azul', 'catalog', catalog],
    queryFn: () =>
      calibraApi.integrations.listContaAzulCatalog<ContaAzulCatalogResponse>(
        id,
        catalog,
      ),
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
  return calibraApi.integrations.previewSync<SyncPreviewResponse>(id, {
    target,
    limit: 50,
    mappings,
  })
}

export function organizationUnitsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['organization-units', organizationId],
    queryFn: () => calibraApi.units.listAdminUnits<OrganizationUnitsData>(),
  })
}

export function dashboardUnitsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['dashboard-units', organizationId],
    queryFn: async () => {
      const response = await calibraApi.units.getDashboardUnits()
      if (!response) {
        throw new Error('Falha ao carregar contexto da unidade')
      }
      return trustedApiValue<UnitContextResponse>(response)
    },
  })
}

export function organizationGovernanceMembersQueryOptions(
  organizationId: string,
) {
  return queryOptions({
    queryKey: ['organization-governance-members', organizationId],
    queryFn: () =>
      calibraApi.units.listAdminMembers<OrganizationGovernanceMembersData>(),
  })
}

export function organizationGovernanceActivityQueryOptions(
  organizationId: string,
) {
  return queryOptions({
    queryKey: ['organization-governance-activity', organizationId],
    queryFn: () =>
      calibraApi.units.listAdminActivity<OrganizationGovernanceActivityData>(),
  })
}

export function organizationMembersQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['organization-members', organizationId],
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
    queryKey: ['organization-invitations', organizationId],
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

export function useSettingsAssetTypesData() {
  return useQuery(settingsAssetTypesQueryOptions())
}

export function useBillingSubscriptionData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...billingSubscriptionQueryOptions(),
    enabled,
  })
}

export function useBillingPaymentsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...billingPaymentsQueryOptions(),
    enabled,
  })
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
