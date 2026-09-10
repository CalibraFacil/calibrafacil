import { describe, expect, it, vi } from 'vitest'
import type { LocalEnvironmentBootstrap } from '@calibra-facil/contracts'

import {
  createDesktopLocalFetch,
  createLocalApiEndpointResolver,
  type LocalEndpointBridge,
} from './local-api-endpoint'

const FALLBACK = 'http://127.0.0.1:4317'

function bootstrap(
  overrides: Partial<LocalEnvironmentBootstrap> = {},
): LocalEnvironmentBootstrap {
  return {
    appVersion: '0.0.4',
    localServerVersion: '0.0.4',
    deviceId: 'device-1',
    tenantId: null,
    organizationId: 'org-1',
    unitId: 1,
    userId: 'user-1',
    dbSchemaVersion: 19,
    syncEnabled: true,
    syncState: 'idle',
    httpBaseUrl: 'http://127.0.0.1:4319',
    localApiToken: 'token-run-1',
    ...overrides,
  }
}

function createClock(start = 0) {
  let value = start
  return {
    now: () => value,
    advance(ms: number) {
      value += ms
    },
  }
}

function createResolver(
  bridge: LocalEndpointBridge | null,
  options: { ttlMs?: number; now?: () => number } = {},
) {
  return createLocalApiEndpointResolver({
    bridge,
    fallbackBaseUrl: FALLBACK,
    ...options,
  })
}

describe('createLocalApiEndpointResolver', () => {
  it('discovers the port the local server actually bound to', async () => {
    // The manager scans forward when the default port is occupied, so the
    // renderer's hardcoded URL points at nothing.
    const resolver = createResolver({
      getLocalEnvironmentBootstrap: async () => bootstrap(),
    })

    await expect(resolver.resolve()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:4319',
      token: 'token-run-1',
    })
  })

  it('falls back before the host can answer', async () => {
    const resolver = createResolver(null)

    await expect(resolver.resolve()).resolves.toEqual({
      baseUrl: FALLBACK,
      token: null,
    })
  })

  it('does not cache a failure, so a late-starting server still works', async () => {
    // The bug this replaces: one lookup during boot cached `null` forever and
    // the local API never worked again until the window reloaded.
    const getLocalEnvironmentBootstrap = vi
      .fn<LocalEndpointBridge['getLocalEnvironmentBootstrap']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(bootstrap())
    const resolver = createResolver({ getLocalEnvironmentBootstrap })

    await expect(resolver.resolve()).resolves.toMatchObject({ token: null })
    await expect(resolver.resolve()).resolves.toMatchObject({
      token: 'token-run-1',
    })
  })

  it('does not cache a thrown lookup either', async () => {
    const getLocalEnvironmentBootstrap = vi
      .fn<LocalEndpointBridge['getLocalEnvironmentBootstrap']>()
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValueOnce(bootstrap())
    const resolver = createResolver({ getLocalEnvironmentBootstrap })

    await expect(resolver.resolve()).resolves.toMatchObject({
      baseUrl: FALLBACK,
    })
    await expect(resolver.resolve()).resolves.toMatchObject({
      baseUrl: 'http://127.0.0.1:4319',
    })
  })

  it('caches a success for the TTL and refreshes after it', async () => {
    const clock = createClock()
    const getLocalEnvironmentBootstrap = vi
      .fn<LocalEndpointBridge['getLocalEnvironmentBootstrap']>()
      .mockResolvedValueOnce(bootstrap())
      .mockResolvedValueOnce(bootstrap({ localApiToken: 'token-run-2' }))
    const resolver = createResolver(
      { getLocalEnvironmentBootstrap },
      { ttlMs: 1_000, now: clock.now },
    )

    await resolver.resolve()
    clock.advance(999)
    await resolver.resolve()
    expect(getLocalEnvironmentBootstrap).toHaveBeenCalledOnce()

    // A restarted server issues a new token; the TTL is what picks it up.
    clock.advance(2)
    await expect(resolver.resolve()).resolves.toMatchObject({
      token: 'token-run-2',
    })
  })

  it('collapses a burst of concurrent reads into one lookup', async () => {
    // A screen mounting a dozen local-first queries must not produce a dozen
    // IPC round trips.
    const getLocalEnvironmentBootstrap = vi
      .fn<LocalEndpointBridge['getLocalEnvironmentBootstrap']>()
      .mockResolvedValue(bootstrap())
    const resolver = createResolver({ getLocalEnvironmentBootstrap })

    await Promise.all(Array.from({ length: 12 }, () => resolver.resolve()))

    expect(getLocalEnvironmentBootstrap).toHaveBeenCalledOnce()
  })

  it('re-reads immediately after invalidation', async () => {
    const clock = createClock()
    const getLocalEnvironmentBootstrap = vi
      .fn<LocalEndpointBridge['getLocalEnvironmentBootstrap']>()
      .mockResolvedValueOnce(bootstrap())
      .mockResolvedValueOnce(bootstrap({ localApiToken: 'token-run-2' }))
    const resolver = createResolver(
      { getLocalEnvironmentBootstrap },
      { now: clock.now },
    )

    await resolver.resolve()
    resolver.invalidate()

    await expect(resolver.resolve()).resolves.toMatchObject({
      token: 'token-run-2',
    })
  })
})

