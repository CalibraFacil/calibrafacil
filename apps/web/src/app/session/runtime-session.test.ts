import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadRuntimeSession(options: {
  isDesktop: boolean
  hasDesktopSession?: boolean
  cloudSessions?: Array<{ user: { id: string } } | null>
}) {
  vi.resetModules()

  const cloudSessions = [...(options.cloudSessions ?? [])]
  const getClientSession = vi.fn(async () => ({
    data: cloudSessions.length > 0 ? cloudSessions.shift() : null,
  }))
  const hasDesktopSession = vi.fn(async () => options.hasDesktopSession ?? true)

  vi.doMock('@/lib/auth-session', () => ({ getClientSession }))
  vi.doMock('@/runtime/desktop-auth', () => ({ hasDesktopSession }))
  vi.doMock('@/runtime/desktop', () => ({
    isDesktopRuntime: () => options.isDesktop,
  }))

  const module = await import('./runtime-session')
  return { ...module, getClientSession, hasDesktopSession }
}

describe('hasRuntimeSession', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('asks only the desktop session on the desktop', async () => {
    const present = await loadRuntimeSession({
      isDesktop: true,
      hasDesktopSession: true,
    })
    await expect(present.hasRuntimeSession()).resolves.toBe(true)
    expect(present.getClientSession).not.toHaveBeenCalled()

    const absent = await loadRuntimeSession({
      isDesktop: true,
      hasDesktopSession: false,
    })
    await expect(absent.hasRuntimeSession()).resolves.toBe(false)
  })

  it('reads the cloud session on the web app, and not the desktop one', async () => {
    const { hasRuntimeSession, hasDesktopSession } = await loadRuntimeSession({
      isDesktop: false,
      cloudSessions: [{ user: { id: 'u1' } }],
    })

    await expect(hasRuntimeSession()).resolves.toBe(true)
    expect(hasDesktopSession).not.toHaveBeenCalled()
  })

  it('does not read one transient missing cloud session as a sign-out', async () => {
    const { hasRuntimeSession, getClientSession } = await loadRuntimeSession({
      isDesktop: false,
      cloudSessions: [null, { user: { id: 'u1' } }],
    })

    await expect(hasRuntimeSession()).resolves.toBe(true)
    expect(getClientSession).toHaveBeenCalledTimes(2)
  })

  it('is false when the cloud has no session', async () => {
    const { hasRuntimeSession } = await loadRuntimeSession({ isDesktop: false })

    await expect(hasRuntimeSession()).resolves.toBe(false)
  })
})
