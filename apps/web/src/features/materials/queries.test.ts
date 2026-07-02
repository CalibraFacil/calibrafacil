import { describe, expect, it } from 'vitest'

import {
  materialDetailQueryOptions,
  materialsListQueryInputFromUrl,
  materialsListQueryOptions,
} from './queries'

describe('materials feature queries', () => {
  it('keys materials lists by organization and filters (REQ-MATUI-001)', () => {
    const options = materialsListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      search: 'Sensor',
      statusFilter: 'active',
    })

    expect(options.queryKey).toEqual([
      'materials',
      'org-1',
      2,
      'Sensor',
      'active',
    ])
  })

  it('derives list input from URL filters (REQ-MATUI-001)', () => {
    expect(
      materialsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/materials?page=3&query=Sensor&status=inactive',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      limit: 20,
      search: 'Sensor',
      statusFilter: 'inactive',
    })
  })

  it('ignores invalid URL filters', () => {
    expect(
      materialsListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/materials?page=-2&status=UNKNOWN',
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

  it('keys material detail queries (REQ-MATUI-003)', () => {
    expect(materialDetailQueryOptions('mat-1').queryKey).toEqual([
      'materials',
      'mat-1',
    ])
  })
})
