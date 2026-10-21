import { db } from "@calibra-facil/db";
import { calibrationJob, type JobStatus } from "@calibra-facil/db/schema";
import { canTransition } from "@calibra-facil/schemas/job-transitions";
import { eq } from "drizzle-orm";
import { conflict } from "../../lib/domain-errors";

/**
 * Job status machine (calibration_job.status), as enforced by the API. The
 * machine itself is DATA: packages/schemas/src/job-transitions.ts. This is a
 * picture of it:
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
 * The states a job may be cancelled from: a view of the transition table
 * (`@calibra-facil/schemas/job-transitions`), not a list of its own. A status
 * added to the machine later is non-cancellable until the table says so.
 */
export function isCancelableJobStatus(status: JobStatus): boolean {
  return canTransition(status, "cancel");
}

/** Thrown inside a transaction to roll it back when a compare-and-set loses. */
export class JobStatusConflictError extends Error {
  constructor() {
    super("O status do job mudou durante a operacao");
    this.name = "JobStatusConflictError";
  }
}

/**
 * The 409 returned when a status compare-and-set matched no row: the job moved
 * under the caller. Wire shape is unchanged for existing clients (legacy
 * upper-case code + top-level `currentStatus`); `details` carries the same
 * status for new clients.
 */
export async function jobStatusConflict(jobId: number) {
  const [current] = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId))
    .limit(1);
  const currentStatus = current?.status ?? null;

  return conflict(
    "JOB_STATUS_CONFLICT",
    "O status do job mudou durante a operacao. Recarregue e tente novamente.",
    { details: { currentStatus }, legacyBody: { currentStatus } },
  );
}
