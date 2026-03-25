import { hc } from 'hono/client'
import type { AppType } from '@calibra-facil/api'

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
    }),
})
