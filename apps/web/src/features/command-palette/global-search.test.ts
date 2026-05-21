import { describe, expect, it } from 'vitest'

import {
  commandSearchAssetsQueryOptions,
  commandSearchClientsQueryOptions,
  commandSearchJobsQueryOptions,
  commandSearchStandardsQueryOptions,
  getSearchModeFromPage,
} from './global-search'

describe('command palette global search', () => {
  it('maps command pages to search modes', () => {
    expect(getSearchModeFromPage('search-assets')).toBe('assets')
    expect(getSearchModeFromPage('search-clients')).toBe('clients')
    expect(getSearchModeFromPage('search-standards')).toBe('standards')
    expect(getSearchModeFromPage('search-jobs')).toBe('jobs')
    expect(getSearchModeFromPage('root')).toBeNull()
  })

  it('uses stable search keys', () => {
    expect(commandSearchAssetsQueryOptions('abc').queryKey).toEqual([
      'command-search',
      'assets',
      'abc',
    ])
    expect(commandSearchClientsQueryOptions('abc').queryKey).toEqual([
      'command-search',
      'clients',
      'abc',
    ])
    expect(commandSearchStandardsQueryOptions('abc').queryKey).toEqual([
      'command-search',
      'standards',
      'abc',
    ])
    expect(commandSearchJobsQueryOptions('abc').queryKey).toEqual([
      'command-search',
      'jobs',
      'abc',
    ])
  })
})
