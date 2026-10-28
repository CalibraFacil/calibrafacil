import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";
import {
  allowedFrom,
  requireTargetOf,
} from "@calibra-facil/schemas/job-transitions";
import { db, systemDb } from "./db.js";
import { forOrg } from "./for-org.js";
import { appendJobEvent, type RenderRejectionTrigger } from "./job-events.js";
import { appQueueJob, calibrationJob } from "./schema.js";
import type { DeadLetteredQueueJob } from "./queue.js";

// Recovery for certificate renders that a hard crash (or a dropped queue message)
// left in GENERATING_PDF with nothing left to move them.
//
// The worker marks a failed certificate job RENDER_FAILED itself (apps/worker/src/index.ts,
// `setJobError`) when it is alive to do so. When it is not — the process was
// killed on the last attempt, or the job ran out of its
// retries — the calibration_job would sit in GENERATING_PDF forever. These
// helpers apply the SAME transition (GENERATING_PDF -> RENDER_FAILED, compare-and-set
// on status, with a job_audit_log row in the same transaction) from the queue
// backstop.
//
// They touch ONLY a job that is still GENERATING_PDF and has no live queue row.
// They never reserve a certificate number and never read or write
// issued_certificate_snapshot; an APPROVED / SUPERSEDED job is out of reach by
// the status predicate (and by the calibration_job immutability trigger).

const REASON_PREFIX = "Erro ao gerar certificado: ";

/** The status a certificate render is in; `fail_render` leaves it (job-transitions). */
const RENDERING_STATUS = "GENERATING_PDF";

/**
 * Why the backstop rejected a render. Written to the audit row so an auditor can
 * tell an automatic rejection from the approver's own action: `rejected_by` /
 * `performed_by` carry the approver (job_audit_log.performed_by is a NOT NULL FK
 * to user and there is no system user), so the marker is the only difference.
 */
export type { RenderRejectionTrigger };

export const RENDER_REJECTION_SOURCE = "queue-backstop";

/** Human-readable (pt-BR) reason a dead-lettered render was rejected. */
const DEAD_LETTER_REASON =
  "o processo de geração foi interrompido de forma inesperada na última tentativa e a fila desistiu do trabalho. Envie o certificado para aprovação novamente.";

function stuckRenderReason(stuckAfterMs: number): string {
  const minutes = Math.max(1, Math.round(stuckAfterMs / 60_000));
  return `a geração não foi concluída em ${minutes} min e não há trabalho de geração pendente na fila. Envie o certificado para aprovação novamente.`;
}

/** A live certificate-render queue row for `jobId` (PENDING or PROCESSING). */
function liveRenderRowFor(jobId: number) {
  return db
    .select({ one: sql`1` })
    .from(appQueueJob)
    .where(
      and(
        eq(appQueueJob.type, "CERTIFICATE"),
        inArray(appQueueJob.status, ["PENDING", "PROCESSING"]),
        sql`${appQueueJob.payload} ->> 'jobId' = ${String(jobId)}`,
      ),
    );
}

/**
 * GENERATING_PDF -> RENDER_FAILED for one job, with its audit row in the same
 * transaction. Compare-and-set on the status (and organization), so a job that
 * was approved, cancelled or re-released in the meantime is never flipped by a
 * late recovery. Returns whether this call rejected the job.
 */
export async function rejectCertificateRender(params: {
  jobId: number;
  organizationId: string;
  rejectedBy: string;
  reason: string;
  trigger: RenderRejectionTrigger;
  /** The dead-lettered app_queue_job row, when that is what triggered this. */
  queueJobId?: number;
  /** Only reject a job not touched since this instant (the stuck sweep). */
  notUpdatedSince?: Date;
}): Promise<boolean> {
  const now = new Date();
  const renderingStatus = RENDERING_STATUS;
  const failedStatus = requireTargetOf(renderingStatus, "fail_render");

  // The rejection runs in a transaction that names the job's laboratory
  // (row-level security): the status write and its audit row, scoped to it.
  return forOrg(db, params.organizationId).transaction(async (tx) => {
    const updated = await tx
      .update(calibrationJob)
      .set({
        status: failedStatus,
        rejectionReason: `${REASON_PREFIX}${params.reason}`,
        rejectedBy: params.rejectedBy,
        rejectedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(calibrationJob.id, params.jobId),
          eq(calibrationJob.organizationId, params.organizationId),
          inArray(calibrationJob.status, allowedFrom("fail_render")),
          params.notUpdatedSince
            ? lt(calibrationJob.updatedAt, params.notUpdatedSince)
            : undefined,
          // Never reject a render another delivery may still complete.
          notExists(liveRenderRowFor(params.jobId)),
        ),
      )
      .returning();

    if (updated.length === 0) return false;

    await appendJobEvent(tx, {
      action: "certificate_error",
      organizationId: params.organizationId,
      jobId: params.jobId,
      actor: {
        kind: "system",
        source: "queue-backstop",
        onBehalfOf: params.rejectedBy,
      },
      changes: {
        status: { old: renderingStatus, new: failedStatus },
        source: RENDER_REJECTION_SOURCE,
        reason: params.trigger,
        ...(params.queueJobId === undefined
          ? {}
          : { queueJobId: params.queueJobId }),
      },
      performedAt: now,
      reason: params.reason,
    });
    return true;
  });
}

