import {
  createBrowserHistory,
  createHashHistory,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { isDesktopRuntime } from './runtime/desktop'
import { initializeSentry } from './app/observability/sentry'
import { routeBoundaryOptions } from './app/router/route-boundaries'

function scheduleIdle(callback: () => void) {
  if (typeof window === 'undefined') return

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout: 2000 })
    return
  }

  globalThis.setTimeout(callback, 0)
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
    ...routeBoundaryOptions,
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
