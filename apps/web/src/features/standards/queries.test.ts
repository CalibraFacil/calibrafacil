import { describe, expect, it } from 'vitest'

import {
  impactedCertificatesQueryOptions,
  standardAuditLogQueryOptions,
  standardDetailQueryOptions,
  standardRecallQueryOptions,
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

  it('keys the recall campaign by standard id', () => {
    expect(standardRecallQueryOptions('std-1').queryKey).toEqual([
      'standards',
      'std-1',
      'recall',
    ])
  })

  it('keys impacted certificates by standard id and review window', () => {
    expect(
      impactedCertificatesQueryOptions(
        'std-1',
        '2026-01-01T00:00:00.000Z',
        '2026-02-01T23:59:59.999Z',
      ).queryKey,
    ).toEqual([
      'standards',
      'std-1',
      'impacted-certificates',
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T23:59:59.999Z',
    ])
  })

  it('keys impacted certificates with empty strings for the default window', () => {
    expect(impactedCertificatesQueryOptions('std-1').queryKey).toEqual([
      'standards',
      'std-1',
      'impacted-certificates',
      '',
      '',
    ])
  })
})
