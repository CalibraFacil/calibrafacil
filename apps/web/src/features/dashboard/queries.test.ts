import { describe, expect, it } from 'vitest'

import { dashboardStatsQueryOptions } from './queries'

describe('dashboard feature queries', () => {
  it('uses a stable stats key scoped by organization', () => {
    expect(dashboardStatsQueryOptions('org-1').queryKey).toEqual([
      'dashboard',
      'stats',
      'org-1',
    ])
  })
})
