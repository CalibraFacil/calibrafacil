import { runtimeEnv } from "@/lib/runtime-env";

type SentryModule = typeof import("@sentry/react");

/**
 * The portal reports only what the router catches: opt-in via
 * `VITE_SENTRY_DSN`, production builds only, no default PII, no session
 * replay and no performance tracing (portal users are customers of the laboratory).
 */
function getSentryDsn(): string | null {
  return runtimeEnv("VITE_SENTRY_DSN", import.meta.env.VITE_SENTRY_DSN) || null;
}

let sentryReady: Promise<SentryModule | null> | null = null;

async function loadAndInitialize(): Promise<SentryModule | null> {
  if (typeof window === "undefined" || !import.meta.env.PROD) return null;

  const dsn = getSentryDsn();
  if (!dsn) return null;

  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn,
    sendDefaultPii: false,
  });
  return Sentry;
}

export function initializeSentry(): Promise<SentryModule | null> {
  sentryReady ??= loadAndInitialize();
  return sentryReady;
}

/** Sends a route render/loader crash to Sentry (no-op when not configured). */
export async function reportRouteError(
  error: unknown,
  info: { componentStack?: string | null },
): Promise<void> {
  const Sentry = await initializeSentry();
  if (!Sentry) return;

  Sentry.captureException(error, {
    contexts: info.componentStack
      ? { react: { componentStack: info.componentStack } }
      : undefined,
  });
}
