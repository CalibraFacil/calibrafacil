// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

type SessionData = {
  user: { role: string }
  session: { impersonatedBy?: string | null }
}

async function loadDashboardSession(options: {
  isDesktop?: boolean
  hasDesktopSession?: boolean
  session?: SessionData | null
  sessions?: Array<SessionData | null>
}) {
  vi.resetModules()

  const redirect = vi.fn((input: unknown) => ({ redirect: input }))
  const sessions = [...(options.sessions ?? [])]
  const getSession = vi.fn(async () => ({
    data: sessions.length > 0 ? sessions.shift() : (options.session ?? null),
  }))
  const hasDesktopSession = vi.fn(async () => options.hasDesktopSession ?? true)

  vi.doMock('@tanstack/react-router', () => ({ redirect }))
  vi.doMock('@calibra-facil/auth/client', () => ({
    authClient: { getSession },
  }))
  vi.doMock('@/runtime/desktop-auth', () => ({ hasDesktopSession }))
  vi.doMock('@/runtime/desktop', () => ({
    isDesktopRuntime: () => options.isDesktop ?? false,
  }))

  const locationReplace = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace: locationReplace },
  })

  const module = await import('./dashboard-session')
  return { ...module, redirect, getSession, hasDesktopSession, locationReplace }
}

describe('dashboard session guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('skips auth checks for route preloads', async () => {
    const { dashboardBeforeLoad, getSession, hasDesktopSession } =
      await loadDashboardSession({ session: labSession() })

    await expect(
      dashboardBeforeLoad({
        location: { pathname: '/dashboard/jobs' },
        preload: true,
      }),
    ).resolves.toBeUndefined()
    expect(getSession).not.toHaveBeenCalled()
    expect(hasDesktopSession).not.toHaveBeenCalled()
  })

  it('redirects desktop users without a local session to sign-in', async () => {
    const { dashboardBeforeLoad } = await loadDashboardSession({
      isDesktop: true,
      hasDesktopSession: false,
    })

    await expect(
      dashboardBeforeLoad({ location: { pathname: '/dashboard/jobs' } }),
    ).rejects.toEqual({
      redirect: {
        to: '/sign-in',
        search: { redirect: '/dashboard/jobs' },
      },
    })
  })

  it('redirects web users without a session to sign-in', async () => {
    const { dashboardBeforeLoad } = await loadDashboardSession({
      session: null,
    })

    await expect(
      dashboardBeforeLoad({ location: { pathname: '/dashboard/assets' } }),
    ).rejects.toEqual({
      redirect: {
        to: '/sign-in',
        search: { redirect: '/dashboard/assets' },
      },
    })
  })

  it('allows web users after one transient missing session', async () => {
    const { dashboardBeforeLoad, getSession } = await loadDashboardSession({
      sessions: [null, labSession()],
    })

    await expect(
      dashboardBeforeLoad({ location: { pathname: '/dashboard/assets' } }),
    ).resolves.toBeUndefined()
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('keeps platform-role users in the dashboard', async () => {
    const { dashboardBeforeLoad, locationReplace } = await loadDashboardSession(
      {
        session: labSession({ role: 'ADMIN' }),
      },
    )

    await expect(
      dashboardBeforeLoad({ location: { pathname: '/dashboard' } }),
    ).resolves.toBeUndefined()
    expect(locationReplace).not.toHaveBeenCalled()
  })

  describe('portal handoff (/dashboard?organization=<id>)', () => {
    afterEach(() => {
      window.localStorage.clear()
    })

    it('stores the laboratory the portal named and drops the param', async () => {
      const { dashboardBeforeLoad } = await loadDashboardSession({
        session: labSession(),
      })

      await expect(
        dashboardBeforeLoad({
          location: {
            pathname: '/dashboard',
            searchStr: '?organization=lab-7',
          },
        }),
      ).rejects.toEqual({ redirect: { to: '/dashboard', replace: true } })
      expect(window.localStorage.getItem('dashboard-active-org')).toBe('lab-7')
    })

    it('carries the param through sign-in when there is no session yet', async () => {
      const { dashboardBeforeLoad } = await loadDashboardSession({
        session: null,
      })

      await expect(
        dashboardBeforeLoad({
          location: {
            pathname: '/dashboard',
            searchStr: '?organization=lab-7',
          },
        }),
      ).rejects.toEqual({
        redirect: {
          to: '/sign-in',
          search: { redirect: '/dashboard?organization=lab-7' },
        },
      })
      expect(window.localStorage.getItem('dashboard-active-org')).toBeNull()
    })

    it('ignores the param off the dashboard home', async () => {
      const { dashboardBeforeLoad } = await loadDashboardSession({
        session: labSession(),
      })

      await expect(
        dashboardBeforeLoad({
          location: {
            pathname: '/dashboard/jobs',
            searchStr: '?organization=lab-7',
          },
        }),
      ).resolves.toBeUndefined()
      expect(window.localStorage.getItem('dashboard-active-org')).toBeNull()
    })
  })
})

function labSession(
  overrides: { role?: string; impersonatedBy?: string | null } = {},
): SessionData {
  return {
    user: { role: overrides.role ?? 'USER' },
    session: { impersonatedBy: overrides.impersonatedBy ?? null },
  }
}
