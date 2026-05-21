import { describe, expect, it } from 'vitest'

import { openSyncConflictsQueryOptions } from './queries'

describe('sync feature queries', () => {
  it('uses a stable open conflicts key', () => {
    expect(openSyncConflictsQueryOptions().queryKey).toEqual([
      'desktop-sync-conflicts',
      'open',
    ])
  })
})
