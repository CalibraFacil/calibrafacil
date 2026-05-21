import { describe, expect, it } from 'vitest'

import {
  assetAuditLogQueryOptions,
  assetDetailQueryOptions,
  assetTypesQueryOptions,
  assetsListQueryInputFromUrl,
  assetsListQueryOptions,
  newAssetCustomersQueryOptions,
} from './queries'

describe('assets feature queries', () => {
  it('keys assets lists by organization and filters', () => {
    const options = assetsListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      search: 'BAL-01',
      statusFilter: 'MAINTENANCE',
      customerId: 42,
    })

    expect(options.queryKey).toEqual([
      'assets',
      'org-1',
      2,
      20,
      'BAL-01',
      'MAINTENANCE',
      42,
    ])
  })

  it('derives list input from URL filters', () => {
    expect(
      assetsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/assets?page=3&query=BAL&status=ACTIVE&customerId=7',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      limit: 20,
      search: 'BAL',
      statusFilter: 'ACTIVE',
      customerId: 7,
    })
  })

  it('keys asset detail and audit reads by id', () => {
    expect(assetDetailQueryOptions('BAL-01').queryKey).toEqual([
      'asset',
      'BAL-01',
    ])
    expect(assetAuditLogQueryOptions('BAL-01').queryKey).toEqual([
      'asset',
      'BAL-01',
      'audit-log',
    ])
  })

  it('keys new asset form option reads', () => {
    expect(newAssetCustomersQueryOptions('acme').queryKey).toEqual([
      'customers',
      'search',
      'acme',
    ])
    expect(assetTypesQueryOptions().queryKey).toEqual(['asset-types'])
  })

  it('ignores invalid URL filters', () => {
    expect(
      assetsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/assets?page=-1&status=UNKNOWN&customerId=NaN',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 1,
      limit: 20,
      search: '',
      statusFilter: '',
      customerId: null,
    })
  })
})
