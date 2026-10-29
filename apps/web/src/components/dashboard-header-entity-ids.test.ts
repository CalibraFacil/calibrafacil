import { describe, expect, it } from 'vitest'

import { extractEntityIds } from './dashboard-header'

describe('extractEntityIds', () => {
  it('reads the entity id of a detail route and its sub-pages', () => {
    expect(extractEntityIds('/dashboard/clients/c-1')).toEqual({
      customerId: 'c-1',
    })
    expect(extractEntityIds('/dashboard/clients/c-1/assets')).toEqual({
      customerId: 'c-1',
    })
    expect(extractEntityIds('/dashboard/jobs/42/execute')).toEqual({
      jobId: '42',
    })
  })

  it('does not take a static child route for an id', () => {
    for (const pathname of [
      '/dashboard/clients/groups',
      '/dashboard/clients/groups/g-1/overview',
      '/dashboard/clients/new',
      '/dashboard/methods/from-template',
      '/dashboard/standards/composition-profiles',
      '/dashboard/assets/new',
    ]) {
      expect(extractEntityIds(pathname)).toEqual({})
    }
  })

  it('ignores sections without entity crumbs and non-dashboard paths', () => {
    expect(extractEntityIds('/dashboard/settings/members')).toEqual({})
    expect(extractEntityIds('/dashboard')).toEqual({})
    expect(extractEntityIds('/sign-in')).toEqual({})
  })
})
