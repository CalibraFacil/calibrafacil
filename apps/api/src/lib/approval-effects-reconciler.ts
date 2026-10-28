/**
 * Nightly reconciler of the post-approval effects (roadmap 2 B2, ISO/IEC
 * 17025 7.10).
 *
 * Since B2 the approval transaction writes the asset out-of-tolerance event and
 * the asset calibration-date advance (each with its audit row) and stages the
 * notification jobs, so a new approval cannot lose them. This sweep repairs what
 * can still be missing: approvals committed BEFORE that change (their follow-ups
 * ran after the commit and a crash or a deploy lost them) and notification jobs
 * the queue gave up on. It finds, within a bounded look-back window:
 *
 * 1. approved NON_CONFORMING jobs with no `asset_oot_event`: it writes the event
 *    and its audit row (marked `reconciled`) and stages the customer alert in the
 *    same transaction;
 * 2. approved jobs whose asset's last calibration date is older than the job's
 *    own date: it advances the dates the same forward-only way the approval does,
 *    with an audit row whose source is `job_approval_reconciliation`;
 * 3. OOT events whose customer alert never left (no `notify` audit entry and no
 *    live queue job): it stages the alert again.
 *
 * Idempotent: each repair is guarded by the state it fixes (the event's unique
 * job key, the forward-only date rule, the `notify` audit entry), so a second
 * run finds nothing. A job approved less than `graceMinutes` ago is left alone
 * (its own approval may still be completing on an older build).
 *
 * The look-back window exists on purpose: the first run after the upgrade must
 * not notify customers about calibrations from years ago (the gap that predates
 * the out-of-tolerance event itself). Gaps older than the window are counted and
 * logged, never repaired, so the owner can decide.
 *
 * Cross-laboratory by design (cron, no request): FOUR statements on the system
 * path (`systemDb`, allowlisted in test/integration/tenant-sql-allowlist.ts) list
 * the candidates of every laboratory, ids only. Everything after that runs per
 * job in a transaction that names its laboratory (`orgTransactionWithExecutor`),
 * which re-reads the job under row-level security before it writes.
 */

import { systemDb } from "@calibra-facil/db";
import {
  appQueueJob,
  asset,
  assetOotAuditLog,
  assetOotEvent,
  calibrationJob,
  type JobStatus,
} from "@calibra-facil/db/schema";
import type { QueueMessage } from "@calibra-facil/schemas";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { advanceAssetCalibrationDates } from "./asset-calibration-advance";
import { recordAssetOotEvent } from "./asset-oot-events";
import {
  dispatchStagedBackgroundJob,
  stageBackgroundJob,
} from "./background-job-outbox";
import { enqueueBackgroundJob } from "./background-jobs";
import { orgTransactionWithExecutor } from "./org-transaction";

/** A job approved this recently is not reconciled yet. */
const RECONCILE_GRACE_MINUTES = 15;
/** How far back a gap is repaired; older gaps are only counted and logged. */
const RECONCILE_LOOKBACK_DAYS = 30;
const DEFAULT_BATCH_SIZE = 200;

/**
 * The statuses of a job that was approved (REVIEW has not, REJECTED/CANCELED are
 * not released). RENDER_FAILED is an approval whose PDF failed: the approval
 * stands until a manager retries the render or rejects the job.
 */
const APPROVED_STATUSES: JobStatus[] = [
  "GENERATING_PDF",
  "RENDER_FAILED",
  "APPROVED",
  "SUPERSEDED",
];

/**
 * The statuses whose out-of-tolerance verdict still stands. A SUPERSEDED job's
 * verdict was replaced by its amendment (which may have corrected it), so the
 * reconciler never creates an event, nor alerts a customer, for one: the
 * amendment's own approval carries the effect.
 */
const CURRENT_VERDICT_STATUSES: JobStatus[] = [
  "GENERATING_PDF",
  "RENDER_FAILED",
  "APPROVED",
];

export type ApprovalEffectsReconcileResult = {
  /** Out-of-tolerance events written for approvals that lacked one. */
  ootEventsCreated: number;
  /** Assets whose calibration dates were advanced. */
  assetDatesAdvanced: number;
  /** Customer out-of-tolerance alerts staged again. */
  notificationsRestaged: number;
  /** Candidates whose repair failed (logged, retried by the next run). */
  failures: number;
  /** Non-conforming approved jobs older than the window with no event (not repaired). */
  ootGapsOlderThanWindow: number;
};

export type ApprovalEffectsReconcileOptions = {
  now?: Date;
  graceMinutes?: number;
  lookbackDays?: number;
  batchSize?: number;
};

type Candidate = { organizationId: string; jobId: number };

