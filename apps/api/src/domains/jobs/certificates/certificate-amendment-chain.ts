import { calibrationJob, type JobStatus } from "@calibra-facil/db/schema";
import { CERTIFICATE_ISSUED_JOB_STATUSES } from "@calibra-facil/schemas";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { OrgRawTransaction } from "../../../lib/org-transaction";
import { executeRows } from "../../../lib/db";
import { orgSetDb } from "../../../lib/org-db";

/**
 * Portal-facing amendment-chain resolution — ISO/IEC 17025:2017 §7.8.8
 * ("Amendments to reports"). Mirrors the public verification endpoint's
 * semantics (apps/api/src/domains/verify/routes/verify.ts):
 *
 * - A certificate reads as superseded as soon as `supersededById` is set —
 *   the customer must stop using it even while the replacement is still
 *   being issued.
 * - Chain LINKS (the neighbour's id/jobId, used by the portal to navigate)
 *   are only surfaced once the neighbour is itself in a terminal,
 *   portal-visible status. A DRAFT replacement must not be linkable as "the
 *   current version", and a reopened original must not leak through an
 *   already-approved amendment.
 */

export type AmendmentChainJob = {
  id: number;
  jobId: string;
  status: JobStatus;
  supersedesId: number | null;
  supersededById: number | null;
  amendmentNumber: number | null;
  amendmentReason: string | null;
  approvedAt: Date | null;
  supersededAt: Date | null;
};

/**
 * Resolves one chain neighbour by id, or null when it must not be surfaced
 * (non-terminal status, other tenant, or missing). The DB-backed loader is
 * `createPortalAmendmentChainLoader`; tests inject fakes.
 */
export type AmendmentChainLoader = (
  id: number,
) => Promise<AmendmentChainJob | null>;

type PortalAmendmentChainMember = {
  id: number;
  jobId: string;
  amendmentNumber: number | null;
  approvedAt: Date | null;
  /** True for the chain's current (not superseded) member. */
  isCurrent: boolean;
};

export type PortalAmendmentInfo = {
  isAmendment: boolean;
  isSuperseded: boolean;
  amendmentNumber: number | null;
  amendmentReason: string | null;
  supersededAt: Date | null;
  /** Immediate original this certificate replaces, when surfaceable. */
  supersedes: { id: number; jobId: string } | null;
  /** Immediate replacement of this certificate, when surfaceable. */
  supersededBy: {
    id: number;
    jobId: string;
    amendmentNumber: number | null;
    approvedAt: Date | null;
  } | null;
  /**
   * Full surfaceable chain, oldest → newest, always including the viewed
   * certificate. Length 1 means "no amendment history to show".
   */
  chain: PortalAmendmentChainMember[];
};

// Guards against corrupted supersedes links (cycles / runaway chains).
const MAX_CHAIN_WALK = 25;

export async function resolvePortalAmendmentInfo(
  job: AmendmentChainJob,
  loadChainJob: AmendmentChainLoader,
): Promise<PortalAmendmentInfo> {
  const seen = new Set<number>([job.id]);

  // Walk back to the original. Each link is gated by the loader, so the
  // walk stops at the first non-surfaceable ancestor.
  const ancestors: AmendmentChainJob[] = [];
  let cursor = job.supersedesId;
  while (cursor !== null && !seen.has(cursor) && seen.size <= MAX_CHAIN_WALK) {
    const member = await loadChainJob(cursor);
    if (!member) break;
    seen.add(member.id);
    ancestors.unshift(member);
    cursor = member.supersedesId;
  }

  // Walk forward to the latest surfaceable replacement.
  const successors: AmendmentChainJob[] = [];
  cursor = job.supersededById;
  while (cursor !== null && !seen.has(cursor) && seen.size <= MAX_CHAIN_WALK) {
    const member = await loadChainJob(cursor);
    if (!member) break;
    seen.add(member.id);
    successors.push(member);
    cursor = member.supersededById;
  }

  const supersedes = ancestors.at(-1) ?? null;
  const supersededBy = successors.at(0) ?? null;

  const chain = [...ancestors, job, ...successors].map((member) => ({
    id: member.id,
    jobId: member.jobId,
    amendmentNumber: member.amendmentNumber,
    approvedAt: member.approvedAt,
    isCurrent: member.supersededById === null && member.status === "APPROVED",
  }));

  return {
    isAmendment: job.supersedesId !== null,
    isSuperseded: job.supersededById !== null || job.status === "SUPERSEDED",
    amendmentNumber: job.amendmentNumber,
    amendmentReason: job.amendmentReason,
    supersededAt: job.supersededAt,
    supersedes: supersedes
      ? { id: supersedes.id, jobId: supersedes.jobId }
      : null,
    supersededBy: supersededBy
      ? {
          id: supersededBy.id,
          jobId: supersededBy.jobId,
          amendmentNumber: supersededBy.amendmentNumber,
          approvedAt: supersededBy.approvedAt,
        }
      : null,
    chain,
  };
}

