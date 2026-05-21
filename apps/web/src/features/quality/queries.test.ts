import { describe, expect, it } from 'vitest'

import {
  capaAuditLogQueryOptions,
  capaDetailQueryOptions,
  capaListInputFromUrl,
  capaListQueryOptions,
  capaResponsibleMembersQueryOptions,
  nonConformanceAuditLogQueryOptions,
  nonConformanceDetailQueryOptions,
  nonConformanceJobsQueryOptions,
  nonConformanceListInputFromUrl,
  nonConformanceListQueryOptions,
} from './queries'

describe('quality feature queries', () => {
  it('keys non-conformance lists by organization and filters', () => {
    const options = nonConformanceListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      search: 'NC-001',
      statusFilter: 'under_review',
      typeFilter: 'equipment',
    })

    expect(options.queryKey).toEqual([
      'non-conformances',
      'org-1',
      2,
      'NC-001',
      'under_review',
      'equipment',
    ])
  })

  it('keys CAPA lists by organization and filters', () => {
    const options = capaListQueryOptions({
      organizationId: 'org-1',
      page: 3,
      search: 'CAPA-002',
      statusFilter: 'IMPLEMENTATION',
      severityFilter: 'major',
      categoryFilter: 'method',
    })

    expect(options.queryKey).toEqual([
      'capas',
      'org-1',
      3,
      'CAPA-002',
      'IMPLEMENTATION',
      'major',
      'method',
    ])
  })

  it('derives non-conformance list input from URL filters', () => {
    expect(
      nonConformanceListInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/nc?page=4&query=NC&status=open&type=work',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 4,
      search: 'NC',
      statusFilter: 'open',
      typeFilter: 'work',
    })
  })

  it('keys non-conformance detail, audit, and new form reads', () => {
    expect(nonConformanceDetailQueryOptions('12').queryKey).toEqual([
      'non-conformance',
      '12',
    ])
    expect(nonConformanceAuditLogQueryOptions('12').queryKey).toEqual([
      'non-conformance-audit',
      '12',
    ])
    expect(nonConformanceJobsQueryOptions().queryKey).toEqual(['jobs-for-nc'])
  })

  it('ignores invalid non-conformance URL filters', () => {
    expect(
      nonConformanceListInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/nc?page=-1&status=INVALID&type=INVALID',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 1,
      search: '',
      statusFilter: '',
      typeFilter: '',
    })
  })

  it('derives CAPA list input from URL filters', () => {
    expect(
      capaListInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/capa?page=5&query=CAPA&status=CLOSED&severity=critical&category=procedure',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 5,
      search: 'CAPA',
      statusFilter: 'CLOSED',
      severityFilter: 'critical',
      categoryFilter: 'procedure',
    })
  })

  it('keys CAPA detail, audit, and responsible-member reads', () => {
    expect(capaDetailQueryOptions('21').queryKey).toEqual(['capa', '21'])
    expect(capaAuditLogQueryOptions('21').queryKey).toEqual([
      'capa-audit-log',
      '21',
    ])
    expect(capaResponsibleMembersQueryOptions().queryKey).toEqual([
      'jobs',
      'technicians',
    ])
  })

  it('ignores invalid CAPA URL filters', () => {
    expect(
      capaListInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/capa?status=INVALID&severity=INVALID&category=INVALID',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 1,
      search: '',
      statusFilter: '',
      severityFilter: '',
      categoryFilter: '',
    })
  })
})
