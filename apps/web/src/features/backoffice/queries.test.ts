import { describe, expect, it } from 'vitest'

import {
  backofficeAccessQueryOptions,
  backofficeCommercialContextQueryOptions,
  backofficeCommercialOrganizationsQueryOptions,
  backofficeOrganizationDetailQueryOptions,
  backofficeOrganizationOptionsQueryOptions,
  backofficeOrganizationsQueryOptions,
  backofficeSupportQueueQueryOptions,
  backofficeUsersQueryOptions,
} from './queries'

describe('backoffice feature queries', () => {
  it('keys access checks by scope', () => {
    expect(backofficeAccessQueryOptions('layout').queryKey).toEqual([
      'backoffice',
      'access',
      'layout',
      'route',
    ])
    expect(
      backofficeAccessQueryOptions('layout', 'session-1').queryKey,
    ).toEqual(['backoffice', 'access', 'layout', 'session-1'])
  })

  it('keys organization queries by use case', () => {
    expect(backofficeOrganizationsQueryOptions('list').queryKey).toEqual([
      'backoffice',
      'organizations',
    ])
    expect(backofficeOrganizationsQueryOptions('summary').queryKey).toEqual([
      'backoffice',
      'organizations',
      'summary',
    ])
    expect(backofficeOrganizationOptionsQueryOptions().queryKey).toEqual([
      'backoffice',
      'organizations',
      'options',
    ])
    expect(backofficeOrganizationDetailQueryOptions('org-1').queryKey).toEqual([
      'backoffice',
      'organizations',
      'org-1',
    ])
  })

  it('keys support queues by use case', () => {
    expect(backofficeSupportQueueQueryOptions('list').queryKey).toEqual([
      'backoffice',
      'support',
      'queue',
    ])
    expect(backofficeSupportQueueQueryOptions('summary').queryKey).toEqual([
      'backoffice',
      'support',
      'queue',
      'summary',
    ])
  })

  it('keys users by normalized filter object', () => {
    expect(
      backofficeUsersQueryOptions({
        search: 'ana',
        organizationId: 'org-1',
        platformRole: 'platform_admin',
        membershipScope: 'lab_members',
      }).queryKey,
    ).toEqual([
      'backoffice',
      'users',
      {
        search: 'ana',
        organizationId: 'org-1',
        platformRole: 'platform_admin',
        membershipScope: 'lab_members',
      },
    ])
  })

  it('keys commercial checkout context by search and organization', () => {
    expect(
      backofficeCommercialOrganizationsQueryOptions('lab').queryKey,
    ).toEqual(['backoffice', 'commercial', 'organizations', 'lab'])
    expect(backofficeCommercialContextQueryOptions('org-1').queryKey).toEqual([
      'backoffice',
      'commercial',
      'context',
      'org-1',
    ])
  })
})
