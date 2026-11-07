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
  prewarmCustomersSearch,
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
import { getStoredDashboardOrganizationId } from '@/lib/route-data'
import { isDesktopRuntime } from '@/runtime/desktop'
import {
  listDashboardRouteIds,
  matchRoutePath,
  type DashboardRouteId,
} from '@/app/router/route-registry'

const PREWARM_COOLDOWN_MS = 3_000

// The route registry owns which routes exist and which pathname belongs to
// which; this module only says what to warm for the ones that have a loader.
type PrewarmRouteId = DashboardRouteId | '/accept-invitation/$id'

type RoutePrewarmContext = {
  queryClient: QueryClient
  url: URL
  /** Decoded `$param` values of the matched route. */
  params: Record<string, string>
}

type RoutePrewarm = (context: RoutePrewarmContext) => Promise<void>

function dashboardOrgId() {
  return getStoredDashboardOrganizationId()
}

function dashboardUnitId() {
  const unitId = Number(getStoredDashboardActiveUnitId())
  return Number.isFinite(unitId) && unitId > 0 ? unitId : null
}

function param({ params }: RoutePrewarmContext, name: string) {
  return params[name] ?? ''
}

const routePrewarms: Partial<Record<PrewarmRouteId, RoutePrewarm>> = {
  '/dashboard': ({ queryClient }) => prewarmDashboardIndex(queryClient),
  '/dashboard/jobs': ({ queryClient, url }) =>
    prewarmJobsIndex(queryClient, url),
  '/dashboard/clients': ({ queryClient, url }) =>
    prewarmCustomersIndex(queryClient, url),
  '/dashboard/assets': async ({ queryClient, url }) => {
    const organizationId = dashboardOrgId()
    await Promise.all([
      prewarmAssetsIndex(queryClient, url),
      organizationId
        ? prewarmCustomersSearch(queryClient, organizationId)
        : null,
    ])
  },
  '/dashboard/standards': ({ queryClient, url }) =>
    prewarmStandardsIndex(queryClient, url),
  '/dashboard/services': ({ queryClient, url }) =>
    prewarmServicesIndex(queryClient, url),
  '/dashboard/methods': ({ queryClient, url }) =>
    prewarmMethodsIndex(queryClient, url),
  '/dashboard/service-orders': ({ queryClient, url }) =>
    prewarmServiceOrdersIndex(queryClient, url),
  '/dashboard/requests': ({ queryClient, url }) =>
    prewarmRequestsIndex(queryClient, url),
  '/dashboard/personnel': ({ queryClient, url }) =>
    prewarmPersonnelIndex(queryClient, url),
  '/dashboard/nc': ({ queryClient, url }) =>
    prewarmNonConformancesIndex(queryClient, url),
  '/dashboard/capa': ({ queryClient, url }) =>
    prewarmCapasIndex(queryClient, url),
  '/dashboard/finance': ({ queryClient }) =>
    prewarmFinanceOverview(queryClient),
  '/dashboard/finance/documents': ({ queryClient, url }) =>
    prewarmFinanceDocuments(queryClient, url),
  '/dashboard/finance/contracts': ({ queryClient, url }) =>
    prewarmFinanceContracts(queryClient, url),
  '/dashboard/finance/receipts': ({ queryClient }) =>
    prewarmFinanceReceipts(queryClient),
  '/dashboard/finance/erp': ({ queryClient }) => prewarmFinanceErp(queryClient),
  '/dashboard/jobs/new': ({ queryClient }) => prewarmNewJob(queryClient),
  '/dashboard/service-orders/new': ({ queryClient }) =>
    prewarmNewServiceOrder(queryClient),
  '/dashboard/personnel/new': ({ queryClient }) =>
    prewarmNewCompetence(queryClient),
  '/dashboard/assets/new': ({ queryClient }) => prewarmNewAsset(queryClient),
  '/dashboard/services/new': ({ queryClient }) =>
    prewarmNewService(queryClient),
  '/dashboard/nc/new': ({ queryClient }) =>
    prewarmNewNonConformance(queryClient),
  '/dashboard/capa/new': ({ queryClient }) => prewarmNewCapa(queryClient),
  '/dashboard/finance/documents/new': ({ queryClient }) =>
    prewarmNewFinanceDocument(queryClient),
  '/dashboard/finance/contracts/new': ({ queryClient }) =>
    prewarmNewFinanceContract(queryClient),
  '/dashboard/assets/$id': (context) =>
    prewarmAssetDetail(context.queryClient, param(context, 'id')),
  '/dashboard/assets/$id/edit': (context) =>
    prewarmAssetEdit(context.queryClient, param(context, 'id')),
  '/dashboard/clients/$id': (context) =>
    prewarmCustomerDetail(context.queryClient, param(context, 'id')),
  '/dashboard/clients/$id/info': (context) =>
    prewarmCustomerDetail(context.queryClient, param(context, 'id')),
  '/dashboard/clients/$id/assets': (context) =>
    prewarmCustomerAssets(context.queryClient, param(context, 'id')),
  '/dashboard/clients/$id/calibrations': (context) =>
    prewarmCustomerDetail(context.queryClient, param(context, 'id')),
  '/dashboard/clients/$id/compliance': (context) =>
    prewarmCustomerCompliance(context.queryClient, param(context, 'id')),
  '/dashboard/clients/$id/users': (context) =>
    prewarmCustomerUsers(context.queryClient, param(context, 'id')),
  '/dashboard/jobs/$id': (context) =>
    prewarmJobDetail(context.queryClient, param(context, 'id')),
  '/dashboard/jobs/$id/execute': (context) =>
    prewarmJobExecute(context.queryClient, param(context, 'id')),
  '/dashboard/standards/$id': (context) =>
    prewarmStandardDetail(context.queryClient, param(context, 'id')),
  '/dashboard/standards/$id/edit': (context) =>
    prewarmStandardDetail(context.queryClient, param(context, 'id')),
  '/dashboard/services/$id': (context) =>
    prewarmServiceDetail(context.queryClient, param(context, 'id')),
  '/dashboard/services/$id/edit': (context) =>
    prewarmServiceEdit(context.queryClient, param(context, 'id')),
  '/dashboard/methods/$id': (context) =>
    prewarmMethodDetail(context.queryClient, param(context, 'id')),
  '/dashboard/methods/$id/edit': (context) =>
    prewarmMethodEdit(context.queryClient, param(context, 'id')),
  '/dashboard/service-orders/$publicId': (context) =>
    prewarmServiceOrderDetail(context.queryClient, param(context, 'publicId')),
  '/dashboard/requests/$id': (context) =>
    prewarmRequestDetail(context.queryClient, param(context, 'id')),
  '/dashboard/personnel/$id': (context) =>
    prewarmCompetenceDetail(context.queryClient, param(context, 'id')),
  '/dashboard/personnel/$id/training': (context) =>
    prewarmCompetenceDetail(context.queryClient, param(context, 'id')),
  '/dashboard/personnel/$id/audit': (context) =>
    prewarmCompetenceAudit(context.queryClient, param(context, 'id')),
  '/dashboard/nc/$id': (context) =>
    prewarmNonConformanceDetail(context.queryClient, param(context, 'id')),
  '/dashboard/capa/$id': (context) =>
    prewarmCapaDetail(context.queryClient, param(context, 'id')),
  '/dashboard/finance/documents/$id': (context) =>
    prewarmFinanceDocumentDetail(context.queryClient, param(context, 'id')),
  '/dashboard/finance/contracts/$id': (context) =>
    prewarmFinanceContractDetail(context.queryClient, param(context, 'id')),
  '/dashboard/reports': ({ queryClient }) =>
    prewarmReportsIndex(queryClient, dashboardOrgId()),
  '/dashboard/settings/authentication': ({ queryClient }) =>
    prewarmAuthenticationSettings(queryClient, dashboardOrgId()),
  '/dashboard/settings/certificate-numbering': ({ queryClient }) =>
    prewarmCertificateNumberingSettings(queryClient),
  '/dashboard/settings/certificates': ({ queryClient }) =>
    prewarmCertificateSettings(queryClient),
  '/dashboard/settings/signature': ({ queryClient }) =>
    prewarmSignatureSettings(queryClient),
  '/dashboard/settings/portal-domain': ({ queryClient }) =>
    prewarmPortalDomainSettings(queryClient),
  '/dashboard/settings/environment': ({ queryClient }) =>
    prewarmEnvironmentSettings(queryClient, dashboardUnitId()),
  '/dashboard/settings/notifications': ({ queryClient }) =>
    prewarmNotificationSettings(queryClient),
  '/accept-invitation/$id': (context) =>
    prewarmInvitation(context.queryClient, param(context, 'id')),
}

// Matched against every route, not just the ones with a loader, so a static
// page (`/dashboard/clients/new`) is not taken for a `$id` one.
const routePatterns: readonly PrewarmRouteId[] = [
  ...listDashboardRouteIds(),
  '/accept-invitation/$id',
]

const prewarmState = new Map<
  string,
  { lastStartedAt: number; promise: Promise<void> }
>()

export function prewarmRouteDataForPath(url: URL, queryClient: QueryClient) {
  if (isDesktopRuntime()) return

  const match = matchRoutePath(url.pathname, routePatterns)
  const prewarm = match ? routePrewarms[match.pattern] : undefined
  if (!match || !prewarm) return

  const stateKey = `${match.pattern}:${url.pathname}${url.search}`
  const existing = prewarmState.get(stateKey)
  if (existing && Date.now() - existing.lastStartedAt < PREWARM_COOLDOWN_MS) {
    return existing.promise
  }

  const promise = prewarm({ queryClient, url, params: match.params }).catch(
    () => {
      // Prewarming is opportunistic; navigation should own user-facing errors.
    },
  )

  prewarmState.set(stateKey, {
    lastStartedAt: Date.now(),
    promise,
  })

  return promise
}
