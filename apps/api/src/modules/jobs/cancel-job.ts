import { db } from "@calibra-facil/db";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { appendJobEvent } from "@calibra-facil/db/job-events";
import { calibrationJob, type JobStatus } from "@calibra-facil/db/schema";
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

type CancelJobTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * How a caller that runs under row-level security reaches the database: the
 * read of the job and the transaction of the write each name the organization
 * (`orgDb(org).transaction`, `orgTransactionWithExecutor`). Both default to the
 * plain `db`, which is what the jobs routes and the public API still use. The
 * read and the write stay two transactions on purpose: the compare-and-set
 * below is what protects the status between them.
 */
export type CancelJobRunners = {
  read?: <R>(
    run: (reader: Pick<OrgExecutor, "select">) => Promise<R>,
  ) => Promise<R>;
  write?: <R>(run: (tx: CancelJobTransaction) => Promise<R>) => Promise<R>;
};

export async function cancelJob(
  command: CancelJobCommand,
  runners: CancelJobRunners = {},
): Promise<CancelJobResult> {
  const { actor, organizationId } = command;
  const read = runners.read ?? ((run) => run(db));
  const write = runners.write ?? ((run) => db.transaction(run));

  const existing = await read((reader) =>
    loadScopedJob(
      {
        jobId: command.jobId,
        organizationId,
        unitScope: command.unitScope,
      },
      reader,
    ),
  );
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
  const updated = await write(async (tx) => {
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

    await appendJobEvent(tx, {
      action: "cancel",
      organizationId,
      jobId: existing.id,
      actor: { kind: "user", userId: actor.userId },
      changes: {
        ...jobActorAuditFields(actor),
        status: { old: existing.status, new: canceledStatus },
      },
      ipAddress: actor.ipAddress ?? null,
      reason: command.reason,
    });
    return row;
  });
  if (!updated) return { status: "concurrent_update" };

  return { status: "ok", job: updated, previousStatus: existing.status };
}
