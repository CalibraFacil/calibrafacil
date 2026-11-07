import { describe, expect, it } from 'vitest'

import {
  dashboardRoutes,
  getDashboardRedirectTarget,
  getDashboardRouteTitle,
  getSettingsNavGroups,
  listDashboardRouteIds,
  matchRoutePath,
  routeHead,
  toRouteTo,
} from './route-registry'

describe('dashboard route registry', () => {
  describe('titles', () => {
    it('serves a crumb for a route id, index or not', () => {
      expect(getDashboardRouteTitle('/dashboard/')).toBe('Painel de Controle')
      expect(getDashboardRouteTitle('/dashboard/jobs/')).toBe('Calibrações')
      expect(getDashboardRouteTitle('/dashboard/jobs/$id')).toBe('Calibração')
    })

    it('has no crumb for a route that only redirects, or one it does not know', () => {
      expect(getDashboardRouteTitle('/dashboard/settings/branding')).toBe(
        undefined,
      )
      expect(getDashboardRouteTitle('/dashboard/finance/receipts')).toBe(
        undefined,
      )
      expect(getDashboardRouteTitle('/dashboard/not-a-page')).toBe(undefined)
    })

    it('writes the tab title as "<title> | CalibraFácil"', () => {
      expect(routeHead('/dashboard/visits').meta).toEqual([
        { title: 'Visitas | CalibraFácil' },
      ])
    })

    it('lets a route word its tab differently from its crumb', () => {
      expect(getDashboardRouteTitle('/dashboard/assets/$id')).toBe('Ativo')
      expect(routeHead('/dashboard/assets/$id').meta[0]).toEqual({
        title: 'Detalhes do Ativo | CalibraFácil',
      })
    })

    it('adds the section a page belongs to between title and brand', () => {
      expect(routeHead('/dashboard/settings/profile').meta[0]).toEqual({
        title: 'Perfil | Configurações | CalibraFácil',
      })
    })

    it('keeps the extra meta a route asks for', () => {
      const head = routeHead('/dashboard/settings', [
        { name: 'description', content: 'About settings' },
      ])
      expect(head.meta).toEqual([
        { title: 'Configurações | CalibraFácil' },
        { name: 'description', content: 'About settings' },
      ])
    })

    it('says the same thing in the sidebar, the crumb and the tab for settings pages', () => {
      const items = getSettingsNavGroups().flatMap((group) => group.items)
      const portal = items.find(
        (item) => item.to === '/dashboard/settings/portal-domain',
      )
      expect(portal?.label).toBe('Domínio do portal')
      expect(getDashboardRouteTitle('/dashboard/settings/portal-domain')).toBe(
        'Domínio do portal',
      )
      expect(routeHead('/dashboard/settings/portal-domain').meta[0]).toEqual({
        title: 'Domínio do portal | Configurações | CalibraFácil',
      })
    })
  })

  describe('redirects', () => {
    it('names where a legacy route sends the user', () => {
      expect(getDashboardRedirectTarget('/dashboard/settings/branding')).toBe(
        '/dashboard/settings/portal-domain',
      )
      expect(getDashboardRedirectTarget('/dashboard/finance/receipts')).toBe(
        '/dashboard/finance/receivables',
      )
      expect(getDashboardRedirectTarget('/dashboard/finance/documents')).toBe(
        '/dashboard/finance/receivables',
      )
    })

    it('never sends the user to another redirect', () => {
      const chained = Object.entries(dashboardRoutes).flatMap(([from, def]) => {
        if (!('redirectTo' in def)) return []
        const target: object = dashboardRoutes[def.redirectTo]
        return 'redirectTo' in target ? [from] : []
      })

      expect(chained).toEqual([])
    })
  })

  describe('settings sidebar', () => {
    it('gives every page a unique key', () => {
      const values = getSettingsNavGroups().flatMap((group) =>
        group.items.map((item) => item.value),
      )
      expect(new Set(values).size).toBe(values.length)
    })
  })

  describe('matching a pathname to a route', () => {
    const patterns = listDashboardRouteIds()

    it('matches a static route, with or without a trailing slash', () => {
      expect(matchRoutePath('/dashboard/jobs', patterns)?.pattern).toBe(
        '/dashboard/jobs',
      )
      expect(matchRoutePath('/dashboard/jobs/', patterns)?.pattern).toBe(
        '/dashboard/jobs',
      )
      expect(matchRoutePath('/dashboard', patterns)?.pattern).toBe('/dashboard')
    })

    it('reads the params of a dynamic route, decoded', () => {
      expect(
        matchRoutePath('/dashboard/clients/a%20b/assets', patterns),
      ).toEqual({
        pattern: '/dashboard/clients/$id/assets',
        params: { id: 'a b' },
      })
      expect(
        matchRoutePath('/dashboard/service-orders/OS-1', patterns)?.params,
      ).toEqual({ publicId: 'OS-1' })
    })

    it('prefers a static page to a dynamic one that would also fit', () => {
      expect(matchRoutePath('/dashboard/clients/new', patterns)?.pattern).toBe(
        '/dashboard/clients/new',
      )
      expect(
        matchRoutePath('/dashboard/clients/groups', patterns)?.pattern,
      ).toBe('/dashboard/clients/groups')
      expect(
        matchRoutePath('/dashboard/methods/from-template', patterns)?.pattern,
      ).toBe('/dashboard/methods/from-template')
    })

    it('matches nothing for a path the router would not render', () => {
      expect(matchRoutePath('/dashboard/jobs/1/2/3', patterns)).toBeNull()
      expect(matchRoutePath('/elsewhere', patterns)).toBeNull()
    })

    it('does not throw on a malformed escape', () => {
      expect(
        matchRoutePath('/dashboard/jobs/%E0%A4%A', patterns)?.params,
      ).toEqual({ id: '%E0%A4%A' })
    })
  })

  it('turns a TanStack index route id into a `to`', () => {
    expect(toRouteTo('/dashboard/jobs/')).toBe('/dashboard/jobs')
    expect(toRouteTo('/dashboard/')).toBe('/dashboard')
    expect(toRouteTo('/dashboard/jobs/$id')).toBe('/dashboard/jobs/$id')
  })
})
