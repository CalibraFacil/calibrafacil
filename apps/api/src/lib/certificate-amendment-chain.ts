import { db } from "@calibra-facil/db";
import { calibrationJob, type JobStatus } from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Portal-facing amendment-chain resolution — ISO/IEC 17025:2017 §7.8.8
 * ("Amendments to reports"). Mirrors the public verification endpoint's
 * semantics (apps/api/src/routes/verify.ts):
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

export const PORTAL_TERMINAL_CERTIFICATE_STATUSES: JobStatus[] = [
  "APPROVED",
  "SUPERSEDED",
];

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

export type PortalAmendmentChainMember = {
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
}): AmendmentChainLoader {
  return async (id) => {
    if (params.customerIds.length === 0) return null;
    const [row] = await db
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
          inArray(calibrationJob.status, PORTAL_TERMINAL_CERTIFICATE_STATUSES),
        ),
      )
      .limit(1);
    return row ?? null;
  };
}