describe('createDesktopLocalFetch', () => {
  function setup(
    responses: Response[],
    bridgeValues: Array<LocalEnvironmentBootstrap | null>,
  ) {
    const calls: string[] = []
    const queue = [...responses]
    const bridgeQueue = [...bridgeValues]
    const baseFetch = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        calls.push(input instanceof Request ? input.url : String(input))
        return queue.shift() ?? new Response(null, { status: 200 })
      },
    )
    const resolver = createResolver({
      getLocalEnvironmentBootstrap: async () =>
        bridgeQueue.shift() ?? bootstrap(),
    })

    return {
      calls,
      baseFetch,
      localFetch: createDesktopLocalFetch({ resolver, baseFetch }),
    }
  }

  it('sends the request to the discovered origin, not the stale one', async () => {
    const { calls, localFetch } = setup([], [bootstrap()])

    await localFetch(new URL('/api/jobs?page=1', FALLBACK))

    expect(calls).toEqual(['http://127.0.0.1:4319/api/jobs?page=1'])
  })

  it('preserves path, query and hash', async () => {
    const { calls, localFetch } = setup([], [bootstrap()])

    await localFetch(`${FALLBACK}/api/jobs/R-1%2F26?x=1#top`)

    expect(calls[0]).toBe('http://127.0.0.1:4319/api/jobs/R-1%2F26?x=1#top')
  })

  it('rewrites a Request rather than leaving it on the stale port', async () => {
    const { calls, localFetch } = setup([], [bootstrap()])

    await localFetch(
      new Request(`${FALLBACK}/api/customers`, { method: 'GET' }),
    )

    expect(calls).toEqual(['http://127.0.0.1:4319/api/customers'])
  })

  it('re-discovers and retries once when the token is rejected', async () => {
    // The desktop restarted the local server; this renderer is holding the
    // previous run's token.
    const { calls, localFetch } = setup(
      [
        new Response(null, { status: 401 }),
        new Response(null, { status: 200 }),
      ],
      [bootstrap(), bootstrap({ localApiToken: 'token-run-2' })],
    )

    const response = await localFetch(new URL('/api/jobs', FALLBACK))

    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('retries once and no more, so a genuine 401 still surfaces', () => {
    // The retry rewrites the Authorization header, so it is worth making even
    // when the resolver's token is unchanged — the *request* may have carried
    // a stale one. What must not happen is looping.
    return (async () => {
      const { calls, localFetch } = setup(
        [
          new Response(null, { status: 401 }),
          new Response(null, { status: 401 }),
        ],
        [bootstrap(), bootstrap()],
      )

      const response = await localFetch(new URL('/api/jobs', FALLBACK))

      expect(response.status).toBe(401)
      expect(calls).toHaveLength(2)
    })()
  })

  it('does not retry when discovery still has no token to offer', async () => {
    const { calls, localFetch } = setup(
      [new Response(null, { status: 401 })],
      [bootstrap({ localApiToken: null }), bootstrap({ localApiToken: null })],
    )

    const response = await localFetch(new URL('/api/jobs', FALLBACK))

    expect(response.status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it('sends the rediscovered token on the retry', async () => {
    // The caller built its header before this wrapper ran, so reusing `init`
    // would repeat the same rejected request.
    const { baseFetch, localFetch } = setup(
      [
        new Response(null, { status: 401 }),
        new Response(null, { status: 200 }),
      ],
      [bootstrap(), bootstrap({ localApiToken: 'token-run-2' })],
    )

    await localFetch(new URL('/api/jobs', FALLBACK), {
      headers: { Authorization: 'Bearer token-run-1' },
    })

    const retryInit = baseFetch.mock.calls[1]?.[1]
    const headers = new Headers(retryInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer token-run-2')
  })

  it('passes the request init through untouched', async () => {
    const { baseFetch, localFetch } = setup([], [bootstrap()])
    const init = { method: 'POST', body: '{"a":1}' }

    await localFetch(new URL('/api/customers', FALLBACK), init)

    expect(baseFetch).toHaveBeenCalledWith(expect.any(String), init)
  })
})
