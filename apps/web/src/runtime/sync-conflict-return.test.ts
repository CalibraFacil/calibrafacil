import { describe, expect, it } from 'vitest'

import {
  getSyncConflictReturnSearch,
  parseSyncConflictReturnSearch,
  shouldReturnToSyncConflicts,
} from './sync-conflict-return'

describe('sync conflict return search', () => {
  it('builds route search for conflict edit links', () => {
    expect(getSyncConflictReturnSearch('conflict:asset:1')).toEqual({
      syncConflictId: 'conflict:asset:1',
      returnTo: '/dashboard/sync/conflicts',
    })
  })

  it('parses only the supported return route', () => {
    expect(
      parseSyncConflictReturnSearch({
        syncConflictId: 'conflict:customer:1',
        returnTo: '/dashboard/sync/conflicts',
      }),
    ).toEqual({
      syncConflictId: 'conflict:customer:1',
      returnTo: '/dashboard/sync/conflicts',
    })

    expect(
      parseSyncConflictReturnSearch({
        syncConflictId: 'conflict:customer:1',
        returnTo: '/dashboard',
      }),
    ).toEqual({
      syncConflictId: 'conflict:customer:1',
      returnTo: undefined,
    })
  })

  it('requires both conflict id and return route before redirecting back', () => {
    expect(
      shouldReturnToSyncConflicts({
        syncConflictId: 'conflict:job:1',
        returnTo: '/dashboard/sync/conflicts',
      }),
    ).toBe(true)
    expect(
      shouldReturnToSyncConflicts({
        syncConflictId: 'conflict:job:1',
      }),
    ).toBe(false)
  })
})
