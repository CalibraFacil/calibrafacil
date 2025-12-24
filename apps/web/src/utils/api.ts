import { hc } from 'hono/client'
import type { AppType } from '@calibra-facil/api'

function getApiBaseURL(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  // In browser, use the same hostname with port 3000
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    return `https://${host}:3000`
  }
  return 'https://localhost:3000'
}

export const api = hc<AppType>(getApiBaseURL(), {
  fetch: (input, init) =>
    fetch(input, {
      ...init,
    credentials: 'include',
    }),
})
