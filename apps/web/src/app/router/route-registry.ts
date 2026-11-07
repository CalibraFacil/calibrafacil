import type { FileRouteTypes } from '@/routeTree.gen'

/**
 * The dashboard route registry: one declaration of what each dashboard route
 * is called and where it shows up. Everything else reads from here:
 *
 * - breadcrumb crumb      `title`            (features/dashboard/components/dashboard-header.tsx)
 * - document (tab) title  `routeHead`        (each route file's `head`)
 * - sidebar               `nav`, `navTitle`  (route-meta.ts builds the sections)
 * - settings sidebar      `settingsNav`      (components/settings-nav.tsx)
 * - redirect target       `redirectTo`       (the redirecting route files)
 * - prewarm matching      the keys           (app/router/route-prewarm.ts)
 * - desktop availability  the keys           (runtime/desktop-offline-routes.ts)
 *
 * Ids are the router's `to` (an index route shares its parent's id). The
 * `satisfies` below makes the table exhaustive: a dashboard route added to the
 * route tree does not compile until it is declared here, and an entry for a
 * route that no longer exists does not compile either.
 *
 * This module stays free of feature and component imports: it is read by
 * infrastructure and by the route files, never the other way around.
 */

export type DashboardRouteId = Extract<
  FileRouteTypes['to'],
  `/dashboard${string}`
>

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

// The sidebar follows the laboratory's work, not the data model: the daily
// flow first (request -> service order -> calibration -> visit), then the
// records it uses, the technical and quality base ISO/IEC 17025 asks for, and
// the management areas.
export const dashboardNavSectionLabels = {
  home: undefined,
  operation: 'Operação',
  registers: 'Cadastros',
  laboratory: 'Laboratório',
  management: 'Gestão',
} as const

export type DashboardNavSectionId = keyof typeof dashboardNavSectionLabels

type NavGroupDef = {
  title: string
  icon: DashboardIconId
  /** The group's own page, when its header links somewhere. */
  to?: DashboardRouteId
  requiredModule?: 'finance'
  requiredRole?: 'admin-or-owner'
}

export const dashboardNavGroups = {
  clients: { title: 'Clientes', icon: 'customers', to: '/dashboard/clients' },
  catalog: { title: 'Catálogo', icon: 'services' },
  quality: { title: 'Qualidade', icon: 'quality' },
  finance: {
    title: 'Financeiro',
    icon: 'wallet',
    requiredModule: 'finance',
    requiredRole: 'admin-or-owner',
  },
} as const satisfies Record<string, NavGroupDef>

export type DashboardNavGroupId = keyof typeof dashboardNavGroups

const settingsNavGroupLabels = {
  account: 'Conta',
  laboratory: 'Laboratório',
  // Everything about the certificate, from its number to its delivery,
  // release and automatic send included.
  certificates: 'Certificados',
  portal: 'Portal e integrações',
  advanced: 'Avançado',
} as const

type SettingsNavGroupId = keyof typeof settingsNavGroupLabels

type RouteDef = {
  /** Breadcrumb crumb; also the default for the sidebar and the tab title. */
  title: string
  /** Sidebar text, when the sidebar says it shorter than the crumb does. */
  navTitle?: string
  /** Tab title, when it is more specific than `title` ("Detalhes do Ativo"). */
  documentTitle?: string
  /** Appended to the tab title ("Perfil | Configurações | CalibraFácil"). */
  headContext?: string
  /**
   * Sidebar placement. Order is the order of the entries below; a group sits
   * where its first member does.
   */
  nav?: {
    section: DashboardNavSectionId
    icon: DashboardIconId
    group?: DashboardNavGroupId
    requiredRole?: 'admin-or-owner'
  }
  /** Settings sidebar placement, in the order of the entries below. */
  settingsNav?: { group: SettingsNavGroupId }
  /**
   * Where visiting this route exactly sends the user. A route that only
   * redirects has no title: it never renders, so it has no crumb or tab.
   */
  redirectTo?: DashboardRouteId
}

type RedirectOnlyRouteDef = { redirectTo: DashboardRouteId }

type DashboardRouteDef = RouteDef | RedirectOnlyRouteDef

