import { db } from "@calibra-facil/db";
import { calibrationJob, type JobStatus } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

/**
 * Job status machine (calibration_job.status), as enforced by the API:
 *
 *   DRAFT ──execute──▶ IN_PROGRESS ──submit──▶ REVIEW ──approve──▶ GENERATING_PDF
 *     │ └──────────submit───────────▶ REVIEW        │                  │ (worker)
 *     │                                  ▲  reject   ▼                  ▼
 *     │                                  └────── REJECTED          APPROVED ──amend──▶ SUPERSEDED
 *     └─ cancel (DRAFT, IN_PROGRESS, REVIEW, REJECTED) ─▶ CANCELED
 *
 * GENERATING_PDF is an approval in progress and is owned by the worker, which
 * moves it to APPROVED (or REJECTED on failure). APPROVED, SUPERSEDED and
 * CANCELED are terminal for cancellation.
 *
 * Every transition is a compare-and-set on the status the request validated,
 * in one transaction with its audit row; losing the race is a 409.
 */

/**
 * Explicit allow-list of the states a job may be cancelled from. Deliberately
 * NOT a deny-list: any status added to the machine later is non-cancellable
 * until someone decides otherwise.
 */
const CANCELABLE_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
  "REJECTED",
]);

export function isCancelableJobStatus(status: JobStatus): boolean {
  return CANCELABLE_JOB_STATUSES.has(status);
}

/** Thrown inside a transaction to roll it back when a compare-and-set loses. */
export class JobStatusConflictError extends Error {
  constructor() {
    super("O status do job mudou durante a operacao");
    this.name = "JobStatusConflictError";
  }
}

/** Body of the 409 returned when a status compare-and-set matched no row. */
export async function buildJobStatusConflict(jobId: number) {
  const [current] = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId))
    .limit(1);

  return {
    error:
      "O status do job mudou durante a operacao. Recarregue e tente novamente.",
    code: "JOB_STATUS_CONFLICT",
    currentStatus: current?.status ?? null,
  };
}
