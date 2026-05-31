import {
  createBrowserHistory,
  createHashHistory,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { isDesktopRuntime } from './runtime/desktop'
import {
  getSentryDsn,
  shouldEnableSentryReplay,
  shouldEnableTelemetry,
  shouldSendSentryPii,
} from './app/config/runtime'

function scheduleIdle(callback: () => void) {
  if (typeof window === 'undefined') return

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout: 2000 })
    return
  }

  globalThis.setTimeout(callback, 0)
}

async function initializeSentry() {
  if (
    typeof window === 'undefined' ||
    !shouldEnableTelemetry() ||
    isDesktopRuntime()
  ) {
    return
  }

  const dsn = getSentryDsn()
  if (!dsn) return

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
}

export const getRouter = () => {
  const isDesktop = isDesktopRuntime()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 5000, // 5 minutes
      },
    },
  })

  const router = createRouter({
    routeTree,
    history: isDesktop ? createHashHistory() : createBrowserHistory(),
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadDelay: 80,
    defaultPreloadStaleTime: 0,
    context: {
      queryClient,
      runtime: {
        isDesktop,
      },
    },
  })

  scheduleIdle(() => {
    void initializeSentry()
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
