import { readObservabilityConfig } from "@calibra-facil/config";
import {
  createLogErrorReporter,
  createLogger,
  type ErrorReporter,
  type StructuredLogger,
} from "@calibra-facil/shared/telemetry";

// Server-side error tracking for the worker surfaces: every run
// mode reports through this singleton — the local Bun poller, and the Cloudflare
// document-worker container. Errors are written as one
// redacted JSON line on stderr (see packages/shared/src/telemetry/error-reporter.ts).

let reporter: ErrorReporter | null = null;

export function getWorkerErrorReporter(): ErrorReporter {
  const observability = readObservabilityConfig();
  reporter ??= createLogErrorReporter({
    service: "worker",
    environment: observability.environment,
    release: observability.release,
  });
  return reporter;
}

export const workerLogger: StructuredLogger = createLogger("Worker");

/** Capture + structured log for a failed job; never throws. */
export function reportWorkerError(
  error: unknown,
  tags: Record<string, string>,
): void {
  workerLogger.error("job failed", {
    ...tags,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "UnknownError", message: String(error) },
  });
  getWorkerErrorReporter().captureException(error, {
    tags: { surface: "worker", ...tags },
  });
}

export function flushWorkerErrorReporter(timeoutMs?: number): Promise<void> {
  return getWorkerErrorReporter().flush(timeoutMs);
}
