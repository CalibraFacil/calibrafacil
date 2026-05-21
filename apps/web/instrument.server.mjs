import * as Sentry from '@sentry/tanstackstart-react'

const SENTRY_DSN =
  process.env.VITE_SENTRY_DSN ??
  'https://examplePublicKey@o0.ingest.sentry.io/0'

Sentry.init({
  dsn: SENTRY_DSN,
  sendDefaultPii: process.env.VITE_SENTRY_SEND_DEFAULT_PII === 'true',
  tracesSampleRate: 1.0,
})
