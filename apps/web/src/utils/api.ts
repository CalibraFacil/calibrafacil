import {
  createCloudApiClient,
  createDesktopHybridApiClient,
  createRawCloudClient,
  isDesktopRuntime,
} from '@calibra-facil/client-runtime'
import type { AppType } from '@calibra-facil/api'

const DASHBOARD_UNIT_KEY_PREFIX = 'dashboard-active-unit:'
const DEFAULT_DESKTOP_LOCAL_API_URL = 'http://127.0.0.1:4317'
const DEFAULT_CLOUD_API_URL = 'https://api.calibrafacil.com'

function getStoredActiveUnitId(): string | null {
  if (typeof window === 'undefined') return null

  const activeOrgId = window.localStorage.getItem('dashboard-active-org')
  if (!activeOrgId) return null

  return window.localStorage.getItem(
    `${DASHBOARD_UNIT_KEY_PREFIX}${activeOrgId}`,
  )
}

export function getApiBaseURL(): string {
  return getCloudApiBaseURL()
}

function getLocalApiBaseURL(): string {
  if (isDesktopRuntime()) {
    return import.meta.env.VITE_LOCAL_API_URL ?? DEFAULT_DESKTOP_LOCAL_API_URL
  }

  return getCloudApiBaseURL()
}

function getCloudApiBaseURL(): string {
  if (isDesktopRuntime()) {
    return import.meta.env.VITE_DESKTOP_AUTH_API_URL ?? DEFAULT_CLOUD_API_URL
  }

  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      return `http://${host}:3000`
    }

    return DEFAULT_CLOUD_API_URL
  }

  return DEFAULT_CLOUD_API_URL
}

export function resolveApiURL(): string
export function resolveApiURL(pathOrUrl: string): string
export function resolveApiURL(pathOrUrl?: string): string {
  const baseUrl = getApiBaseURL()

  if (!pathOrUrl) {
    return baseUrl
  }

  if (/^https?:\/\//.test(pathOrUrl)) {
    return pathOrUrl
  }

  return new URL(pathOrUrl, baseUrl).toString()
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  const activeUnitId = getStoredActiveUnitId()

  if (activeUnitId) {
    headers.set('x-active-unit-id', activeUnitId)
  }

  return desktopCloudFetch(resolveApiFetchInput(input), {
    ...init,
    credentials: 'include',
    headers,
  })
}

export const api = createRawCloudClient<AppType>({
  baseUrl: getCloudApiBaseURL(),
  activeUnitProvider: getStoredActiveUnitId,
  fetch: desktopCloudFetch,
})

export const calibraApi = isDesktopRuntime()
  ? createDesktopHybridApiClient({
      cloud: {
        baseUrl: getCloudApiBaseURL(),
        activeUnitProvider: getStoredActiveUnitId,
        fetch: desktopCloudFetch,
      },
      local: {
        baseUrl: getLocalApiBaseURL(),
        tokenProvider: getDesktopLocalApiToken,
      },
    })
  : createCloudApiClient({
      baseUrl: getCloudApiBaseURL(),
      activeUnitProvider: getStoredActiveUnitId,
    })

let desktopLocalApiTokenPromise: Promise<string | null> | null = null

function getDesktopLocalApiToken() {
  if (typeof window === 'undefined' || !window.calibraBridge) {
    return null
  }

  desktopLocalApiTokenPromise ??= window.calibraBridge
    .getLocalEnvironmentBootstrap()
    .then((bootstrap) => bootstrap?.localApiToken ?? null)
    .catch(() => null)

  return desktopLocalApiTokenPromise
}

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

function resolveApiFetchInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== 'string' || /^https?:\/\//.test(input)) {
    return input
  }

  return resolveApiURL(input)
}

async function encodeDesktopCloudRequestBody(request: Request) {
  if (request.body === null) {
    return null
  }

  return {
    encoding: 'base64' as const,
    data: arrayBufferToBase64(await request.clone().arrayBuffer()),
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}
