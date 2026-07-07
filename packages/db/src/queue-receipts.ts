import { sql } from "drizzle-orm";
import { db } from "./db.js";

// Idempotency ledger for queue consumers. Both delivery channels are at-least-once:
//   - Vercel Queue redelivers a message until it is acknowledged;
//   - the app_queue_job stale-lease reclaim re-queues a PROCESSING row whose
//     worker died (or is merely slower than the lease).
// A consumer therefore claims a receipt for its DELIVERY UNIT before running.
// If the unit already ran to COMPLETED, enforce mode skips the re-run; a live
// RUNNING lease means another worker owns it right now.
//
// The key is the delivery unit — `app-queue-<rowId>` / `vq:<messageId>` —
// never a business id: re-requesting the same certificate enqueues a NEW unit
// and must run. What this ledger cannot give is transactional exactly-once for
// non-DB side effects (R2 uploads, email): a crash between finishing the work
// and completing the receipt still re-runs on the next delivery. The regulated
// write paths stay protected by their own write-once guards (e.g. the
// certificate issued-snapshot `on conflict (job_id) do nothing`).
//
// Rollout is gated by QUEUE_RECEIPTS_MODE:
//   - "off"      — no receipts at all.
//   - "shadow"   — record receipts and LOG would-be duplicates, always run
//                  (the default: shadow-compare before trusting enforcement).
//   - "enforce"  — skip COMPLETED duplicates; defer while a lease is held.

export type QueueReceiptsMode = "off" | "shadow" | "enforce";

const DEFAULT_LEASE_MS = 10 * 60_000; // matches the app_queue_job stale-lease reclaim

export function readQueueReceiptsMode(): QueueReceiptsMode {
  const raw = process.env.QUEUE_RECEIPTS_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "enforce") return raw;
  return "shadow";
}