export const dashboardRoutes = {
  '/dashboard': {
    title: 'Painel de Controle',
    navTitle: 'Painel',
    documentTitle: 'Dashboard',
    nav: { section: 'home', icon: 'home' },
  },

  // Operation
  '/dashboard/requests': {
    title: 'Solicitações de Calibração',
    navTitle: 'Solicitações',
    nav: { section: 'operation', icon: 'requests' },
  },
  '/dashboard/requests/$id': {
    title: 'Solicitação',
    documentTitle: 'Solicitação de Calibração',
  },
  '/dashboard/service-orders': {
    title: 'Ordens de serviço',
    nav: { section: 'operation', icon: 'serviceOrders' },
  },
  '/dashboard/service-orders/new': { title: 'Nova OS' },
  '/dashboard/service-orders/$publicId': {
    title: 'Ordem de Serviço',
    documentTitle: 'Detalhe da OS',
  },
  '/dashboard/jobs': {
    title: 'Calibrações',
    nav: { section: 'operation', icon: 'jobs' },
  },
  '/dashboard/jobs/new': { title: 'Nova Calibração' },
  '/dashboard/jobs/$id': {
    title: 'Calibração',
    documentTitle: 'Detalhes do Job',
  },
  '/dashboard/jobs/$id/execute': {
    title: 'Executar',
    documentTitle: 'Executar Calibração',
  },
  '/dashboard/visits': {
    title: 'Visitas',
    nav: { section: 'operation', icon: 'visits' },
  },
  '/dashboard/visits/$id': { title: 'Visita' },

  // Registers
  '/dashboard/clients': {
    title: 'Clientes',
    navTitle: 'Todos os clientes',
    nav: { section: 'registers', icon: 'customers', group: 'clients' },
  },
  '/dashboard/clients/groups': {
    title: 'Grupos de Clientes',
    navTitle: 'Grupos',
    nav: { section: 'registers', icon: 'building', group: 'clients' },
  },
  '/dashboard/clients/groups/$groupId': { title: 'Grupo' },
  '/dashboard/clients/groups/$groupId/overview': {
    title: 'Visão geral',
    documentTitle: 'Grupo | Visão geral',
  },
  '/dashboard/clients/groups/$groupId/unidades': {
    title: 'Unidades',
    documentTitle: 'Grupo | Unidades',
  },
  '/dashboard/clients/groups/$groupId/gestor': {
    title: 'Gestor',
    documentTitle: 'Grupo | Gestor',
  },
  '/dashboard/clients/new': { title: 'Novo Cliente' },
  '/dashboard/clients/$id': { title: 'Cliente' },
  '/dashboard/clients/$id/overview': {
    title: 'Visão geral',
    documentTitle: 'Cliente | Visão geral',
  },
  '/dashboard/clients/$id/info': {
    title: 'Informações',
    documentTitle: 'Cliente | Informações',
  },
  '/dashboard/clients/$id/users': {
    title: 'Usuários',
    documentTitle: 'Cliente | Usuários',
  },
  '/dashboard/clients/$id/assets': {
    title: 'Ativos',
    documentTitle: 'Cliente | Ativos',
  },
  '/dashboard/clients/$id/calibrations': {
    title: 'Calibrações',
    documentTitle: 'Cliente | Calibrações',
  },
  '/dashboard/clients/$id/compliance': {
    title: 'Conformidade',
    documentTitle: 'Cliente | Compliance',
  },
  '/dashboard/assets': {
    title: 'Ativos',
    nav: { section: 'registers', icon: 'assets' },
  },
  '/dashboard/assets/new': { title: 'Novo Ativo' },
  '/dashboard/assets/$id': {
    title: 'Ativo',
    documentTitle: 'Detalhes do Ativo',
  },
  '/dashboard/assets/$id/edit': { title: 'Editar Ativo' },
  '/dashboard/services': {
    title: 'Serviços',
    nav: { section: 'registers', icon: 'services', group: 'catalog' },
  },
  '/dashboard/services/new': { title: 'Novo Serviço' },
  '/dashboard/services/$id': {
    title: 'Serviço',
    documentTitle: 'Detalhes do Serviço',
  },
  '/dashboard/services/$id/edit': { title: 'Editar Serviço' },
  '/dashboard/materials': {
    title: 'Materiais',
    documentTitle: 'Peças e Materiais',
    nav: { section: 'registers', icon: 'materials', group: 'catalog' },
  },
  '/dashboard/materials/new': { title: 'Novo Material' },
  '/dashboard/materials/$id/edit': { title: 'Editar Material' },

  // Laboratory
  '/dashboard/methods': {
    title: 'Métodos de Calibração',
    navTitle: 'Métodos',
    nav: { section: 'laboratory', icon: 'methods' },
  },
  '/dashboard/methods/new': { title: 'Novo Método' },
  '/dashboard/methods/from-template': {
    title: 'A partir de modelo',
    documentTitle: 'Novo Método a partir de modelo',
  },
  '/dashboard/methods/$id': {
    title: 'Método',
    documentTitle: 'Detalhes do Método',
  },
  '/dashboard/methods/$id/edit': { title: 'Editar Método' },
  '/dashboard/standards': {
    title: 'Padrões',
    documentTitle: 'Padrões de Referência',
    nav: { section: 'laboratory', icon: 'ruler' },
  },
  '/dashboard/standards/new': { title: 'Novo Padrão' },
  '/dashboard/standards/composition-profiles': {
    title: 'Perfis de Composição',
  },
  '/dashboard/standards/$id': {
    title: 'Padrão',
    documentTitle: 'Detalhes do Padrão',
  },
  '/dashboard/standards/$id/edit': { title: 'Editar Padrão' },
  '/dashboard/personnel': {
    title: 'Competências do Pessoal',
    navTitle: 'Pessoal e competências',
    nav: { section: 'laboratory', icon: 'personnel' },
  },
  '/dashboard/personnel/new': {
    title: 'Nova Solicitação',
    documentTitle: 'Nova Solicitação de Competência',
  },
  '/dashboard/personnel/$id': {
    title: 'Competência',
    documentTitle: 'Detalhes da Competência',
  },
  '/dashboard/personnel/$id/training': { title: 'Treinamentos' },
  '/dashboard/personnel/$id/audit': { title: 'Histórico' },
  '/dashboard/nc': {
    title: 'Não conformidades',
    nav: { section: 'laboratory', icon: 'quality', group: 'quality' },
  },
  '/dashboard/nc/new': {
    title: 'Registrar NC',
    documentTitle: 'Registrar Não Conformidade',
  },
  '/dashboard/nc/$id': {
    title: 'Não Conformidade',
    documentTitle: 'Detalhes da NC',
  },
  '/dashboard/capa': {
    title: 'Ações corretivas (CAPA)',
    nav: { section: 'laboratory', icon: 'services', group: 'quality' },
  },
  '/dashboard/capa/new': { title: 'Nova CAPA' },
  '/dashboard/capa/$id': { title: 'CAPA', documentTitle: 'Detalhes CAPA' },
  '/dashboard/proficiency-tests': {
    title: 'Ensaios de proficiência',
    nav: { section: 'laboratory', icon: 'clipboard', group: 'quality' },
  },
  '/dashboard/proficiency-tests/new': {
    title: 'Novo Ensaio',
    documentTitle: 'Novo Ensaio de Proficiência',
  },
  '/dashboard/proficiency-tests/plan': {
    title: 'Plano de Participação',
    documentTitle: 'Plano de Participação EP',
  },
  '/dashboard/proficiency-tests/$id': {
    title: 'Ensaio',
    documentTitle: 'Detalhes do Ensaio',
  },
  '/dashboard/spc': {
    title: 'Cartas de controle (CEP)',
    nav: { section: 'laboratory', icon: 'analytics', group: 'quality' },
  },
  '/dashboard/spc/$id': { title: 'Carta', documentTitle: 'Carta de Controle' },

  // Management
  '/dashboard/finance': {
    title: 'Financeiro',
    navTitle: 'Painel financeiro',
    documentTitle: 'Visão geral financeira',
    nav: { section: 'management', icon: 'analytics', group: 'finance' },
  },
  '/dashboard/finance/billing-readiness': {
    title: 'Pronto para faturar',
    nav: { section: 'management', icon: 'wallet', group: 'finance' },
  },
  '/dashboard/finance/receivables': {
    title: 'Recebíveis',
    nav: { section: 'management', icon: 'creditCard', group: 'finance' },
  },
  '/dashboard/finance/contracts': {
    title: 'Contratos comerciais',
    navTitle: 'Contratos',
    nav: { section: 'management', icon: 'clipboard', group: 'finance' },
  },
  '/dashboard/finance/analytics': {
    title: 'Análises financeiras',
    navTitle: 'Análises',
    nav: { section: 'management', icon: 'analytics', group: 'finance' },
  },
  '/dashboard/finance/automation': {
    title: 'Automação financeira',
    navTitle: 'Automação',
    nav: { section: 'management', icon: 'ruler', group: 'finance' },
  },
  '/dashboard/finance/erp': {
    title: 'ERP financeiro',
    navTitle: 'ERP',
    nav: { section: 'management', icon: 'settings', group: 'finance' },
  },
  '/dashboard/finance/contracts/new': { title: 'Novo contrato comercial' },
  '/dashboard/finance/contracts/$id': { title: 'Contrato comercial' },
  // Documents and receipts merged into the unified Recebíveis workspace.
  '/dashboard/finance/documents': {
    title: 'Documentos financeiros',
    redirectTo: '/dashboard/finance/receivables',
  },
  '/dashboard/finance/documents/new': { title: 'Nova cobrança' },
  '/dashboard/finance/documents/$id': { title: 'Documento financeiro' },
  '/dashboard/finance/receipts': {
    redirectTo: '/dashboard/finance/receivables',
  },
  '/dashboard/finance/cash-forecast': { title: 'Previsão de caixa' },
  '/dashboard/finance/margin-dashboards': { title: 'Painel de margens' },
  '/dashboard/finance/operations-to-cash': { title: 'Operação ao caixa' },
  '/dashboard/finance/revenue-leakage': { title: 'Alertas de receita' },
  '/dashboard/reports': {
    title: 'Relatórios',
    documentTitle: 'Relatórios Consolidados',
    nav: {
      section: 'management',
      icon: 'analytics',
      requiredRole: 'admin-or-owner',
    },
  },
  '/dashboard/settings': {
    title: 'Configurações',
    nav: { section: 'management', icon: 'settings' },
    redirectTo: '/dashboard/settings/profile',
  },

  // Settings: account
  '/dashboard/settings/profile': {
    title: 'Perfil',
    headContext: 'Configurações',
    settingsNav: { group: 'account' },
  },
  '/dashboard/settings/notifications': {
    title: 'Notificações',
    headContext: 'Configurações',
    settingsNav: { group: 'account' },
  },
  '/dashboard/settings/appearance': {
    title: 'Aparência',
    headContext: 'Configurações',
    settingsNav: { group: 'account' },
  },
  '/dashboard/settings/security': {
    title: 'Segurança',
    headContext: 'Configurações',
    settingsNav: { group: 'account' },
  },
  '/dashboard/settings/authentication': {
    title: 'Autenticação',
    headContext: 'Configurações',
    settingsNav: { group: 'account' },
  },
  '/dashboard/settings/passkeys': {
    title: 'Passkeys',
    headContext: 'Configurações',
    settingsNav: { group: 'account' },
  },

  // Settings: laboratory
  '/dashboard/settings/organization': {
    title: 'Organização',
    navTitle: 'Geral',
    headContext: 'Configurações',
    settingsNav: { group: 'laboratory' },
  },
  '/dashboard/settings/units': {
    title: 'Unidades & governança',
    headContext: 'Configurações',
    settingsNav: { group: 'laboratory' },
  },
  '/dashboard/settings/members': {
    title: 'Membros & convites',
    headContext: 'Configurações',
    settingsNav: { group: 'laboratory' },
  },
  '/dashboard/settings/environment': {
    title: 'Condições Ambientais',
    navTitle: 'Ambiente',
    headContext: 'Configurações',
    settingsNav: { group: 'laboratory' },
  },
  '/dashboard/settings/accredited-scope': {
    title: 'Escopo acreditado (CMC)',
    headContext: 'Configurações',
    settingsNav: { group: 'laboratory' },
  },

  // Settings: certificates
  '/dashboard/settings/certificate-numbering': {
    title: 'Numeração de Certificados',
    navTitle: 'Numeração',
    headContext: 'Configurações',
    settingsNav: { group: 'certificates' },
  },
  '/dashboard/settings/signature': {
    title: 'Assinatura',
    navTitle: 'Assinatura digital',
    headContext: 'Configurações',
    settingsNav: { group: 'certificates' },
  },
  '/dashboard/settings/certificates': {
    title: 'Certificados ICP',
    documentTitle: 'Certificados ICP-Brasil',
    headContext: 'Configurações',
    settingsNav: { group: 'certificates' },
  },
  '/dashboard/settings/certificate-release': {
    title: 'Liberação de Certificados',
    navTitle: 'Liberação ao cliente',
    headContext: 'Configurações',
    settingsNav: { group: 'certificates' },
  },
  '/dashboard/settings/automatic-send': {
    title: 'Envio automático',
    headContext: 'Configurações',
    settingsNav: { group: 'certificates' },
  },

  // Settings: portal and integrations
  '/dashboard/settings/portal-domain': {
    title: 'Domínio do portal',
    headContext: 'Configurações',
    settingsNav: { group: 'portal' },
  },
  '/dashboard/settings/email-domain': {
    title: 'Domínio de e-mail',
    headContext: 'Configurações',
    settingsNav: { group: 'portal' },
  },
  '/dashboard/settings/integrations': {
    title: 'Integrações',
    headContext: 'Configurações',
    settingsNav: { group: 'portal' },
  },
  '/dashboard/settings/integrations/drift': {
    title: 'Divergências de Integração',
    headContext: 'Configurações',
  },
  '/dashboard/settings/danger': {
    title: 'Zona de perigo',
    headContext: 'Configurações',
    settingsNav: { group: 'advanced' },
  },
  // Portal branding now lives alongside the custom-domain workspace.
  '/dashboard/settings/branding': {
    redirectTo: '/dashboard/settings/portal-domain',
  },

  // The desktop's own sync machinery
  '/dashboard/sync/conflicts': { title: 'Conflitos de sincronização' },
} as const satisfies Record<DashboardRouteId, DashboardRouteDef>

