export type DashboardIconId =
  | 'analytics'
  | 'assets'
  | 'building'
  | 'clipboard'
  | 'creditCard'
  | 'customers'
  | 'documentation'
  | 'file'
  | 'home'
  | 'jobs'
  | 'materials'
  | 'methods'
  | 'personnel'
  | 'quality'
  | 'requests'
  | 'ruler'
  | 'services'
  | 'serviceOrders'
  | 'settings'
  | 'visits'
  | 'wallet'

export type DashboardNavItem = {
  title: string
  url: string
  icon: DashboardIconId
  items?: DashboardNavItem[]
  requiredModule?: 'finance'
  requiredRole?: 'admin-or-owner'
}

export type DashboardRedirectRouteMeta = {
  from: string
  to: string
}

export const dashboardRedirectRouteMeta = [
  {
    // Portal branding now lives alongside the custom-domain workspace.
    from: '/dashboard/settings/branding',
    to: '/dashboard/settings/portal-domain',
  },
  {
    // Documents + receipts merged into the unified Recebíveis workspace.
    from: '/dashboard/finance/documents',
    to: '/dashboard/finance/receivables',
  },
  {
    from: '/dashboard/finance/receipts',
    to: '/dashboard/finance/receivables',
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
    items: [
      {
        title: 'Todos os clientes',
        url: '/dashboard/clients',
        icon: 'customers',
      },
      {
        title: 'Grupos',
        url: '/dashboard/clients/groups',
        icon: 'building',
      },
    ],
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
    title: 'Catálogo',
    url: '#',
    icon: 'services',
    items: [
      {
        title: 'Serviços',
        url: '/dashboard/services',
        icon: 'services',
      },
      {
        title: 'Materiais',
        url: '/dashboard/materials',
        icon: 'materials',
      },
    ],
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
    title: 'Solicitações',
    url: '/dashboard/requests',
    icon: 'requests',
  },
  {
    title: 'Visitas',
    url: '/dashboard/visits',
    icon: 'visits',
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
      {
        title: 'Ensaios de Proficiência',
        url: '/dashboard/proficiency-tests',
        icon: 'quality',
      },
      {
        title: 'Cartas de Controle (CEP)',
        url: '/dashboard/spc',
        icon: 'analytics',
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
        title: 'Painel',
        url: '/dashboard/finance',
        icon: 'analytics',
      },
      {
        title: 'Pronto para faturar',
        url: '/dashboard/finance/billing-readiness',
        icon: 'wallet',
      },
      {
        title: 'Recebíveis',
        url: '/dashboard/finance/receivables',
        icon: 'creditCard',
      },
      {
        title: 'Contratos',
        url: '/dashboard/finance/contracts',
        icon: 'clipboard',
      },
      {
        title: 'Análises',
        url: '/dashboard/finance/analytics',
        icon: 'analytics',
      },
      {
        title: 'Automação',
        url: '/dashboard/finance/automation',
        icon: 'ruler',
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
    title: 'Configurações',
    url: '/dashboard/settings',
    icon: 'settings',
  },
] satisfies DashboardNavItem[]

export const dashboardSecondaryNavItems = [
  {
    title: 'Documentação',
    url: 'https://calibrafacil.com/docs',
    icon: 'documentation',
  },
] satisfies DashboardNavItem[]

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
