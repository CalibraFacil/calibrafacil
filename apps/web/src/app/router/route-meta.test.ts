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
