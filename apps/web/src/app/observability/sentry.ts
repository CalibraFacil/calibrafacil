import {
  getSentryDsn,
  shouldEnableSentryReplay,
  shouldEnableTelemetry,
  shouldSendSentryPii,
} from '@/app/config/runtime'
import { isDesktopRuntime } from '@/runtime/desktop'

type SentryModule = typeof import('@sentry/react')

let sentryReady: Promise<SentryModule | null> | null = null

async function loadAndInitialize(): Promise<SentryModule | null> {
  // The desktop shell never initializes browser Sentry (see CLAUDE.md).
  if (
    typeof window === 'undefined' ||
    !shouldEnableTelemetry() ||
    isDesktopRuntime()
  ) {
    return null
  }

  const dsn = getSentryDsn()
  if (!dsn) return null

  const Sentry = await import('@sentry/react')
  const replayEnabled = shouldEnableSentryReplay(window.location.pathname)

  Sentry.init({
    dsn,
    sendDefaultPii: shouldSendSentryPii(),
    integrations: replayEnabled
      ? [Sentry.browserTracingIntegration(), Sentry.replayIntegration()]
      : [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: replayEnabled ? 0.1 : 0,
    replaysOnErrorSampleRate: replayEnabled ? 1.0 : 0,
  })

  return Sentry
}

/**
 * Loads and initializes Sentry once. Resolves to `null` (and does nothing)
 * on desktop, outside production, or without a DSN.
 */
export function initializeSentry(): Promise<SentryModule | null> {
  sentryReady ??= loadAndInitialize()
  return sentryReady
}

/**
 * Sends a route render/loader crash to Sentry. Initializes Sentry first when
 * the idle-scheduled init has not run yet, so an early crash is not lost.
 */
export async function reportRouteError(
  error: unknown,
  info: { componentStack?: string | null },
): Promise<void> {
  // Checked on every report, not only at init: desktop must never reach Sentry.
  if (isDesktopRuntime()) return

  const Sentry = await initializeSentry()
  if (!Sentry) return

  Sentry.captureException(error, {
    contexts: info.componentStack
      ? { react: { componentStack: info.componentStack } }
      : undefined,
  })
}
