import { Link, useMatches } from '@tanstack/react-router'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Fragment, useMemo } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@calibra-facil/ui/breadcrumb'
import { Separator } from '@calibra-facil/ui/separator'
import { SidebarTrigger } from '@calibra-facil/ui/sidebar'
import { getDashboardRouteTitle } from '@/app/router/route-registry'
import { NotificationCenter } from '@/features/notifications/notification-center'
import {
  useAssetLabelData,
  useCapaLabelData,
  useCompetenceLabelData,
  useCustomerLabelData,
  useJobLabelData,
  useMethodLabelData,
  useNonConformanceLabelData,
  useServiceLabelData,
  useServiceOrderLabelData,
  useStandardLabelData,
} from '@/features/entity-labels/queries'
import { usePathPrewarmIntent } from '@/lib/use-route-prewarm-intent'
import {
  DesktopDataSourceIndicator,
  DesktopSyncButton,
} from '@/runtime/sync-status'
import { customerKeys } from '@/features/customers/keys'
import { assetKeys } from '@/features/assets/keys'
import { methodKeys } from '@/features/methods/keys'
import { jobKeys } from '@/features/jobs/keys'
import { serviceKeys } from '@/features/services/keys'
import { serviceOrderKeys } from '@/features/service-orders/keys'
import { standardKeys } from '@/features/standards/keys'
import { capaKeys, nonConformanceKeys } from '@/features/quality/keys'
import { competenceKeys } from '@/features/personnel/keys'

function getCachedLabel(
  queryClient: { getQueryData: (queryKey: readonly unknown[]) => unknown },
  queryKey: readonly unknown[],
  pickLabel: (cached: unknown) => string | undefined,
): string | null {
  return pickLabel(queryClient.getQueryData(queryKey)) || null
}

function stringProperty(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const property = Reflect.get(value, key)
  return typeof property === 'string' ? property : undefined
}

type EntityIds = {
  customerId?: string
  assetId?: string
  methodId?: string
  jobId?: string
  serviceId?: string
  serviceOrderId?: string
  standardId?: string
  ncId?: string
  capaId?: string
  competenceId?: string
}

// The dashboard section whose second segment is an entity id, and the static
// child routes that share that position (so `/dashboard/clients/groups` is the
// groups page, not a customer called "groups").
const ENTITY_SECTIONS: Record<
  string,
  { key: keyof EntityIds; staticSegments: readonly string[] }
> = {
  clients: { key: 'customerId', staticSegments: ['new', 'groups'] },
  assets: { key: 'assetId', staticSegments: ['new'] },
  methods: { key: 'methodId', staticSegments: ['new', 'from-template'] },
  jobs: { key: 'jobId', staticSegments: ['new'] },
  services: { key: 'serviceId', staticSegments: ['new'] },
  // The segment is the opaque public id, which is also the detail query's
  // cache key, so the crumb still resolves to the human OS number.
  'service-orders': { key: 'serviceOrderId', staticSegments: ['new'] },
  standards: {
    key: 'standardId',
    staticSegments: ['new', 'composition-profiles'],
  },
  nc: { key: 'ncId', staticSegments: ['new'] },
  capa: { key: 'capaId', staticSegments: ['new'] },
  personnel: { key: 'competenceId', staticSegments: ['new'] },
}

// Extract the entity id of a /dashboard/<section>/<id>/... pathname.
export function extractEntityIds(pathname: string): EntityIds {
  const [, root, section, id] = pathname.split('/')
  if (root !== 'dashboard' || !section || !id) return {}
  const entry = ENTITY_SECTIONS[section]
  if (!entry || entry.staticSegments.includes(id)) return {}
  return { [entry.key]: id }
}

type DashboardHeaderProps = {
  suspendEntityQueries?: boolean
}

function DashboardBreadcrumbLink({
  path,
  label,
}: {
  path: string
  label: string
}) {
  const prewarmIntentHandlers = usePathPrewarmIntent(path)

  return (
    <BreadcrumbLink
      render={<Link preload="intent" to={path} />}
      {...prewarmIntentHandlers}
    >
      {label}
    </BreadcrumbLink>
  )
}