type Registry = typeof dashboardRoutes

/** Every dashboard route id that has a tab title (all but redirect-only). */
export type TitledDashboardRouteId = {
  [K in DashboardRouteId]: Registry[K] extends { title: string } ? K : never
}[DashboardRouteId]

type RedirectingRouteId = {
  [K in DashboardRouteId]: Registry[K] extends { redirectTo: DashboardRouteId }
    ? K
    : never
}[DashboardRouteId]

type RedirectTarget<K extends RedirectingRouteId> = Registry[K] extends {
  redirectTo: infer T
}
  ? T
  : never

export type SettingsNavRouteId = {
  [K in DashboardRouteId]: Registry[K] extends { settingsNav: unknown }
    ? K
    : never
}[DashboardRouteId]

const BRAND = 'CalibraFácil'

function isDashboardRouteId(value: string): value is DashboardRouteId {
  return Object.hasOwn(dashboardRoutes, value)
}

/** Every dashboard route id, for matching a pathname against the registry. */
export function listDashboardRouteIds(): DashboardRouteId[] {
  return Object.keys(dashboardRoutes).filter(isDashboardRouteId)
}

/** The routes that have a title, in declaration order (the sidebar's order). */
const titledRoutes: ReadonlyArray<readonly [DashboardRouteId, RouteDef]> =
  listDashboardRouteIds().flatMap((to) => {
    const def: DashboardRouteDef = dashboardRoutes[to]
    return 'title' in def ? [[to, def] as const] : []
  })

