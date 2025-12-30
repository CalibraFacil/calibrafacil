import * as Sentry from '@sentry/tanstackstart-react'

Sentry.init({
    dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
    sendDefaultPii: true,
    tracesSampleRate: 1.0,
})