function readLeaseMs(): number {
  const value = Number(process.env.QUEUE_RECEIPT_LEASE_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LEASE_MS;
}

/** Receipt key for an app_queue_job row — stable across reclaims/retries. */
export function appQueueJobReceiptKey(queueJobId: number): string {
  return `app-queue-${queueJobId}`;
}

/** Receipt key for a Vercel Queue message — stable across redeliveries. */
export function vercelQueueReceiptKey(messageId: string): string {
  return `vq:${messageId}`;
}

export type QueueReceiptClaim =
  | { outcome: "claimed"; attempts: number }
  | { outcome: "duplicate-completed" }
  | { outcome: "duplicate-running" };

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

function getExecuteRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = toRecord(result).rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Claim the receipt for one delivery unit. Exactly one caller wins a
 * (job_type, idempotency_key) pair at a time:
 *   - first delivery inserts the receipt and runs;
 *   - a RUNNING receipt whose lease expired is taken over (crashed worker);
 *   - a RUNNING receipt with a live lease belongs to another worker;
 *   - a COMPLETED receipt means the work already succeeded.
 * Only the claim owner may later complete/release the receipt.
 */
export async function claimQueueReceipt(params: {
  jobType: string;
  idempotencyKey: string;
  leaseMs?: number;
}): Promise<QueueReceiptClaim> {
  const leaseMs = params.leaseMs ?? readLeaseMs();
  const lockedUntil = new Date(Date.now() + leaseMs);

  const result = await db.execute(sql`
    insert into queue_job_receipt (job_type, idempotency_key, status, locked_until)
    values (${params.jobType}, ${params.idempotencyKey}, 'RUNNING', ${lockedUntil.toISOString()}::timestamptz)
    on conflict (job_type, idempotency_key) do update
      set locked_until = excluded.locked_until,
          attempts = queue_job_receipt.attempts + 1,
          updated_at = now()
      where queue_job_receipt.status <> 'COMPLETED'
        and queue_job_receipt.locked_until < now()
    returning attempts
  `);

  const [row] = getExecuteRows(result);
  if (row) {
    const attempts = toRecord(row).attempts;
    return {
      outcome: "claimed",
      attempts: typeof attempts === "number" ? attempts : 1,
    };
  }

  // Lost the claim: distinguish "already done" from "someone is running it".
  const existing = await db.execute(sql`
    select status
    from queue_job_receipt
    where job_type = ${params.jobType}
      and idempotency_key = ${params.idempotencyKey}
  `);
  const status = toRecord(getExecuteRows(existing)[0]).status;
  return status === "COMPLETED"
    ? { outcome: "duplicate-completed" }
    : { outcome: "duplicate-running" };
}

/** Mark a claimed receipt as successfully finished (claim owner only). */
export async function completeQueueReceipt(params: {
  jobType: string;
  idempotencyKey: string;
}): Promise<void> {
  await db.execute(sql`
    update queue_job_receipt
    set status = 'COMPLETED',
        completed_at = now(),
        updated_at = now()
    where job_type = ${params.jobType}
      and idempotency_key = ${params.idempotencyKey}
  `);
}

/**
 * Release a claimed receipt after a FAILED run (claim owner only): expire the
 * lease immediately so the queue's own retry backoff (5s·2^n) is not blocked
 * until the full lease elapses.
 */
export async function releaseQueueReceipt(params: {
  jobType: string;
  idempotencyKey: string;
}): Promise<void> {
  await db.execute(sql`
    update queue_job_receipt
    set locked_until = now(),
        updated_at = now()
    where job_type = ${params.jobType}
      and idempotency_key = ${params.idempotencyKey}
      and status <> 'COMPLETED'
  `);
}

/**
 * Drop receipts old enough that their delivery unit can no longer reappear
 * (Vercel Queue messages expire; app_queue_job rows go terminal). Called from
 * the queue-backstop cron so the ledger stays bounded.
 */
export async function pruneQueueReceipts(
  olderThanMs = 30 * 24 * 60 * 60_000,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await db.execute(sql`
    delete from queue_job_receipt
    where coalesce(completed_at, locked_until) < ${cutoff.toISOString()}::timestamptz
    returning id
  `);
  return getExecuteRows(result).length;
}

export type QueueReceiptRunResult =
  | { ran: true }
  | { ran: false; reason: "duplicate-completed" };

/** Thrown in enforce mode when another worker holds a live lease on the unit. */
export class QueueReceiptHeldError extends Error {
  constructor(jobType: string, idempotencyKey: string) {
    super(
      `queue receipt for ${jobType}/${idempotencyKey} is held by another worker`,
    );
    this.name = "QueueReceiptHeldError";
  }
}

/**
 * Run one delivery unit under the receipt ledger. In enforce mode a
 * COMPLETED duplicate is skipped and a held lease throws
 * QueueReceiptHeldError (callers turn that into "retry later"). In shadow
 * mode duplicates are only logged and the unit always runs; the receipt is
 * mutated only when this call owns the claim.
 */
export async function runWithQueueReceipt(
  params: {
    jobType: string;
    idempotencyKey: string;
    mode?: QueueReceiptsMode;
    leaseMs?: number;
  },
  run: () => Promise<void>,
): Promise<QueueReceiptRunResult> {
  const mode = params.mode ?? readQueueReceiptsMode();
  if (mode === "off") {
    await run();
    return { ran: true };
  }

  let claim: QueueReceiptClaim;
  try {
    claim = await claimQueueReceipt(params);
  } catch (error) {
    // Fail open: the ledger is a reliability net, never a gate. If it is
    // unavailable (e.g. deploy raced the migration), run without a receipt.
    console.error(
      `[QueueReceipt] ledger unavailable — running without receipt: type=${params.jobType} key=${params.idempotencyKey}`,
      error,
    );
    await run();
    return { ran: true };
  }

  if (claim.outcome !== "claimed") {
    console.warn(
      `[QueueReceipt] duplicate delivery (${mode}): type=${params.jobType} key=${params.idempotencyKey} state=${claim.outcome}`,
    );
    if (mode === "enforce") {
      if (claim.outcome === "duplicate-completed") {
        return { ran: false, reason: "duplicate-completed" };
      }
      throw new QueueReceiptHeldError(params.jobType, params.idempotencyKey);
    }
    // Shadow mode: observe only — run without owning the receipt.
    await run();
    return { ran: true };
  }

  if (claim.attempts > 1) {
    console.warn(
      `[QueueReceipt] re-claimed expired lease (attempt ${claim.attempts}): type=${params.jobType} key=${params.idempotencyKey}`,
    );
  }

  try {
    await run();
  } catch (error) {
    await releaseQueueReceipt(params).catch((releaseError) => {
      console.error(
        `[QueueReceipt] failed to release receipt for ${params.jobType}/${params.idempotencyKey}`,
        releaseError,
      );
    });
    throw error;
  }

  await completeQueueReceipt(params).catch((completeError) => {
    // Never fail a finished job over ledger bookkeeping: the lease will
    // expire and the worst case is one redundant re-run.
    console.error(
      `[QueueReceipt] failed to complete receipt for ${params.jobType}/${params.idempotencyKey}`,
      completeError,
    );
  });
  return { ran: true };
}
