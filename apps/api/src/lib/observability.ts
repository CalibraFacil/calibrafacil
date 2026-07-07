import {
  createErrorReporter,
  createLogger,
  type ErrorReporter,
  type StructuredLogger,
} from "@calibra-facil/shared/telemetry";

// Server-side error tracking for the API surfaces: request
// handlers (app.onError), the cron dispatcher and the Vercel Queue consumer
// all report through this singleton. No SENTRY_DSN -> no-op, zero overhead —
// the reporter is a reliability net, never a dependency.

let reporter: ErrorReporter | null = null;

export function getErrorReporter(): ErrorReporter {
  reporter ??= createErrorReporter({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV ??
      "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    serverName: process.env.VERCEL_REGION,
  });
  return reporter;
}

export const apiLogger: StructuredLogger = createLogger("API");

/** Capture + structured log in one call; never throws. */
export function reportServerError(
  error: unknown,
  context: { surface: string; tags?: Record<string, string> },
): void {
  const { surface, tags } = context;
  apiLogger.error("unhandled server error", {
    surface,
    ...tags,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "UnknownError", message: String(error) },
  });
  getErrorReporter().captureException(error, {
    tags: { surface, ...tags },
  });
}

/** Bounded wait for in-flight deliveries — call before a function returns. */
export function flushErrorReporter(timeoutMs?: number): Promise<void> {
  return getErrorReporter().flush(timeoutMs);
}
