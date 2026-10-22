import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobAuditLog,
  type JobStatus,
} from "@calibra-facil/db/schema";
import {
  requireTargetOf,
  targetOf,
} from "@calibra-facil/schemas/job-transitions";
import { and, eq } from "drizzle-orm";
import { invalid, type DomainError } from "../../lib/domain-errors";
import {
  jobActorAuditFields,
  loadScopedJob,
  type JobLifecycleActor,
  type JobRow,
  type UnitScope,
} from "./job-actor";

/**
 * Reject a job under review (REVIEW -> REJECTED): the ONE implementation behind
 * the cloud route and the public API. A reject sends the job back to the
 * technician with a written reason, so the reason is part of the command.
 *
 *   1. load the job (organization + unit scope)
 *   2. the transition table (`reject`)
 *   3. the compare-and-set write and its audit row, in one transaction: the
 *      write carries `WHERE id AND organization_id AND status = <status read>`,
 *      so a job that moved (approved, canceled, left the organization) between
 *      the read and the write matches no row and yields `concurrent_update`.
 *
 * A refusal writes nothing. Who may reject (`calibration:reject`) is decided by
 * the route's guard, never here.
 */
export type RejectJobCommand = {
  actor: JobLifecycleActor;
  jobId: number;
  organizationId: string;
  /** The units the caller may act in; `null` is organization-wide (an API key). */
  unitScope: UnitScope | null;
  reason: string;
};

export type RejectJobResult =
  | { status: "ok"; job: JobRow; previousStatus: JobStatus }
  | { status: "not_found" }
  | {
      status: "illegal_transition";
      currentStatus: JobStatus;
      error: DomainError;
    }
  /** The job left the status (or organization) it was judged in; nothing written. */
  | { status: "concurrent_update" };

export async function rejectJob(
  command: RejectJobCommand,
): Promise<RejectJobResult> {
  const { actor, organizationId } = command;

  const existing = await loadScopedJob({
    jobId: command.jobId,
    organizationId,
    unitScope: command.unitScope,
  });
  if (!existing) return { status: "not_found" };

  if (targetOf(existing.status, "reject") === null) {
    return {
      status: "illegal_transition",
      currentStatus: existing.status,
      error: invalid(
        "job_not_rejectable",
        `Nao e possivel rejeitar um job com status ${existing.status}. O job deve estar em REVIEW.`,
      ),
    };
  }

  const rejectedStatus = requireTargetOf(existing.status, "reject");
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(calibrationJob)
      .set({
        status: rejectedStatus,
        rejectedBy: actor.userId,
        rejectedAt: new Date(),
        rejectionReason: command.reason,
      })
      .where(
        and(
          eq(calibrationJob.id, existing.id),
          eq(calibrationJob.organizationId, organizationId),
          eq(calibrationJob.status, existing.status),
        ),
      )
      .returning();
    if (!row) return null;

    await tx.insert(jobAuditLog).values({
      organizationId,
      jobId: existing.id,
      action: "reject",
      changes: {
        ...jobActorAuditFields(actor),
        status: { old: existing.status, new: rejectedStatus },
      },
      performedBy: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      reason: command.reason,
    });
    return row;
  });
  if (!updated) return { status: "concurrent_update" };

  return { status: "ok", job: updated, previousStatus: existing.status };
}
