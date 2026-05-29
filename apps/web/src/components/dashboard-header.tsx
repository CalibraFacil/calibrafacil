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
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { NotificationBell } from '@/components/notifications/notification-bell'
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

const routeLabels: Record<string, string> = {
  // Dashboard
  '/dashboard': 'Painel de Controle',

  // Settings
  '/dashboard/settings': 'Configurações',
  '/dashboard/settings/profile': 'Perfil',
  '/dashboard/settings/organization': 'Organização',
  '/dashboard/settings/portal-domain': 'Portal Domain',
  '/dashboard/settings/branding': 'Branding',
  '/dashboard/settings/billing': 'Assinatura',
  '/dashboard/settings/subscription': 'Assinatura',
  '/dashboard/settings/notifications': 'Notificações',
  '/dashboard/settings/security': 'Segurança',
  '/dashboard/settings/authentication': 'Autenticação',
  '/dashboard/settings/integrations': 'Integrações',
  '/dashboard/settings/appearance': 'Aparência',
  '/dashboard/settings/signature': 'Assinatura',
  '/dashboard/settings/certificates': 'Certificados ICP',
  '/dashboard/settings/certificate-numbering': 'Numeração de Certificados',
  '/dashboard/settings/danger': 'Zona de Perigo',
  '/dashboard/customer-success': 'Customer Success',
  '/dashboard/internal': 'Operação Interna',
  '/dashboard/internal/customer-success': 'Customer Success',
  '/dashboard/finance': 'Financeiro',
  '/dashboard/finance/billing-readiness': 'Pronto para faturar',
  '/dashboard/finance/receivables': 'Recebíveis',
  '/dashboard/finance/documents': 'Documentos financeiros',
  '/dashboard/finance/documents/new': 'Nova cobrança',
  '/dashboard/finance/documents/$id': 'Documento financeiro',
  '/dashboard/finance/receipts': 'Recebimentos',
  '/dashboard/finance/contracts': 'Contratos comerciais',
  '/dashboard/finance/contracts/new': 'Novo contrato comercial',
  '/dashboard/finance/contracts/$id': 'Contrato comercial',
  '/dashboard/finance/analytics': 'Análises financeiras',
  '/dashboard/finance/automation': 'Automação financeira',
  '/dashboard/finance/erp': 'ERP financeiro',

  // Clients
  '/dashboard/clients': 'Clientes',
  '/dashboard/clients/new': 'Novo Cliente',
  '/dashboard/clients/$id': 'Cliente',
  '/dashboard/clients/$id/overview': 'Visão geral',
  '/dashboard/clients/$id/info': 'Informações',
  '/dashboard/clients/$id/users': 'Usuários',
  '/dashboard/clients/$id/assets': 'Ativos',
  '/dashboard/clients/$id/calibrations': 'Calibrações',
  '/dashboard/clients/$id/compliance': 'Conformidade',

  // Assets
  '/dashboard/assets': 'Ativos',
  '/dashboard/assets/new': 'Novo Ativo',
  '/dashboard/assets/$id': 'Ativo',
  '/dashboard/assets/$id/edit': 'Editar Ativo',

  // Methods
  '/dashboard/methods': 'Métodos de Calibração',
  '/dashboard/methods/new': 'Novo Método',
  '/dashboard/methods/$id': 'Método',
  '/dashboard/methods/$id/edit': 'Editar Método',

  // Calibration jobs
  '/dashboard/jobs': 'Calibrações',
  '/dashboard/service-orders': 'Ordens de Serviço',
  '/dashboard/service-orders/new': 'Nova OS',
  '/dashboard/service-orders/$id': 'Ordem de Serviço',
  '/dashboard/jobs/new': 'Nova Calibração',
  '/dashboard/jobs/$id': 'Calibração',
  '/dashboard/jobs/$id/execute': 'Executar',

  // Reports
  '/dashboard/reports': 'Relatórios',

  // Calibration Requests
  '/dashboard/requests': 'Solicitações de Calibração',
  '/dashboard/requests/$id': 'Solicitação',

  // Services
  '/dashboard/services': 'Serviços',
  '/dashboard/services/new': 'Novo Serviço',
  '/dashboard/services/$id': 'Serviço',
  '/dashboard/services/$id/edit': 'Editar Serviço',

  // Standards
  '/dashboard/standards': 'Padrões',
  '/dashboard/standards/new': 'Novo Padrão',
  '/dashboard/standards/$id': 'Padrão',
  '/dashboard/standards/$id/edit': 'Editar Padrão',

  // Non-Conformances
  '/dashboard/nc': 'Não Conformidades',
  '/dashboard/nc/new': 'Registrar NC',
  '/dashboard/nc/$id': 'Não Conformidade',

  // CAPA
  '/dashboard/capa': 'Ações Corretivas (CAPA)',
  '/dashboard/capa/new': 'Nova CAPA',
  '/dashboard/capa/$id': 'CAPA',

  // Personnel Competences
  '/dashboard/personnel': 'Competências do Pessoal',
  '/dashboard/personnel/new': 'Nova Solicitação',
  '/dashboard/personnel/$id': 'Competência',
  '/dashboard/personnel/$id/training': 'Treinamentos',
  '/dashboard/personnel/$id/audit': 'Histórico',

  // Certificate Templates
  '/dashboard/certificate-templates': 'Templates de Certificados',
}

