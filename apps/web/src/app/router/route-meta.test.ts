import { describe, expect, it } from 'vitest'

import {
  dashboardNavSections,
  filterDashboardNavItems,
  getDashboardRedirectPath,
  type DashboardNavItem,
} from './route-meta'

const allTopItems: DashboardNavItem[] = dashboardNavSections.flatMap(
  (section): DashboardNavItem[] => section.items,
)

describe('dashboard route metadata', () => {
  it('orders the sidebar by the laboratory workflow', () => {
    expect(dashboardNavSections.map((section) => section.label)).toEqual([
      undefined,
      'Operação',
      'Cadastros',
      'Laboratório',
      'Gestão',
    ])
    const operation = dashboardNavSections.find(
      (section) => section.label === 'Operação',
    )
    expect(operation?.items.map((item) => item.title)).toEqual([
      'Solicitações',
      'Ordens de serviço',
      'Calibrações',
      'Visitas',
    ])
  })

  it('groups Serviços and Materiais under the Catálogo nav section', () => {
    const catalogo = allTopItems.find((item) => item.title === 'Catálogo')
    expect(catalogo).toBeDefined()
    const childTitles = (catalogo?.items ?? []).map((item) => item.title)
    expect(childTitles).toEqual(['Serviços', 'Materiais'])
    // Neither appears as a top-level entry anymore
    const topTitles = allTopItems.map((item) => item.title)
    expect(topTitles).not.toContain('Serviços')
    expect(topTitles).not.toContain('Materiais')
  })

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

  it('keeps legacy dashboard redirects in route metadata', () => {
    expect(getDashboardRedirectPath('/dashboard/settings/branding')).toBe(
      '/dashboard/settings/portal-domain',
    )
    expect(getDashboardRedirectPath('/dashboard/settings/profile')).toBeNull()
  })
})
