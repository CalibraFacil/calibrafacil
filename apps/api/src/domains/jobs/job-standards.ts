import { CERTIFICATE_ISSUED_JOB_STATUSES } from "@calibra-facil/schemas";
import type { OrgDb, OrgExecutor } from "@calibra-facil/db/for-org";
import {
  calibrationJob,
  customer,
  jobStandard,
  ootNotification,
  standardRecall,
  type JobStatus,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

/**
 * Reverse traceability: keeps the `job_standard` join table in
 * sync with `calibration_job.standards_snapshot`. The frozen JSONB snapshot
 * remains the source of truth — these rows are a derived, indexed projection
 * that makes "which certificates relied on standard X" a relational query.
 *
 * Called after every write that persists the snapshot (submit, execute/save,
 * amend), on the same org-bound transaction as that write: the links commit
 * with the snapshot they mirror, and a failure rolls the write back instead of
 * leaving the index missing. Idempotent full rewrite per job.
 *
 * `organizationId` is the job's laboratory; the composite (organization_id,
 * job_id) foreign key rejects a pair that is not the same tenant.
 *
 * `executor` is the org-bound handle of the caller (row-level security).
 */
export async function syncJobStandardLinks(
  jobId: number,
  snapshot: StandardSnapshot[] | null | undefined,
  usedAt: Date | null | undefined,
  organizationId: string,
  executor: OrgDb,
): Promise<void> {
  // undefined = "snapshot untouched by this write" — keep existing links.
  if (snapshot === undefined) return;

  const rewrite = async (tx: Pick<OrgExecutor, "insert" | "delete">) => {
    await tx
      .delete(jobStandard)
      .where(
        and(
          eq(jobStandard.jobId, jobId),
          eq(jobStandard.organizationId, organizationId),
        ),
      );

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
          organizationId,
          jobId,
          standardId,
          usedAt: usedAt ?? new Date(),
        })),
      )
      .onConflictDoNothing();
  };
  await executor.transaction(rewrite);
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
 * Reverse-traceability query: approved certificates that
 * relied on a reference standard, date-bounded by approval time. Amendment
 * chains are collapsed — when both the superseded original and its
 * replacement relied on the standard, only the current certificate is
 * listed; a superseded original whose replacement did NOT use the standard
 * is kept, annotated with the replacement's identity.
 */
export async function findImpactedCertificates(
  input: {
    standardId: number;
    organizationId: string;
    from: Date;
    to: Date;
  },
  /** The org-bound handle of the caller's transaction (row-level security). */
  executor: Pick<OrgExecutor, "select">,
): Promise<ImpactedCertificate[]> {
  const rows = await executor
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
        inArray(calibrationJob.status, CERTIFICATE_ISSUED_JOB_STATUSES),
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
    ? await executor
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
  const notifiedRows = await executor
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

/**
 * The statuses of a job that is still on its way to a certificate: a recalled
 * standard on any of them reaches a NEW certificate unless somebody acts.
 * GENERATING_PDF is already approved (the worker is rendering it): it is
 * listed so the laboratory can stop or amend it, not because approval can still
 * refuse it; RENDER_FAILED likewise (its render is retried or the job rejected).
 */
const IN_FLIGHT_JOB_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
  "GENERATING_PDF",
  "RENDER_FAILED",
] as const satisfies readonly JobStatus[];

export type InFlightJob = {
  jobId: number;
  certificateNumber: string;
  status: string;
  performedAt: Date | null;
  customer: { id: number; name: string };
};

/**
 * Recall impact beyond the issued certificates (ISO/IEC 17025
 * §6.4, §7.10): the jobs in flight (`IN_FLIGHT_JOB_STATUSES`) that carry the
 * standard in their saved snapshot (the `job_standard` projection). Not
 * date-bounded: none of them is issued yet. Tenant-scoped in SQL.
 */
export async function findInFlightJobsUsingStandard(
  input: { standardId: number; organizationId: string },
  /** The org-bound handle of the caller's transaction (row-level security). */
  executor: Pick<OrgExecutor, "select">,
): Promise<InFlightJob[]> {
  const rows = await executor
    .select({
      jobId: calibrationJob.id,
      certificateNumber: calibrationJob.jobId,
      status: calibrationJob.status,
      performedAt: calibrationJob.performedAt,
      customerId: customer.id,
      customerName: customer.name,
    })
    .from(jobStandard)
    .innerJoin(calibrationJob, eq(jobStandard.jobId, calibrationJob.id))
    .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
    .where(
      and(
        eq(jobStandard.standardId, input.standardId),
        eq(jobStandard.organizationId, input.organizationId),
        eq(calibrationJob.organizationId, input.organizationId),
        inArray(calibrationJob.status, [...IN_FLIGHT_JOB_STATUSES]),
      ),
    )
    .orderBy(desc(calibrationJob.updatedAt));

  return rows.map((row) => ({
    jobId: row.jobId,
    certificateNumber: row.certificateNumber,
    status: row.status,
    performedAt: row.performedAt,
    customer: { id: row.customerId, name: row.customerName },
  }));
}
