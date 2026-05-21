export const DASHBOARD_ORG_KEY = 'dashboard-active-org'
export const DASHBOARD_UNIT_KEY_PREFIX = 'dashboard-active-unit:'

const DEFAULT_CLOUD_API_URL = 'https://api.calibrafacil.com'
const DEFAULT_DESKTOP_LOCAL_API_URL = 'http://127.0.0.1:4317'
const DEFAULT_PRODUCTION_PORTAL_URL = 'https://portal.calibrafacil.com'
const DEFAULT_DEVELOPMENT_PORTAL_PORT = '5174'
const SENTRY_DSN =
  'https://examplePublicKey@o0.ingest.sentry.io/0'

const SENTRY_REPLAY_ENABLED_PREFIXES = [
  '/dashboard',
  '/sign-in',
  '/sign-up',
  '/accept-invitation',
] as const

export function getDefaultCloudApiUrl() {
  return DEFAULT_CLOUD_API_URL
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
    return DEFAULT_PRODUCTION_PORTAL_URL
  }

  const { hostname, protocol } = window.location
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)

  if (isLocalHost) {
    return `${protocol}//${hostname}:${DEFAULT_DEVELOPMENT_PORTAL_PORT}`
  }

  return DEFAULT_PRODUCTION_PORTAL_URL
}

export function getSentryDsn() {
  return import.meta.env.VITE_SENTRY_DSN || SENTRY_DSN || null
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
