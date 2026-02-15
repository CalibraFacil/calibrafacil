import { Link, useMatches } from '@tanstack/react-router'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { api } from '@/utils/api'

const routeLabels: Record<string, string> = {
  // Dashboard
  '/dashboard': 'Painel de Controle',

  // Settings
  '/dashboard/settings': 'Configurações',
  '/dashboard/settings/profile': 'Perfil',
  '/dashboard/settings/organization': 'Organização',
  '/dashboard/settings/billing': 'Faturamento',
  '/dashboard/settings/notifications': 'Notificações',
  '/dashboard/settings/security': 'Segurança',
  '/dashboard/settings/authentication': 'Autenticação',
  '/dashboard/settings/appearance': 'Aparência',
  '/dashboard/settings/signature': 'Assinatura',
  '/dashboard/settings/certificates': 'Certificados ICP',
  '/dashboard/settings/danger': 'Zona de Perigo',

  // Clients
  '/dashboard/clients': 'Clientes',
  '/dashboard/clients/new': 'Novo Cliente',
  '/dashboard/clients/$id': 'Cliente',
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

  // Jobs (Ordens de Serviço)
  '/dashboard/jobs': 'Ordens de Serviço',
  '/dashboard/jobs/new': 'Nova OS',
  '/dashboard/jobs/$id': 'Ordem de Serviço',
  '/dashboard/jobs/$id/execute': 'Executar',

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
}

const LABEL_STALE_TIME = 5 * 60 * 1000

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

