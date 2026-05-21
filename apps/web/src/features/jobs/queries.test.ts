import { describe, expect, it } from 'vitest'

import {
  activeReferenceStandardsQueryOptions,
  effectiveEnvironmentalLimitsQueryOptions,
  jobCertificateDownloadUrlQueryOptions,
  jobDetailQueryOptions,
  jobTechniciansQueryOptions,
  jobsListQueryInputFromUrl,
  jobsListQueryOptions,
  newJobCustomerAssetsQueryOptions,
  newJobCustomersQueryOptions,
  newJobServicesQueryOptions,
} from './queries'

describe('jobs feature queries', () => {
  it('keys jobs lists by organization and filters', () => {
    const options = jobsListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      search: 'CAL-001',
      statusFilter: 'APPROVED',
    })

    expect(options.queryKey).toEqual([
      'jobs',
      'org-1',
      2,
      'CAL-001',
      'APPROVED',
    ])
  })

  it('derives jobs list input from URL filters', () => {
    expect(
      jobsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/jobs?page=3&query=CAL&status=REVIEW',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      search: 'CAL',
      statusFilter: 'REVIEW',
    })
  })

  it('ignores invalid URL status values', () => {
    expect(
      jobsListQueryInputFromUrl(
        'org-1',
        new URL('https://app.example.test/dashboard/jobs?status=INVALID'),
      ).statusFilter,
    ).toBe('')
  })

  it('keys job detail and shared option reads', () => {
    expect(jobDetailQueryOptions({ id: 'CAL-001' }).queryKey).toEqual([
      'jobs',
      'CAL-001',
    ])
    expect(jobTechniciansQueryOptions().queryKey).toEqual([
      'jobs',
      'technicians',
    ])
    expect(activeReferenceStandardsQueryOptions().queryKey).toEqual([
      'standards',
      'active',
    ])
  })

  it('keys new job dependent form reads', () => {
    expect(newJobCustomersQueryOptions('acme').queryKey).toEqual([
      'customers',
      'search',
      'acme',
    ])
    expect(newJobCustomerAssetsQueryOptions(42).queryKey).toEqual([
      'assets',
      'customer',
      42,
    ])
    expect(newJobServicesQueryOptions(7).queryKey).toEqual([
      'services',
      'for-job',
      7,
    ])
  })

  it('keys effective environmental limits by asset type and unit', () => {
    expect(
      effectiveEnvironmentalLimitsQueryOptions({
        assetTypeId: 7,
        unitId: 3,
      }).queryKey,
    ).toEqual(['environmental-limits', 'effective', 7, 3])
  })

  it('keys job certificate download urls by job and current certificate url', () => {
    expect(
      jobCertificateDownloadUrlQueryOptions({
        jobId: 17,
        certificateUrl: '/certificates/17.pdf',
      }).queryKey,
    ).toEqual(['jobs', 17, 'certificate-download-url', '/certificates/17.pdf'])
  })
})
