import { describe, expect, it } from 'vitest'

import { routeLocationToUrl } from './route-data'

describe('route data helpers', () => {
  it('converts TanStack route locations into URL objects for filter-aware loaders', () => {
    const url = routeLocationToUrl({
      href: '/dashboard/jobs?page=3&query=CAL&status=REVIEW',
    })

    expect(url.pathname).toBe('/dashboard/jobs')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('query')).toBe('CAL')
    expect(url.searchParams.get('status')).toBe('REVIEW')
  })
})
