import type { QueryClient } from '@tanstack/react-query'

import { authClient } from '@calibra-facil/auth/client'
import { prewarmDashboardIndex } from '@/routes/dashboard/-index.data'
import { prewarmClientsIndex } from '@/routes/dashboard/clients/-index.data'
import { prewarmJobsIndex } from '@/routes/dashboard/jobs/-index.data'
import {
  getStoredDashboardOrganizationId,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import { isDesktopRuntime } from '@/runtime/desktop'

const PREWARM_COOLDOWN_MS = 3_000
const DEFAULT_PREWARM_STALE_TIME_MS = 15_000
const DEFAULT_LIST_LIMIT = 20

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

function pageFromUrl(url: URL) {
  const page = Number(url.searchParams.get('page') ?? 1)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function searchFromUrl(url: URL, key = 'query') {
  return url.searchParams.get(key) ?? ''
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

function customersPlainSearchQuery(search = '') {
  return query({
    queryKey: ['customers', 'search', search],
    queryFn: async () =>
      calibraApi.customers.list({
        page: 1,
        limit: 50,
        query: search || undefined,
      }),
  })
}

function customerDetailQuery(id: string) {
  return query({
    queryKey: ['customer', id],
    queryFn: async () => calibraApi.customers.get(id),
  })
}

function assetsListQuery(organizationId: string, url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''
  const customerId = url.searchParams.get('customerId')
  const customerIdParam = customerId ? Number(customerId) : null

  return query({
    queryKey: [
      'assets',
      organizationId,
      page,
      DEFAULT_LIST_LIMIT,
      search,
      status,
      customerIdParam,
    ],
    queryFn: async () =>
      calibraApi.assets.list({
        page,
        limit: DEFAULT_LIST_LIMIT,
        query: search || undefined,
        status: status || undefined,
        customerId: customerIdParam || undefined,
      }),
  })
}

function assetDetailQuery(id: string) {
  return query({
    queryKey: ['asset', id],
    queryFn: async () => calibraApi.assets.get(id),
  })
}

function assetAuditQuery(id: string) {
  return query({
    queryKey: ['asset', id, 'audit-log'],
    queryFn: async () => calibraApi.assets.auditLog(id),
  })
}

function assetTypesQuery() {
  return query({
    queryKey: ['asset-types'],
    queryFn: async () => calibraApi.assetTypes.list(),
  })
}

function standardsListQuery(organizationId: string, url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['standards', organizationId, page, search, status],
    queryFn: async () =>
      calibraApi.standards.list({
        page,
        limit: DEFAULT_LIST_LIMIT,
        query: search || undefined,
        status: status || undefined,
      }),
  })
}

function activeStandardsQuery() {
  return query({
    queryKey: ['standards', 'active'],
    queryFn: async () => calibraApi.jobs.listStandards(),
  })
}

function standardDetailQuery(id: string) {
  return query({
    queryKey: ['standards', id],
    queryFn: async () => calibraApi.standards.get(id),
  })
}

function standardAuditQuery(id: string) {
  return query({
    queryKey: ['standards', id, 'audit-log'],
    queryFn: async () => calibraApi.standards.auditLog(id),
  })
}

function servicesListQuery(organizationId: string, url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['services', organizationId, page, search, status],
    queryFn: async () =>
      calibraApi.services.list({
        page,
        limit: DEFAULT_LIST_LIMIT,
        query: search || undefined,
        isActive:
          status === 'active'
            ? true
            : status === 'inactive'
              ? false
              : undefined,
      }),
  })
}

function serviceOptionsQuery() {
  return query({
    queryKey: ['finance', 'contract-form', 'services'],
    queryFn: async () => calibraApi.services.list({ limit: 100 }),
  })
}

function serviceDetailQuery(id: string) {
  return query({
    queryKey: ['services', id],
    queryFn: async () => calibraApi.services.get(id),
  })
}

function serviceAuditQuery(id: string) {
  return query({
    queryKey: ['services', id, 'audit-log'],
    queryFn: async () => calibraApi.services.auditLog(id),
  })
}

