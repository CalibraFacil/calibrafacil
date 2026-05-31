// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

type SessionResponse = {
  data?: {
    user?: {
      id?: string | null
    } | null
  } | null
}

async function loadDesktopAuth(options: {
  isDesktop?: boolean
  localSession?: () => Promise<SessionResponse>
  cloudSession?: () => Promise<SessionResponse>
}) {
  vi.resetModules()
  installMemoryLocalStorage()

  const getLocalSession = vi.fn(
    options.localSession ??
      (async () => ({ data: { user: { id: 'local-user' } } })),
  )
  const getCloudSession = vi.fn(
    options.cloudSession ??
      (async () => ({ data: { user: { id: 'cloud-user' } } })),
  )

  vi.doMock('@/runtime/desktop', () => ({
    isDesktopRuntime: () => options.isDesktop ?? true,
  }))
  vi.doMock('@/utils/api', () => ({
    calibraApi: {
      sync: {
        getSession: getLocalSession,
      },
    },
  }))
  vi.doMock('@calibra-facil/auth/client', () => ({
    authClient: {
      getSession: getCloudSession,
    },
  }))

  const module = await import('./desktop-auth')
  return { ...module, getLocalSession, getCloudSession }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function installMemoryLocalStorage() {
  const values = new Map<string, string>()
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    clear: vi.fn(() => {
      values.clear()
    }),
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

describe('desktop auth session checks', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
    window.localStorage?.clear?.()
  })

  it('deduplicates concurrent local session checks', async () => {
    const localSession = createDeferred<SessionResponse>()
    const { hasDesktopSession, getLocalSession, getCloudSession } =
      await loadDesktopAuth({
        localSession: () => localSession.promise,
      })

    const first = hasDesktopSession()
    const second = hasDesktopSession()

    expect(getLocalSession).toHaveBeenCalledTimes(1)

    localSession.resolve({ data: { user: { id: 'local-user' } } })

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(getLocalSession).toHaveBeenCalledTimes(1)
    expect(getCloudSession).not.toHaveBeenCalled()
  })

  it('reuses the local session snapshot inside the TTL window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-09T12:00:00.000Z'))

    const { hasDesktopSession, getLocalSession, getCloudSession } =
      await loadDesktopAuth({})

    await expect(hasDesktopSession()).resolves.toBe(true)
    await expect(hasDesktopSession()).resolves.toBe(true)

    expect(getLocalSession).toHaveBeenCalledTimes(1)
    expect(getCloudSession).not.toHaveBeenCalled()
  })

  it('refreshes the local session snapshot after the TTL expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-09T12:00:00.000Z'))

    const { hasDesktopSession, getLocalSession } = await loadDesktopAuth({})

    await expect(hasDesktopSession()).resolves.toBe(true)

    vi.advanceTimersByTime(10_001)

    await expect(hasDesktopSession()).resolves.toBe(true)
    expect(getLocalSession).toHaveBeenCalledTimes(2)
  })

  it('falls back to the cloud session when the local snapshot is unavailable', async () => {
    const { hasDesktopSession, getLocalSession, getCloudSession } =
      await loadDesktopAuth({
        localSession: async () => ({ data: null }),
      })

    await expect(hasDesktopSession()).resolves.toBe(true)

    expect(getLocalSession).toHaveBeenCalledTimes(1)
    expect(getCloudSession).toHaveBeenCalledTimes(1)
  })
})
