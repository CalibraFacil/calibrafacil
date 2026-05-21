import { describe, expect, it } from 'vitest'

import {
  assignableTrainingRecordsQueryOptions,
  competenceAuditLogQueryOptions,
  competenceDetailQueryOptions,
  competencesListQueryInputFromUrl,
  competencesListQueryOptions,
  competencesMatrixQueryOptions,
  newCompetenceMatrixQueryOptions,
} from './queries'

describe('personnel feature queries', () => {
  it('keys competence lists by organization and filters', () => {
    const options = competencesListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      statusFilter: 'ACTIVE',
    })

    expect(options.queryKey).toEqual(['competences', 'org-1', 2, 'ACTIVE'])
  })

  it('keys the competence matrix by organization', () => {
    expect(competencesMatrixQueryOptions('org-1').queryKey).toEqual([
      'competences-matrix',
      'org-1',
    ])
  })

  it('keeps the new competence matrix on the legacy route key', () => {
    expect(newCompetenceMatrixQueryOptions().queryKey).toEqual([
      'competences-matrix',
    ])
  })

  it('keys competence detail and audit reads by id', () => {
    expect(competenceDetailQueryOptions('42').queryKey).toEqual([
      'competence',
      '42',
    ])
    expect(competenceAuditLogQueryOptions('42').queryKey).toEqual([
      'competence-audit',
      '42',
    ])
  })

  it('keys assignable training records by user', () => {
    expect(assignableTrainingRecordsQueryOptions('user-1').queryKey).toEqual([
      'training-records',
      'assignable',
      'user-1',
    ])
  })

  it('derives list input from URL filters', () => {
    expect(
      competencesListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/personnel?page=3&status=SUSPENDED',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      limit: 20,
      statusFilter: 'SUSPENDED',
    })
  })

  it('ignores invalid URL filters', () => {
    expect(
      competencesListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/personnel?page=-2&status=UNKNOWN',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 1,
      limit: 20,
      statusFilter: '',
    })
  })
})
