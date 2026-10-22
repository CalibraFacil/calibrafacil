import { describe, expect, it } from 'vitest'

import {
  deadSyncEventsQueryOptions,
  openSyncConflictsQueryOptions,
} from './queries'

describe('sync feature queries', () => {
  it('uses a stable open conflicts key', () => {
    expect(openSyncConflictsQueryOptions().queryKey).toEqual([
      'desktop-sync-conflicts',
      'open',
    ])
  })

  it('REQ-OB-3: uses a stable refused-events key', () => {
    expect(deadSyncEventsQueryOptions().queryKey).toEqual([
      'desktop-sync-dead-events',
    ])
  })
})
