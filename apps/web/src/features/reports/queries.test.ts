import { describe, expect, it } from 'vitest'

import {
  comparisonReportQueryOptions,
  defaultReportsQueryInput,
  executiveReportQueryOptions,
  trendReportQueryOptions,
} from './queries'

describe('reports feature queries', () => {
  it('keys report reads by organization, period, and unit scope', () => {
    const input = {
      organizationId: 'org-1',
      period: '90d' as const,
      unitIds: '1,3',
    }

    expect(executiveReportQueryOptions(input).queryKey).toEqual([
      'reports',
      'executive-overview',
      'org-1',
      '90d',
      '1,3',
    ])
    expect(comparisonReportQueryOptions(input).queryKey).toEqual([
      'reports',
      'comparison',
      'org-1',
      '90d',
      '1,3',
    ])
    expect(trendReportQueryOptions(input).queryKey).toEqual([
      'reports',
      'trend',
      'org-1',
      '90d',
      '1,3',
    ])
  })

  it('uses default cache sentinels for missing organization and all units', () => {
    expect(
      executiveReportQueryOptions(defaultReportsQueryInput(null)).queryKey,
    ).toEqual(['reports', 'executive-overview', 'no-org', '30d', 'all'])
  })
})
