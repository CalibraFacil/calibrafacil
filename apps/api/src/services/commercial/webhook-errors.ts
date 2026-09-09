// Transient-vs-permanent classification for ASAAS webhook processing failures.
//
// WHY this matters (grounded in https://docs.asaas.com/docs/about-webhooks,
// fetched 2026-07-04): ASAAS treats any response outside 200–299 as a delivery
// failure and RETRIES it. But its sync queue is SEQUENTIAL and, after 15
// consecutive non-2xx responses, PAUSES entirely — new events keep queuing but
// are not delivered, and anything left in the paused queue for >14 days is purged.
//
// So the webhook handler must return non-2xx ONLY when a retry could plausibly
// succeed (a TRANSIENT infra blip: DB connection/deadlock/timeout, network). A
// PERMANENT error (a bug, a malformed/unroutable payload) must still be acked
// (2xx) — otherwise a single poison event would stall the whole sequential queue
// until manual reactivation. The reconciliation cron (REQ-REL-ASA-002) is the
// backstop for the state divergence a permanent-error ack leaves behind.

/**
 * Marker thrown by the reconcile path for infrastructure failures that are worth
 * a provider retry (e.g. "could not persist the payment"). Carries the original
 * cause for logging without losing the classification signal.
 */
export class TransientWebhookError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "TransientWebhookError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// Postgres SQLSTATEs that represent a transient/retryable condition. Class 08
// (connection exception) and class 57 (operator intervention: admin shutdown,
// crash, cannot-connect-now, query-canceled) are matched by prefix; the rest are
// specific codes for insufficient-resources, deadlock, serialization failure, and
// lock-not-available.
const TRANSIENT_PG_PREFIXES = ["08", "57"] as const;
const TRANSIENT_PG_CODES = new Set([
  "53000", // insufficient_resources
  "53100", // disk_full
  "53200", // out_of_memory
  "53300", // too_many_connections
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "55006", // object_in_use
]);

// Node / undici network errno that a retry can recover from.
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function codeOf(value: unknown): string | null {
  if (value && typeof value === "object" && "code" in value) {
    const code = Reflect.get(value, "code");
    return typeof code === "string" ? code : null;
  }
  return null;
}

function isTransientCode(code: string | null): boolean {
  if (!code) return false;
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;
  if (TRANSIENT_PG_CODES.has(code)) return true;
  return TRANSIENT_PG_PREFIXES.some((prefix) => code.startsWith(prefix));
}

/**
 * True when `error` represents a transient/retryable processing failure. Mirrors
 * `isUniqueConstraintError`'s one-level `.cause` unwrap, since postgres-js wraps
 * driver errors in a Drizzle `DrizzleQueryError` whose real SQLSTATE lives on
 * `.cause`. Unknown/permanent errors return false so the handler acks them.
 */
export function isTransientWebhookError(error: unknown): boolean {
  if (error instanceof TransientWebhookError) {
    return true;
  }

  // undici/fetch surfaces a dropped connection as a bare TypeError("fetch failed")
  // with no `code` — treat that specific network failure as transient.
  if (
    error instanceof TypeError &&
    /fetch failed|network/i.test(error.message)
  ) {
    return true;
  }

  if (isTransientCode(codeOf(error))) {
    return true;
  }

  if (error && typeof error === "object" && "cause" in error) {
    return isTransientCode(codeOf(Reflect.get(error, "cause")));
  }

  return false;
}
