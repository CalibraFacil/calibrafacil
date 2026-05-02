import type { QueryClient } from '@tanstack/react-query'

import { authClient } from '@calibra-facil/auth/client'
import { prewarmDashboardIndex } from '@/routes/dashboard/-index.data'
import { prewarmClientsIndex } from '@/routes/dashboard/clients/-index.data'
import { prewarmJobsIndex } from '@/routes/dashboard/jobs/-index.data'
import {
  getStoredDashboardOrganizationId,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { apiRouteParam } from '@/lib/route-identifiers'
import { api } from '@/utils/api'

const PREWARM_COOLDOWN_MS = 15_000
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
  return options
}

function apiQuery<T extends Record<string, unknown>>(value: T) {
  return value as never
}

async function jsonOrThrow(response: Response, message: string) {
  if (!response.ok) {
    throw new Error(message)
  }

  return response.json() as Promise<unknown>
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
      jsonOrThrow(
        await api.api.customers.$get({
          query: {
            page: '1',
            limit: '50',
            query: search || undefined,
          },
        }),
        'Failed to load customers',
      ),
    staleTime: 30_000,
  })
}

function customersPlainSearchQuery(search = '') {
  return query({
    queryKey: ['customers', 'search', search],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.customers.$get({
          query: {
            page: '1',
            limit: '50',
            query: search || undefined,
          },
        }),
        'Failed to load customers',
      ),
  })
}

function customerDetailQuery(id: string) {
  return query({
    queryKey: ['customer', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.customers[':id'].$get({ param: { id } }),
        'Failed to load customer',
      ),
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
      jsonOrThrow(
        await api.api.assets.$get({
          query: apiQuery({
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
            query: search || undefined,
            status: status || undefined,
            customerId: customerIdParam ? String(customerIdParam) : undefined,
          }),
        }),
        'Failed to load assets',
      ),
  })
}

function assetDetailQuery(id: string) {
  return query({
    queryKey: ['asset', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.assets[':id'].$get({ param: { id } }),
        'Failed to load asset',
      ),
  })
}

function assetAuditQuery(id: string) {
  return query({
    queryKey: ['asset', id, 'audit-log'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.assets[':id']['audit-log'].$get({ param: { id } }),
        'Failed to load asset audit log',
      ),
  })
}

function assetTypesQuery() {
  return query({
    queryKey: ['asset-types'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api['asset-types'].$get({ query: {} }),
        'Failed to load asset types',
      ),
  })
}

function standardsListQuery(organizationId: string, url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['standards', organizationId, page, search, status],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.standards.$get({
          query: apiQuery({
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
            query: search || undefined,
            status: status || undefined,
          }),
        }),
        'Failed to load standards',
      ),
  })
}

function activeStandardsQuery() {
  return query({
    queryKey: ['standards', 'active'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.standards.$get({
          query: { status: 'ACTIVE', limit: '100' },
        }),
        'Failed to load standards',
      ),
  })
}

function standardDetailQuery(id: string) {
  return query({
    queryKey: ['standards', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.standards[':id'].$get({ param: { id } }),
        'Failed to load standard',
      ),
  })
}

function standardAuditQuery(id: string) {
  return query({
    queryKey: ['standards', id, 'audit-log'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.standards[':id']['audit-log'].$get({ param: { id } }),
        'Failed to load standard audit log',
      ),
  })
}

function servicesListQuery(organizationId: string, url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['services', organizationId, page, search, status],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.services.$get({
          query: {
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
            query: search || undefined,
            isActive:
              status === 'active'
                ? 'true'
                : status === 'inactive'
                  ? 'false'
                  : undefined,
          },
        }),
        'Failed to load services',
      ),
  })
}

function serviceOptionsQuery() {
  return query({
    queryKey: ['finance', 'contract-form', 'services'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.services.$get({ query: { limit: '100' } }),
        'Failed to load services',
      ),
  })
}

function serviceDetailQuery(id: string) {
  return query({
    queryKey: ['services', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.services[':id'].$get({ param: { id } }),
        'Failed to load service',
      ),
  })
}

