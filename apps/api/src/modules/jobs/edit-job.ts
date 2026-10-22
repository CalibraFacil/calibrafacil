import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobAuditLog,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { targetOf } from "@calibra-facil/schemas/job-transitions";
import { calendarDateKey } from "@calibra-facil/shared";
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
 * Edit the plain fields of a job (technician, due date): the ONE implementation
 * behind the cloud `PUT /jobs/:id` and the public API `PATCH /jobs/:id`.
 * Status is never editable here; every transition has its own command.
 *
 *   1. load the job (organization + unit scope)
 *   2. the transition table (`edit`): APPROVED, SUPERSEDED (an issued
 *      certificate an amendment replaced) and CANCELED jobs are frozen
 *   3. a changed technician must be assignable in the job's unit (decision
 *      Q25, the same rule as `assignJob`) and hold an active competence for
 *      the job's instrument type (§6.2.5, decision Q26, the same gate)
 *   4. what actually changed: a field sent with its current value is not a
 *      change, and the due date is a calendar day (the same day at another
 *      hour is not a change). Nothing changed: nothing is written
 *   5. the compare-and-set write and its audit row, in one transaction
 *
 * A refusal writes nothing. Notifying a newly assigned technician is the
 * caller's, after the write (`changed.technician`).
 */
export type EditJobCommand = {
  actor: JobLifecycleActor;
  jobId: number;
  organizationId: string;
  /** The units the caller may act in; `null` is organization-wide (an API key). */
  unitScope: UnitScope | null;
  /** `undefined` leaves the technician alone; `null` clears it. */
  technicianId?: string | null;
  /** `undefined` leaves the due date alone; `null` clears it. */
  dueDate?: string | null;
};

export type EditJobResult =
  | {
      status: "ok";
      /** The updated row, or the job as read when nothing changed. */
      job: JobRow;
      previousStatus: JobStatus;
      changed: { technician: boolean; dueDate: boolean };
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

export async function editJob(command: EditJobCommand): Promise<EditJobResult> {
  const { actor, organizationId } = command;

  const existing = await loadScopedJob({
    jobId: command.jobId,
    organizationId,
    unitScope: command.unitScope,
  });
  if (!existing) return { status: "not_found" };

  if (targetOf(existing.status, "edit") === null) {
    return {
      status: "illegal_transition",
      currentStatus: existing.status,
      error: invalid(
        "job_not_editable",
        `Nao e possivel atualizar um job com status ${existing.status}`,
      ),
    };
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const set: Partial<Pick<JobRow, "technicianId" | "dueDate">> = {};

  if (
    command.technicianId !== undefined &&
    command.technicianId !== existing.technicianId
  ) {
    if (command.technicianId) {
      // Q25: the one technician rule; Q26: the one competence gate, as in
      // `assignJob`.
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
    }
    changes.technicianId = {
      old: existing.technicianId,
      new: command.technicianId,
    };
    set.technicianId = command.technicianId;
  }

  if (command.dueDate !== undefined) {
    const newDueDate = command.dueDate ? new Date(command.dueDate) : null;
    const oldDueDate = existing.dueDate;
    // due_date is a calendar day: the same day typed at another hour is not a
    // change.
    if (
      (newDueDate ? calendarDateKey(newDueDate) : null) !==
      (oldDueDate ? calendarDateKey(oldDueDate) : null)
    ) {
      changes.dueDate = {
        old: oldDueDate?.toISOString() || null,
        new: newDueDate?.toISOString() || null,
      };
      set.dueDate = newDueDate;
    }
  }

  if (Object.keys(set).length === 0) {
    return {
      status: "ok",
      job: existing,
      previousStatus: existing.status,
      changed: { technician: false, dueDate: false },
    };
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(calibrationJob)
      .set(set)
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
      action: "update",
      changes: { ...jobActorAuditFields(actor), ...changes },
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
    changed: {
      technician: changes.technicianId !== undefined,
      dueDate: changes.dueDate !== undefined,
    },
  };
}
