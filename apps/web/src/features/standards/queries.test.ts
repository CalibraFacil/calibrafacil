import { describe, expect, it } from 'vitest'

import {
  standardAuditLogQueryOptions,
  standardDetailQueryOptions,
  standardsListQueryInputFromUrl,
  standardsListQueryOptions,
} from './queries'

describe('standards feature queries', () => {
  it('keys standards lists by organization and filters', () => {
    const options = standardsListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      search: 'M1',
      statusFilter: 'SENT_FOR_CALIBRATION',
    })

    expect(options.queryKey).toEqual([
      'standards',
      'org-1',
      2,
      'M1',
      'SENT_FOR_CALIBRATION',
    ])
  })

  it('derives list input from URL filters', () => {
    expect(
      standardsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/standards?page=4&query=M1&status=OUT_OF_TOLERANCE',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 4,
      limit: 20,
      search: 'M1',
      statusFilter: 'OUT_OF_TOLERANCE',
    })
  })

  it('ignores invalid URL filters', () => {
    expect(
      standardsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/standards?page=0&status=UNKNOWN',
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

  it('keys standard detail and audit log by id', () => {
    expect(standardDetailQueryOptions('std-1').queryKey).toEqual([
      'standards',
      'std-1',
    ])
    expect(standardAuditLogQueryOptions('std-1').queryKey).toEqual([
      'standards',
      'std-1',
      'audit-log',
    ])
  })
})
