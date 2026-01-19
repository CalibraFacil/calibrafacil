import { Link, useMatches } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
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
}

// Extract entity IDs from pathname
function extractEntityIds(pathname: string): {
  customerId?: string
  assetId?: string
  methodId?: string
  jobId?: string
  serviceId?: string
  standardId?: string
} {
  const parts = pathname.split('/')
  const result: {
    customerId?: string
    assetId?: string
    methodId?: string
    jobId?: string
    serviceId?: string
    standardId?: string
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

  return result
}

export function DashboardHeader() {
  const matches = useMatches()

  // Extract IDs from current pathname
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const { customerId, assetId, methodId, jobId, serviceId, standardId } =
    extractEntityIds(pathname)

  // Reactive queries for entity names
  const { data: customer } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: async () => {
      const res = await api.api.customers[':id'].$get({
        param: { id: customerId! },
      })
      if (!res.ok) throw new Error('Failed to fetch customer')
      return res.json()
    },
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const { data: asset } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: async () => {
      const res = await api.api.assets[':id'].$get({
        param: { id: assetId! },
      })
      if (!res.ok) throw new Error('Failed to fetch asset')
      return res.json()
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: method } = useQuery({
    queryKey: ['method', methodId],
    queryFn: async () => {
      const res = await api.api.methods[':id'].$get({
        param: { id: methodId! },
      })
      if (!res.ok) throw new Error('Failed to fetch method')
      return res.json()
    },
    enabled: !!methodId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const res = await api.api.jobs[':id'].$get({
        param: { id: jobId! },
      })
      if (!res.ok) throw new Error('Failed to fetch job')
      return res.json()
    },
    enabled: !!jobId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: service } = useQuery({
    queryKey: ['service', serviceId],
    queryFn: async () => {
      const res = await api.api.services[':id'].$get({
        param: { id: serviceId! },
      })
      if (!res.ok) throw new Error('Failed to fetch service')
      return res.json()
    },
    enabled: !!serviceId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: standard } = useQuery({
    queryKey: ['standard', standardId],
    queryFn: async () => {
      const res = await api.api.standards[':id'].$get({
        param: { id: standardId! },
      })
      if (!res.ok) throw new Error('Failed to fetch standard')
      return res.json()
    },
    enabled: !!standardId,
    staleTime: 5 * 60 * 1000,
  })

  // Build entity name lookup
  const entityNames: Record<string, string> = useMemo(() => {
    const names: Record<string, string> = {}
    if (customerId && customer?.name) names[customerId] = customer.name
    if (assetId && asset?.name) names[assetId] = asset.name
    if (methodId && method?.name) names[methodId] = method.name
    if (jobId && job?.jobId) names[jobId] = job.jobId
    if (serviceId && service?.name) names[serviceId] = service.name
    if (standardId && standard?.name) names[standardId] = standard.name
    return names
  }, [
    customerId,
    customer,
    assetId,
    asset,
    methodId,
    method,
    jobId,
    job,
    serviceId,
    service,
    standardId,
    standard,
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