function publishedMethodsQuery() {
  return query({
    queryKey: ['methods', 'published'],
    queryFn: async () =>
      calibraApi.methods.list({
        status: 'PUBLISHED',
        limit: 100,
      }),
  })
}

function methodsListQuery(url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['methods', page, search, status],
    queryFn: async () =>
      calibraApi.methods.list({
        page,
        limit: DEFAULT_LIST_LIMIT,
        query: search || undefined,
        status: status || undefined,
      }),
  })
}

function methodDetailQuery(id: string) {
  return query({
    queryKey: ['methods', id],
    queryFn: async () => calibraApi.methods.get(id),
  })
}

function serviceOrdersListQuery(url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['service-orders', page, search, status],
    queryFn: async () =>
      calibraApi.serviceOrders.list({
        query: search || undefined,
        status: status || undefined,
        page,
        limit: DEFAULT_LIST_LIMIT,
      }),
  })
}

function serviceOrderDetailQuery(id: string) {
  return query({
    queryKey: ['service-order', id],
    queryFn: async () => calibraApi.serviceOrders.get(id),
  })
}

function calibrationRequestsListQuery(organizationId: string, url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['calibration-requests', organizationId, page, search, status],
    queryFn: async () =>
      calibraApi.calibrationRequests.list({
        page,
        limit: DEFAULT_LIST_LIMIT,
        query: search || undefined,
        status: status || undefined,
      }),
  })
}

function calibrationRequestDetailQuery(id: string) {
  return query({
    queryKey: ['calibration-request', id],
    queryFn: async () => calibraApi.calibrationRequests.get(id),
  })
}

function personnelListQuery(url: URL) {
  const page = pageFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['competences', page, status],
    queryFn: async () =>
      calibraApi.competences.list({
        page,
        limit: DEFAULT_LIST_LIMIT,
        status: status || undefined,
      }),
  })
}

function competenceDetailQuery(id: string) {
  return query({
    queryKey: ['competence', id],
    queryFn: async () => calibraApi.competences.get(id),
  })
}

function competenceAuditQuery(id: string) {
  return query({
    queryKey: ['competence-audit', id],
    queryFn: async () => calibraApi.competences.auditLog(id),
  })
}

function ncListQuery(url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''
  const type = url.searchParams.get('type') ?? ''

  return query({
    queryKey: ['non-conformances', page, search, status, type],
    queryFn: async () =>
      calibraApi.nonConformances.list({
        page,
        limit: DEFAULT_LIST_LIMIT,
        query: search || undefined,
        status: status || undefined,
        type: type || undefined,
      }),
  })
}

function ncSummaryQuery() {
  return query({
    queryKey: ['non-conformances-summary'],
    queryFn: async () => calibraApi.nonConformances.summary(),
  })
}

function ncDetailQuery(id: string) {
  return query({
    queryKey: ['non-conformance', id],
    queryFn: async () => calibraApi.nonConformances.get(id),
  })
}

function ncAuditQuery(id: string) {
  return query({
    queryKey: ['non-conformance-audit', id],
    queryFn: async () => calibraApi.nonConformances.auditLog(id),
  })
}

function capaListQuery(url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''
  const severity = url.searchParams.get('severity') ?? ''
  const category = url.searchParams.get('category') ?? ''

  return query({
    queryKey: ['capas', page, search, status, severity, category],
    queryFn: async () =>
      calibraApi.capas.list({
        page,
        limit: DEFAULT_LIST_LIMIT,
        query: search || undefined,
        status: status || undefined,
        severity: severity || undefined,
        category: category || undefined,
      }),
  })
}

function capaSummaryQuery() {
  return query({
    queryKey: ['capas-summary'],
    queryFn: async () => calibraApi.capas.summary(),
  })
}

function capaDetailQuery(id: string) {
  return query({
    queryKey: ['capa', id],
    queryFn: async () => calibraApi.capas.get(id),
  })
}