const titledRoutesById = new Map<string, RouteDef>(titledRoutes)

/** TanStack route ids end with a slash for index routes; ids here do not. */
export function toRouteTo(routeId: string): string {
  return routeId.length > 1 && routeId.endsWith('/')
    ? routeId.slice(0, -1)
    : routeId
}

/** Breadcrumb text for a router route id (index or not), if it has one. */
export function getDashboardRouteTitle(routeId: string): string | undefined {
  return titledRoutesById.get(toRouteTo(routeId))?.title
}

/** The sidebar text of a route: its nav title, else its title. */
export function getDashboardNavTitle(def: RouteDef): string {
  return def.navTitle ?? def.title
}

/** The registry's titled routes in declaration order. */
export function listTitledDashboardRoutes() {
  return titledRoutes
}

/**
 * `head` for a dashboard route: the tab title, `<title> | CalibraFácil`.
 * Extra meta (a description) goes in `extra`.
 */
export function routeHead(
  to: TitledDashboardRouteId,
  extra: ReadonlyArray<{ name: string; content: string }> = [],
) {
  const def = titledRoutesById.get(to)
  if (!def) throw new Error(`Dashboard route ${to} has no title`)
  const segments = [def.documentTitle ?? def.title]
  if (def.headContext) segments.push(def.headContext)
  segments.push(BRAND)
  return { meta: [{ title: segments.join(' | ') }, ...extra] }
}

