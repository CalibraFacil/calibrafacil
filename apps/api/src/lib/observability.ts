import { readObservabilityConfig } from "@calibra-facil/config";
import {
  createLogErrorReporter,
  type ErrorReporter,
} from "@calibra-facil/shared/telemetry";

// Server-side error tracking for the API surfaces: request
// handlers (app.onError), and the cron dispatcher
// all report through this singleton, which writes one redacted JSON line to
// stderr per error (see packages/shared/src/telemetry/error-reporter.ts).

let reporter: ErrorReporter | null = null;

function getErrorReporter(): ErrorReporter {
  const observability = readObservabilityConfig();
  reporter ??= createLogErrorReporter({
    service: "api",
    environment: observability.environment,
    release: observability.release,
  });
  return reporter;
}

/**
 * Report an error the code caught (and continued past, or turned into a
 * response) as one redacted JSON line on stderr; never throws. This is the only
 * way a caught error leaves the process: pass the error itself, never its
 * message or a hand-built object, so the reporter scrubs it, and keep the
 * context in `tags` (identifiers only, never an e-mail, a name or a payload).
 */
export function reportServerError(
  error: unknown,
  context: { surface: string; tags?: Record<string, string> },
): void {
  const { surface, tags } = context;
  getErrorReporter().captureException(error, {
    tags: { surface, ...tags },
  });
}

/** Bounded wait for in-flight deliveries — call before a function returns. */
export function flushErrorReporter(timeoutMs?: number): Promise<void> {
  return getErrorReporter().flush(timeoutMs);
}
