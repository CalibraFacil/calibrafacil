import { sql, eq } from "drizzle-orm";
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
  | { type: "SCHEDULED_NOTIFICATIONS" }
  | { type: "PORTAL_DIGEST" }
  | { type: "MARKETING_CONTACT_SYNC" }
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

function isQueueMessage(value: unknown): value is QueueMessage {
  return (
    isBackgroundJobMessage(value) &&
    value.type !== "SCHEDULED_NOTIFICATIONS" &&
    value.type !== "PORTAL_DIGEST" &&
    value.type !== "MARKETING_CONTACT_SYNC"
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

export async function enqueueQueueJob(
  message: QueueMessage,
  options: { maxAttempts?: number; availableAt?: Date } = {},
) {
  const availableAt = options.availableAt ?? new Date();

  const result = await db.execute(sql`
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

export async function completeQueueJob(id: number) {
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

export async function failQueueJob(id: number, error: unknown) {
  const [job] = await db
    .select({
      attempts: appQueueJob.attempts,
      maxAttempts: appQueueJob.maxAttempts,
    })
    .from(appQueueJob)
    .where(eq(appQueueJob.id, id))
    .limit(1);

  if (!job) return;

  const exhausted = job.attempts >= job.maxAttempts;
  const lastError = error instanceof Error ? error.message : String(error);
  const status: AppQueueJobStatus = exhausted ? "FAILED" : "PENDING";
  const availableAt = exhausted
    ? new Date()
    : new Date(Date.now() + getRetryDelayMs(job.attempts));

  await db
    .update(appQueueJob)
    .set({
      status,
      availableAt,
      lockedBy: null,
      lockedAt: null,
      lastError,
      updatedAt: new Date(),
    })
    .where(eq(appQueueJob.id, id));
}

// Reclaim rows whose PROCESSING lease has expired (a worker died mid-job, or a
// drain crashed) back to PENDING so they can be claimed again. Returns the number
// of rows reclaimed so a periodic backstop can decide whether to re-drive the
// drain (see apps/api/src/lib/stale-job-backstop.ts / the queue-backstop cron).
export async function releaseStaleQueueJobs(
  staleAfterMs = 10 * 60_000,
): Promise<number> {
  const staleBefore = new Date(Date.now() - staleAfterMs);

  const result = await db.execute(sql`
    update app_queue_job
    set status = 'PENDING',
        locked_by = null,
        locked_at = null,
        updated_at = now()
    where status = 'PROCESSING'
      and locked_at < ${staleBefore.toISOString()}::timestamptz
    returning id
  `);

  return getExecuteRows(result).length;
}

export type QueueDepth = {
  pending: number;
  processing: number;
  failed: number;
};

// Backlog snapshot by status for the /api/health readiness probe.
// Cheap aggregate over the (small, pruned) queue table — informational only;
// alerting on FAILED rows stays in the operator-alerts engine.
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
