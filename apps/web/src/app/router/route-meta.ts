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

export type DashboardNavSection = {
  /** No label for the home entry at the top. */
  label?: string
  items: DashboardNavItem[]
}

// The sidebar follows the laboratory's work, not the data model: the daily
// flow first (request -> service order -> calibration -> visit), then the
// records it uses, the technical and quality base ISO/IEC 17025 asks for, and
// the management areas.
export const dashboardNavSections = [
  {
    items: [{ title: 'Painel', url: '/dashboard', icon: 'home' }],
  },
  {
    label: 'Operação',
    items: [
      {
        title: 'Solicitações',
        url: '/dashboard/requests',
        icon: 'requests',
      },
      {
        title: 'Ordens de serviço',
        url: '/dashboard/service-orders',
        icon: 'serviceOrders',
      },
      { title: 'Calibrações', url: '/dashboard/jobs', icon: 'jobs' },
      { title: 'Visitas', url: '/dashboard/visits', icon: 'visits' },
    ],
  },
  {
    label: 'Cadastros',
    items: [
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
      { title: 'Ativos', url: '/dashboard/assets', icon: 'assets' },
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
    ],
  },
  {
    label: 'Laboratório',
    items: [
      { title: 'Métodos', url: '/dashboard/methods', icon: 'methods' },
      { title: 'Padrões', url: '/dashboard/standards', icon: 'ruler' },
      {
        title: 'Pessoal e competências',
        url: '/dashboard/personnel',
        icon: 'personnel',
      },
      {
        title: 'Qualidade',
        url: '#',
        icon: 'quality',
        items: [
          {
            title: 'Não conformidades',
            url: '/dashboard/nc',
            icon: 'quality',
          },
          {
            title: 'Ações corretivas (CAPA)',
            url: '/dashboard/capa',
            icon: 'services',
          },
          {
            title: 'Ensaios de proficiência',
            url: '/dashboard/proficiency-tests',
            icon: 'clipboard',
          },
          {
            title: 'Cartas de controle (CEP)',
            url: '/dashboard/spc',
            icon: 'analytics',
          },
        ],
      },
    ],
  },
  {
    label: 'Gestão',
    items: [
      {
        title: 'Financeiro',
        url: '#',
        icon: 'wallet',
        requiredModule: 'finance',
        requiredRole: 'admin-or-owner',
        items: [
          {
            title: 'Painel financeiro',
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
    ],
  },
] satisfies DashboardNavSection[]

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
