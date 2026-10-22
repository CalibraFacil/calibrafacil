import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  desktopOfflineRoutes,
  isDesktopOfflineRoute,
  toRouteTo,
} from './desktop-offline-routes'

/**
 * REQ-OFF-1 / REQ-OFF-5: the desktop's offline route availability is derived
 * from the data-policy registry, new routes default to cloud-only, and the set
 * of offline routes is exactly the Q13 scope (field capture, intake, reference
 * reads).
 */

/** Every page route the router knows, read from the generated route tree. */
function listRouterTargets(): string[] {
  const source = readFileSync(
    new URL('../routeTree.gen.ts', import.meta.url),
    'utf8',
  )
  const start = source.indexOf('export interface FileRoutesByTo {')
  const end = source.indexOf('\n}\n', start)
  const block = source.slice(start, end)

  return [...block.matchAll(/^ {2}'([^']+)':/gm)].map((match) => match[1] ?? '')
}

const Q13_OFFLINE_ROUTES = [
  // field capture
  '/dashboard/jobs',
  '/dashboard/jobs/$id',
  '/dashboard/jobs/$id/execute',
  // intake
  '/dashboard/assets/new',
  '/dashboard/service-orders',
  '/dashboard/service-orders/new',
  '/dashboard/service-orders/$publicId',
  // reference reads
  '/dashboard/clients',
  '/dashboard/clients/$id/overview',
  '/dashboard/clients/$id/assets',
  '/dashboard/clients/$id/calibrations',
  '/dashboard/assets',
  '/dashboard/assets/$id',
  '/dashboard/standards',
  '/dashboard/standards/$id',
  '/dashboard/methods',
  '/dashboard/methods/$id',
  // the desktop's own sync machinery
  '/dashboard/sync/conflicts',
].sort()

afterEach(() => {
  vi.doUnmock('@calibra-facil/client-runtime')
  vi.resetModules()
})

describe('desktop offline route availability', () => {
  it('REQ-OFF-1: offers exactly the Q13 routes offline', () => {
    const offline = listRouterTargets()
      .filter((to) => isDesktopOfflineRoute(to))
      .sort()

    expect(offline).toEqual(Q13_OFFLINE_ROUTES)
  })

  it('REQ-OFF-1: every allowlisted route is a real route', () => {
    const targets = new Set(listRouterTargets())

    for (const route of desktopOfflineRoutes) {
      expect(targets.has(route.to), route.to).toBe(true)
    }
  })

  it('REQ-OFF-1: every router route resolves to an availability', () => {
    const targets = listRouterTargets()

    expect(targets.length).toBeGreaterThan(50)
    for (const to of targets) {
      expect(typeof isDesktopOfflineRoute(to), to).toBe('boolean')
    }
  })

  it.each([
    '/dashboard',
    '/dashboard/jobs/new',
    '/dashboard/assets/$id/edit',
    '/dashboard/clients/new',
    '/dashboard/clients/$id/info',
    '/dashboard/clients/$id/compliance',
    '/dashboard/methods/new',
    '/dashboard/methods/$id/edit',
    '/dashboard/standards/new',
    '/dashboard/standards/composition-profiles',
    '/dashboard/services',
    '/dashboard/materials',
    '/dashboard/nc',
    '/dashboard/nc/new',
    '/dashboard/capa',
    '/dashboard/requests',
    '/dashboard/visits',
    '/dashboard/proficiency-tests',
    '/dashboard/spc',
    '/dashboard/personnel',
    '/dashboard/reports',
    '/dashboard/finance',
    '/dashboard/finance/contracts',
    '/dashboard/settings/organization',
    '/dashboard/settings/signature',
  ])('REQ-OFF-1: %s is online-only on the desktop', (to) => {
    expect(isDesktopOfflineRoute(to)).toBe(false)
  })

  it('REQ-OFF-1: a route nobody classified defaults to cloud-only', () => {
    expect(isDesktopOfflineRoute('/dashboard/brand-new-page')).toBe(false)
    expect(isDesktopOfflineRoute('/dashboard/jobs/$id/something-new')).toBe(
      false,
    )
  })

  it('accepts TanStack index route ids, which end with a slash', () => {
    expect(toRouteTo('/dashboard/jobs/')).toBe('/dashboard/jobs')
    expect(toRouteTo('/dashboard/')).toBe('/dashboard')
    expect(isDesktopOfflineRoute('/dashboard/jobs/')).toBe(true)
    expect(isDesktopOfflineRoute('/dashboard/')).toBe(false)
  })

  it('REQ-OFF-1: derives availability from the registry, not from a second list', async () => {
    const real = await vi.importActual<
      typeof import('@calibra-facil/client-runtime')
    >('@calibra-facil/client-runtime')

    // The same registry, except customers.list is online-only.
    vi.doMock('@calibra-facil/client-runtime', () => ({
      ...real,
      listCalibraApiPolicyEntries: () =>
        real
          .listCalibraApiPolicyEntries()
          .map((entry) =>
            entry.namespace === 'customers' && entry.method === 'list'
              ? { ...entry, policy: 'cloud-only' as const }
              : entry,
          ),
    }))
    vi.resetModules()
    const reclassified = await import('./desktop-offline-routes')

    // Everything that needs customers.list goes with it ...
    expect(reclassified.isDesktopOfflineRoute('/dashboard/clients')).toBe(false)
    expect(reclassified.isDesktopOfflineRoute('/dashboard/assets/new')).toBe(
      false,
    )
    expect(
      reclassified.isDesktopOfflineRoute('/dashboard/service-orders/new'),
    ).toBe(false)
    // ... and nothing else does.
    expect(reclassified.isDesktopOfflineRoute('/dashboard/jobs')).toBe(true)
    expect(
      reclassified.isDesktopOfflineRoute('/dashboard/jobs/$id/execute'),
    ).toBe(true)
  })
})
