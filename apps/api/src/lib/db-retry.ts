/**
 * Bounded retry for transient database-connection failures.
 *
 * The production database (Neon) autoscales to zero when idle. The first query
 * after the compute has suspended has to wait for it to wake, and that first
 * touch can fail with a transient connection error (the compute is still
 * starting up). A second attempt a moment later succeeds, because the wake is
 * server-side and applies to the whole compute.
 *
 * Wrap the FIRST database operation of a request in `withDbWakeRetry` so a cold
 * start surfaces as a brief delay instead of a 500. Only wrap idempotent reads
 * (or otherwise idempotent operations) — a retried write could run twice.
 */

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = Reflect.get(error, "code");
    return typeof code === "string" ? code : "";
  }
  return "";
}

const TRANSIENT_CONNECTION_PATTERNS = [
  "connection terminated",
  "connection ended",
  "connection closed",
  "connect_timeout",
  "connection timeout",
  "timeout expired",
  "terminating connection",
  "the database system is starting up",
  "could not connect",
  "econnreset",
  "econnrefused",
  "etimedout",
  "epipe",
  "socket hang up",
  "fetch failed",
];

/**
 * True when the error looks like a transient connection/cold-start failure that
 * is worth retrying, rather than a deterministic application error (validation,
 * duplicate key, not-found, …) that would fail again on retry.
 */
export function isTransientConnectionError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const haystack = `${message} ${readErrorCode(error)}`.toLowerCase();
  return TRANSIENT_CONNECTION_PATTERNS.some((pattern) =>
    haystack.includes(pattern),
  );
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDbWakeRetry<T>(
  operation: () => Promise<T>,
  options?: {
    attempts?: number;
    baseDelayMs?: number;
    onRetry?: (error: unknown, attempt: number) => void;
  },
): Promise<T> {
  const attempts = options?.attempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 200;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientConnectionError(error)) {
        throw error;
      }
      options?.onRetry?.(error, attempt);
      // Linear backoff: the compute usually wakes within a second or two.
      await delay(baseDelayMs * attempt);
    }
  }
  throw lastError;
}