export async function reconcileApprovalEffects(
  options: ApprovalEffectsReconcileOptions = {},
): Promise<ApprovalEffectsReconcileResult> {
  const now = options.now ?? new Date();
  const graceMinutes = options.graceMinutes ?? RECONCILE_GRACE_MINUTES;
  const lookbackDays = options.lookbackDays ?? RECONCILE_LOOKBACK_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const newest = new Date(now.getTime() - graceMinutes * 60_000);
  const oldest = new Date(now.getTime() - lookbackDays * 24 * 60 * 60_000);

  const result: ApprovalEffectsReconcileResult = {
    ootEventsCreated: 0,
    assetDatesAdvanced: 0,
    notificationsRestaged: 0,
    failures: 0,
    ootGapsOlderThanWindow: 0,
  };
  // Jobs staged in the database queue wait for one wake-up at the end.
  let stagedAny = false;
  const afterCommit: QueueMessage[] = [];

  // ---- 1. approved NON_CONFORMING jobs with no out-of-tolerance event --------
  // System path (cron, every laboratory): ids only.
  const missingEvents: Candidate[] = await systemDb
    .select({
      organizationId: calibrationJob.organizationId,
      jobId: calibrationJob.id,
    })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.asFoundConformity, "NON_CONFORMING"),
        inArray(calibrationJob.status, CURRENT_VERDICT_STATUSES),
        isNotNull(calibrationJob.approvedBy),
        gte(calibrationJob.approvedAt, oldest),
        lte(calibrationJob.approvedAt, newest),
        notExists(
          systemDb
            .select({ one: sql`1` })
            .from(assetOotEvent)
            .where(eq(assetOotEvent.jobId, calibrationJob.id)),
        ),
      ),
    )
    .orderBy(calibrationJob.approvedAt)
    .limit(batchSize);

  for (const candidate of missingEvents) {
    try {
      const staged = await repairMissingOotEvent(candidate, afterCommit);
      if (staged === null) continue;
      result.ootEventsCreated += 1;
      stagedAny = stagedAny || staged;
    } catch (error) {
      result.failures += 1;
      console.error(
        `[approval-reconciler] Could not write the out-of-tolerance event of job ${candidate.jobId}:`,
        error,
      );
    }
  }

  // The gaps the window leaves alone, so they are visible instead of silent.
  const [older] = await systemDb
    .select({ count: sql<number>`count(*)::int` })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.asFoundConformity, "NON_CONFORMING"),
        inArray(calibrationJob.status, CURRENT_VERDICT_STATUSES),
        isNotNull(calibrationJob.approvedBy),
        lt(calibrationJob.approvedAt, oldest),
        notExists(
          systemDb
            .select({ one: sql`1` })
            .from(assetOotEvent)
            .where(eq(assetOotEvent.jobId, calibrationJob.id)),
        ),
      ),
    );
  result.ootGapsOlderThanWindow = older?.count ?? 0;
  if (result.ootGapsOlderThanWindow > 0) {
    console.warn(
      `[approval-reconciler] ${result.ootGapsOlderThanWindow} approved non-conforming job(s) older than ${lookbackDays} days have no out-of-tolerance event; not repaired automatically.`,
    );
  }

  // ---- 2. approved jobs whose asset dates were not advanced ------------------
  // The job's own date is `performed_at`, else the approval time; newest first,
  // so the latest calibration of an asset advances it and the older ones are
  // no-ops (forward-only). `<` on the UTC day is a superset of the lab-day rule
  // the per-job decision applies (the lab zone is behind UTC).
  const jobDate = sql`coalesce(${calibrationJob.performedAt}, ${calibrationJob.approvedAt})`;
  const staleDates: Candidate[] = await systemDb
    .select({
      organizationId: calibrationJob.organizationId,
      jobId: calibrationJob.id,
    })
    .from(calibrationJob)
    .innerJoin(asset, eq(asset.id, calibrationJob.assetId))
    .where(
      and(
        inArray(calibrationJob.status, APPROVED_STATUSES),
        isNotNull(calibrationJob.approvedBy),
        gte(calibrationJob.approvedAt, oldest),
        lte(calibrationJob.approvedAt, newest),
        isNull(asset.deletedAt),
        or(
          isNull(asset.lastCalibrationDate),
          sql`${asset.lastCalibrationDate} < (${jobDate})::date`,
        ),
      ),
    )
    .orderBy(desc(jobDate))
    .limit(batchSize);

  for (const candidate of staleDates) {
    try {
      const advanced = await repairStaleAssetDates(candidate);
      if (advanced) result.assetDatesAdvanced += 1;
    } catch (error) {
      result.failures += 1;
      console.error(
        `[approval-reconciler] Could not advance the asset dates of job ${candidate.jobId}:`,
        error,
      );
    }
  }

  // ---- 3. out-of-tolerance events whose customer alert never left ------------
  const unnotified = await systemDb
    .select({
      eventId: assetOotEvent.id,
      organizationId: assetOotEvent.labOrganizationId,
      approvedBy: calibrationJob.approvedBy,
    })
    .from(assetOotEvent)
    .innerJoin(calibrationJob, eq(calibrationJob.id, assetOotEvent.jobId))
    .where(
      and(
        isNotNull(calibrationJob.approvedBy),
        // No late alert for a verdict an amendment has since replaced.
        inArray(calibrationJob.status, CURRENT_VERDICT_STATUSES),
        gte(assetOotEvent.createdAt, oldest),
        lte(assetOotEvent.createdAt, newest),
        notExists(
          systemDb
            .select({ one: sql`1` })
            .from(assetOotAuditLog)
            .where(
              and(
                eq(assetOotAuditLog.eventId, assetOotEvent.id),
                eq(assetOotAuditLog.action, "notify"),
              ),
            ),
        ),
        // Not while the queue still holds the alert (pending or being sent).
        notExists(
          systemDb
            .select({ one: sql`1` })
            .from(appQueueJob)
            .where(
              and(
                eq(appQueueJob.type, "ASSET_OOT_NOTIFICATION"),
                inArray(appQueueJob.status, ["PENDING", "PROCESSING"]),
                sql`${appQueueJob.payload} ->> 'eventId' = ${assetOotEvent.id}::text`,
              ),
            ),
        ),
      ),
    )
    .orderBy(assetOotEvent.createdAt)
    .limit(batchSize);

  for (const event of unnotified) {
    if (event.approvedBy === null) continue;
    const message: QueueMessage = {
      type: "ASSET_OOT_NOTIFICATION",
      eventId: event.eventId,
      organizationId: event.organizationId,
      userId: event.approvedBy,
    };
    try {
      const staged = await orgTransactionWithExecutor(
        event.organizationId,
        (_o, tx) => stageBackgroundJob(tx, message),
      );
      if (staged) stagedAny = true;
      else afterCommit.push(message);
      result.notificationsRestaged += 1;
    } catch (error) {
      result.failures += 1;
      console.error(
        `[approval-reconciler] Could not re-stage the notification of OOT event ${event.eventId}:`,
        error,
      );
    }
  }

  // ---- delivery: everything above is committed ------------------------------
  if (stagedAny) await dispatchStagedBackgroundJob();
  for (const message of afterCommit) {
    try {
      await enqueueBackgroundJob(message);
    } catch (error) {
      console.error("[approval-reconciler] Could not dispatch a job", {
        type: message.type,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  console.info("[approval-reconciler] done", result);
  return result;
}

/**
 * Write the event of one approved NON_CONFORMING job and stage its customer
 * alert in the same transaction. Returns null when there was nothing to do (the
 * job is no longer a candidate, or the event exists), else whether the alert
 * went to the database queue (false: the caller dispatches it after the commit).
 */
async function repairMissingOotEvent(
  candidate: Candidate,
  afterCommit: QueueMessage[],
): Promise<boolean | null> {
  const outcome = await orgTransactionWithExecutor(
    candidate.organizationId,
    async (o, tx) => {
      const [job] = await o
        .select({
          assetId: calibrationJob.assetId,
          customerId: calibrationJob.customerId,
          approvedBy: calibrationJob.approvedBy,
          approvedAt: calibrationJob.approvedAt,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, candidate.jobId),
            eq(calibrationJob.asFoundConformity, "NON_CONFORMING"),
            inArray(calibrationJob.status, CURRENT_VERDICT_STATUSES),
          ),
        )
        .limit(1)
        // Holds the status against a concurrent transition (amendment, a
        // failed render) until this repair commits.
        .for("share");
      if (!job?.approvedBy || !job.approvedAt) return null;

      const event = await recordAssetOotEvent(o, {
        jobId: candidate.jobId,
        assetId: job.assetId,
        customerId: job.customerId,
        labOrganizationId: candidate.organizationId,
        detectedAt: job.approvedAt,
        actorUserId: job.approvedBy,
        reconciled: true,
      });
      if (!event) return null;

      const message: QueueMessage = {
        type: "ASSET_OOT_NOTIFICATION",
        eventId: event.eventId,
        organizationId: candidate.organizationId,
        userId: job.approvedBy,
      };
      return { message, staged: await stageBackgroundJob(tx, message) };
    },
  );
  if (!outcome) return null;
  if (!outcome.staged) afterCommit.push(outcome.message);
  return outcome.staged !== null;
}

/** Advance the asset of one approved job, forward-only, in its laboratory. */
async function repairStaleAssetDates(candidate: Candidate): Promise<boolean> {
  const applied = await orgTransactionWithExecutor(
    candidate.organizationId,
    async (o) => {
      const [job] = await o
        .select({
          assetId: calibrationJob.assetId,
          performedAt: calibrationJob.performedAt,
          approvedAt: calibrationJob.approvedAt,
          approvedBy: calibrationJob.approvedBy,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, candidate.jobId),
            inArray(calibrationJob.status, APPROVED_STATUSES),
          ),
        )
        .limit(1)
        .for("share");
      if (!job?.approvedBy) return null;

      return advanceAssetCalibrationDates(o, {
        assetId: job.assetId,
        calibrationDate: job.performedAt ?? job.approvedAt ?? null,
        performedBy: job.approvedBy,
        source: "job_approval_reconciliation",
      });
    },
  );
  return applied !== null;
}
