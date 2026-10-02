export const DASHBOARD_ORG_KEY = 'dashboard-active-org'
export const DASHBOARD_UNIT_KEY_PREFIX = 'dashboard-active-unit:'

const DEFAULT_LOCAL_API_URL = 'http://localhost:3000'
const DEFAULT_DESKTOP_LOCAL_API_URL = 'http://127.0.0.1:4317'
const DEFAULT_DEVELOPMENT_PORTAL_PORT = '5174'

const SENTRY_REPLAY_ENABLED_PREFIXES = [
  '/dashboard',
  '/sign-in',
  '/accept-invitation',
] as const

function isLocalHostname(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  )
}

// The cloud API the desktop shell (and non-browser callers) talk to. Builds for
// a real deployment set VITE_API_URL; the fallback is the local dev API.
export function getDefaultCloudApiUrl() {
  return import.meta.env.VITE_API_URL?.trim() || DEFAULT_LOCAL_API_URL
}

export function getDefaultDesktopLocalApiUrl() {
  return DEFAULT_DESKTOP_LOCAL_API_URL
}

export function getPortalBaseUrl() {
  const configuredPortalUrl = import.meta.env.VITE_PORTAL_APP_URL?.trim()
  if (configuredPortalUrl) {
    return configuredPortalUrl.replace(/\/+$/, '')
  }

  if (typeof window === 'undefined') {
    return `http://localhost:${DEFAULT_DEVELOPMENT_PORTAL_PORT}`
  }

  const { hostname, protocol } = window.location

  if (isLocalHostname(hostname)) {
    return `${protocol}//${hostname}:${DEFAULT_DEVELOPMENT_PORTAL_PORT}`
  }

  // Convention when VITE_PORTAL_APP_URL is unset: the portal lives on the
  // "portal." subdomain of the lab app's domain.
  return `${protocol}//portal.${hostname.replace(/^www\./, '')}`
}

export function getSentryDsn() {
  return import.meta.env.VITE_SENTRY_DSN || null
}

export function shouldEnableTelemetry() {
  return import.meta.env.PROD
}

export function shouldSendSentryPii() {
  return import.meta.env.VITE_SENTRY_SEND_DEFAULT_PII === 'true'
}

export function shouldEnableSentryReplay(pathname: string) {
  return (
    import.meta.env.VITE_SENTRY_REPLAY_ENABLED === 'true' &&
    SENTRY_REPLAY_ENABLED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  )
}
