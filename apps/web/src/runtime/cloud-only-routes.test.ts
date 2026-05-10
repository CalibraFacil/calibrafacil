import { describe, expect, it } from 'vitest'

import { isCloudOnlyDashboardPath } from './cloud-only-routes'

describe('isCloudOnlyDashboardPath', () => {
  it.each([
    '/dashboard/reports',
    '/dashboard/requests',
    '/dashboard/requests/123',
    '/dashboard/nc',
    '/dashboard/nc/42',
    '/dashboard/capa',
    '/dashboard/capa/new',
    '/dashboard/certificate-designer',
    '/dashboard/finance/contracts/9',
    '/dashboard/settings/organization',
    '/dashboard/customer-success',
    '/dashboard/internal/customer-success',
  ])('marks %s as cloud-only', (pathname) => {
    expect(isCloudOnlyDashboardPath(pathname)).toBe(true)
  })

  it.each([
    '/dashboard',
    '/dashboard/jobs',
    '/dashboard/jobs/123/execute',
    '/dashboard/standards',
    '/dashboard/assets',
    '/dashboard/clients',
    '/dashboard/services',
    '/dashboard/methods',
    '/dashboard/service-orders',
    '/dashboard/sync/conflicts',
  ])('does not mark %s as cloud-only', (pathname) => {
    expect(isCloudOnlyDashboardPath(pathname)).toBe(false)
  })
})
