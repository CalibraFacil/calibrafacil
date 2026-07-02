import { describe, expect, it } from 'vitest'

import {
  dashboardPrimaryNavItems,
  filterDashboardNavItems,
  getDashboardRedirectPath,
  isDashboardCloudOnlyPath,
} from './route-meta'

describe('dashboard route metadata', () => {
  it('uses metadata to identify cloud-only dashboard paths', () => {
    expect(isDashboardCloudOnlyPath('/dashboard/nc/42')).toBe(true)
    expect(isDashboardCloudOnlyPath('/dashboard/finance/contracts')).toBe(true)
    expect(isDashboardCloudOnlyPath('/dashboard/jobs/42/execute')).toBe(false)
  })

  it('registers the materials catalog as a cloud-only route (REQ-MATUI-005)', () => {
    expect(isDashboardCloudOnlyPath('/dashboard/materials')).toBe(true)
    expect(isDashboardCloudOnlyPath('/dashboard/materials/new')).toBe(true)
    expect(isDashboardCloudOnlyPath('/dashboard/materials/1/edit')).toBe(true)
  })

  it('groups Serviços and Materiais under the Catálogo nav section', () => {
    const catalogo = dashboardPrimaryNavItems.find(
      (item) => item.title === 'Catálogo',
    )
    expect(catalogo).toBeDefined()
    const childTitles = (catalogo?.items ?? []).map((item) => item.title)
    expect(childTitles).toEqual(['Serviços', 'Materiais'])
    // Neither appears as a top-level entry anymore
    const topTitles = dashboardPrimaryNavItems.map((item) => item.title)
    expect(topTitles).not.toContain('Serviços')
    expect(topTitles).not.toContain('Materiais')
  })

  it('filters finance nav items by module and role access', () => {
    const withoutFinance = filterDashboardNavItems(dashboardPrimaryNavItems, {
      canAccessFinance: false,
      canAccessAdminOrOwner: true,
    })
    const withFinance = filterDashboardNavItems(dashboardPrimaryNavItems, {
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
