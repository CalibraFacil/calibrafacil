import { Link, useRouter } from "@tanstack/react-router";
import { Alert02Icon, Compass01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ErrorComponentProps } from "@tanstack/react-router";

import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from "@/components/instrument-panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { reportRouteError } from "@/lib/sentry";

function BoundaryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-4">
      {children}
    </div>
  );
}

/**
 * Router-level error boundary. Reporting happens in `defaultOnCatch` (below),
 * not here, so it needs no effect and fires once per caught error.
 */
export function RouteErrorFallback({ reset }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <BoundaryShell>
      <Panel className="w-full max-w-md space-y-5 p-6" role="alert">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <HugeiconsIcon icon={Alert02Icon} className="size-5" />
          </span>
          <PanelHeader
            title="Algo deu errado ao carregar esta página"
            description="O erro foi registrado. Tente novamente; se o problema continuar, volte ao início."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className={ACTION_BUTTON_CLASS}
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            Tentar novamente
          </Button>
          <Button
            variant="outline"
            className={ACTION_BUTTON_CLASS}
            render={<Link to="/" />}
          >
            Ir para o início
          </Button>
        </div>
      </Panel>
    </BoundaryShell>
  );
}

export function RoutePendingFallback() {
  return (
    <BoundaryShell>
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner aria-hidden role="presentation" className="size-5" />
        <span>Carregando…</span>
      </div>
    </BoundaryShell>
  );
}

export function RouteNotFoundFallback() {
  return (
    <BoundaryShell>
      <Panel className="w-full max-w-md space-y-5 p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
            <HugeiconsIcon icon={Compass01Icon} className="size-5" />
          </span>
          <PanelHeader
            title="Página não encontrada"
            description="O endereço pode ter mudado ou o conteúdo não está mais disponível."
          />
        </div>
        <Button className={ACTION_BUTTON_CLASS} render={<Link to="/" />}>
          Ir para o início
        </Button>
      </Panel>
    </BoundaryShell>
  );
}

/** Spread into `createRouter` so every route inherits the boundaries. */
export const routeBoundaryOptions = {
  defaultErrorComponent: RouteErrorFallback,
  defaultPendingComponent: RoutePendingFallback,
  defaultNotFoundComponent: RouteNotFoundFallback,
  defaultOnCatch: (error: Error, info: { componentStack?: string | null }) => {
    void reportRouteError(error, info);
  },
};