/** Where a redirecting route sends the user, as the router's literal `to`. */
export function getDashboardRedirectTarget<K extends RedirectingRouteId>(
  from: K,
): RedirectTarget<K>
export function getDashboardRedirectTarget(from: RedirectingRouteId) {
  return dashboardRoutes[from].redirectTo
}

export type SettingsNavGroup = {
  id: SettingsNavGroupId
  label: string
  items: ReadonlyArray<{
    to: SettingsNavRouteId
    /** The last path segment: the settings page's stable key. */
    value: string
    label: string
  }>
}

/** The settings sidebar: groups in order, each with its pages in order. */
export function getSettingsNavGroups(): SettingsNavGroup[] {
  const groups = new Map<
    SettingsNavGroupId,
    SettingsNavGroup['items'][number][]
  >()
  for (const [to, def] of listTitledDashboardRoutes()) {
    if (!def.settingsNav || !isSettingsNavRouteId(to)) continue
    const items = groups.get(def.settingsNav.group) ?? []
    items.push({
      to,
      value: to.split('/').at(-1) ?? to,
      label: getDashboardNavTitle(def),
    })
    groups.set(def.settingsNav.group, items)
  }

  return Object.entries(settingsNavGroupLabels).flatMap(([id, label]) => {
    if (!isSettingsNavGroupId(id)) return []
    const items = groups.get(id)
    return items ? [{ id, label, items }] : []
  })
}

