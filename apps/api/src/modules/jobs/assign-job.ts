import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobAuditLog,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { targetOf } from "@calibra-facil/schemas/job-transitions";
import { and, eq } from "drizzle-orm";
import { invalid, type DomainError } from "../../lib/domain-errors";
import {
  jobActorAuditFields,
  loadScopedJob,
  type JobLifecycleActor,
  type JobRow,
  type UnitScope,
} from "./job-actor";
import {
  findAssignableTechnician,
  technicianCompetenceMissing,
  technicianCompetentForJobService,
  technicianNotFound,
} from "./technician-assignment";

/**
 * Assign a technician to a job: the ONE implementation behind the cloud route.
 *
 *   1. load the job (organization + unit scope)
 *   2. the transition table (`assign`, decision Q19): only DRAFT, IN_PROGRESS,
 *      REVIEW and REJECTED take a technician; CANCELED, GENERATING_PDF,
 *      APPROVED and SUPERSEDED are refused
 *   3. the technician: a member of the organization with an assignment in the
 *      job's unit (org admins and owners need none)
 *   4. ISO/IEC 17025 §6.2.5: an active competence for the instrument type of
 *      the job's service, once the organization keeps competence records
 *   5. the compare-and-set write and its audit row, in one transaction
 *
 * A refusal writes nothing. The status is kept. Notifying the technician is
 * the caller's, after the write.
 */
export type AssignJobCommand = {
  actor: JobLifecycleActor;
  jobId: number;
  organizationId: string;
  /** The units the caller may act in; `null` is organization-wide. */
  unitScope: UnitScope | null;
  technicianId: string;
};

export type AssignJobResult =
  | {
      status: "ok";
      job: JobRow;
      previousStatus: JobStatus;
      technicianName: string;
    }
  | { status: "not_found" }
  | {
      status: "illegal_transition";
      currentStatus: JobStatus;
      error: DomainError;
    }
  | { status: "technician_not_found"; error: DomainError }
  | { status: "competence_missing"; error: DomainError }
  /** The job left the status (or organization) it was judged in; nothing written. */
  | { status: "concurrent_update" };

export async function assignJob(
  command: AssignJobCommand,
): Promise<AssignJobResult> {
  const { actor, organizationId } = command;

  const existing = await loadScopedJob({
    jobId: command.jobId,
    organizationId,
    unitScope: command.unitScope,
  });
  if (!existing) return { status: "not_found" };

  if (targetOf(existing.status, "assign") === null) {
    return {
      status: "illegal_transition",
      currentStatus: existing.status,
      error: invalid(
        "job_not_assignable",
        `Nao e possivel atribuir tecnico a um job com status ${existing.status}`,
      ),
    };
  }

  const technician = await findAssignableTechnician({
    organizationId,
    userId: command.technicianId,
    unitId: existing.unitId,
  });
  if (!technician) {
    return { status: "technician_not_found", error: technicianNotFound() };
  }

  if (
    !(await technicianCompetentForJobService({
      organizationId,
      technicianId: technician.userId,
      serviceId: existing.serviceId,
    }))
  ) {
    return {
      status: "competence_missing",
      error: technicianCompetenceMissing(),
    };
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(calibrationJob)
      .set({ technicianId: technician.userId })
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
      jobId: existing.id,
      action: "assign",
      changes: {
        ...jobActorAuditFields(actor),
        technicianId: {
          old: existing.technicianId,
          new: technician.userId,
        },
        technicianName: { old: null, new: technician.name },
      },
      performedBy: actor.userId,
      ipAddress: actor.ipAddress ?? null,
    });
    return row;
  });
  if (!updated) return { status: "concurrent_update" };

  return {
    status: "ok",
    job: updated,
    previousStatus: existing.status,
    technicianName: technician.name,
  };
}
