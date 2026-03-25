import { hc } from 'hono/client'
import type { AppType } from '@calibra-facil/api'

const DASHBOARD_UNIT_KEY_PREFIX = 'dashboard-active-unit:'

function getStoredActiveUnitId(): string | null {
  if (typeof window === 'undefined') return null

  const activeOrgId = window.localStorage.getItem('dashboard-active-org')
  if (!activeOrgId) return null

  return window.localStorage.getItem(`${DASHBOARD_UNIT_KEY_PREFIX}${activeOrgId}`)
}

function getApiBaseURL(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      return `https://${host}:3000`
    }

    return 'https://api.calibrafacil.com'
  }

  return 'https://api.calibrafacil.com'
}

export const api = hc<AppType>(getApiBaseURL(), {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.headers ?? {}),
        ...(getStoredActiveUnitId()
          ? { 'x-active-unit-id': getStoredActiveUnitId() as string }
          : {}),
      },
    }),
})