function serviceAuditQuery(id: string) {
  return query({
    queryKey: ['services', id, 'audit-log'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.services[':id']['audit-log'].$get({ param: { id } }),
        'Failed to load service audit log',
      ),
  })
}

function methodsListQuery(url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['methods', page, search, status],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.methods.$get({
          query: apiQuery({
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
            query: search || undefined,
            status: status || undefined,
            includeArchived: status === 'ARCHIVED' ? 'true' : 'false',
          }),
        }),
        'Failed to load methods',
      ),
  })
}

function methodDetailQuery(id: string) {
  return query({
    queryKey: ['methods', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.methods[':id'].$get({ param: { id } }),
        'Failed to load method',
      ),
  })
}

function serviceOrdersListQuery(url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['service-orders', page, search, status],
    queryFn: async () =>
      jsonOrThrow(
        await api.api['service-orders'].$get({
          query: apiQuery({
            query: search || undefined,
            status: status || undefined,
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
          }),
        }),
        'Failed to load service orders',
      ),
  })
}

function serviceOrderDetailQuery(id: string) {
  return query({
    queryKey: ['service-order', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api['service-orders'][':id'].$get({ param: { id } }),
        'Failed to load service order',
      ),
  })
}

function calibrationRequestsListQuery(organizationId: string, url: URL) {
  const page = pageFromUrl(url)
  const search = searchFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['calibration-requests', organizationId, page, search, status],
    queryFn: async () =>
      jsonOrThrow(
        await api.api['calibration-requests'].$get({
          query: apiQuery({
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
            query: search || undefined,
            status: status || undefined,
          }),
        }),
        'Failed to load calibration requests',
      ),
  })
}

function calibrationRequestDetailQuery(id: string) {
  return query({
    queryKey: ['calibration-request', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api['calibration-requests'][':id'].$get({
          param: { id },
        }),
        'Failed to load calibration request',
      ),
  })
}

function personnelListQuery(url: URL) {
  const page = pageFromUrl(url)
  const status = url.searchParams.get('status') ?? ''

  return query({
    queryKey: ['competences', page, status],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.competences.$get({
          query: apiQuery({
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
            status: status || undefined,
          }),
        }),
        'Failed to load competences',
      ),
  })
}

function competenceDetailQuery(id: string) {
  return query({
    queryKey: ['competence', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.competences[':id'].$get({ param: { id } }),
        'Failed to load competence',
      ),
  })
}

function competenceAuditQuery(id: string) {
  return query({
    queryKey: ['competence-audit', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.competences[':id']['audit-log'].$get({ param: { id } }),
        'Failed to load competence audit log',
      ),
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
      jsonOrThrow(
        await api.api.nc.$get({
          query: apiQuery({
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
            query: search || undefined,
            status: status || undefined,
            type: type || undefined,
          }),
        }),
        'Failed to load non-conformances',
      ),
  })
}

function ncSummaryQuery() {
  return query({
    queryKey: ['non-conformances-summary'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.nc.summary.$get(),
        'Failed to load non-conformance summary',
      ),
  })
}

function ncDetailQuery(id: string) {
  return query({
    queryKey: ['non-conformance', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.nc[':id'].$get({ param: { id } }),
        'Failed to load non-conformance',
      ),
  })
}

function ncAuditQuery(id: string) {
  return query({
    queryKey: ['non-conformance-audit', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.nc[':id']['audit-log'].$get({ param: { id } }),
        'Failed to load non-conformance audit log',
      ),
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
      jsonOrThrow(
        await api.api.capa.$get({
          query: apiQuery({
            page: String(page),
            limit: String(DEFAULT_LIST_LIMIT),
            query: search || undefined,
            status: status || undefined,
            severity: severity || undefined,
            category: category || undefined,
          }),
        }),
        'Failed to load CAPAs',
      ),
  })
}

function capaSummaryQuery() {
  return query({
    queryKey: ['capas-summary'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.capa.summary.$get(),
        'Failed to load CAPA summary',
      ),
  })
}