function capaAuditQuery(id: string) {
  return query({
    queryKey: ['capa-audit-log', id],
    queryFn: async () => calibraApi.capas.auditLog(id),
  })
}

function techniciansQuery(key: readonly unknown[] = ['jobs', 'technicians']) {
  return query({
    queryKey: key,
    queryFn: async () => calibraApi.jobs.listTechnicians(),
  })
}

function financeOverviewQuery() {
  return query({
    queryKey: ['finance', 'overview'],
    queryFn: async () => calibraApi.finance.getOverview(),
  })
}

function financeDocumentsQuery(url: URL) {
  const search = searchFromUrl(url)

  return query({
    queryKey: ['finance', 'documents', search],
    queryFn: async () =>
      calibraApi.finance.listDocuments({ query: search || undefined }),
  })
}

function financeDocumentDetailQuery(id: string) {
  return query({
    queryKey: ['finance', 'documents', id],
    queryFn: async () => calibraApi.finance.getDocument(id),
  })
}

function financeContractsQuery(url: URL) {
  const search = searchFromUrl(url)

  return query({
    queryKey: ['finance', 'contracts', search],
    queryFn: async () =>
      calibraApi.finance.listContracts({ query: search || undefined }),
  })
}

function financeContractDetailQuery(id: string) {
  return query({
    queryKey: ['finance', 'contracts', id],
    queryFn: async () => calibraApi.finance.getContract(id),
  })
}

function financeReceiptsQuery() {
  return query({
    queryKey: ['finance', 'receipts'],
    queryFn: async () => calibraApi.finance.listReceipts(),
  })
}

function financeErpQuery() {
  return query({
    queryKey: ['finance', 'erp'],
    queryFn: async () => calibraApi.finance.listErpExports(),
  })
}

function certificateTemplatesQuery() {
  return query({
    queryKey: ['certificate-templates'],
    queryFn: async () => calibraApi.certificateTemplates.list(),
  })
}

function executiveReportQuery() {
  return query({
    queryKey: ['reports', 'executive'],
    queryFn: async () => calibraApi.reports.getExecutiveOverview(),
  })
}

function comparisonReportQuery() {
  return query({
    queryKey: ['reports', 'comparison'],
    queryFn: async () => calibraApi.reports.getComparison(),
  })
}

function trendReportQuery() {
  return query({
    queryKey: ['reports', 'trend'],
    queryFn: async () => calibraApi.reports.getTrend(),
  })
}

function backofficeAccessQuery(scope: string) {
  return query({
    queryKey: ['backoffice', 'access', scope],
    queryFn: async () => calibraApi.backoffice.getAccess(),
    staleTime: 30_000,
  })
}

function backofficeOrganizationsQuery(queryKey: readonly unknown[]) {
  return query({
    queryKey,
    queryFn: async () => calibraApi.backoffice.listOrganizations(),
  })
}

function backofficeOrganizationDetailQuery(id: string) {
  return query({
    queryKey: ['backoffice', 'organizations', id],
    queryFn: async () => calibraApi.backoffice.getOrganization(id),
  })
}

function backofficeSupportQueueQuery(queryKey: readonly unknown[]) {
  return query({
    queryKey,
    queryFn: async () => calibraApi.backoffice.getSupportQueue(),
  })
}

function invitationQuery(id: string) {
  return query({
    queryKey: ['accept-invitation', id],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({
        query: { id },
      })

      if (error) {
        throw new Error(error.message || 'Failed to load invitation')
      }

      return data as unknown
    },
  })
}

function checkoutSnapshotQuery(token: string) {
  return query({
    queryKey: ['public-commercial-checkout', token, 'snapshot'],
    queryFn: async () => calibraApi.publicCheckout.getSnapshot(token),
  })
}