type CertificateRenderPayload = { jobId: number; userId: string };

function readCertificateRenderPayload(
  job: DeadLetteredQueueJob,
): CertificateRenderPayload | null {
  if (job.type !== "CERTIFICATE") return null;
  const { jobId, userId, type } = job.payload;
  if (type !== undefined && type !== "CERTIFICATE") return null;
  if (typeof jobId !== "number" || !Number.isInteger(jobId)) return null;
  if (typeof userId !== "string" || userId.length === 0) return null;
  return { jobId, userId };
}

/**
 * Rejects the calibration_job of every dead-lettered certificate-render queue
 * row that is still GENERATING_PDF. Rows of other types are ignored. A failure
 * on one job is logged and does not stop the others (the stuck-render sweep is
 * the safety net for anything missed here). Returns how many jobs were rejected.
 */
export async function rejectDeadLetteredCertificateRenders(
  deadLettered: readonly DeadLetteredQueueJob[],
): Promise<number> {
  let rejected = 0;

  for (const queueJob of deadLettered) {
    const payload = readCertificateRenderPayload(queueJob);
    if (!payload) continue;

    try {
      // The queue payload does not carry the tenant: resolve it from the job
      // itself, then scope every write by it. This lookup is what LEARNS the
      // laboratory, so it runs on the system path (the owner connection); the
      // rejection itself runs in the laboratory's own transaction.
      // oxlint-disable-next-line eslint/no-await-in-loop -- one short transaction per job, kept sequential so a failure stays isolated and logged.
      const [job] = await systemDb
        .select({ organizationId: calibrationJob.organizationId })
        .from(calibrationJob)
        .where(eq(calibrationJob.id, payload.jobId))
        .limit(1);
      if (!job) continue;

      // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
      const done = await rejectCertificateRender({
        jobId: payload.jobId,
        organizationId: job.organizationId,
        rejectedBy: payload.userId,
        reason: DEAD_LETTER_REASON,
        trigger: "dead-lettered",
        queueJobId: queueJob.id,
      });
      if (done) rejected += 1;
    } catch (error) {
      console.error(
        `[QueueDeadLetter] failed to reject certificate job ${payload.jobId} (queue row ${queueJob.id})`,
        error,
      );
    }
  }

  return rejected;
}

const STUCK_RENDER_BATCH = 200;

function readRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const { rows } = result;
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

type StuckRender = {
  id: number;
  organizationId: string;
  actor: string;
};

function toStuckRender(value: unknown): StuckRender | null {
  if (!value || typeof value !== "object") return null;
  const {
    id,
    organization_id: organizationId,
    actor,
  } = Object.fromEntries(Object.entries(value));
  if (
    typeof id !== "number" ||
    typeof organizationId !== "string" ||
    typeof actor !== "string"
  ) {
    return null;
  }
  return { id, organizationId, actor };
}

/**
 * Rejects every calibration_job that has been GENERATING_PDF for longer than
 * `stuckAfterMs` (measured from updated_at) and has no PENDING / PROCESSING
 * certificate-render queue row — the shape a job that ran out of
 * its retries leaves behind. The sweep is cross-tenant by design (a platform
 * cron); each rejection is scoped by the job's own organization. The actor is
 * the user who released the certificate (approved_by), falling back to its
 * creator. Returns how many jobs were rejected.
 */
export async function rejectStuckCertificateRenders(
  stuckAfterMs: number,
): Promise<number> {
  const stuckBefore = new Date(Date.now() - stuckAfterMs);

  // Cross-tenant by design (a platform cron): the candidates of every laboratory
  // are listed on the system path; each rejection then runs in its own
  // laboratory's transaction.
  const candidates = await systemDb.execute(sql`
    select
      cj.id as id,
      cj.organization_id as organization_id,
      coalesce(cj.approved_by, cj.created_by) as actor
    from calibration_job cj
    where cj.status = 'GENERATING_PDF'
      and cj.updated_at < ${stuckBefore.toISOString()}::timestamp
      and not exists (
        select 1
        from app_queue_job q
        where q.type = 'CERTIFICATE'
          and q.status in ('PENDING', 'PROCESSING')
          and q.payload ->> 'jobId' = cj.id::text
      )
    order by cj.updated_at asc
    limit ${STUCK_RENDER_BATCH}
  `);

  let rejected = 0;
  for (const raw of readRows(candidates)) {
    const candidate = toStuckRender(raw);
    if (!candidate) continue;

    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one short transaction per job, kept sequential so a failure stays isolated and logged.
      const done = await rejectCertificateRender({
        jobId: candidate.id,
        organizationId: candidate.organizationId,
        rejectedBy: candidate.actor,
        reason: stuckRenderReason(stuckAfterMs),
        trigger: "stuck-render",
        notUpdatedSince: stuckBefore,
      });
      if (done) rejected += 1;
    } catch (error) {
      console.error(
        `[QueueDeadLetter] failed to reject stuck certificate job ${candidate.id}`,
        error,
      );
    }
  }

  return rejected;
}