function getCachedLabel(
  queryClient: { getQueryData: (queryKey: readonly unknown[]) => unknown },
  queryKeys: ReadonlyArray<readonly unknown[]>,
  pickLabel: (cached: unknown) => string | undefined,
): string | null {
  for (const queryKey of queryKeys) {
    const cached = queryClient.getQueryData(queryKey)
    const label = pickLabel(cached)
    if (label) {
      return label
    }
  }

  return null
}

function stringProperty(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const property = Reflect.get(value, key)
  return typeof property === 'string' ? property : undefined
}

// Extract entity IDs from pathname
function extractEntityIds(pathname: string): {
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
} {
  const parts = pathname.split('/')
  const result: {
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
  } = {}

  // /dashboard/clients/:id/...
  const clientsIndex = parts.indexOf('clients')
  if (clientsIndex !== -1 && parts[clientsIndex + 1]) {
    const id = parts[clientsIndex + 1]
    if (id !== 'new') result.customerId = id
  }

  // /dashboard/assets/:id/...
  const assetsIndex = parts.indexOf('assets')
  if (assetsIndex !== -1 && parts[assetsIndex + 1]) {
    const id = parts[assetsIndex + 1]
    if (id !== 'new') result.assetId = id
  }

  // /dashboard/methods/:id/...
  const methodsIndex = parts.indexOf('methods')
  if (methodsIndex !== -1 && parts[methodsIndex + 1]) {
    const id = parts[methodsIndex + 1]
    if (id !== 'new') result.methodId = id
  }

  // /dashboard/jobs/:id/...
  const jobsIndex = parts.indexOf('jobs')
  if (jobsIndex !== -1 && parts[jobsIndex + 1]) {
    const id = parts[jobsIndex + 1]
    if (id !== 'new') result.jobId = id
  }

  // /dashboard/services/:id/...
  const servicesIndex = parts.indexOf('services')
  if (servicesIndex !== -1 && parts[servicesIndex + 1]) {
    const id = parts[servicesIndex + 1]
    if (id !== 'new') result.serviceId = id
  }

  // /dashboard/service-orders/:id/...
  const serviceOrdersIndex = parts.indexOf('service-orders')
  if (serviceOrdersIndex !== -1 && parts[serviceOrdersIndex + 1]) {
    const id = parts[serviceOrdersIndex + 1]
    if (id !== 'new') result.serviceOrderId = id
  }

  // /dashboard/standards/:id/...
  const standardsIndex = parts.indexOf('standards')
  if (standardsIndex !== -1 && parts[standardsIndex + 1]) {
    const id = parts[standardsIndex + 1]
    if (id !== 'new') result.standardId = id
  }

  // /dashboard/nc/:id/...
  const ncIndex = parts.indexOf('nc')
  if (ncIndex !== -1 && parts[ncIndex + 1]) {
    const id = parts[ncIndex + 1]
    if (id !== 'new') result.ncId = id
  }

  // /dashboard/capa/:id/...
  const capaIndex = parts.indexOf('capa')
  if (capaIndex !== -1 && parts[capaIndex + 1]) {
    const id = parts[capaIndex + 1]
    if (id !== 'new') result.capaId = id
  }

  // /dashboard/personnel/:id/...
  const personnelIndex = parts.indexOf('personnel')
  if (personnelIndex !== -1 && parts[personnelIndex + 1]) {
    const id = parts[personnelIndex + 1]
    if (id !== 'new') result.competenceId = id
  }

  return result
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

  // Extract IDs from current pathname
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
    [['customer', customerId]],
    (cached) => stringProperty(cached, 'name'),
  )
  const assetCachedLabel = getCachedLabel(
    queryClient,
    [['asset', assetId]],
    (cached) => stringProperty(cached, 'name'),
  )
  const methodCachedLabel = getCachedLabel(
    queryClient,
    [['methods', methodId]],
    (cached) => stringProperty(cached, 'name'),
  )
  const jobCachedLabel = getCachedLabel(
    queryClient,
    [['jobs', jobId]],
    (cached) => stringProperty(cached, 'jobId'),
  )
  const serviceCachedLabel = getCachedLabel(
    queryClient,
    [['services', serviceId]],
    (cached) => stringProperty(cached, 'name'),
  )
  const serviceOrderCachedLabel = getCachedLabel(
    queryClient,
    [['service-order', serviceOrderId]],
    (cached) => stringProperty(cached, 'serviceOrderNumber'),
  )
  const standardCachedLabel = getCachedLabel(
    queryClient,
    [['standards', standardId]],
    (cached) => stringProperty(cached, 'name'),
  )
  const ncCachedLabel = getCachedLabel(
    queryClient,
    [['non-conformance', ncId]],
    (cached) => stringProperty(cached, 'ncNumber'),
  )
  const capaCachedLabel = getCachedLabel(
    queryClient,
    [['capa', capaId]],
    (cached) => stringProperty(cached, 'capaNumber'),
  )
  const competenceCachedLabel = getCachedLabel(
    queryClient,
    [['competence', competenceId]],
    (cached) => stringProperty(cached, 'userName'),
  )

  const customerDetailFetchCount = useIsFetching({
    queryKey: ['customer', customerId],
  })
  const assetDetailFetchCount = useIsFetching({ queryKey: ['asset', assetId] })
  const methodDetailFetchCount = useIsFetching({
    queryKey: ['methods', methodId],
  })
  const jobDetailFetchCount = useIsFetching({ queryKey: ['jobs', jobId] })
  const serviceDetailFetchCount = useIsFetching({
    queryKey: ['services', serviceId],
  })
  const serviceOrderDetailFetchCount = useIsFetching({
    queryKey: ['service-order', serviceOrderId],
  })
  const standardDetailFetchCount = useIsFetching({
    queryKey: ['standards', standardId],
  })
  const ncDetailFetchCount = useIsFetching({
    queryKey: ['non-conformance', ncId],
  })
  const capaDetailFetchCount = useIsFetching({ queryKey: ['capa', capaId] })
  const competenceDetailFetchCount = useIsFetching({
    queryKey: ['competence', competenceId],
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

  // Build entity name lookup
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
    return (
      matches
        .filter((m) => {
          // Filter only dashboard routes
          if (!m.routeId?.startsWith('/dashboard')) return false

          // Remove index routes that duplicate layout routes
          if (m.routeId.endsWith('/')) {
            const layoutId = m.routeId.slice(0, -1)
            const hasLayout = matches.some(
              (other) => other.routeId === layoutId,
            )
            if (hasLayout) return false
          }

          return true
        })
        .map((m) => {
          // Normalize routeId by removing trailing slash for label lookup
          const normalizedRouteId = m.routeId.endsWith('/')
            ? m.routeId.slice(0, -1)
            : m.routeId

          let label = routeLabels[normalizedRouteId]

          // For routes that end with $id (entity routes), try to get entity name
          // Only replace for routes like /clients/$id, not /clients/$id/info
          if (normalizedRouteId.endsWith('$id')) {
            const pathParts = m.pathname.split('/')
            const routeParts = normalizedRouteId.split('/')
            const idIndex = routeParts.findIndex((part) => part === '$id')
            const id = pathParts[idIndex]

            if (id && entityNames[id]) {
              label = entityNames[id]
            }
          }

          // Fallback to last path segment if no label found
          if (!label) {
            label = m.pathname.split('/').pop() ?? ''
          }

          return {
            path: m.pathname,
            label,
          }
        })
        // Filter out breadcrumbs with empty labels
        .filter((crumb) => crumb.label.trim() !== '')
    )
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
        <NotificationBell />
      </div>
    </header>
  )
}
