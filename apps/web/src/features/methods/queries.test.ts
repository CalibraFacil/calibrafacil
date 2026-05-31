import { describe, expect, it } from 'vitest'

import {
  methodAuditLogQueryOptions,
  methodDetailQueryOptions,
  methodEditQueryOptions,
  methodsListQueryInputFromUrl,
  methodsListQueryOptions,
} from './queries'

describe('methods feature queries', () => {
  it('keys methods lists by organization and filters', () => {
    const options = methodsListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      search: 'Massa',
      statusFilter: 'PUBLISHED',
    })

    expect(options.queryKey).toEqual([
      'methods',
      'org-1',
      2,
      'Massa',
      'PUBLISHED',
    ])
  })

  it('derives list input from URL filters', () => {
    expect(
      methodsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/methods?page=3&query=Massa&status=TECHNICAL_REVIEWED',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      limit: 20,
      search: 'Massa',
      statusFilter: 'TECHNICAL_REVIEWED',
    })
  })

  it('keys method detail, edit, and audit reads by id', () => {
    expect(methodDetailQueryOptions('mass-v1').queryKey).toEqual([
      'methods',
      'mass-v1',
    ])
    expect(methodEditQueryOptions('mass-v1').queryKey).toEqual([
      'methods',
      'mass-v1',
    ])
    expect(methodAuditLogQueryOptions('mass-v1').queryKey).toEqual([
      'methods',
      'mass-v1',
      'audit',
    ])
  })

  it('ignores invalid URL filters', () => {
    expect(
      methodsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/methods?page=-2&status=UNKNOWN',
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
})