export function DashboardHeader({
  suspendEntityQueries = false,
}: DashboardHeaderProps) {
  const matches = useMatches()
  const queryClient = useQueryClient()

  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const {
    customerId,
    assetId,
    methodId,
    jobId,
    serviceId,
    serviceOrderId,
    standardId,
    ncId,
    capaId,
    competenceId,
  } = extractEntityIds(pathname)

  const customerCachedLabel = getCachedLabel(
    queryClient,
    customerKeys.detail(customerId ?? ''),
    (cached) => stringProperty(cached, 'name'),
  )
  const assetCachedLabel = getCachedLabel(
    queryClient,
    assetKeys.detail(assetId ?? ''),
    (cached) => stringProperty(cached, 'name'),
  )
  const methodCachedLabel = getCachedLabel(
    queryClient,
    methodKeys.detail(methodId ?? ''),
    (cached) => stringProperty(cached, 'name'),
  )
  const jobCachedLabel = getCachedLabel(
    queryClient,
    jobKeys.detail(jobId ?? ''),
    (cached) => stringProperty(cached, 'jobId'),
  )
  const serviceCachedLabel = getCachedLabel(
    queryClient,
    serviceKeys.detail(serviceId ?? ''),
    (cached) => stringProperty(cached, 'name'),
  )
  const serviceOrderCachedLabel = getCachedLabel(
    queryClient,
    serviceOrderKeys.detail(serviceOrderId ?? ''),
    (cached) => stringProperty(cached, 'serviceOrderNumber'),
  )
  const standardCachedLabel = getCachedLabel(
    queryClient,
    standardKeys.detail(standardId ?? ''),
    (cached) => stringProperty(cached, 'name'),
  )
  const ncCachedLabel = getCachedLabel(
    queryClient,
    nonConformanceKeys.detail(ncId ?? ''),
    (cached) => stringProperty(cached, 'ncNumber'),
  )
  const capaCachedLabel = getCachedLabel(
    queryClient,
    capaKeys.detail(capaId ?? ''),
    (cached) => stringProperty(cached, 'capaNumber'),
  )
  const competenceCachedLabel = getCachedLabel(
    queryClient,
    competenceKeys.detail(competenceId ?? ''),
    (cached) => stringProperty(cached, 'userName'),
  )

  const customerDetailFetchCount = useIsFetching({
    queryKey: customerKeys.detail(customerId ?? ''),
  })
  const assetDetailFetchCount = useIsFetching({
    queryKey: assetKeys.detail(assetId ?? ''),
  })
  const methodDetailFetchCount = useIsFetching({
    queryKey: methodKeys.detail(methodId ?? ''),
  })
  const jobDetailFetchCount = useIsFetching({
    queryKey: jobKeys.detail(jobId ?? ''),
  })
  const serviceDetailFetchCount = useIsFetching({
    queryKey: serviceKeys.detail(serviceId ?? ''),
  })
  const serviceOrderDetailFetchCount = useIsFetching({
    queryKey: serviceOrderKeys.detail(serviceOrderId ?? ''),
  })
  const standardDetailFetchCount = useIsFetching({
    queryKey: standardKeys.detail(standardId ?? ''),
  })
  const ncDetailFetchCount = useIsFetching({
    queryKey: nonConformanceKeys.detail(ncId ?? ''),
  })
  const capaDetailFetchCount = useIsFetching({
    queryKey: capaKeys.detail(capaId ?? ''),
  })
  const competenceDetailFetchCount = useIsFetching({
    queryKey: competenceKeys.detail(competenceId ?? ''),
  })

  const { data: customerLabel } = useCustomerLabelData({
    id: customerId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!customerId &&
      !customerCachedLabel &&
      customerDetailFetchCount === 0,
  })

  const { data: assetLabel } = useAssetLabelData({
    id: assetId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!assetId &&
      !assetCachedLabel &&
      assetDetailFetchCount === 0,
  })

  const { data: methodLabel } = useMethodLabelData({
    id: methodId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!methodId &&
      !methodCachedLabel &&
      methodDetailFetchCount === 0,
  })

  const { data: jobLabel } = useJobLabelData({
    id: jobId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!jobId &&
      !jobCachedLabel &&
      jobDetailFetchCount === 0,
  })

  const { data: serviceLabel } = useServiceLabelData({
    id: serviceId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!serviceId &&
      !serviceCachedLabel &&
      serviceDetailFetchCount === 0,
  })

  const { data: serviceOrderLabel } = useServiceOrderLabelData({
    id: serviceOrderId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!serviceOrderId &&
      !serviceOrderCachedLabel &&
      serviceOrderDetailFetchCount === 0,
  })

  const { data: standardLabel } = useStandardLabelData({
    id: standardId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!standardId &&
      !standardCachedLabel &&
      standardDetailFetchCount === 0,
  })

  const { data: ncLabel } = useNonConformanceLabelData({
    id: ncId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!ncId &&
      !ncCachedLabel &&
      ncDetailFetchCount === 0,
  })

  const { data: capaLabel } = useCapaLabelData({
    id: capaId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!capaId &&
      !capaCachedLabel &&
      capaDetailFetchCount === 0,
  })

  const { data: competenceLabel } = useCompetenceLabelData({
    id: competenceId ?? '',
    enabled:
      !suspendEntityQueries &&
      !!competenceId &&
      !competenceCachedLabel &&
      competenceDetailFetchCount === 0,
  })

  const entityNames: Record<string, string> = useMemo(() => {
    const names: Record<string, string> = {}
    const customerDisplayLabel = customerCachedLabel ?? customerLabel ?? null
    if (customerId && customerDisplayLabel) {
      names[customerId] = customerDisplayLabel
    }
    const assetDisplayLabel = assetCachedLabel ?? assetLabel ?? null
    if (assetId && assetDisplayLabel) {
      names[assetId] = assetDisplayLabel
    }
    const methodDisplayLabel = methodCachedLabel ?? methodLabel ?? null
    if (methodId && methodDisplayLabel) {
      names[methodId] = methodDisplayLabel
    }
    const jobDisplayLabel = jobCachedLabel ?? jobLabel ?? null
    if (jobId && jobDisplayLabel) {
      names[jobId] = jobDisplayLabel
    }
    const serviceDisplayLabel = serviceCachedLabel ?? serviceLabel ?? null
    if (serviceId && serviceDisplayLabel) {
      names[serviceId] = serviceDisplayLabel
    }
    const serviceOrderDisplayLabel =
      serviceOrderCachedLabel ?? serviceOrderLabel ?? null
    if (serviceOrderId && serviceOrderDisplayLabel) {
      names[serviceOrderId] = serviceOrderDisplayLabel
    }
    const standardDisplayLabel = standardCachedLabel ?? standardLabel ?? null
    if (standardId && standardDisplayLabel) {
      names[standardId] = standardDisplayLabel
    }
    const ncDisplayLabel = ncCachedLabel ?? ncLabel ?? null
    if (ncId && ncDisplayLabel) {
      names[ncId] = ncDisplayLabel
    }
    const capaDisplayLabel = capaCachedLabel ?? capaLabel ?? null
    if (capaId && capaDisplayLabel) {
      names[capaId] = capaDisplayLabel
    }
    const competenceDisplayLabel =
      competenceCachedLabel ?? competenceLabel ?? null
    if (competenceId && competenceDisplayLabel) {
      names[competenceId] = competenceDisplayLabel
    }
    return names
  }, [
    customerId,
    customerCachedLabel,
    customerLabel,
    assetId,
    assetCachedLabel,
    assetLabel,
    methodId,
    methodCachedLabel,
    methodLabel,
    jobId,
    jobCachedLabel,
    jobLabel,
    serviceId,
    serviceCachedLabel,
    serviceLabel,
    serviceOrderId,
    serviceOrderCachedLabel,
    serviceOrderLabel,
    standardId,
    standardCachedLabel,
    standardLabel,
    ncId,
    ncCachedLabel,
    ncLabel,
    capaId,
    capaCachedLabel,
    capaLabel,
    competenceId,
    competenceCachedLabel,
    competenceLabel,
  ])

  const breadcrumbs = useMemo(() => {
    return matches
      .filter((m) => {
        if (!m.routeId?.startsWith('/dashboard')) return false

        if (m.routeId.endsWith('/')) {
          const layoutId = m.routeId.slice(0, -1)
          const hasLayout = matches.some((other) => other.routeId === layoutId)
          if (hasLayout) return false
        }

        return true
      })
      .map((m) => {
        const normalizedRouteId = m.routeId.endsWith('/')
          ? m.routeId.slice(0, -1)
          : m.routeId

        let label = getDashboardRouteTitle(normalizedRouteId)

        // Entity routes end in a dynamic segment — $id, $publicId, whatever
        // the route names it. Swap the raw segment for the entity's own name
        // so the crumb reads "OS-2026-000001" instead of the generic route
        // label (or the opaque id itself).
        // Still only for routes ENDING there: /clients/$id, not
        // /clients/$id/info.
        const routeParts = normalizedRouteId.split('/')
        const lastRoutePart = routeParts.at(-1) ?? ''
        if (lastRoutePart.startsWith('$')) {
          const pathParts = m.pathname.split('/')
          const id = pathParts[routeParts.length - 1]

          if (id && entityNames[id]) {
            label = entityNames[id]
          }
        }

        if (!label) {
          label = m.pathname.split('/').pop() ?? ''
        }

        return {
          path: m.pathname,
          label,
        }
      })
      .filter((crumb) => crumb.label.trim() !== '')
  }, [matches, entityNames])

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-8" />
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1

              return (
                <Fragment key={crumb.path}>
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <DashboardBreadcrumbLink
                        label={crumb.label}
                        path={crumb.path}
                      />
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex items-center gap-2">
        <DesktopDataSourceIndicator />
        <DesktopSyncButton />
        <NotificationCenter />
      </div>
    </header>
  )
}
