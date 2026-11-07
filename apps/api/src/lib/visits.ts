import { db } from "@calibra-facil/db";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  calibrationJob,
  calibrationVisit,
  visitRescheduleRequest,
  type VisitStatus,
} from "@calibra-facil/db/schema";
import {
  VISIT_MACHINE,
  VISIT_RESCHEDULE_REQUEST_MACHINE,
  isVisitTerminal,
} from "@calibra-facil/schemas/machines";
import { and, eq, inArray } from "drizzle-orm";

/** Job states that mean the technician is done with that instrument. */
const SETTLED_JOB_STATES = new Set(["APPROVED", "SUPERSEDED", "CANCELED"]);

/**
 * Roll a visit's lifecycle forward from its child jobs (one visit fans out to
 * N jobs, one per instrument). Advances PROPOSED/CONFIRMED → IN_PROGRESS once
 * any job leaves DRAFT, and → COMPLETED once every job is settled with at
 * least one approved cert. Never downgrades and never touches a CANCELLED or
 * already-COMPLETED visit. Safe to call after any job status change; a no-op
 * when the job has no visit.
 */
export async function syncVisitStatusFromJobs(
  visitId: number | null | undefined,
  // The org-bound handle of a caller that runs under row-level security; the
  // default is the plain `db`, as before.
  executor: Pick<OrgExecutor, "select" | "update"> = db,
): Promise<void> {
  if (!visitId) return;

  const [visit] = await executor
    .select({ status: calibrationVisit.status })
    .from(calibrationVisit)
    .where(eq(calibrationVisit.id, visitId))
    .limit(1);

  if (!visit) return;
  if (isVisitTerminal(visit.status)) return;

  const jobs = await executor
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.visitId, visitId));

  if (jobs.length === 0) return;

  const allSettled = jobs.every((job) => SETTLED_JOB_STATES.has(job.status));
  const anyApproved = jobs.some(
    (job) => job.status === "APPROVED" || job.status === "SUPERSEDED",
  );
  const anyStarted = jobs.some((job) => job.status !== "DRAFT");

  // `settle` / `start` in VISIT_MACHINE; a visit already past them is left alone.
  const command =
    allSettled && anyApproved ? "settle" : anyStarted ? "start" : null;
  if (!command || !VISIT_MACHINE.canTransition(visit.status, command)) return;
  const nextStatus: VisitStatus = VISIT_MACHINE.requireTargetOf(
    visit.status,
    command,
  );

  const moved = await executor
    .update(calibrationVisit)
    .set({ status: nextStatus })
    .where(
      and(
        eq(calibrationVisit.id, visitId),
        eq(calibrationVisit.status, visit.status),
      ),
    )
    .returning({ id: calibrationVisit.id });
  if (moved.length > 0 && command === "settle") {
    // A finished trip has no date to move: its pending customer request is
    // superseded with it.
    await executor
      .update(visitRescheduleRequest)
      .set({ status: "SUPERSEDED", resolvedAt: new Date() })
      .where(
        and(
          eq(visitRescheduleRequest.visitId, visitId),
          inArray(
            visitRescheduleRequest.status,
            VISIT_RESCHEDULE_REQUEST_MACHINE.allowedFrom("supersede"),
          ),
        ),
      );
  }
}
