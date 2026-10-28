import {
  createBrowserHistory,
  createHashHistory,
  createRouter,
} from '@tanstack/react-router'
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { routeTree } from './routeTree.gen'
import { isDesktopRuntime } from './runtime/desktop'
import { routeBoundaryOptions } from './app/router/route-boundaries'
import {
  createSessionExpiryHandler,
  shouldRetryQuery,
} from './app/session-expiry'

const SESSION_EXPIRED_TOAST_ID = 'session-expired'

export const getRouter = () => {
  const isDesktop = isDesktopRuntime()
  // Roadmap 2 F4: an expired cloud session is one notice with a way back in,
  // not a generic error on whichever screen asked first. The router is created
  // below; the handler only runs after a request, so it is set by then.
  let goToSignIn: (redirect: string) => void = () => {}
  const onSessionExpired = isDesktop
    ? () => {}
    : createSessionExpiryHandler({
        currentLocation: () =>
          `${window.location.pathname}${window.location.search}`,
        notify: ({ onSignIn, onDismiss }) => {
          toast.error('Sessão expirada', {
            id: SESSION_EXPIRED_TOAST_ID,
            description:
              'Entre novamente para continuar. Leituras não salvas podem ser mantidas como rascunho.',
            duration: Infinity,
            action: { label: 'Entrar novamente', onClick: onSignIn },
            onDismiss,
          })
        },
        goToSignIn: (redirect) => goToSignIn(redirect),
      })
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onSessionExpired }),
    mutationCache: new MutationCache({ onError: onSessionExpired }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 5000, // 5 minutes
        retry: shouldRetryQuery,
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

  goToSignIn = (redirect) => {
    void router.navigate({ to: '/sign-in', search: { redirect } })
  }

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
