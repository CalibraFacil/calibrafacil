/**
 * The real routes stamp "now" on every row they write. A calibration that was
 * approved six weeks ago must read as approved six weeks ago, so once a job has
 * gone through the real pipeline its timestamps are rewritten to the planned
 * timeline: the job, its audit trail, its certificate snapshot and the frozen
 * environment/location snapshots all move together.
 */
import { db } from "@calibra-facil/db";
import {
  assetAuditLog,
  calibrationJob,
  issuedCertificateSnapshot,
  jobAuditLog,
  jobCommercialSnapshot,
  jobStandard,
} from "@calibra-facil/db/schema";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import type { PlannedJob } from "./job-plan";

const MINUTE_MS = 60_000;

export type JobMoments = Pick<
  PlannedJob,
  | "createdAt"
  | "dueDate"
  | "performedAt"
  | "submittedAt"
  | "decidedAt"
  | "final"
>;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

/** When an audit entry of this kind happened on the planned timeline. */
function auditTime(action: string, index: number, moments: JobMoments): Date {
  const created = moments.createdAt;
  const performed = moments.performedAt ?? addMinutes(created, 90);
  const submitted = moments.submittedAt ?? addMinutes(performed, 20);
  const decided = moments.decidedAt ?? submitted;
  switch (action) {
    case "create":
      return created;
    case "assign":
      return addMinutes(created, 4 + index);
    case "execute":
      return addMinutes(performed, -45 + index * 6);
    case "submit":
      return submitted;
    case "approve":
    case "reject":
      return decided;
    case "certificate_generated":
      return addMinutes(decided, 1);
    default:
      return addMinutes(decided, 2 + index);
  }
}

/** Rewrites every "now" the pipeline left on a job to the planned timeline. */
export async function applyJobTimeline(
  jobId: number,
  assetId: number,
  moments: JobMoments,
  seedStartedAt: Date,
): Promise<void> {
  const decided = moments.decidedAt ?? null;
  const approved = moments.final === "APPROVED";
  const rejected = moments.final === "REJECTED";
  const lastEvent = decided ?? moments.submittedAt ?? moments.createdAt;

  await db
    .update(calibrationJob)
    .set({
      createdAt: moments.createdAt,
      updatedAt: lastEvent,
      dueDate: moments.dueDate,
      ...(moments.performedAt ? { performedAt: moments.performedAt } : {}),
      ...(approved && decided ? { approvedAt: decided } : {}),
      ...(rejected && decided ? { rejectedAt: decided } : {}),
    })
    .where(eq(calibrationJob.id, jobId));

  // The frozen snapshots carry their own capture instants.
  const recordedAt = (moments.performedAt ?? moments.createdAt).toISOString();
  await db.execute(sql`
    update calibration_job set
      environmental_snapshot = case when environmental_snapshot is null then null
        else jsonb_set(environmental_snapshot, '{recordedAt}', to_jsonb(${recordedAt}::text)) end,
      calibration_location_snapshot = case when calibration_location_snapshot is null then null
        else jsonb_set(calibration_location_snapshot, '{recordedAt}', to_jsonb(${recordedAt}::text)) end,
      certificate_numbering_snapshot = case when certificate_numbering_snapshot is null then null
        else jsonb_set(certificate_numbering_snapshot, '{generatedAt}', to_jsonb(${moments.createdAt.toISOString()}::text)) end,
      asset_snapshot = case when asset_snapshot is null then null
        else jsonb_set(asset_snapshot, '{capturedAt}', to_jsonb(${moments.createdAt.toISOString()}::text)) end
    where id = ${jobId}
  `);

  const entries = await db
    .select({ id: jobAuditLog.id, action: jobAuditLog.action })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, jobId))
    .orderBy(asc(jobAuditLog.id));
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const index = seen.get(entry.action) ?? 0;
    seen.set(entry.action, index + 1);
    // eslint-disable-next-line no-await-in-loop
    await db
      .update(jobAuditLog)
      .set({ performedAt: auditTime(entry.action, index, moments) })
      .where(eq(jobAuditLog.id, entry.id));
  }

  await db
    .update(jobCommercialSnapshot)
    .set({ capturedAt: moments.createdAt })
    .where(eq(jobCommercialSnapshot.jobId, jobId));
  await db
    .update(jobStandard)
    .set({ usedAt: moments.performedAt ?? moments.createdAt })
    .where(eq(jobStandard.jobId, jobId));

  if (approved && decided) {
    await db
      .update(issuedCertificateSnapshot)
      .set({
        issuedAt: addMinutes(decided, 1),
        createdAt: addMinutes(decided, 1),
      })
      .where(eq(issuedCertificateSnapshot.jobId, jobId));
    // "Last calibration date advanced" is logged when the job is approved.
    await db
      .update(assetAuditLog)
      .set({ performedAt: decided })
      .where(
        and(
          eq(assetAuditLog.assetId, assetId),
          eq(assetAuditLog.action, "update"),
          gt(assetAuditLog.performedAt, seedStartedAt),
        ),
      );
  }
}
