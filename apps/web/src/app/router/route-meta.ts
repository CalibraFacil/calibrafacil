export type DashboardIconId =
  | 'analytics'
  | 'assets'
  | 'billing'
  | 'building'
  | 'certificateTemplate'
  | 'clipboard'
  | 'creditCard'
  | 'customers'
  | 'customerSuccess'
  | 'documentation'
  | 'file'
  | 'home'
  | 'jobs'
  | 'methods'
  | 'personnel'
  | 'quality'
  | 'requests'
  | 'ruler'
  | 'services'
  | 'serviceOrders'
  | 'settings'
  | 'wallet'

export type DashboardNavItem = {
  title: string
  url: string
  icon: DashboardIconId
  items?: DashboardNavItem[]
  requiredModule?: 'finance'
  requiredRole?: 'admin-or-owner'
}

export type DashboardRouteMeta = {
  path: string
  cloudOnly?: boolean | 'prefix'
}

export type DashboardRedirectRouteMeta = {
  from: string
  to: string
}

export const dashboardRouteMeta = [
  { path: '/dashboard/reports', cloudOnly: true },
  { path: '/dashboard/requests', cloudOnly: 'prefix' },
  { path: '/dashboard/nc', cloudOnly: 'prefix' },
  { path: '/dashboard/capa', cloudOnly: 'prefix' },
  { path: '/dashboard/certificate-templates', cloudOnly: true },
  { path: '/dashboard/finance', cloudOnly: 'prefix' },
  { path: '/dashboard/settings', cloudOnly: 'prefix' },
  { path: '/dashboard/customer-success', cloudOnly: true },
  { path: '/dashboard/internal', cloudOnly: 'prefix' },
] satisfies DashboardRouteMeta[]

export const dashboardRedirectRouteMeta = [
  {
    from: '/dashboard/settings/branding',
    to: '/dashboard/certificate-templates',
  },
] satisfies DashboardRedirectRouteMeta[]

export const dashboardPrimaryNavItems = [
  {
    title: 'Painel',
    url: '/dashboard',
    icon: 'home',
  },
  {
    title: 'Clientes',
    url: '/dashboard/clients',
    icon: 'customers',
  },
  {
    title: 'Ativos',
    url: '/dashboard/assets',
    icon: 'assets',
  },
  {
    title: 'Laboratório',
    url: '#',
    icon: 'building',
    items: [
      {
        title: 'Métodos de Calibração',
        url: '/dashboard/methods',
        icon: 'methods',
      },
      {
        title: 'Padrões de Referência',
        url: '/dashboard/standards',
        icon: 'ruler',
      },
      {
        title: 'Competências do Pessoal',
        url: '/dashboard/personnel',
        icon: 'personnel',
      },
    ],
  },
  {
    title: 'Serviços',
    url: '/dashboard/services',
    icon: 'services',
  },
  {
    title: 'Calibrações',
    url: '/dashboard/jobs',
    icon: 'jobs',
  },
  {
    title: 'Ordens de Serviço',
    url: '/dashboard/service-orders',
    icon: 'serviceOrders',
  },
  {
    title: 'Templates de Certificados',
    url: '/dashboard/certificate-templates',
    icon: 'certificateTemplate',
  },
  {
    title: 'Solicitações',
    url: '/dashboard/requests',
    icon: 'requests',
  },
  {
    title: 'Qualidade',
    url: '#',
    icon: 'quality',
    items: [
      {
        title: 'Não Conformidades',
        url: '/dashboard/nc',
        icon: 'quality',
      },
      {
        title: 'Ações Corretivas (CAPA)',
        url: '/dashboard/capa',
        icon: 'services',
      },
    ],
  },
  {
    title: 'Financeiro',
    url: '#',
    icon: 'wallet',
    requiredModule: 'finance',
    requiredRole: 'admin-or-owner',
    items: [
      {
        title: 'Visão geral',
        url: '/dashboard/finance',
        icon: 'analytics',
      },
      {
        title: 'Documentos',
        url: '/dashboard/finance/documents',
        icon: 'file',
      },
      {
        title: 'Recebimentos',
        url: '/dashboard/finance/receipts',
        icon: 'creditCard',
      },
      {
        title: 'Contratos',
        url: '/dashboard/finance/contracts',
        icon: 'clipboard',
      },
      {
        title: 'ERP',
        url: '/dashboard/finance/erp',
        icon: 'settings',
      },
    ],
  },
] satisfies DashboardNavItem[]

export const dashboardManagementNavItems = [
  {
    title: 'Relatórios',
    url: '/dashboard/reports',
    icon: 'analytics',
    requiredRole: 'admin-or-owner',
  },
  {
    title: 'Customer Success',
    url: '/dashboard/customer-success',
    icon: 'customerSuccess',
    items: [
      {
        title: 'Área do laboratório',
        url: '/dashboard/customer-success',
        icon: 'customerSuccess',
      },
    ],
  },
  {
    title: 'Configurações',
    url: '/dashboard/settings',
    icon: 'settings',
  },
] satisfies DashboardNavItem[]

export const dashboardSecondaryNavItems = [
  {
    title: 'Documentação',
    url: 'https://docs.calibrafacil.com',
    icon: 'documentation',
  },
] satisfies DashboardNavItem[]

export function isDashboardCloudOnlyPath(pathname: string) {
  return dashboardRouteMeta.some((route) => {
    if (!route.cloudOnly) return false

    if (route.cloudOnly === 'prefix') {
      return pathname === route.path || pathname.startsWith(`${route.path}/`)
    }

    return pathname === route.path || pathname === `${route.path}/`
  })
}

export function getDashboardRedirectPath(pathname: string) {
  return (
    dashboardRedirectRouteMeta.find((route) => route.from === pathname)?.to ??
    null
  )
}

export function filterDashboardNavItems(
  items: readonly DashboardNavItem[],
  access: {
    canAccessFinance: boolean
    canAccessAdminOrOwner: boolean
  },
): DashboardNavItem[] {
  return items
    .filter((item) => {
      if (item.requiredModule === 'finance' && !access.canAccessFinance) {
        return false
      }

      if (
        item.requiredRole === 'admin-or-owner' &&
        !access.canAccessAdminOrOwner
      ) {
        return false
      }

      return true
    })
    .map((item) => ({
      ...item,
      items: item.items
        ? filterDashboardNavItems(item.items, access)
        : undefined,
    }))
}
