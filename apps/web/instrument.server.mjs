import * as Sentry from '@sentry/tanstackstart-react'

// Error tracking is opt-in: nothing is reported unless VITE_SENTRY_DSN is set.
const SENTRY_DSN = process.env.VITE_SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: process.env.VITE_SENTRY_SEND_DEFAULT_PII === 'true',
    tracesSampleRate: 1.0,
  })
}
