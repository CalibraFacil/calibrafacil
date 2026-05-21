import { describe, expect, it } from 'vitest'

import {
  recentNotificationsQueryOptions,
  unreadNotificationsQueryOptions,
} from './queries'

describe('notifications feature queries', () => {
  it('uses stable notification keys scoped by organization', () => {
    expect(unreadNotificationsQueryOptions('org-1').queryKey).toEqual([
      'notifications',
      'org-1',
      'unread-count',
    ])
    expect(recentNotificationsQueryOptions('org-1').queryKey).toEqual([
      'notifications',
      'org-1',
      'recent',
    ])
  })
})
