import { describe, expect, it } from 'vitest'

import {
  calibrationRequestDetailQueryOptions,
  calibrationRequestsListQueryInputFromUrl,
  calibrationRequestsListQueryOptions,
  requestConversionServicesQueryOptions,
  requestTechniciansQueryOptions,
} from './queries'

describe('requests feature queries', () => {
  it('keys calibration request lists by organization and filters', () => {
    const options = calibrationRequestsListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      search: 'urgente',
      statusFilter: 'UNDER_REVIEW',
    })

    expect(options.queryKey).toEqual([
      'calibration-requests',
      'org-1',
      2,
      'urgente',
      'UNDER_REVIEW',
    ])
  })

  it('derives list input from URL filters', () => {
    expect(
      calibrationRequestsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/requests?page=3&query=balanca&status=APPROVED',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      limit: 20,
      search: 'balanca',
      statusFilter: 'APPROVED',
    })
  })

  it('ignores invalid URL filters', () => {
    expect(
      calibrationRequestsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/requests?page=-2&status=UNKNOWN',
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

  it('keys request detail dependencies by organization', () => {
    expect(calibrationRequestDetailQueryOptions('org-1', 10).queryKey).toEqual([
      'calibration-request',
      'org-1',
      '10',
    ])
    expect(requestConversionServicesQueryOptions('org-1').queryKey).toEqual([
      'services',
      'org-1',
      'request-conversion',
    ])
    expect(requestTechniciansQueryOptions('org-1').queryKey).toEqual([
      'jobs',
      'org-1',
      'technicians',
    ])
  })
})
