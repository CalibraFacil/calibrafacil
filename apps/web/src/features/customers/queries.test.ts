import { describe, expect, it } from 'vitest'

import {
  customerAssetsQueryOptions,
  customerAuditLogQueryOptions,
  customerDetailQueryOptions,
  customerInvitationsQueryOptions,
  customerJobsQueryOptions,
  customerMembersQueryOptions,
  customersListQueryInputFromUrl,
  customersListQueryOptions,
} from './queries'

describe('customers feature queries', () => {
  it('keys customers lists by organization, pagination, and search', () => {
    const options = customersListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      search: 'Acme',
    })

    expect(options.queryKey).toEqual(['customers', 'org-1', 2, 20, 'Acme'])
  })

  it('derives list input from URL filters', () => {
    expect(
      customersListQueryInputFromUrl(
        'org-1',
        new URL('https://app.example.test/dashboard/clients?page=3&query=Acme'),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      limit: 20,
      search: 'Acme',
    })
  })

  it('ignores invalid URL page values', () => {
    expect(
      customersListQueryInputFromUrl(
        'org-1',
        new URL('https://app.example.test/dashboard/clients?page=-5'),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 1,
      limit: 20,
      search: '',
    })
  })

  it('keys customer detail tabs by customer identity and filters', () => {
    expect(customerDetailQueryOptions('42').queryKey).toEqual([
      'customer',
      '42',
    ])
    expect(
      customerAssetsQueryOptions({
        customerId: 42,
        page: 2,
        limit: 20,
        search: 'balanca',
      }).queryKey,
    ).toEqual(['assets', 'customer', 42, 2, 20, 'balanca'])
    expect(
      customerJobsQueryOptions({
        customerId: 42,
        page: 3,
        limit: 20,
        search: 'CAL-1',
        statusFilter: 'APPROVED',
      }).queryKey,
    ).toEqual(['jobs', 'customer', 42, 3, 'CAL-1', 'APPROVED'])
  })

  it('keys customer audit and portal queries by route id', () => {
    expect(customerAuditLogQueryOptions('42').queryKey).toEqual([
      'customer-audit-log',
      '42',
    ])
    expect(customerMembersQueryOptions('42').queryKey).toEqual([
      'customer-members',
      '42',
    ])
    expect(customerInvitationsQueryOptions('42').queryKey).toEqual([
      'customer-invitations',
      '42',
    ])
  })
})
