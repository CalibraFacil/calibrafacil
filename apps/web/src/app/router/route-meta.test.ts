import { describe, expect, it } from 'vitest'

import {
  dashboardNavSections,
  filterDashboardNavItems,
  type DashboardNavItem,
} from './route-meta'
import { getDashboardRouteTitle, listDashboardRouteIds } from './route-registry'

const allTopItems: DashboardNavItem[] = dashboardNavSections.flatMap(
  (section): DashboardNavItem[] => section.items,
)

describe('dashboard route metadata', () => {
  it('filters finance nav items by module and role access', () => {
    const withoutFinance = filterDashboardNavItems(allTopItems, {
      canAccessFinance: false,
      canAccessAdminOrOwner: true,
    })
    const withFinance = filterDashboardNavItems(allTopItems, {
      canAccessFinance: true,
      canAccessAdminOrOwner: true,
    })

    expect(withoutFinance.some((item) => item.title === 'Financeiro')).toBe(
      false,
    )
    expect(withFinance.some((item) => item.title === 'Financeiro')).toBe(true)
  })

  it('derives sidebar titles from the route registry', () => {
    const titles = allTopItems
      .flatMap((item) => [item, ...(item.items ?? [])])
      .filter((item) => item.url.startsWith('/dashboard'))
      .map((item) => [item.url, item.title])
    const byUrl = new Map(titles.map(([url, title]) => [url, title]))

    // A route says its sidebar text once; the sidebar does not retype it.
    expect(byUrl.get('/dashboard/finance/contracts')).toBe('Contratos')
    expect(byUrl.get('/dashboard/service-orders')).toBe(
      getDashboardRouteTitle('/dashboard/service-orders'),
    )
  })

  it('links every sidebar entry to a registered route', () => {
    const ids = new Set<string>(listDashboardRouteIds())
    const urls = allTopItems
      .flatMap((item) => [item, ...(item.items ?? [])])
      .map((item) => item.url)
      .filter((url) => url !== '#')

    expect(urls.filter((url) => !ids.has(url))).toEqual([])
  })

  it('puts the finance group behind the finance module and admin role', () => {
    const finance = allTopItems.find((item) => item.title === 'Financeiro')
    expect(finance).toMatchObject({
      requiredModule: 'finance',
      requiredRole: 'admin-or-owner',
    })
  })

  it('hides role-gated entries from members', () => {
    const asMember = filterDashboardNavItems(allTopItems, {
      canAccessFinance: true,
      canAccessAdminOrOwner: false,
    })
    expect(asMember.some((item) => item.title === 'Relatórios')).toBe(false)
    expect(asMember.some((item) => item.title === 'Financeiro')).toBe(false)
  })
})
