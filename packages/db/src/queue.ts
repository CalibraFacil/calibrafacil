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

function isQueueMessage(value: unknown): value is QueueMessage {
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
    case "CERTIFICATE_XLSX_PREVIEW":
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

export async function releaseStaleQueueJobs(staleAfterMs = 10 * 60_000) {
  const staleBefore = new Date(Date.now() - staleAfterMs);

  await db.execute(sql`
    update app_queue_job
    set status = 'PENDING',
        locked_by = null,
        locked_at = null,
        updated_at = now()
    where status = 'PROCESSING'
      and locked_at < ${staleBefore.toISOString()}::timestamptz
  `);
}
