import { describe, expect, it } from 'vitest'

import {
  publishedMethodsQueryOptions,
  serviceAssetTypesQueryOptions,
  serviceAuditLogQueryOptions,
  serviceDetailQueryOptions,
  servicesListQueryInputFromUrl,
  servicesListQueryOptions,
} from './queries'

describe('services feature queries', () => {
  it('keys services lists by organization and filters', () => {
    const options = servicesListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      search: 'Massa',
      statusFilter: 'active',
    })

    expect(options.queryKey).toEqual([
      'services',
      'org-1',
      2,
      'Massa',
      'active',
    ])
  })

  it('derives list input from URL filters', () => {
    expect(
      servicesListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/services?page=3&query=Massa&status=inactive',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      limit: 20,
      search: 'Massa',
      statusFilter: 'inactive',
    })
  })

  it('ignores invalid URL filters', () => {
    expect(
      servicesListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/services?page=-2&status=UNKNOWN',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 1,
      limit: 20,
      search: '',
      statusFilter: '',
    })
  })

  it('keys service detail and form option queries', () => {
    expect(serviceDetailQueryOptions('svc-1').queryKey).toEqual([
      'services',
      'svc-1',
    ])
    expect(serviceAuditLogQueryOptions('svc-1').queryKey).toEqual([
      'services',
      'svc-1',
      'audit-log',
    ])
    expect(publishedMethodsQueryOptions().queryKey).toEqual([
      'methods',
      'published',
    ])
    expect(serviceAssetTypesQueryOptions().queryKey).toEqual(['asset-types'])
  })
})