function isSettingsNavGroupId(value: string): value is SettingsNavGroupId {
  return Object.hasOwn(settingsNavGroupLabels, value)
}

function isSettingsNavRouteId(to: DashboardRouteId): to is SettingsNavRouteId {
  return 'settingsNav' in dashboardRoutes[to]
}

type RouteMatch<TPattern extends string> = {
  pattern: TPattern
  /** Decoded values of the pattern's `$param` segments. */
  params: Record<string, string>
}

function splitPath(path: string): string[] {
  return path.replace(/^\/+|\/+$/g, '').split('/')
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * The pattern (`/dashboard/clients/$id/assets`) a pathname belongs to. A
 * static segment beats a `$param` one, so `/dashboard/clients/new` is the new
 * page, not a client called "new". A trailing slash is ignored.
 */
export function matchRoutePath<TPattern extends string>(
  pathname: string,
  patterns: readonly TPattern[],
): RouteMatch<TPattern> | null {
  const actual = splitPath(pathname)
  let best: (RouteMatch<TPattern> & { statics: number }) | null = null

  for (const pattern of patterns) {
    const expected = splitPath(pattern)
    if (expected.length !== actual.length) continue

    const params: Record<string, string> = {}
    let statics = 0
    let matches = true
    for (const [index, part] of expected.entries()) {
      const value = actual[index] ?? ''
      if (part.startsWith('$')) {
        if (value === '') {
          matches = false
          break
        }
        params[part.slice(1)] = decodeSegment(value)
      } else if (part === value) {
        statics += 1
      } else {
        matches = false
        break
      }
    }

    if (matches && (!best || statics > best.statics)) {
      best = { pattern, params, statics }
    }
  }

  return best ? { pattern: best.pattern, params: best.params } : null
}
