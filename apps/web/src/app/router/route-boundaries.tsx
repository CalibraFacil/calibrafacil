import { Link, useRouter } from '@tanstack/react-router'
import { Alert02Icon, Compass01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ErrorComponentProps } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { ACTION_BUTTON_CLASS } from '@/components/instrument-panel'
import { reportClientError } from '@/lib/report-client-error'

const BOUNDARY_WRAPPER_CLASS =
  'flex min-h-[60vh] w-full items-center justify-center p-6'

/**
 * Router-level error boundary: a render or loader crash lands here instead of
 * blanking the app. Reporting happens in `defaultOnCatch` (below), not here,
 * so it needs no effect and fires once per caught error.
 */
export function RouteErrorFallback({ reset }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <div className={BOUNDARY_WRAPPER_CLASS}>
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Alert02Icon} />
          </EmptyMedia>
          <EmptyTitle>Algo deu errado ao carregar esta página</EmptyTitle>
          <EmptyDescription>
            O erro foi registrado. Tente novamente; se o problema continuar,
            volte ao início.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              className={ACTION_BUTTON_CLASS}
              onClick={() => {
                reset()
                void router.invalidate()
              }}
            >
              Tentar novamente
            </Button>
            <Button
              variant="outline"
              className={ACTION_BUTTON_CLASS}
              render={<Link to="/dashboard" />}
            >
              Ir para o início
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}

export function RoutePendingFallback() {
  return (
    <div className={BOUNDARY_WRAPPER_CLASS} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner aria-hidden role="presentation" className="size-5" />
        <span>Carregando…</span>
      </div>
    </div>
  )
}

export function RouteNotFoundFallback() {
  return (
    <div className={BOUNDARY_WRAPPER_CLASS}>
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Compass01Icon} />
          </EmptyMedia>
          <EmptyTitle>Página não encontrada</EmptyTitle>
          <EmptyDescription>
            O endereço pode ter mudado ou o conteúdo não existe mais.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            className={ACTION_BUTTON_CLASS}
            render={<Link to="/dashboard" />}
          >
            Ir para o início
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

/** Spread into `createRouter` so every route inherits the boundaries. */
export const routeBoundaryOptions = {
  defaultErrorComponent: RouteErrorFallback,
  defaultPendingComponent: RoutePendingFallback,
  defaultNotFoundComponent: RouteNotFoundFallback,
  defaultOnCatch: (error: Error, info: { componentStack?: string | null }) => {
    reportClientError(error, {
      route: typeof window === 'undefined' ? '' : window.location.pathname,
      componentStack: info.componentStack,
    })
  },
}
