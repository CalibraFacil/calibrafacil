import { Link, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { buttonVariants } from "@calibra-facil/ui/button-variants";
import {
  ACTION_BUTTON_CLASS,
  PANEL_CLASS,
} from "@calibra-facil/ui/panel-styles";
import { cn } from "@/lib/utils";
import { reportClientError } from "@/lib/report-client-error";

/*
 * These boundaries are wired into the router, so they ship in the initial
 * bundle graph. They wear the instrument-panel look through its style
 * constants (`panel-styles`) instead of importing `instrument-panel.tsx`
 * (which pulls `motion` and the tooltip stack), and draw their two glyphs
 * inline: the hugeicons barrel is a 47 KiB chunk that must stay out of
 * first paint.
 */

function AlertGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
    >
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.25h.01" />
    </svg>
  );
}

function CompassGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </svg>
  );
}

function BoundaryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-4">
      {children}
    </div>
  );
}

function BoundaryPanel({
  tone,
  icon,
  title,
  description,
  children,
  role,
}: {
  tone: "critical" | "neutral";
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  role?: "alert";
}) {
  return (
    <section
      role={role}
      className={cn(PANEL_CLASS, "w-full max-w-md space-y-5 p-6")}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            tone === "critical"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted/60 text-muted-foreground",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-balance text-base font-semibold sm:text-lg">
            {title}
          </h2>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
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
      <BoundaryPanel
        role="alert"
        tone="critical"
        icon={<AlertGlyph />}
        title="Algo deu errado ao carregar esta página"
        description="O erro foi registrado. Tente novamente; se o problema continuar, volte ao início."
      >
        <button
          type="button"
          className={cn(buttonVariants(), ACTION_BUTTON_CLASS)}
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Tentar novamente
        </button>
        <Link
          to="/"
          className={cn(
            buttonVariants({ variant: "outline" }),
            ACTION_BUTTON_CLASS,
          )}
        >
          Ir para o início
        </Link>
      </BoundaryPanel>
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
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
        />
        <span>Carregando…</span>
      </div>
    </BoundaryShell>
  );
}

export function RouteNotFoundFallback() {
  return (
    <BoundaryShell>
      <BoundaryPanel
        tone="neutral"
        icon={<CompassGlyph />}
        title="Página não encontrada"
        description="O endereço pode ter mudado ou o conteúdo não está mais disponível."
      >
        <Link to="/" className={cn(buttonVariants(), ACTION_BUTTON_CLASS)}>
          Ir para o início
        </Link>
      </BoundaryPanel>
    </BoundaryShell>
  );
}

/** Spread into `createRouter` so every route inherits the boundaries. */
export const routeBoundaryOptions = {
  defaultErrorComponent: RouteErrorFallback,
  defaultPendingComponent: RoutePendingFallback,
  defaultNotFoundComponent: RouteNotFoundFallback,
  defaultOnCatch: (error: Error, info: { componentStack?: string | null }) => {
    reportClientError(error, {
      route: typeof window === "undefined" ? "" : window.location.pathname,
      componentStack: info.componentStack,
    });
  },
};
