import {
  dashboardNavGroups,
  dashboardNavSectionLabels,
  getDashboardNavTitle,
  listTitledDashboardRoutes,
  type DashboardIconId,
  type DashboardNavGroupId,
  type DashboardNavSectionId,
} from './route-registry'

export type { DashboardIconId }

export type DashboardNavItem = {
  title: string
  url: string
  icon: DashboardIconId
  items?: DashboardNavItem[]
  requiredModule?: 'finance'
  requiredRole?: 'admin-or-owner'
}

export type DashboardNavSection = {
  /** No label for the home entry at the top. */
  label?: string
  items: DashboardNavItem[]
}

/**
 * The sidebar, derived from the route registry: each route that declares a
 * `nav` lands in its section, in registry order, and a group's header sits
 * where its first member does.
 */
function buildDashboardNavSections(): DashboardNavSection[] {
  const sections = new Map<DashboardNavSectionId, DashboardNavSection>()
  for (const [id, label] of Object.entries(dashboardNavSectionLabels)) {
    if (isSectionId(id)) sections.set(id, { label, items: [] })
  }
  const groups = new Map<DashboardNavGroupId, DashboardNavItem>()

  for (const [to, def] of listTitledDashboardRoutes()) {
    if (!def.nav) continue
    const section = sections.get(def.nav.section)
    if (!section) continue

    const item: DashboardNavItem = {
      title: getDashboardNavTitle(def),
      url: to,
      icon: def.nav.icon,
      ...(def.nav.requiredRole ? { requiredRole: def.nav.requiredRole } : {}),
    }
    if (!def.nav.group) {
      section.items.push(item)
      continue
    }

    let group = groups.get(def.nav.group)
    if (!group) {
      const meta: NavGroupMeta = dashboardNavGroups[def.nav.group]
      group = {
        title: meta.title,
        url: meta.to ?? '#',
        icon: meta.icon,
        ...(meta.requiredModule ? { requiredModule: meta.requiredModule } : {}),
        ...(meta.requiredRole ? { requiredRole: meta.requiredRole } : {}),
        items: [],
      }
      groups.set(def.nav.group, group)
      section.items.push(group)
    }
    group.items?.push(item)
  }

  return [...sections.values()]
}

type NavGroupMeta = {
  title: string
  icon: DashboardIconId
  to?: string
  requiredModule?: 'finance'
  requiredRole?: 'admin-or-owner'
}

function isSectionId(value: string): value is DashboardNavSectionId {
  return Object.hasOwn(dashboardNavSectionLabels, value)
}

export const dashboardNavSections = buildDashboardNavSections()

export const dashboardSecondaryNavItems = [
  {
    title: 'Documentação',
    url: 'https://calibrafacil.com/docs',
    icon: 'documentation',
  },
] satisfies DashboardNavItem[]

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
