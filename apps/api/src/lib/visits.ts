import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  calibrationVisit,
  type VisitStatus,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

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
): Promise<void> {
  if (!visitId) return;

  const [visit] = await db
    .select({ status: calibrationVisit.status })
    .from(calibrationVisit)
    .where(eq(calibrationVisit.id, visitId))
    .limit(1);

  if (!visit) return;
  if (visit.status === "CANCELLED" || visit.status === "COMPLETED") return;

  const jobs = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.visitId, visitId));

  if (jobs.length === 0) return;

  const allSettled = jobs.every((job) => SETTLED_JOB_STATES.has(job.status));
  const anyApproved = jobs.some(
    (job) => job.status === "APPROVED" || job.status === "SUPERSEDED",
  );
  const anyStarted = jobs.some((job) => job.status !== "DRAFT");

  let nextStatus: VisitStatus = visit.status;
  if (allSettled && anyApproved) {
    nextStatus = "COMPLETED";
  } else if (
    anyStarted &&
    (visit.status === "PROPOSED" || visit.status === "CONFIRMED")
  ) {
    nextStatus = "IN_PROGRESS";
  }

  if (nextStatus !== visit.status) {
    await db
      .update(calibrationVisit)
      .set({ status: nextStatus })
      .where(eq(calibrationVisit.id, visitId));
  }
}
