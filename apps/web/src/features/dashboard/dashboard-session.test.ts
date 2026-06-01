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
  vi.doMock('@calibra-facil/auth/access', () => ({
    canAccessBackoffice: (role: string) => role === 'ADMIN',
  }))
  vi.doMock('@calibra-facil/auth/client', () => ({
    authClient: { getSession },
  }))
  vi.doMock('@/runtime/desktop-auth', () => ({ hasDesktopSession }))
  vi.doMock('@/runtime/desktop', () => ({
    isDesktopRuntime: () => options.isDesktop ?? false,
  }))
  vi.doMock('@/app/config/runtime', () => ({
    getBackofficeAppUrl: () => 'https://ops.test',
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

  it('redirects non-impersonated backoffice users to the backoffice app', async () => {
    const { dashboardBeforeLoad, locationReplace } = await loadDashboardSession(
      {
        session: labSession({ role: 'ADMIN' }),
      },
    )

    // beforeLoad intentionally never resolves after firing the cross-origin
    // redirect (it blocks so the lab route never mounts), so we don't await it;
    // poll until the redirect fires instead of awaiting the (never-settling) call.
    void dashboardBeforeLoad({ location: { pathname: '/dashboard' } })

    await vi.waitFor(() =>
      expect(locationReplace).toHaveBeenCalledWith('https://ops.test'),
    )
  })

  it('allows impersonated backoffice users to stay in the dashboard', async () => {
    const { dashboardBeforeLoad } = await loadDashboardSession({
      session: labSession({ role: 'ADMIN', impersonatedBy: 'owner-1' }),
    })

    await expect(
      dashboardBeforeLoad({ location: { pathname: '/dashboard' } }),
    ).resolves.toBeUndefined()
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
