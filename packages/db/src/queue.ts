import { and, eq, sql } from "drizzle-orm";
import { db } from "./db.js";
import {
  appQueueJob,
  type AppQueueJobStatus,
  type AppQueueJobType,
} from "./schema.js";
import {
  isBackgroundJobMessage,
  type BackgroundJobMessage,
} from "@calibra-facil/shared";

export type QueueMessage = Exclude<
  BackgroundJobMessage,
  { type: "SCHEDULED_NOTIFICATIONS" } | { type: "PORTAL_DIGEST" }
>;

export type ClaimedQueueJob = {
  id: number;
  type: AppQueueJobType;
  payload: QueueMessage;
  attempts: number;
  maxAttempts: number;
};

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

function getInsertedQueueJobId(result: unknown): number | null {
  const [row] = getExecuteRows(result);
  const id = toRecord(row).id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

/** Whether a message can be written to `app_queue_job` (cron-only ones cannot). */
export function isQueueMessage(value: unknown): value is QueueMessage {
  return (
    isBackgroundJobMessage(value) &&
    value.type !== "SCHEDULED_NOTIFICATIONS" &&
    value.type !== "PORTAL_DIGEST"
  );
}

function getMessageType(message: QueueMessage): AppQueueJobType {
  switch (message.type) {
    case "LABEL":
    case "SERVICE_ORDER_INTAKE_DOCUMENT":
    case "SERVICE_ORDER_TAG":
    case "SERVICE_ORDER_QUOTE":
    case "SERVICE_ORDER_DELIVERY_RECEIPT":
    case "INTEGRATION_SYNC":
    case "AUDIT_PACK":
    case "OOT_NOTIFICATION":
      return message.type;
    default:
      return "CERTIFICATE";
  }
}

function toClaimedQueueJob(value: unknown): ClaimedQueueJob | null {
  const row = toRecord(value);
  if (
    typeof row.id !== "number" ||
    !isQueueMessage(row.payload) ||
    typeof row.attempts !== "number" ||
    typeof row.maxAttempts !== "number"
  ) {
    return null;
  }

  return {
    id: row.id,
    type: getMessageType(row.payload),
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
  };
}

function getRetryDelayMs(attempts: number) {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

/** A db handle or an open transaction: anything that can `execute` SQL. */
export type QueueExecutor = Pick<typeof db, "execute">;

export async function enqueueQueueJob(
  message: QueueMessage,
  options: {
    maxAttempts?: number;
    availableAt?: Date;
    /**
     * Run the insert on this handle instead of the shared pool — pass an open
     * transaction to commit the queue row atomically with the state change that
     * needs it (outbox pattern).
     */
    executor?: QueueExecutor;
  } = {},
) {
  const availableAt = options.availableAt ?? new Date();

  const result = await (options.executor ?? db).execute(sql`
    insert into app_queue_job (type, payload, max_attempts, available_at)
    values (
      ${getMessageType(message)},
      ${JSON.stringify(message)}::jsonb,
      ${options.maxAttempts ?? 3},
      ${availableAt.toISOString()}::timestamptz
    )
    returning id
  `);
  const jobId = getInsertedQueueJobId(result);

  if (jobId === null) {
    throw new Error("Failed to enqueue queue job");
  }

  return jobId;
}

export async function claimQueueJobs(
  workerId: string,
  batchSize = 10,
): Promise<ClaimedQueueJob[]> {
  const result = await db.execute(sql`
    with claimed as (
      select id
      from app_queue_job
      where status = 'PENDING'
        and available_at <= now()
      order by created_at asc
      for update skip locked
      limit ${batchSize}
    )
    update app_queue_job q
    set status = 'PROCESSING',
        locked_by = ${workerId},
        locked_at = now(),
        attempts = q.attempts + 1,
        updated_at = now()
    from claimed
    where q.id = claimed.id
    returning
      q.id,
      q.type,
      q.payload,
      q.attempts,
      q.max_attempts as "maxAttempts"
  `);

  return getExecuteRows(result).flatMap((row) => {
    const job = toClaimedQueueJob(row);
    return job ? [job] : [];
  });
}

// Lease fencing. `claimQueueJobs` stamps `locked_by` with the claiming worker,
// and the stale-lease reclaim (`releaseStaleQueueJobs`) hands a PROCESSING row
// whose lease expired to the NEXT claimant. A worker that was merely slower than
// the lease still believes it owns the row, so settling by `id` alone would let
// it overwrite the new owner's state (complete a row another worker is still
// rendering, or send a healthy row back to PENDING). Settling therefore requires
// the caller to STILL be the lock holder of a PROCESSING row. A fenced-out
// settlement is a logged no-op returning `false` — never an error, because a
// throw would make the caller retry a job it no longer owns.
function ownedProcessingRow(id: number, workerId: string) {
  return and(
    eq(appQueueJob.id, id),
    eq(appQueueJob.status, "PROCESSING"),
    eq(appQueueJob.lockedBy, workerId),
  );
}

function logFencedOut(
  action: "complete" | "fail",
  id: number,
  workerId: string,
) {
  console.warn(
    `[Queue] fenced out: worker ${workerId} no longer holds the lease on queue job ${id}; ${action} ignored`,
  );
}

/**
 * Mark a claimed row COMPLETED. Only the current lock holder of a PROCESSING
 * row may do so; otherwise nothing is written. Returns whether it applied.
 */
export async function completeQueueJob(
  id: number,
  workerId: string,
): Promise<boolean> {
  const updated = await db
    .update(appQueueJob)
    .set({
      status: "COMPLETED",
      lockedBy: null,
      lockedAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(ownedProcessingRow(id, workerId))
    .returning();

  if (updated.length === 0) {
    logFencedOut("complete", id, workerId);
    return false;
  }
  return true;
}

/**
 * Settle a claimed row as failed: back to PENDING with backoff, or FAILED once
 * attempts are exhausted. Only the current lock holder of a PROCESSING row may
 * do so; otherwise nothing is written. Returns whether it applied.
 */
export async function failQueueJob(
  id: number,
  workerId: string,
  error: unknown,
): Promise<boolean> {
  const [job] = await db
    .select({
      attempts: appQueueJob.attempts,
      maxAttempts: appQueueJob.maxAttempts,
    })
    .from(appQueueJob)
    .where(ownedProcessingRow(id, workerId))
    .limit(1);

  if (!job) {
    logFencedOut("fail", id, workerId);
    return false;
  }

  const exhausted = job.attempts >= job.maxAttempts;
  const lastError = error instanceof Error ? error.message : String(error);
  const status: AppQueueJobStatus = exhausted ? "FAILED" : "PENDING";
  const availableAt = exhausted
    ? new Date()
    : new Date(Date.now() + getRetryDelayMs(job.attempts));

  // The same fence on the write: the lease can be reclaimed between the read
  // above and this update, and `attempts` is only valid for the claim we read.
  const updated = await db
    .update(appQueueJob)
    .set({
      status,
      availableAt,
      lockedBy: null,
      lockedAt: null,
      lastError,
      updatedAt: new Date(),
    })
    .where(
      and(
        ownedProcessingRow(id, workerId),
        eq(appQueueJob.attempts, job.attempts),
      ),
    )
    .returning();

  if (updated.length === 0) {
    logFencedOut("fail", id, workerId);
    return false;
  }
  return true;
}

/**
 * Unfenced settle for rows that were never claimed by a worker — the demo seed
 * runs queued jobs inline and marks them done. Worker code must use the fenced
 * `completeQueueJob`; this one deliberately ignores the lease.
 */
export async function forceCompleteQueueJob(id: number): Promise<void> {
  await db
    .update(appQueueJob)
    .set({
      status: "COMPLETED",
      lockedBy: null,
      lockedAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(appQueueJob.id, id));
}

/** A queue row the lease reclaim gave up on (see `releaseStaleQueueJobs`). */
export type DeadLetteredQueueJob = {
  id: number;
  type: AppQueueJobType;
  payload: Record<string, unknown>;
};

export type ReleaseStaleQueueJobsResult = {
  /** Rows returned to PENDING so they can be claimed again. */
  released: number;
  /** Rows moved to FAILED because the lease expired on their final attempt. */
  deadLettered: DeadLetteredQueueJob[];
};

function isAppQueueJobType(value: unknown): value is AppQueueJobType {
  return (
    value === "CERTIFICATE" ||
    value === "LABEL" ||
    value === "SERVICE_ORDER_INTAKE_DOCUMENT" ||
    value === "SERVICE_ORDER_TAG" ||
    value === "SERVICE_ORDER_QUOTE" ||
    value === "SERVICE_ORDER_DELIVERY_RECEIPT" ||
    value === "INTEGRATION_SYNC" ||
    value === "AUDIT_PACK" ||
    value === "OOT_NOTIFICATION"
  );
}

// Reclaim rows whose PROCESSING lease has expired (a worker died mid-job, or a
// drain crashed). A row with attempts left goes back to PENDING so it can be
// claimed again. A row whose lease expired on its FINAL attempt (attempts >=
// max_attempts) is dead-lettered to FAILED instead: a job that kills the worker
// process (OOM, a crash in rendering) never reaches `failQueueJob`, so without
// this it would be re-claimed forever. The dead-lettered rows are returned so the
// caller can settle whatever the job left in flight (a certificate stuck in
// GENERATING_PDF — see queue-render-recovery.ts). A periodic backstop uses the
// counts to decide whether to re-drive the drain (see
// apps/api/src/lib/stale-job-backstop.ts / the queue-backstop cron).
export async function releaseStaleQueueJobs(
  staleAfterMs = 10 * 60_000,
): Promise<ReleaseStaleQueueJobsResult> {
  const staleBefore = new Date(Date.now() - staleAfterMs);

  const result = await db.execute(sql`
    update app_queue_job
    set status = case when attempts >= max_attempts then 'FAILED' else 'PENDING' end,
        available_at = case when attempts >= max_attempts then now() else available_at end,
        last_error = case
          when attempts >= max_attempts then
            'Lease expired on the final attempt (' || attempts || '/' || max_attempts ||
            '): the worker stopped before finishing the job; dead-lettered.'
          else last_error
        end,
        locked_by = null,
        locked_at = null,
        updated_at = now()
    where status = 'PROCESSING'
      and locked_at < ${staleBefore.toISOString()}::timestamptz
    returning id, type, payload, status
  `);

  let released = 0;
  const deadLettered: DeadLetteredQueueJob[] = [];
  for (const raw of getExecuteRows(result)) {
    const row = toRecord(raw);
    if (row.status !== "FAILED") {
      released += 1;
      continue;
    }
    if (typeof row.id === "number" && isAppQueueJobType(row.type)) {
      deadLettered.push({
        id: row.id,
        type: row.type,
        payload: toRecord(row.payload),
      });
    }
  }

  return { released, deadLettered };
}

export type QueueDepth = {
  pending: number;
  processing: number;
  failed: number;
};

// Backlog snapshot by status for the /api/health readiness probe.
// Cheap aggregate over the (small, pruned) queue table — informational only.
export async function countQueueJobsByStatus(): Promise<QueueDepth> {
  const result = await db.execute(sql`
    select status, count(*)::int as count
    from app_queue_job
    where status in ('PENDING', 'PROCESSING', 'FAILED')
    group by status
  `);

  const depth: QueueDepth = { pending: 0, processing: 0, failed: 0 };
  for (const row of getExecuteRows(result)) {
    const record = toRecord(row);
    const count =
      typeof record.count === "number" && Number.isFinite(record.count)
        ? record.count
        : 0;
    if (record.status === "PENDING") depth.pending = count;
    else if (record.status === "PROCESSING") depth.processing = count;
    else if (record.status === "FAILED") depth.failed = count;
  }

  return depth;
}

// Count rows that are claimable right now — PENDING and past their availability.
// This includes rows just reclaimed by releaseStaleQueueJobs AND rows stranded in
// PENDING by a dropped wake ping (nothing re-claims them until a NEW enqueue
// happens). The periodic backstop uses this to know whether a stuck job needs the
// worker woken, independent of any new enqueue.
export async function countRecoverableQueueJobs(): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as count
    from app_queue_job
    where status = 'PENDING'
      and available_at <= now()
  `);

  const [row] = getExecuteRows(result);
  const count = toRecord(row).count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}
