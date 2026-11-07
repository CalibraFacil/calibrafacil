import { QueryClient, queryOptions } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { routeData, routeLocationToUrl } from './route-data'

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

function optionsFor(key: string) {
  return queryOptions({
    queryKey: ['route-data-test', key],
    queryFn: async () => key,
  })
}

describe('routeData', () => {
  it('load and prewarm read one list: what the page waits for is what hover warms', async () => {
    const queries = vi.fn((id: string) => [
      optionsFor(`detail-${id}`),
      optionsFor(`audit-${id}`),
    ])
    const route = routeData(queries)

    const loaded = new QueryClient()
    await route.load(loaded, '7')
    const warmed = new QueryClient()
    await route.prewarm(warmed, '7')

    const keysOf = (client: QueryClient) =>
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey)
    expect(keysOf(loaded)).toEqual([
      ['route-data-test', 'detail-7'],
      ['route-data-test', 'audit-7'],
    ])
    expect(keysOf(warmed)).toEqual(keysOf(loaded))
    expect(queries).toHaveBeenCalledTimes(2)
    expect(queries).toHaveBeenCalledWith('7')
  })

  it('takes a list that is resolved later and skips the entries that are null', async () => {
    const route = routeData(async (organizationId?: string) => [
      organizationId ? optionsFor(`org-${organizationId}`) : null,
      undefined,
    ])
    const client = new QueryClient()

    await route.load(client, undefined)
    expect(client.getQueryCache().getAll()).toHaveLength(0)

    await route.load(client, 'a')
    expect(client.getQueryData(['route-data-test', 'org-a'])).toBe('org-a')
  })

  it('load rejects when a query fails, prewarm never does', async () => {
    const failing = queryOptions({
      queryKey: ['route-data-test', 'fails'],
      queryFn: async () => {
        throw new Error('boom')
      },
      retry: false,
    })
    const route = routeData(() => [failing])

    await expect(route.load(new QueryClient())).rejects.toThrow('boom')
    await expect(route.prewarm(new QueryClient())).resolves.toBeUndefined()
  })
})
