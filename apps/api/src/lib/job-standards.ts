import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  customer,
  jobStandard,
  ootNotification,
  standardRecall,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

/**
 * Reverse traceability (#426 Phase 1): keeps the `job_standard` join table in
 * sync with `calibration_job.standards_snapshot`. The frozen JSONB snapshot
 * remains the source of truth — these rows are a derived, indexed projection
 * that makes "which certificates relied on standard X" a relational query.
 *
 * Called after every write that persists the snapshot (submit, execute/save,
 * desktop-sync ingest). Idempotent full rewrite per job. Failures are logged
 * but never propagate: a derived-index hiccup must not fail a calibration
 * save; drift is repairable by re-running the same rewrite (or the migration
 * backfill logic) since the snapshot is retained.
 */
export async function syncJobStandardLinks(
  jobId: number,
  snapshot: StandardSnapshot[] | null | undefined,
  usedAt?: Date | null,
): Promise<void> {
  // undefined = "snapshot untouched by this write" — keep existing links.
  if (snapshot === undefined) return;

  try {
    await db.transaction(async (tx) => {
      await tx.delete(jobStandard).where(eq(jobStandard.jobId, jobId));

      const standardIds = [
        ...new Set(
          (snapshot ?? [])
            .map((entry) => entry.id)
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ];
      if (standardIds.length === 0) return;

      await tx
        .insert(jobStandard)
        .values(
          standardIds.map((standardId) => ({
            jobId,
            standardId,
            usedAt: usedAt ?? new Date(),
          })),
        )
        .onConflictDoNothing();
    });
  } catch (error) {
    console.error(
      `[JobStandards] Failed to sync standard links for job ${jobId}:`,
      error,
    );
  }
}

export type ImpactedCertificate = {
  jobId: number;
  certificateNumber: string;
  status: string;
  approvedAt: Date | null;
  performedAt: Date | null;
  customer: { id: number; name: string; email: string | null };
  /** Set when this certificate was amended — the replacement's identifiers. */
  supersededByJobId: number | null;
  supersededByCertificateNumber: string | null;
  /** A recall notification for this certificate already exists. */
  alreadyNotified: boolean;
};

/**
 * Reverse-traceability query (#426 Phase 1): approved certificates that
 * relied on a reference standard, date-bounded by approval time. Amendment
 * chains are collapsed — when both the superseded original and its
 * replacement relied on the standard, only the current certificate is
 * listed; a superseded original whose replacement did NOT use the standard
 * is kept, annotated with the replacement's identity.
 */
export async function findImpactedCertificates(input: {
  standardId: number;
  organizationId: string;
  from: Date;
  to: Date;
}): Promise<ImpactedCertificate[]> {
  const rows = await db
    .select({
      jobId: calibrationJob.id,
      certificateNumber: calibrationJob.jobId,
      status: calibrationJob.status,
      approvedAt: calibrationJob.approvedAt,
      performedAt: calibrationJob.performedAt,
      supersededById: calibrationJob.supersededById,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
    })
    .from(jobStandard)
    .innerJoin(calibrationJob, eq(jobStandard.jobId, calibrationJob.id))
    .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
    .where(
      and(
        eq(jobStandard.standardId, input.standardId),
        eq(calibrationJob.organizationId, input.organizationId),
        inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        gte(calibrationJob.approvedAt, input.from),
        lte(calibrationJob.approvedAt, input.to),
      ),
    )
    .orderBy(desc(calibrationJob.approvedAt));

  if (rows.length === 0) return [];

  const jobIdsInSet = new Set(rows.map((row) => row.jobId));

  // Collapse amendment chains: drop a superseded original when its
  // replacement is itself in the impacted set.
  const collapsed = rows.filter(
    (row) => !(row.supersededById && jobIdsInSet.has(row.supersededById)),
  );

  // Resolve replacement identity for kept superseded rows.
  const replacementIds = [
    ...new Set(
      collapsed
        .map((row) => row.supersededById)
        .filter((id): id is number => id !== null),
    ),
  ];
  const replacements = replacementIds.length
    ? await db
        .select({ id: calibrationJob.id, jobId: calibrationJob.jobId })
        .from(calibrationJob)
        .where(inArray(calibrationJob.id, replacementIds))
    : [];
  const replacementNumberById = new Map(
    replacements.map((row) => [row.id, row.jobId]),
  );

  // Already-notified flag: an existing notification for this certificate in
  // ANY recall of this standard.
  const collapsedJobIds = collapsed.map((row) => row.jobId);
  const notifiedRows = await db
    .select({ jobId: ootNotification.jobId })
    .from(ootNotification)
    .innerJoin(standardRecall, eq(ootNotification.recallId, standardRecall.id))
    .where(
      and(
        eq(standardRecall.standardId, input.standardId),
        inArray(ootNotification.jobId, collapsedJobIds),
      ),
    );
  const notifiedJobIds = new Set(notifiedRows.map((row) => row.jobId));

  return collapsed.map((row) => ({
    jobId: row.jobId,
    certificateNumber: row.certificateNumber,
    status: row.status,
    approvedAt: row.approvedAt,
    performedAt: row.performedAt,
    customer: {
      id: row.customerId,
      name: row.customerName,
      email: row.customerEmail,
    },
    supersededByJobId: row.supersededById,
    supersededByCertificateNumber: row.supersededById
      ? (replacementNumberById.get(row.supersededById) ?? null)
      : null,
    alreadyNotified: notifiedJobIds.has(row.jobId),
  }));
}
