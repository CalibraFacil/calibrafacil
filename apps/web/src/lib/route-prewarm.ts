import type { QueryClient } from '@tanstack/react-query'

import {
  prewarmAssetDetail,
  prewarmAssetEdit,
  prewarmAssetsIndex,
  prewarmNewAsset,
} from '@/features/assets/queries'
import {
  prewarmCustomerAssets,
  prewarmCustomerCompliance,
  prewarmCustomerDetail,
  prewarmCustomersIndex,
  prewarmCustomerUsers,
} from '@/features/customers/queries'
import {
  prewarmFinanceContracts,
  prewarmFinanceContractDetail,
  prewarmFinanceDocumentDetail,
  prewarmFinanceDocuments,
  prewarmFinanceErp,
  prewarmNewFinanceContract,
  prewarmNewFinanceDocument,
  prewarmFinanceOverview,
  prewarmFinanceReceipts,
} from '@/features/finance/queries'
import {
  prewarmJobDetail,
  prewarmJobExecute,
  prewarmJobsIndex,
  prewarmNewJob,
} from '@/features/jobs/queries'
import {
  prewarmMethodDetail,
  prewarmMethodEdit,
  prewarmMethodsIndex,
} from '@/features/methods/queries'
import {
  prewarmCompetenceAudit,
  prewarmCompetenceDetail,
  prewarmNewCompetence,
  prewarmPersonnelIndex,
} from '@/features/personnel/queries'
import {
  prewarmCapaDetail,
  prewarmCapasIndex,
  prewarmNewCapa,
  prewarmNewNonConformance,
  prewarmNonConformanceDetail,
  prewarmNonConformancesIndex,
} from '@/features/quality/queries'
import {
  prewarmRequestDetail,
  prewarmRequestsIndex,
} from '@/features/requests/queries'
import { prewarmInvitation } from '@/features/public/queries'
import { prewarmReportsIndex } from '@/features/reports/queries'
import {
  prewarmNewServiceOrder,
  prewarmServiceOrderDetail,
  prewarmServiceOrdersIndex,
} from '@/features/service-orders/queries'
import {
  prewarmNewService,
  prewarmServiceDetail,
  prewarmServiceEdit,
  prewarmServicesIndex,
} from '@/features/services/queries'
import {
  prewarmEnvironmentSettings,
  prewarmAuthenticationSettings,
  prewarmCertificateNumberingSettings,
  prewarmCertificateSettings,
  prewarmNotificationSettings,
  prewarmPortalDomainSettings,
  prewarmSignatureSettings,
} from '@/features/settings/queries'
import {
  prewarmStandardDetail,
  prewarmStandardsIndex,
} from '@/features/standards/queries'
import { getStoredDashboardActiveUnitId } from '@/features/dashboard/dashboard-scope-storage'
import { prewarmDashboardIndex } from '@/features/dashboard/queries'
import {
  getStoredDashboardOrganizationId,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import { isDesktopRuntime } from '@/runtime/desktop'

const PREWARM_COOLDOWN_MS = 3_000
const DEFAULT_PREWARM_STALE_TIME_MS = 15_000

type PrewarmQuery = {
  queryKey: readonly unknown[]
  queryFn: () => Promise<unknown>
  staleTime?: number
}

type RoutePrewarmContext = {
  queryClient: QueryClient
  url: URL
  pathname: string
  match: RegExpMatchArray
}

type RoutePrewarmSpec = {
  id: string
  match: RegExp
  prewarm: (context: RoutePrewarmContext) => Promise<void>
}

function query(options: PrewarmQuery) {
  return {
    staleTime: DEFAULT_PREWARM_STALE_TIME_MS,
    ...options,
  }
}

function prewarmQueries(
  queryClient: QueryClient,
  queries: Array<PrewarmQuery | null | undefined>,
) {
  return prewarmRouteQueries(queryClient, queries)
}

function dashboardOrgId() {
  return getStoredDashboardOrganizationId()
}

function dashboardUnitId() {
  const unitId = Number(getStoredDashboardActiveUnitId())
  return Number.isFinite(unitId) && unitId > 0 ? unitId : null
}

function segment(match: RegExpMatchArray, index = 1) {
  const value = match[index]
  return value ? decodeURIComponent(value) : ''
}

function maybeOrgQuery(
  factory: (organizationId: string) => PrewarmQuery | null | undefined,
) {
  const organizationId = dashboardOrgId()
  return organizationId ? factory(organizationId) : null
}

function customersSearchQuery(organizationId: string, search = '') {
  return query({
    queryKey: ['customers', organizationId, 'search', search],
    queryFn: async () =>
      calibraApi.customers.list({
        page: 1,
        limit: 50,
        query: search || undefined,
      }),
    staleTime: 30_000,
  })
}

const routePrewarmSpecs: RoutePrewarmSpec[] = [
  {
    id: 'dashboard:index',
    match: /^\/dashboard\/?$/,
    prewarm: ({ queryClient }) => prewarmDashboardIndex(queryClient),
  },
  {
    id: 'dashboard:jobs:index',
    match: /^\/dashboard\/jobs\/?$/,
    prewarm: ({ queryClient, url }) => prewarmJobsIndex(queryClient, url),
  },
  {
    id: 'dashboard:clients:index',
    match: /^\/dashboard\/clients\/?$/,
    prewarm: ({ queryClient, url }) => prewarmCustomersIndex(queryClient, url),
  },
  {
    id: 'dashboard:assets:index',
    match: /^\/dashboard\/assets\/?$/,
    prewarm: async ({ queryClient, url }) => {
      await Promise.all([
        prewarmAssetsIndex(queryClient, url),
        prewarmQueries(queryClient, [
          maybeOrgQuery((organizationId) =>
            customersSearchQuery(organizationId),
          ),
        ]),
      ])
    },
  },
  {
    id: 'dashboard:standards:index',
    match: /^\/dashboard\/standards\/?$/,
    prewarm: ({ queryClient, url }) => prewarmStandardsIndex(queryClient, url),
  },
  {
    id: 'dashboard:services:index',
    match: /^\/dashboard\/services\/?$/,
    prewarm: ({ queryClient, url }) => prewarmServicesIndex(queryClient, url),
  },
  {
    id: 'dashboard:methods:index',
    match: /^\/dashboard\/methods\/?$/,
    prewarm: ({ queryClient, url }) => prewarmMethodsIndex(queryClient, url),
  },
  {
    id: 'dashboard:service-orders:index',
    match: /^\/dashboard\/service-orders\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmServiceOrdersIndex(queryClient, url),
  },
  {
    id: 'dashboard:requests:index',
    match: /^\/dashboard\/requests\/?$/,
    prewarm: ({ queryClient, url }) => prewarmRequestsIndex(queryClient, url),
  },
  {
    id: 'dashboard:personnel:index',
    match: /^\/dashboard\/personnel\/?$/,
    prewarm: ({ queryClient, url }) => prewarmPersonnelIndex(queryClient, url),
  },
  {
    id: 'dashboard:nc:index',
    match: /^\/dashboard\/nc\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmNonConformancesIndex(queryClient, url),
  },
  {
    id: 'dashboard:capa:index',
    match: /^\/dashboard\/capa\/?$/,
    prewarm: ({ queryClient, url }) => prewarmCapasIndex(queryClient, url),
  },
  {
    id: 'dashboard:finance:index',
    match: /^\/dashboard\/finance\/?$/,
    prewarm: ({ queryClient }) => prewarmFinanceOverview(queryClient),
  },
  {
    id: 'dashboard:finance:documents:index',
    match: /^\/dashboard\/finance\/documents\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmFinanceDocuments(queryClient, url),
  },
  {
    id: 'dashboard:finance:contracts:index',
    match: /^\/dashboard\/finance\/contracts\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmFinanceContracts(queryClient, url),
  },
  {
    id: 'dashboard:finance:receipts',
    match: /^\/dashboard\/finance\/receipts\/?$/,
    prewarm: ({ queryClient }) => prewarmFinanceReceipts(queryClient),
  },
  {
    id: 'dashboard:finance:erp',
    match: /^\/dashboard\/finance\/erp\/?$/,
    prewarm: ({ queryClient }) => prewarmFinanceErp(queryClient),
  },
  {
    id: 'dashboard:jobs:new',
    match: /^\/dashboard\/jobs\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewJob(queryClient),
  },
  {
    id: 'dashboard:service-orders:new',
    match: /^\/dashboard\/service-orders\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewServiceOrder(queryClient),
  },
  {
    id: 'dashboard:personnel:new',
    match: /^\/dashboard\/personnel\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewCompetence(queryClient),
  },
  {
    id: 'dashboard:assets:new',
    match: /^\/dashboard\/assets\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewAsset(queryClient),
  },
  {
    id: 'dashboard:services:new',
    match: /^\/dashboard\/services\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewService(queryClient),
  },
  {
    id: 'dashboard:nc:new',
    match: /^\/dashboard\/nc\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewNonConformance(queryClient),
  },
  {
    id: 'dashboard:capa:new',
    match: /^\/dashboard\/capa\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewCapa(queryClient),
  },
  {
    id: 'dashboard:finance:documents:new',
    match: /^\/dashboard\/finance\/documents\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewFinanceDocument(queryClient),
  },
  {
    id: 'dashboard:finance:contracts:new',
    match: /^\/dashboard\/finance\/contracts\/new\/?$/,
    prewarm: ({ queryClient }) => prewarmNewFinanceContract(queryClient),
  },
  {
    id: 'dashboard:asset-detail',
    match: /^\/dashboard\/assets\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmAssetDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:asset-edit',
    match: /^\/dashboard\/assets\/([^/]+)\/edit\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmAssetEdit(queryClient, segment(match)),
  },
  {
    id: 'dashboard:client-detail',
    match: /^\/dashboard\/clients\/([^/]+)(?:\/(?:info)?)?\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCustomerDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:client-assets',
    match: /^\/dashboard\/clients\/([^/]+)\/assets\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCustomerAssets(queryClient, segment(match)),
  },
  {
    id: 'dashboard:client-calibrations',
    match: /^\/dashboard\/clients\/([^/]+)\/calibrations\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCustomerDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:client-compliance',
    match: /^\/dashboard\/clients\/([^/]+)\/compliance\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCustomerCompliance(queryClient, segment(match)),
  },
  {
    id: 'dashboard:client-users',
    match: /^\/dashboard\/clients\/([^/]+)\/users\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCustomerUsers(queryClient, segment(match)),
  },
  {
    id: 'dashboard:job-detail',
    match: /^\/dashboard\/jobs\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmJobDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:job-execute',
    match: /^\/dashboard\/jobs\/([^/]+)\/execute\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmJobExecute(queryClient, segment(match)),
  },
  {
    id: 'dashboard:standard-detail',
    match: /^\/dashboard\/standards\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmStandardDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:standard-edit',
    match: /^\/dashboard\/standards\/([^/]+)\/edit\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmStandardDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:service-detail',
    match: /^\/dashboard\/services\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmServiceDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:service-edit',
    match: /^\/dashboard\/services\/([^/]+)\/edit\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmServiceEdit(queryClient, segment(match)),
  },
  {
    id: 'dashboard:method-detail',
    match: /^\/dashboard\/methods\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmMethodDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:method-edit',
    match: /^\/dashboard\/methods\/([^/]+)\/edit\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmMethodEdit(queryClient, segment(match)),
  },
  {
    id: 'dashboard:service-order-detail',
    match: /^\/dashboard\/service-orders\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmServiceOrderDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:request-detail',
    match: /^\/dashboard\/requests\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmRequestDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:competence-detail',
    match: /^\/dashboard\/personnel\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCompetenceDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:competence-training',
    match: /^\/dashboard\/personnel\/([^/]+)\/training\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCompetenceDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:competence-audit',
    match: /^\/dashboard\/personnel\/([^/]+)\/audit\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCompetenceAudit(queryClient, segment(match)),
  },
  {
    id: 'dashboard:nc-detail',
    match: /^\/dashboard\/nc\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmNonConformanceDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:capa-detail',
    match: /^\/dashboard\/capa\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmCapaDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:finance:document-detail',
    match: /^\/dashboard\/finance\/documents\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmFinanceDocumentDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:finance:contract-detail',
    match: /^\/dashboard\/finance\/contracts\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmFinanceContractDetail(queryClient, segment(match)),
  },
  {
    id: 'dashboard:reports',
    match: /^\/dashboard\/reports\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmReportsIndex(queryClient, dashboardOrgId()),
  },
  {
    id: 'dashboard:settings:authentication',
    match: /^\/dashboard\/settings\/authentication\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmAuthenticationSettings(queryClient, dashboardOrgId()),
  },
  {
    id: 'dashboard:settings:certificate-numbering',
    match: /^\/dashboard\/settings\/certificate-numbering\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmCertificateNumberingSettings(queryClient),
  },
  {
    id: 'dashboard:settings:certificates',
    match: /^\/dashboard\/settings\/certificates\/?$/,
    prewarm: ({ queryClient }) => prewarmCertificateSettings(queryClient),
  },
  {
    id: 'dashboard:settings:signature',
    match: /^\/dashboard\/settings\/signature\/?$/,
    prewarm: ({ queryClient }) => prewarmSignatureSettings(queryClient),
  },
  {
    id: 'dashboard:settings:portal-domain',
    match: /^\/dashboard\/settings\/portal-domain\/?$/,
    prewarm: ({ queryClient }) => prewarmPortalDomainSettings(queryClient),
  },
  {
    id: 'dashboard:settings:environment',
    match: /^\/dashboard\/settings\/environment\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmEnvironmentSettings(queryClient, dashboardUnitId()),
  },
  {
    id: 'dashboard:settings:notifications',
    match: /^\/dashboard\/settings\/notifications\/?$/,
    prewarm: ({ queryClient }) => prewarmNotificationSettings(queryClient),
  },
  {
    id: 'accept-invitation',
    match: /^\/accept-invitation\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmInvitation(queryClient, segment(match)),
  },
]

const prewarmState = new Map<
  string,
  { lastStartedAt: number; promise: Promise<void> }
>()

export function prewarmRouteDataForPath(url: URL, queryClient: QueryClient) {
  if (isDesktopRuntime()) return

  const specMatch = routePrewarmSpecs
    .map((candidate) => ({
      spec: candidate,
      match: url.pathname.match(candidate.match),
    }))
    .find((candidate) => candidate.match)

  if (!specMatch?.match) return

  const stateKey = `${specMatch.spec.id}:${url.pathname}${url.search}`
  const existing = prewarmState.get(stateKey)
  if (existing && Date.now() - existing.lastStartedAt < PREWARM_COOLDOWN_MS) {
    return existing.promise
  }

  const promise = specMatch.spec
    .prewarm({
      queryClient,
      url,
      pathname: url.pathname,
      match: specMatch.match,
    })
    .catch(() => {
      // Prewarming is opportunistic; navigation should own user-facing errors.
    })

  prewarmState.set(stateKey, {
    lastStartedAt: Date.now(),
    promise,
  })

  return promise
}
