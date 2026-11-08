import { readObservabilityConfig } from "@calibra-facil/config";
import {
  createLogErrorReporter,
  type ErrorReporter,
} from "@calibra-facil/shared/telemetry";

// Server-side error tracking for the worker surfaces: every run mode (the
// always-on Bun worker, the API's in-process `local` runner) reports through
// this singleton. Errors are written as one redacted JSON line on stderr (see
// packages/shared/src/telemetry/error-reporter.ts).

let reporter: ErrorReporter | null = null;

function getWorkerErrorReporter(): ErrorReporter {
  const observability = readObservabilityConfig();
  reporter ??= createLogErrorReporter({
    service: "worker",
    environment: observability.environment,
    release: observability.release,
  });
  return reporter;
}

/**
 * Report a failed job as one redacted JSON line on stderr; never throws. The
 * reporter is the only writer: a second plain-logger line carried the raw
 * message (a failed statement's bound values) next to the scrubbed one.
 */
export function reportWorkerError(
  error: unknown,
  tags: Record<string, string>,
): void {
  getWorkerErrorReporter().captureException(error, {
    tags: { surface: "worker", ...tags },
  });
}

export function flushWorkerErrorReporter(timeoutMs?: number): Promise<void> {
  return getWorkerErrorReporter().flush(timeoutMs);
}
