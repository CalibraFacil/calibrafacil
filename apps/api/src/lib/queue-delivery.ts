// Delivery policy for the Vercel Queue consumer.
//
// Vercel Queue has NO maximum-deliveries setting: a handler that throws is
// redelivered until it succeeds or the message expires (24 hours by default,
// 7 days at most) — see the `@vercel/queue` README, "Retry and Backoff". The
// only way to stop retrying earlier is for the consumer to return
// `{ acknowledge: true }` from its `retry` callback. So the ceiling is ours and
// is enforced in ONE place for both sides of the contract:
//
//   - `vercelDeliveryAttempt` tells the worker which delivery this is, so the
//     last one REJECTS a certificate that could not be issued (earlier
//     deliveries keep it in GENERATING_PDF for the retry);
//   - `vercelRetryDirective` acknowledges the message after that same last
//     delivery, so the platform really stops redelivering it.
//
// Both read `BACKGROUND_JOBS_MAX_DELIVERIES` (default 3, the same as the
// database queue's `app_queue_job.max_attempts`), so they cannot drift apart.
//
// Fail closed: when the platform does not report a usable `deliveryCount` the
// delivery is treated as the final one — a failure REJECTS the job and the
// message is acknowledged — rather than guessed to be the first, which could
// leave a failed certificate in GENERATING_PDF forever.

export const DEFAULT_MAX_BACKGROUND_JOB_DELIVERIES = 3;

/** Seconds before the first retry; doubles per delivery, capped at 5 minutes. */
const RETRY_BASE_DELAY_SECONDS = 30;
const RETRY_MAX_DELAY_SECONDS = 300;
/** Wait before retrying a delivery that found the message's lease held. */
const LEASE_HELD_RETRY_SECONDS = 60;

export function readMaxBackgroundJobDeliveries(
  value = process.env.BACKGROUND_JOBS_MAX_DELIVERIES,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1
    ? parsed
    : DEFAULT_MAX_BACKGROUND_JOB_DELIVERIES;
}

function isUsableDeliveryCount(
  deliveryCount: number | undefined,
): deliveryCount is number {
  return (
    typeof deliveryCount === "number" &&
    Number.isInteger(deliveryCount) &&
    deliveryCount >= 1
  );
}

export function vercelDeliveryAttempt(
  deliveryCount: number | undefined,
  maxDeliveries = readMaxBackgroundJobDeliveries(),
): { attempt: number; maxAttempts: number } {
  return {
    // Missing/invalid count: the final delivery (fail closed).
    attempt: isUsableDeliveryCount(deliveryCount)
      ? deliveryCount
      : maxDeliveries,
    maxAttempts: maxDeliveries,
  };
}

export type VercelRetryDirective =
  | { afterSeconds: number }
  | { acknowledge: true };

/**
 * What to do with a message whose handler threw (the `retry` option of
 * `handleCallback`): redeliver with backoff, or acknowledge once the ceiling is
 * reached so the platform stops.
 *
 * `leaseHeld` marks the receipt ledger's "another delivery is working on this
 * message" rejection. That says nothing about the work failing, so it never
 * consumes the ceiling: the message is retried later, when the lease is either
 * released or expired, and that delivery (whose count is by then past the
 * ceiling) is the final one.
 */
export function vercelRetryDirective(
  params: { deliveryCount: number | undefined; leaseHeld?: boolean },
  maxDeliveries = readMaxBackgroundJobDeliveries(),
): VercelRetryDirective {
  if (params.leaseHeld) {
    return { afterSeconds: LEASE_HELD_RETRY_SECONDS };
  }
  const { attempt, maxAttempts } = vercelDeliveryAttempt(
    params.deliveryCount,
    maxDeliveries,
  );
  if (attempt >= maxAttempts) {
    return { acknowledge: true };
  }
  return {
    afterSeconds: Math.min(
      RETRY_MAX_DELAY_SECONDS,
      RETRY_BASE_DELAY_SECONDS * 2 ** (attempt - 1),
    ),
  };
}
