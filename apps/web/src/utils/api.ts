import {
  createCloudApiClient,
  createDesktopHybridApiClient,
  isDesktopRuntime,
} from '@calibra-facil/client-runtime'
import { resolveApiBaseUrl } from '@calibra-facil/shared/api-base-url'
import {
  createDesktopLocalFetch,
  createLocalApiEndpointResolver,
} from '@/runtime/local-api-endpoint'
import {
  assertDesktopRequestBodyWithinLimit,
  encodeDesktopRequestBody,
} from '@/runtime/desktop-request-body'
import {
  getDefaultCloudApiUrl,
  getDefaultDesktopLocalApiUrl,
} from '@/app/config/runtime'
import { getStoredDashboardActiveUnitId } from '@/features/dashboard/dashboard-scope-storage'

export function getApiBaseURL(): string {
  return getCloudApiBaseUrl()
}

export function getLocalApiBaseURL(): string {
  if (isDesktopRuntime()) {
    return import.meta.env.VITE_LOCAL_API_URL ?? getDefaultDesktopLocalApiUrl()
  }

  return getCloudApiBaseUrl()
}

function getCloudApiBaseUrl(): string {
  if (isDesktopRuntime()) {
    return import.meta.env.VITE_DESKTOP_AUTH_API_URL || getDefaultCloudApiUrl()
  }

  return resolveApiBaseUrl({
    configuredUrl: import.meta.env.VITE_API_URL,
    fallbackUrl: getDefaultCloudApiUrl(),
  })
}

export function resolveCloudApiUrl(): string
export function resolveCloudApiUrl(pathOrUrl: string): string
export function resolveCloudApiUrl(pathOrUrl?: string): string {
  const baseUrl = getCloudApiBaseUrl()

  if (!pathOrUrl) {
    return baseUrl
  }

  if (/^https?:\/\//.test(pathOrUrl)) {
    return pathOrUrl
  }

  return new URL(pathOrUrl, baseUrl).toString()
}

/**
 * Endpoint discovery for the local server. Both the port and the bootstrap
 * token change between runs, so neither may be resolved once and trusted for
 * the life of the window — see `local-api-endpoint.ts`.
 */
const localApiEndpointResolver = createLocalApiEndpointResolver({
  bridge: typeof window === 'undefined' ? null : (window.calibraBridge ?? null),
  fallbackBaseUrl: getLocalApiBaseURL(),
})

const desktopLocalFetch = createDesktopLocalFetch({
  resolver: localApiEndpointResolver,
})

export async function getDesktopLocalApiToken() {
  if (typeof window === 'undefined' || !window.calibraBridge) {
    return null
  }

  return (await localApiEndpointResolver.resolve()).token
}

/**
 * API responses are checked against their `@calibra-facil/contracts` schemas.
 * A mismatch throws in development and tests (drift fails where it is
 * introduced) and only logs a structured warning in production, so a contract
 * slip never takes the UI down. `VITE_RESPONSE_VALIDATION=warn` opts a dev
 * server into the production behavior. The mocked-API Playwright run does not:
 * its fixtures are contract-valid (`@calibra-facil/contracts/jobs-fixtures`).
 */
const RESPONSE_VALIDATION =
  import.meta.env.PROD || import.meta.env.VITE_RESPONSE_VALIDATION === 'warn'
    ? 'warn'
    : 'strict'

const calibraClient = isDesktopRuntime()
  ? createDesktopHybridApiClient({
      cloud: {
        baseUrl: getCloudApiBaseUrl(),
        activeUnitProvider: getStoredDashboardActiveUnitId,
        fetch: desktopCloudFetch,
        responseValidation: RESPONSE_VALIDATION,
      },
      local: {
        // A starting point only. The real origin is discovered from the host
        // and applied by `desktopLocalFetch`, because the local server picks a
        // different port whenever the default one is taken.
        baseUrl: getLocalApiBaseURL(),
        tokenProvider: getDesktopLocalApiToken,
        fetch: desktopLocalFetch,
      },
    })
  : createCloudApiClient({
      baseUrl: getCloudApiBaseUrl(),
      activeUnitProvider: getStoredDashboardActiveUnitId,
      responseValidation: RESPONSE_VALIDATION,
    })

export const calibraApi = calibraClient

async function desktopCloudFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!isDesktopRuntime() || !window.calibraBridge?.authFetch) {
    return fetch(input, init)
  }

  const request = new Request(input, init)
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : await encodeDesktopCloudRequestBody(request)
  const response = await window.calibraBridge.authFetch({
    url: request.url,
    method: request.method,
    headers: [...request.headers.entries()],
    body,
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function encodeDesktopCloudRequestBody(request: Request) {
  if (request.body === null) {
    return null
  }

  // Checked *before* buffering wherever the size is already known. Reading the
  // body first and validating afterwards defeats the guard entirely: a large
  // enough upload exhausts the renderer during `arrayBuffer()`, long before
  // any length check could run.
  assertDesktopRequestBodyWithinLimit(declaredRequestBodyBytes(request))

  return {
    encoding: 'base64' as const,
    data: encodeDesktopRequestBody(await request.clone().arrayBuffer()),
  }
}

/**
 * The body size the request already knows, without consuming it.
 *
 * `Content-Length` covers what `fetch` set from a Blob, File or string body —
 * which is every upload path in this app. Returns null for a streamed body of
 * unknown length, where there is nothing to check up front.
 */
function declaredRequestBodyBytes(request: Request): number | null {
  const header = request.headers.get('content-length')
  if (!header) return null

  const parsed = Number(header)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
