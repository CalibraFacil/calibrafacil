import {
  createBrowserHistory,
  createHashHistory,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { isDesktopRuntime } from './runtime/desktop'
import { routeBoundaryOptions } from './app/router/route-boundaries'

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

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