function checkoutStatusQuery(token: string) {
  return query({
    queryKey: ['public-commercial-checkout', token, 'status'],
    queryFn: async () => calibraApi.publicCheckout.getStatus(token),
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
    prewarm: ({ queryClient }) => prewarmJobsIndex(queryClient),
  },
  {
    id: 'dashboard:clients:index',
    match: /^\/dashboard\/clients\/?$/,
    prewarm: ({ queryClient }) => prewarmClientsIndex(queryClient),
  },
  {
    id: 'dashboard:assets:index',
    match: /^\/dashboard\/assets\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [
        maybeOrgQuery((organizationId) => customersSearchQuery(organizationId)),
        maybeOrgQuery((organizationId) => assetsListQuery(organizationId, url)),
      ]),
  },
  {
    id: 'dashboard:standards:index',
    match: /^\/dashboard\/standards\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [
        maybeOrgQuery((organizationId) =>
          standardsListQuery(organizationId, url),
        ),
      ]),
  },
  {
    id: 'dashboard:services:index',
    match: /^\/dashboard\/services\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [
        maybeOrgQuery((organizationId) =>
          servicesListQuery(organizationId, url),
        ),
      ]),
  },
  {
    id: 'dashboard:methods:index',
    match: /^\/dashboard\/methods\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [methodsListQuery(url)]),
  },
  {
    id: 'dashboard:service-orders:index',
    match: /^\/dashboard\/service-orders\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [serviceOrdersListQuery(url)]),
  },
  {
    id: 'dashboard:requests:index',
    match: /^\/dashboard\/requests\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [
        maybeOrgQuery((organizationId) =>
          calibrationRequestsListQuery(organizationId, url),
        ),
      ]),
  },
  {
    id: 'dashboard:personnel:index',
    match: /^\/dashboard\/personnel\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [personnelListQuery(url)]),
  },
  {
    id: 'dashboard:nc:index',
    match: /^\/dashboard\/nc\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [ncListQuery(url), ncSummaryQuery()]),
  },
  {
    id: 'dashboard:capa:index',
    match: /^\/dashboard\/capa\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [capaListQuery(url), capaSummaryQuery()]),
  },
  {
    id: 'dashboard:finance:index',
    match: /^\/dashboard\/finance\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [financeOverviewQuery()]),
  },
  {
    id: 'dashboard:finance:documents:index',
    match: /^\/dashboard\/finance\/documents\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [financeDocumentsQuery(url)]),
  },
  {
    id: 'dashboard:finance:contracts:index',
    match: /^\/dashboard\/finance\/contracts\/?$/,
    prewarm: ({ queryClient, url }) =>
      prewarmQueries(queryClient, [financeContractsQuery(url)]),
  },
  {
    id: 'dashboard:finance:receipts',
    match: /^\/dashboard\/finance\/receipts\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [financeReceiptsQuery()]),
  },
  {
    id: 'dashboard:finance:erp',
    match: /^\/dashboard\/finance\/erp\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [financeErpQuery()]),
  },
  {
    id: 'dashboard:jobs:new',
    match: /^\/dashboard\/jobs\/new\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        customersPlainSearchQuery(),
        techniciansQuery(),
      ]),
  },
  {
    id: 'dashboard:assets:new',
    match: /^\/dashboard\/assets\/new\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        customersPlainSearchQuery(),
        assetTypesQuery(),
      ]),
  },
  {
    id: 'dashboard:services:new',
    match: /^\/dashboard\/services\/new\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [publishedMethodsQuery(), assetTypesQuery()]),
  },
  {
    id: 'dashboard:nc:new',
    match: /^\/dashboard\/nc\/new\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        query({
          queryKey: ['jobs-for-nc'],
          queryFn: async () =>
            calibraApi.jobs.list({
              page: 1,
              limit: 100,
            }),
        }),
      ]),
  },
  {
    id: 'dashboard:capa:new',
    match: /^\/dashboard\/capa\/new\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [techniciansQuery()]),
  },
  {
    id: 'dashboard:finance:documents:new',
    match: /^\/dashboard\/finance\/documents\/new\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        query({
          queryKey: ['finance', 'documents', 'eligible-jobs', 'single', ''],
          queryFn: async () =>
            calibraApi.finance.listEligibleJobs({
              mode: 'single',
            }),
        }),
      ]),
  },
  {
    id: 'dashboard:finance:contracts:new',
    match: /^\/dashboard\/finance\/contracts\/new\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        query({
          queryKey: ['finance', 'contract-form', 'customers'],
          queryFn: async () =>
            calibraApi.customers.list({
              page: 1,
              limit: 100,
            }),
        }),
        serviceOptionsQuery(),
      ]),
  },
  {
    id: 'dashboard:asset-detail',
    match: /^\/dashboard\/assets\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        assetDetailQuery(id),
        assetAuditQuery(id),
      ])
    },
  },
  {
    id: 'dashboard:asset-edit',
    match: /^\/dashboard\/assets\/([^/]+)\/edit\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        assetDetailQuery(id),
        assetTypesQuery(),
        assetAuditQuery(id),
      ])
    },
  },
  {
    id: 'dashboard:client-detail',
    match: /^\/dashboard\/clients\/([^/]+)(?:\/(?:info)?)?\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [customerDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:client-assets',
    match: /^\/dashboard\/clients\/([^/]+)\/assets\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      const customerId = Number(id)
      return prewarmQueries(queryClient, [
        customerDetailQuery(id),
        Number.isFinite(customerId)
          ? query({
              queryKey: ['assets', 'customer', customerId, 1, 20, ''],
              queryFn: async () =>
                calibraApi.assets.list({
                  customerId,
                  page: 1,
                  limit: 20,
                }),
            })
          : null,
      ])
    },
  },
  {
    id: 'dashboard:client-calibrations',
    match: /^\/dashboard\/clients\/([^/]+)\/calibrations\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [customerDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:client-compliance',
    match: /^\/dashboard\/clients\/([^/]+)\/compliance\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [customerDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:client-users',
    match: /^\/dashboard\/clients\/([^/]+)\/users\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [customerDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:job-detail',
    match: /^\/dashboard\/jobs\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        query({
          queryKey: ['jobs', id],
          queryFn: async () => calibraApi.jobs.get(id),
        }),
        techniciansQuery(),
      ])
    },
  },
  {
    id: 'dashboard:job-execute',
    match: /^\/dashboard\/jobs\/([^/]+)\/execute\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        query({
          queryKey: ['jobs', id],
          queryFn: async () => calibraApi.jobs.get(id),
        }),
        activeStandardsQuery(),
      ])
    },
  },
  {
    id: 'dashboard:standard-detail',
    match: /^\/dashboard\/standards\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        standardDetailQuery(id),
        standardAuditQuery(id),
      ])
    },
  },
  {
    id: 'dashboard:standard-edit',
    match: /^\/dashboard\/standards\/([^/]+)\/edit\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        standardDetailQuery(id),
        standardAuditQuery(id),
      ])
    },
  },
  {
    id: 'dashboard:service-detail',
    match: /^\/dashboard\/services\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        serviceDetailQuery(id),
        serviceAuditQuery(id),
      ])
    },
  },
  {
    id: 'dashboard:service-edit',
    match: /^\/dashboard\/services\/([^/]+)\/edit\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        serviceDetailQuery(id),
        publishedMethodsQuery(),
        assetTypesQuery(),
        serviceAuditQuery(id),
      ])
    },
  },
  {
    id: 'dashboard:method-detail',
    match: /^\/dashboard\/methods\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [methodDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:method-edit',
    match: /^\/dashboard\/methods\/([^/]+)\/edit\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [methodDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:service-order-detail',
    match: /^\/dashboard\/service-orders\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [serviceOrderDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:request-detail',
    match: /^\/dashboard\/requests\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [
        calibrationRequestDetailQuery(segment(match)),
      ]),
  },
  {
    id: 'dashboard:competence-detail',
    match: /^\/dashboard\/personnel\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [competenceDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:competence-training',
    match: /^\/dashboard\/personnel\/([^/]+)\/training\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [competenceDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:competence-audit',
    match: /^\/dashboard\/personnel\/([^/]+)\/audit\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        competenceDetailQuery(id),
        competenceAuditQuery(id),
      ])
    },
  },
  {
    id: 'dashboard:nc-detail',
    match: /^\/dashboard\/nc\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [ncDetailQuery(id), ncAuditQuery(id)])
    },
  },
  {
    id: 'dashboard:capa-detail',
    match: /^\/dashboard\/capa\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) => {
      const id = segment(match)
      return prewarmQueries(queryClient, [
        capaDetailQuery(id),
        capaAuditQuery(id),
      ])
    },
  },
  {
    id: 'dashboard:finance:document-detail',
    match: /^\/dashboard\/finance\/documents\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [financeDocumentDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:finance:contract-detail',
    match: /^\/dashboard\/finance\/contracts\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [financeContractDetailQuery(segment(match))]),
  },
  {
    id: 'dashboard:certificate-templates',
    match: /^\/dashboard\/certificate-templates\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [certificateTemplatesQuery()]),
  },
  {
    id: 'dashboard:reports',
    match: /^\/dashboard\/reports\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        executiveReportQuery(),
        comparisonReportQuery(),
        trendReportQuery(),
      ]),
  },
  {
    id: 'dashboard:settings:authentication',
    match: /^\/dashboard\/settings\/authentication\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        query({
          queryKey: ['api-keys'],
          queryFn: () => calibraApi.apiKeys.list(),
        }),
        maybeOrgQuery((organizationId) =>
          query({
            queryKey: ['sso-settings', organizationId],
            queryFn: () => calibraApi.sso.getProviders(),
          }),
        ),
      ]),
  },
  {
    id: 'dashboard:settings:certificate-numbering',
    match: /^\/dashboard\/settings\/certificate-numbering\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        query({
          queryKey: ['certificate-numbering-profile'],
          queryFn: () => calibraApi.certificateNumbering.getProfile(),
        }),
      ]),
  },
  {
    id: 'dashboard:settings:certificates',
    match: /^\/dashboard\/settings\/certificates\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        query({
          queryKey: ['signing-certificates', 'no-unit'],
          queryFn: () => calibraApi.signingCertificates.list(),
        }),
      ]),
  },
  {
    id: 'dashboard:settings:environment',
    match: /^\/dashboard\/settings\/environment\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [assetTypesQuery()]),
  },
  {
    id: 'backoffice:index',
    match: /^\/backoffice\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        backofficeAccessQuery('layout'),
        backofficeOrganizationsQuery([
          'backoffice',
          'organizations',
          'summary',
        ]),
        backofficeSupportQueueQuery([
          'backoffice',
          'support',
          'queue',
          'summary',
        ]),
      ]),
  },
  {
    id: 'backoffice:organizations:index',
    match: /^\/backoffice\/organizations\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        backofficeAccessQuery('layout'),
        backofficeOrganizationsQuery(['backoffice', 'organizations']),
      ]),
  },
  {
    id: 'backoffice:organizations:detail',
    match: /^\/backoffice\/organizations\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [
        backofficeAccessQuery('layout'),
        backofficeOrganizationDetailQuery(segment(match)),
      ]),
  },
  {
    id: 'backoffice:support',
    match: /^\/backoffice\/support\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        backofficeAccessQuery('layout'),
        backofficeSupportQueueQuery(['backoffice', 'support', 'queue']),
      ]),
  },
  {
    id: 'backoffice:users',
    match: /^\/backoffice\/users\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        backofficeAccessQuery('layout'),
        backofficeOrganizationsQuery([
          'backoffice',
          'organizations',
          'options',
        ]),
      ]),
  },
  {
    id: 'accept-invitation',
    match: /^\/accept-invitation\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) =>
      prewarmQueries(queryClient, [invitationQuery(segment(match))]),
  },
  {
    id: 'checkout',
    match: /^\/checkout\/([^/]+)\/?$/,
    prewarm: ({ queryClient, match }) => {
      const token = segment(match)
      return prewarmQueries(queryClient, [
        checkoutSnapshotQuery(token),
        checkoutStatusQuery(token),
      ])
    },
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