function capaDetailQuery(id: string) {
  return query({
    queryKey: ['capa', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.capa[':id'].$get({ param: { id } }),
        'Failed to load CAPA',
      ),
  })
}

function capaAuditQuery(id: string) {
  return query({
    queryKey: ['capa-audit-log', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.capa[':id']['audit-log'].$get({ param: { id } }),
        'Failed to load CAPA audit log',
      ),
  })
}

function techniciansQuery(key: readonly unknown[] = ['jobs', 'technicians']) {
  return query({
    queryKey: key,
    queryFn: async () =>
      jsonOrThrow(
        await api.api.jobs.technicians.list.$get(),
        'Failed to load technicians',
      ),
  })
}

function financeOverviewQuery() {
  return query({
    queryKey: ['finance', 'overview'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.finance.overview.$get(),
        'Failed to load finance overview',
      ),
  })
}

function financeDocumentsQuery(url: URL) {
  const search = searchFromUrl(url)

  return query({
    queryKey: ['finance', 'documents', search],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.finance.documents.$get({
          query: { query: search || undefined },
        }),
        'Failed to load finance documents',
      ),
  })
}

function financeDocumentDetailQuery(id: string) {
  return query({
    queryKey: ['finance', 'documents', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.finance.documents[':id'].$get({ param: { id } }),
        'Failed to load finance document',
      ),
  })
}

function financeContractsQuery(url: URL) {
  const search = searchFromUrl(url)

  return query({
    queryKey: ['finance', 'contracts', search],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.finance.contracts.$get({
          query: { query: search || undefined },
        }),
        'Failed to load finance contracts',
      ),
  })
}

function financeContractDetailQuery(id: string) {
  return query({
    queryKey: ['finance', 'contracts', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.finance.contracts[':id'].$get({ param: { id } }),
        'Failed to load finance contract',
      ),
  })
}

function financeReceiptsQuery() {
  return query({
    queryKey: ['finance', 'receipts'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.finance.receipts.$get(),
        'Failed to load finance receipts',
      ),
  })
}

function financeErpQuery() {
  return query({
    queryKey: ['finance', 'erp'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.finance.erp.exports.$get(),
        'Failed to load ERP exports',
      ),
  })
}

function certificateDesignerTemplatesQuery() {
  return query({
    queryKey: ['certificate-templates'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api['certificate-templates'].$get(),
        'Failed to load certificate templates',
      ),
  })
}

function executiveReportQuery() {
  return query({
    queryKey: ['reports', 'executive'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.reports.consolidated['executive-overview'].$get({
          query: {},
        }),
        'Failed to load executive report',
      ),
  })
}

function comparisonReportQuery() {
  return query({
    queryKey: ['reports', 'comparison'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.reports.consolidated.comparison.$get({ query: {} }),
        'Failed to load comparison report',
      ),
  })
}

function trendReportQuery() {
  return query({
    queryKey: ['reports', 'trend'],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.reports.consolidated.trend.$get({ query: {} }),
        'Failed to load trend report',
      ),
  })
}

function settingsQuery(
  queryKey: readonly unknown[],
  fetcher: () => Promise<Response>,
) {
  return query({
    queryKey,
    queryFn: async () =>
      jsonOrThrow(await fetcher(), 'Failed to load settings'),
  })
}

function backofficeAccessQuery(scope: string) {
  return query({
    queryKey: ['backoffice', 'access', scope],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.backoffice.access.$get(),
        'Failed to load backoffice access',
      ),
    staleTime: 30_000,
  })
}

function backofficeOrganizationsQuery(queryKey: readonly unknown[]) {
  return query({
    queryKey,
    queryFn: async () =>
      jsonOrThrow(
        await api.api.backoffice.organizations.$get(),
        'Failed to load backoffice organizations',
      ),
  })
}

function backofficeOrganizationDetailQuery(id: string) {
  return query({
    queryKey: ['backoffice', 'organizations', id],
    queryFn: async () =>
      jsonOrThrow(
        await api.api.backoffice.organizations[':id'].$get({ param: { id } }),
        'Failed to load backoffice organization',
      ),
  })
}

