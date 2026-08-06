import {
  createCloudApiClient,
  createDesktopHybridApiClient,
  createRawCloudClient,
  isDesktopRuntime,
} from '@calibra-facil/client-runtime'
import type {
  AppType,
  LocalEnvironmentBootstrap,
} from '@calibra-facil/contracts'
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

export function getCloudApiBaseUrl(): string {
  if (isDesktopRuntime()) {
    return import.meta.env.VITE_DESKTOP_AUTH_API_URL ?? getDefaultCloudApiUrl()
  }

  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      return `http://${host}:3000`
    }

    if (
      /^dev-(portal|web|api)\.calibrafacil\.com$/.test(host) ||
      host === 'devbox.example.ts.net'
    ) {
      return window.location.origin
    }

    return getDefaultCloudApiUrl()
  }

  return getDefaultCloudApiUrl()
}

export const getApiBaseUrl = getCloudApiBaseUrl

export function resolveApiURL(): string
export function resolveApiURL(pathOrUrl: string): string
export function resolveApiURL(pathOrUrl?: string): string {
  return pathOrUrl === undefined
    ? resolveCloudApiUrl()
    : resolveCloudApiUrl(pathOrUrl)
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

export const resolveApiUrl = resolveCloudApiUrl

export function authenticatedCloudFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers)
  const activeUnitId = getStoredDashboardActiveUnitId()

  if (activeUnitId) {
    headers.set('x-active-unit-id', activeUnitId)
  }

  return desktopCloudFetch(resolveApiFetchInput(input), {
    ...init,
    credentials: 'include',
    headers,
  })
}

export const calibraFetch = authenticatedCloudFetch
export const apiFetch = authenticatedCloudFetch

export const rawCloudClient = createRawCloudClient<AppType>({
  baseUrl: getCloudApiBaseUrl(),
  activeUnitProvider: getStoredDashboardActiveUnitId,
  fetch: desktopCloudFetch,
})

export const api = rawCloudClient

export const calibraClient = isDesktopRuntime()
  ? createDesktopHybridApiClient({
      cloud: {
        baseUrl: getCloudApiBaseUrl(),
        activeUnitProvider: getStoredDashboardActiveUnitId,
        fetch: desktopCloudFetch,
      },
      local: {
        baseUrl: getLocalApiBaseURL(),
        tokenProvider: getDesktopLocalApiToken,
      },
    })
  : createCloudApiClient({
      baseUrl: getCloudApiBaseUrl(),
      activeUnitProvider: getStoredDashboardActiveUnitId,
    })

export const calibraApi = calibraClient

let desktopLocalApiTokenPromise: Promise<string | null> | null = null

export function getDesktopLocalApiToken() {
  if (typeof window === 'undefined' || !window.calibraBridge) {
    return null
  }

  desktopLocalApiTokenPromise ??= window.calibraBridge
    .getLocalEnvironmentBootstrap()
    .then(
      (bootstrap: LocalEnvironmentBootstrap | null) =>
        bootstrap?.localApiToken ?? null,
    )
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

  return resolveCloudApiUrl(input)
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