// Extract entity IDs from pathname
function extractEntityIds(pathname: string): {
  customerId?: string
  assetId?: string
  methodId?: string
  jobId?: string
  serviceId?: string
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

export function DashboardHeader() {
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
    standardId,
    ncId,
    capaId,
    competenceId,
  } = extractEntityIds(pathname)

  const customerCachedLabel = getCachedLabel(
    queryClient,
    [['customer', customerId]],
    (cached) => (cached as { name?: string } | undefined)?.name,
  )
  const assetCachedLabel = getCachedLabel(
    queryClient,
    [['asset', assetId]],
    (cached) => (cached as { name?: string } | undefined)?.name,
  )
  const methodCachedLabel = getCachedLabel(
    queryClient,
    [['methods', methodId]],
    (cached) => (cached as { name?: string } | undefined)?.name,
  )
  const jobCachedLabel = getCachedLabel(
    queryClient,
    [['jobs', jobId]],
    (cached) => (cached as { jobId?: string } | undefined)?.jobId,
  )
  const serviceCachedLabel = getCachedLabel(
    queryClient,
    [['services', serviceId]],
    (cached) => (cached as { name?: string } | undefined)?.name,
  )
  const standardCachedLabel = getCachedLabel(
    queryClient,
    [['standards', standardId]],
    (cached) => (cached as { name?: string } | undefined)?.name,
  )
  const ncCachedLabel = getCachedLabel(
    queryClient,
    [['non-conformance', ncId]],
    (cached) => (cached as { ncNumber?: string } | undefined)?.ncNumber,
  )
  const capaCachedLabel = getCachedLabel(
    queryClient,
    [['capa', capaId]],
    (cached) => (cached as { capaNumber?: string } | undefined)?.capaNumber,
  )
  const competenceCachedLabel = getCachedLabel(
    queryClient,
    [['competence', competenceId]],
    (cached) => (cached as { userName?: string } | undefined)?.userName,
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

  // Reactive queries for entity labels
  const { data: customerLabel } = useQuery({
    queryKey: ['customers', customerId, 'label'],
    queryFn: async () => {
      if (customerCachedLabel) return customerCachedLabel

      const res = await api.api.customers[':id'].label.$get({
        param: { id: customerId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled:
      !!customerId && !customerCachedLabel && customerDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  const { data: assetLabel } = useQuery({
    queryKey: ['assets', assetId, 'label'],
    queryFn: async () => {
      if (assetCachedLabel) return assetCachedLabel

      const res = await api.api.assets[':id'].label.$get({
        param: { id: assetId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled: !!assetId && !assetCachedLabel && assetDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  const { data: methodLabel } = useQuery({
    queryKey: ['methods', methodId, 'label'],
    queryFn: async () => {
      if (methodCachedLabel) return methodCachedLabel

      const res = await api.api.methods[':id'].label.$get({
        param: { id: methodId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled: !!methodId && !methodCachedLabel && methodDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  const { data: jobLabel } = useQuery({
    queryKey: ['jobs', jobId, 'label'],
    queryFn: async () => {
      if (jobCachedLabel) return jobCachedLabel

      const res = await api.api.jobs[':id'].label.$get({
        param: { id: jobId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled: !!jobId && !jobCachedLabel && jobDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  const { data: serviceLabel } = useQuery({
    queryKey: ['services', serviceId, 'label'],
    queryFn: async () => {
      if (serviceCachedLabel) return serviceCachedLabel

      const res = await api.api.services[':id'].label.$get({
        param: { id: serviceId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled:
      !!serviceId && !serviceCachedLabel && serviceDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  const { data: standardLabel } = useQuery({
    queryKey: ['standards', standardId, 'label'],
    queryFn: async () => {
      if (standardCachedLabel) return standardCachedLabel

      const res = await api.api.standards[':id'].label.$get({
        param: { id: standardId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled:
      !!standardId && !standardCachedLabel && standardDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  const { data: ncLabel } = useQuery({
    queryKey: ['non-conformance', ncId, 'label'],
    queryFn: async () => {
      if (ncCachedLabel) return ncCachedLabel

      const res = await api.api.nc[':id'].label.$get({
        param: { id: ncId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled: !!ncId && !ncCachedLabel && ncDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  const { data: capaLabel } = useQuery({
    queryKey: ['capa', capaId, 'label'],
    queryFn: async () => {
      if (capaCachedLabel) return capaCachedLabel

      const res = await api.api.capa[':id'].label.$get({
        param: { id: capaId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled: !!capaId && !capaCachedLabel && capaDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  const { data: competenceLabel } = useQuery({
    queryKey: ['competence', competenceId, 'label'],
    queryFn: async () => {
      if (competenceCachedLabel) return competenceCachedLabel

      const res = await api.api.competences[':id'].label.$get({
        param: { id: competenceId! },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.label
    },
    enabled:
      !!competenceId &&
      !competenceCachedLabel &&
      competenceDetailFetchCount === 0,
    staleTime: LABEL_STALE_TIME,
  })

  // Build entity name lookup
  const entityNames: Record<string, string> = useMemo(() => {
    const names: Record<string, string> = {}
    if (customerId && (customerCachedLabel || customerLabel)) {
      names[customerId] = customerCachedLabel || customerLabel
    }
    if (assetId && (assetCachedLabel || assetLabel)) {
      names[assetId] = assetCachedLabel || assetLabel
    }
    if (methodId && (methodCachedLabel || methodLabel)) {
      names[methodId] = methodCachedLabel || methodLabel
    }
    if (jobId && (jobCachedLabel || jobLabel)) {
      names[jobId] = jobCachedLabel || jobLabel
    }
    if (serviceId && (serviceCachedLabel || serviceLabel)) {
      names[serviceId] = serviceCachedLabel || serviceLabel
    }
    if (standardId && (standardCachedLabel || standardLabel)) {
      names[standardId] = standardCachedLabel || standardLabel
    }
    if (ncId && (ncCachedLabel || ncLabel)) {
      names[ncId] = ncCachedLabel || ncLabel
    }
    if (capaId && (capaCachedLabel || capaLabel)) {
      names[capaId] = capaCachedLabel || capaLabel
    }
    if (competenceId && (competenceCachedLabel || competenceLabel)) {
      names[competenceId] = competenceCachedLabel || competenceLabel
    }
    return names
  }, [
    customerId,
    customerCachedLabel,
    customerLabel,
    customerDetailFetchCount,
    assetId,
    assetCachedLabel,
    assetLabel,
    assetDetailFetchCount,
    methodId,
    methodCachedLabel,
    methodLabel,
    methodDetailFetchCount,
    jobId,
    jobCachedLabel,
    jobLabel,
    jobDetailFetchCount,
    serviceId,
    serviceCachedLabel,
    serviceLabel,
    serviceDetailFetchCount,
    standardId,
    standardCachedLabel,
    standardLabel,
    standardDetailFetchCount,
    ncId,
    ncCachedLabel,
    ncLabel,
    ncDetailFetchCount,
    capaId,
    capaCachedLabel,
    capaLabel,
    capaDetailFetchCount,
    competenceId,
    competenceCachedLabel,
    competenceLabel,
    competenceDetailFetchCount,
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
                      <BreadcrumbLink render={<Link to={crumb.path} />}>
                        {crumb.label}
                      </BreadcrumbLink>
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
        <NotificationBell />
      </div>
    </header>
  )
}
