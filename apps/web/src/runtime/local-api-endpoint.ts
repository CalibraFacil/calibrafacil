import type { LocalEnvironmentBootstrap } from '@calibra-facil/contracts'

/**
 * Where the local server actually is, and the token that gets in.
 *
 * Both were previously answered once and then trusted forever, which broke two
 * ordinary situations:
 *
 * - **The port is not fixed.** `LocalServerManager` scans forward from the
 *   default when it is occupied — a second instance, a leftover process, a dev
 *   server — so the renderer's hardcoded URL points at nothing. Every
 *   local-first read and every queued write fails, silently, for the whole
 *   session.
 * - **The token is per run.** The local server generates a fresh bootstrap
 *   token each time it starts, so any restart (crash, update, manual retry)
 *   invalidated the one the renderer had memoized. Worse, a lookup that failed
 *   because the server had not finished booting cached `null` *permanently*,
 *   so the local API never worked again until the window reloaded.
 *
 * The bootstrap is therefore cached with a short TTL, never cached when it
 * fails, and invalidated outright when the server rejects the token.
 */

export type LocalEndpointBridge = {
  getLocalEnvironmentBootstrap(): Promise<LocalEnvironmentBootstrap | null>
}

export type LocalApiEndpoint = {
  baseUrl: string
  token: string | null
}

export type LocalApiEndpointResolver = {
  resolve(): Promise<LocalApiEndpoint>
  /** Drop the cache now — the server answered 401, or restarted. */
  invalidate(): void
}

/**
 * Short enough that a restarted server is picked up almost immediately,
 * long enough that a screen issuing a dozen local reads pays for one lookup.
 * The lookup itself is an IPC hop plus a loopback request, so this is about
 * avoiding noise rather than avoiding cost.
 */
const DEFAULT_TTL_MS = 10_000

export function createLocalApiEndpointResolver({
  bridge,
  fallbackBaseUrl,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
}: {
  bridge: LocalEndpointBridge | null | undefined
  /** Used until the host answers, and whenever it cannot. */
  fallbackBaseUrl: string
  ttlMs?: number
  now?: () => number
}): LocalApiEndpointResolver {
  let cached: { endpoint: LocalApiEndpoint; expiresAt: number } | null = null
  let inFlight: Promise<LocalApiEndpoint> | null = null

  function invalidate() {
    cached = null
  }

  async function load(): Promise<LocalApiEndpoint> {
    const fallback: LocalApiEndpoint = {
      baseUrl: fallbackBaseUrl,
      token: null,
    }

    if (!bridge) return fallback

    try {
      const bootstrap = await bridge.getLocalEnvironmentBootstrap()
      // No bootstrap yet means the server is still starting. Returning the
      // fallback *without caching* is what lets the next call succeed.
      if (!bootstrap?.httpBaseUrl) return fallback

      const endpoint: LocalApiEndpoint = {
        baseUrl: bootstrap.httpBaseUrl,
        token: bootstrap.localApiToken ?? null,
      }
      cached = { endpoint, expiresAt: now() + ttlMs }

      return endpoint
    } catch {
      return fallback
    }
  }

  return {
    invalidate,
    async resolve() {
      if (cached && now() < cached.expiresAt) return cached.endpoint

      // Collapse a burst of concurrent reads into one lookup.
      inFlight ??= load().finally(() => {
        inFlight = null
      })

      return inFlight
    },
  }
}

/**
 * Rewrites every local-API request onto the currently discovered origin, and
 * retries once when the server rejects the token.
 *
 * A wrapper rather than a `baseUrl` provider in `client-runtime`: the local
 * adapter builds its URLs against `options.baseUrl` in sixty-odd places, and
 * intercepting the single fetch it funnels them through is both smaller and
 * harder to get partially wrong.
 */
export function createDesktopLocalFetch({
  resolver,
  baseFetch = fetch,
}: {
  resolver: LocalApiEndpointResolver
  baseFetch?: typeof fetch
}): typeof fetch {
  return async (input, init) => {
    const endpoint = await resolver.resolve()
    const response = await baseFetch(
      rewriteOrigin(input, endpoint.baseUrl),
      init,
    )

    // A rejected token means this renderer is holding one from a previous run
    // of the local server. Re-discover and try again — once, so a genuinely
    // unauthorized request still surfaces.
    if (response.status !== 401) return response

    resolver.invalidate()
    const refreshed = await resolver.resolve()
    if (!refreshed.token) return response

    // The caller built its `Authorization` header before this wrapper ran, so
    // it still carries the stale token — or none at all, when discovery had
    // not yet succeeded. Retrying with the original `init` would repeat the
    // same rejected request; the header has to be rewritten here.
    return baseFetch(rewriteOrigin(input, refreshed.baseUrl), {
      ...init,
      headers: withBearerToken(init?.headers, refreshed.token),
    })
  }
}

function withBearerToken(source: HeadersInit | undefined, token: string) {
  const headers = new Headers(source)
  headers.set('Authorization', `Bearer ${token}`)

  return headers
}

/**
 * Keeps the path, query and hash; replaces the origin. A `Request` is rebuilt
 * rather than passed through, so a caller that uses one is not silently left
 * pointing at the stale port.
 */
function rewriteOrigin(
  input: RequestInfo | URL,
  baseUrl: string,
): RequestInfo | URL {
  if (input instanceof Request) {
    return new Request(rewriteUrlString(input.url, baseUrl), input)
  }

  const asString = input instanceof URL ? input.toString() : input
  return rewriteUrlString(asString, baseUrl)
}

function rewriteUrlString(value: string, baseUrl: string) {
  try {
    const url = new URL(value)
    return new URL(
      `${url.pathname}${url.search}${url.hash}`,
      baseUrl,
    ).toString()
  } catch {
    // A relative path has no origin to replace; resolve it against the base.
    return new URL(value, baseUrl).toString()
  }
}
