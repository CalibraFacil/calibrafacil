import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobAuditLog,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { requireTargetOf } from "@calibra-facil/schemas/job-transitions";
import { and, eq } from "drizzle-orm";
import { invalid, type DomainError } from "../../lib/domain-errors";
import {
  jobActorAuditFields,
  loadScopedJob,
  type JobLifecycleActor,
  type JobRow,
  type UnitScope,
} from "./job-actor";
import { isCancelableJobStatus } from "./job-status-transitions";

/**
 * Cancel a job (the soft delete: status CANCELED, the row and its history
 * stay): the ONE implementation behind the cloud route, the public API
 * (`DELETE /jobs/:id`) and the visit's remove-job.
 *
 *   1. load the job (organization + unit scope)
 *   2. the transition table (`cancel`): APPROVED (immutable, ISO/IEC 17025),
 *      SUPERSEDED, CANCELED and GENERATING_PDF (an approval in progress, owned
 *      by the worker) are refused
 *   3. the compare-and-set write and its audit row, in one transaction
 *
 * A refusal writes nothing.
 */
export type CancelJobCommand = {
  actor: JobLifecycleActor;
  jobId: number;
  organizationId: string;
  /** The units the caller may act in; `null` is organization-wide (an API key). */
  unitScope: UnitScope | null;
  reason: string;
  /**
   * The status the caller's own checks validated (the visit's remove-job
   * judges DRAFT only). A job in any other status when the command reads it is
   * `concurrent_update`, even if that status is cancelable too.
   */
  expectedStatus?: JobStatus;
};

export type CancelJobResult =
  | { status: "ok"; job: JobRow; previousStatus: JobStatus }
  | { status: "not_found" }
  | {
      status: "illegal_transition";
      currentStatus: JobStatus;
      error: DomainError;
    }
  /** The job left the status (or organization) it was judged in; nothing written. */
  | { status: "concurrent_update" };

function cancelRefusal(status: JobStatus): DomainError {
  if (status === "APPROVED") {
    return invalid(
      "job_not_cancelable",
      "Nao e possivel cancelar um job aprovado. Jobs aprovados sao imutaveis para conformidade ISO 17025.",
    );
  }
  if (status === "CANCELED") {
    return invalid("job_not_cancelable", "Job ja foi cancelado");
  }
  return invalid(
    "job_not_cancelable",
    `Nao e possivel cancelar um job com status ${status}.`,
  );
}

export async function cancelJob(
  command: CancelJobCommand,
): Promise<CancelJobResult> {
  const { actor, organizationId } = command;

  const existing = await loadScopedJob({
    jobId: command.jobId,
    organizationId,
    unitScope: command.unitScope,
  });
  if (!existing) return { status: "not_found" };

  if (!isCancelableJobStatus(existing.status)) {
    return {
      status: "illegal_transition",
      currentStatus: existing.status,
      error: cancelRefusal(existing.status),
    };
  }
  if (command.expectedStatus && command.expectedStatus !== existing.status) {
    return { status: "concurrent_update" };
  }

  const canceledStatus = requireTargetOf(existing.status, "cancel");
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(calibrationJob)
      .set({ status: canceledStatus })
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
      action: "cancel",
      changes: {
        ...jobActorAuditFields(actor),
        status: { old: existing.status, new: canceledStatus },
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