function backofficeSupportQueueQuery(queryKey: readonly unknown[]) {
  return query({
    queryKey,
    queryFn: async () =>
      jsonOrThrow(
        await api.api.backoffice.support.queue.$get(),
        'Failed to load backoffice support queue',
      ),
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
    queryFn: async () =>
      jsonOrThrow(
        await api.api.public['commercial-checkout'][':token'].$get({
          param: { token },
        }),
        'Failed to load checkout snapshot',
      ),
  })
}

function checkoutStatusQuery(token: string) {
  return query({
    queryKey: ['public-commercial-checkout', token, 'status'],
    queryFn: async () => {
      const response = await api.api.public['commercial-checkout'][
        ':token'
      ].status.$get({ param: { token } })

      if (response.status === 404) {
        return { state: 'INVALID' }
      }

      return jsonOrThrow(response, 'Failed to load checkout status')
    },
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
        query({
          queryKey: ['customers', 'list'],
          queryFn: async () =>
            jsonOrThrow(
              await api.api.customers.$get({
                query: { page: '1', limit: '100' },
              }),
              'Failed to load customers',
            ),
        }),
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
      prewarmQueries(queryClient, [
        methodsListQuery(new URL('/dashboard/methods', window.location.href)),
        assetTypesQuery(),
      ]),
  },
  {
    id: 'dashboard:nc:new',
    match: /^\/dashboard\/nc\/new\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        query({
          queryKey: ['jobs-for-nc'],
          queryFn: async () =>
            jsonOrThrow(
              await api.api.jobs.$get({ query: { limit: '100' } }),
              'Failed to load jobs',
            ),
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
            jsonOrThrow(
              await api.api.finance.documents['eligible-jobs'].$get({
                query: { mode: 'single' },
              }),
              'Failed to load eligible jobs',
            ),
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
            jsonOrThrow(
              await api.api.customers.$get({ query: { limit: '100' } }),
              'Failed to load customers',
            ),
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
                jsonOrThrow(
                  await api.api.assets.$get({
                    query: {
                      customerId: String(customerId),
                      page: '1',
                      limit: '20',
                    },
                  }),
                  'Failed to load customer assets',
                ),
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
      const apiJobId = apiRouteParam(id)
      return prewarmQueries(queryClient, [
        query({
          queryKey: ['jobs', id],
          queryFn: async () =>
            jsonOrThrow(
              await api.api.jobs[':id'].$get({ param: { id: apiJobId } }),
              'Failed to load job',
            ),
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
      const apiJobId = apiRouteParam(id)
      return prewarmQueries(queryClient, [
        query({
          queryKey: ['jobs', id],
          queryFn: async () =>
            jsonOrThrow(
              await api.api.jobs[':id'].$get({ param: { id: apiJobId } }),
              'Failed to load job',
            ),
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
        methodsListQuery(new URL('/dashboard/methods', window.location.href)),
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
    id: 'dashboard:certificate-designer',
    match: /^\/dashboard\/certificate-designer\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [certificateDesignerTemplatesQuery()]),
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
        settingsQuery(['api-keys'], () => api.api['api-keys'].$get()),
        maybeOrgQuery((organizationId) =>
          settingsQuery(['sso-settings', organizationId], () =>
            api.api.sso.providers.$get(),
          ),
        ),
      ]),
  },
  {
    id: 'dashboard:settings:certificate-numbering',
    match: /^\/dashboard\/settings\/certificate-numbering\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        settingsQuery(['certificate-numbering-profile'], () =>
          api.api['certificate-numbering'].$get(),
        ),
      ]),
  },
  {
    id: 'dashboard:settings:certificates',
    match: /^\/dashboard\/settings\/certificates\/?$/,
    prewarm: ({ queryClient }) =>
      prewarmQueries(queryClient, [
        settingsQuery(['signing-certificates', 'no-unit'], () =>
          api.api.signing.certificates.$get(),
        ),
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