/**
 * DB-backed chain loader for the authenticated portal. Every lookup stays
 * inside the caller's customer scope (tenant safety — chain members are
 * same-customer by construction, but the query enforces it anyway) and only
 * returns terminal, portal-visible certificates.
 */
export function createPortalAmendmentChainLoader(params: {
  customerIds: number[];
  /** The laboratories those customers belong to (see orgSetDb). */
  organizationIds: readonly string[];
}): AmendmentChainLoader {
  const o = orgSetDb(params.organizationIds);
  return async (id) => {
    if (params.customerIds.length === 0) return null;
    const [row] = await o
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        status: calibrationJob.status,
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        amendmentReason: calibrationJob.amendmentReason,
        approvedAt: calibrationJob.approvedAt,
        supersededAt: calibrationJob.supersededAt,
      })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.id, id),
          inArray(calibrationJob.customerId, params.customerIds),
          inArray(calibrationJob.status, CERTIFICATE_ISSUED_JOB_STATUSES),
        ),
      )
      .limit(1);
    return row ?? null;
  };
}

/** Safety limit against a loop in corrupted data. */
const MAX_AMENDMENT_CHAIN_LENGTH = 100;

/**
 * The whole amendment history of a certificate: from the job, up to its original
 * (`supersedes_id`) and down to the latest replacement (`superseded_by_id`),
 * oldest first (ISO/IEC 17025 §7.8.4.1 traceability of amendments). A recursive
 * CTE the org-bound handle cannot express, so it takes the raw transaction of the
 * caller's `withOrg`; every table of it carries the organization predicate.
 */
export async function loadAmendmentChain(
  tx: Pick<OrgRawTransaction, "execute">,
  params: { jobId: number; organizationId: string },
) {
  const result = await tx.execute(sql`
        WITH RECURSIVE ancestors AS (
          SELECT
            id,
            supersedes_id,
            0::integer AS depth,
            ARRAY[id]::integer[] AS path
          FROM calibration_job
          WHERE id = ${params.jobId}
            AND organization_id = ${params.organizationId}

          UNION ALL

          SELECT
            parent.id,
            parent.supersedes_id,
            ancestors.depth + 1,
            ancestors.path || parent.id
          FROM calibration_job parent
          INNER JOIN ancestors ON parent.id = ancestors.supersedes_id
          WHERE parent.organization_id = ${params.organizationId}
            AND ancestors.depth < ${MAX_AMENDMENT_CHAIN_LENGTH}
            AND NOT (parent.id = ANY(ancestors.path))
        ),
        root_job AS (
          SELECT id
          FROM ancestors
          ORDER BY depth DESC
          LIMIT 1
        ),
        chain AS (
          SELECT
            job.id,
            job.job_id,
            job.status,
            job.amendment_number,
            job.amendment_reason,
            job.approved_at,
            job.superseded_at,
            job.superseded_by_id,
            0::integer AS depth,
            ARRAY[job.id]::integer[] AS path
          FROM calibration_job job
          INNER JOIN root_job ON root_job.id = job.id
          WHERE job.organization_id = ${params.organizationId}

          UNION ALL

          SELECT
            child.id,
            child.job_id,
            child.status,
            child.amendment_number,
            child.amendment_reason,
            child.approved_at,
            child.superseded_at,
            child.superseded_by_id,
            chain.depth + 1,
            chain.path || child.id
          FROM calibration_job child
          INNER JOIN chain ON child.id = chain.superseded_by_id
          WHERE child.organization_id = ${params.organizationId}
            AND chain.depth < ${MAX_AMENDMENT_CHAIN_LENGTH}
            AND NOT (child.id = ANY(chain.path))
        )
        SELECT
          id,
          job_id,
          status,
          amendment_number,
          amendment_reason,
          approved_at,
          superseded_at,
          depth
        FROM chain
        ORDER BY depth ASC;
      `);
  return executeRows(
    result,
    z
      .object({
        id: z.coerce.number(),
        job_id: z.string(),
        status: z.string(),
        amendment_number: z.coerce.number().nullable(),
        amendment_reason: z.string().nullable(),
        approved_at: z.coerce.date().nullable(),
        superseded_at: z.coerce.date().nullable(),
      })
      .transform((row) => ({
        id: row.id,
        jobId: row.job_id,
        status: row.status,
        amendmentNumber: row.amendment_number,
        amendmentReason: row.amendment_reason,
        approvedAt: row.approved_at,
        supersededAt: row.superseded_at,
      })),
  );
}
