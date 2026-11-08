import { readJobsConfig } from "@calibra-facil/config";
import {
  countRecoverableQueueJobs,
  releaseStaleQueueJobs,
  type DeadLetteredQueueJob,
  type ReleaseStaleQueueJobsResult,
} from "@calibra-facil/db/queue";
import { pruneQueueReceipts } from "@calibra-facil/db/queue-receipts";
import {
  rejectDeadLetteredCertificateRenders,
  rejectStuckCertificateRenders,
} from "@calibra-facil/db/queue-render-recovery";
import { reportServerError } from "./observability";

// Periodic orphan-job backstop.
//
// The worker reclaims expired leases on every poll, but it can be down, and the
// lease of a job that crashed it on its final attempt has to be settled by
// someone. This backstop (the `queue-backstop` cron of the API) reclaims on a
// timer, independent of any worker, so a stuck job is recovered within a
// bounded interval:
//   1. reclaim expired PROCESSING leases -> PENDING (or FAILED when the lease
//      expired on the row's final attempt: a job that crashes the worker process
//      must not be re-claimed forever),
//   2. mark RENDER_FAILED the GENERATING_PDF certificate of every row dead-lettered in (1),
//   3. mark RENDER_FAILED certificates stuck in GENERATING_PDF past STUCK_RENDER_AFTER_MS
//      with no live queue row (a job that ran out of its retries),
//   4. count what is now claimable (reclaimed + any stranded PENDING), for the
//      cron's summary: the polling worker claims those rows itself,
//   5. prune aged idempotency receipts.
//
// Steps 2-3 only ever move a job GENERATING_PDF -> RENDER_FAILED (compare-and-set,
// with an audit row): the same transition the worker makes when it is alive to.
// The backstop NEVER enqueues and NEVER touches certificate numbering. The
// worker re-claims the SAME app_queue_job row (same payload / jobId) and the
// write-once `on conflict (job_id) do nothing` issued-snapshot insert keeps
// issuance idempotent — so re-driving can never mint a second certificate number.

export type StaleJobBackstopResult = {
  /** How many expired PROCESSING leases were reclaimed to PENDING. */
  released: number;
  /** How many rows were dead-lettered (lease expired on the final attempt). */
  deadLettered: number;
  /** Certificate jobs rejected because their queue row was dead-lettered. */
  rejectedRenders: number;
  /** Certificate jobs rejected by the stuck-GENERATING_PDF sweep. */
  stuckRendersRejected: number;
  /** How many rows are claimable now (reclaimed + stranded PENDING). */
  pending: number;
  /** How many aged idempotency receipts were pruned. */
  prunedReceipts: number;
};

export type StaleJobBackstopDeps = {
  releaseStaleJobs: (
    staleAfterMs: number,
  ) => Promise<ReleaseStaleQueueJobsResult>;
  rejectDeadLetteredRenders: (
    deadLettered: readonly DeadLetteredQueueJob[],
  ) => Promise<number>;
  rejectStuckRenders: (stuckAfterMs: number) => Promise<number>;
  countRecoverableJobs: () => Promise<number>;
  pruneReceipts: () => Promise<number>;
  staleAfterMs: number;
  /** A GENERATING_PDF job older than this with no live queue row is rejected. */
  stuckRenderAfterMs: number;
};

function defaultDeps(): StaleJobBackstopDeps {
  return {
    releaseStaleJobs: releaseStaleQueueJobs,
    rejectDeadLetteredRenders: rejectDeadLetteredCertificateRenders,
    rejectStuckRenders: rejectStuckCertificateRenders,
    countRecoverableJobs: countRecoverableQueueJobs,
    pruneReceipts: pruneQueueReceipts,
    staleAfterMs: readJobsConfig().queueStaleAfterMs,
    stuckRenderAfterMs: readJobsConfig().stuckRenderAfterMs,
  };
}

export async function runStaleJobBackstop(
  overrides: Partial<StaleJobBackstopDeps> = {},
): Promise<StaleJobBackstopResult> {
  const deps = { ...defaultDeps(), ...overrides };

  // 1. Reclaim orphaned PROCESSING rows whose lease expired (dead or crashed
  //    worker) back to PENDING — or dead-lettered to FAILED when the lease
  //    expired on their final attempt. The worker does the same on each poll;
  //    this runs it on a timer so it does not depend on a worker being up.
  const { released, deadLettered } = await deps.releaseStaleJobs(
    deps.staleAfterMs,
  );

  // 2. A dead-lettered certificate render will never run again: move its job out
  //    of GENERATING_PDF. Best-effort — the sweep below is the safety net.
  const rejectedRenders = await deps
    .rejectDeadLetteredRenders(deadLettered)
    .catch((error) => {
      reportServerError(error, {
        surface: "queue-backstop",
        tags: { step: "reject-dead-lettered-renders" },
      });
      return 0;
    });

  // 3. Certificates stranded in GENERATING_PDF with no queue row left to move
  //    them (e.g. a job that ran out of its retries).
  const stuckRendersRejected = await deps
    .rejectStuckRenders(deps.stuckRenderAfterMs)
    .catch((error) => {
      reportServerError(error, {
        surface: "queue-backstop",
        tags: { step: "sweep-stuck-renders" },
      });
      return 0;
    });

  // 4. Count rows now claimable: the just-reclaimed ones plus any PENDING row
  //    nobody has claimed yet. Rows are only re-driven, never enqueued, so
  //    certificate numbering stays write-once and idempotent.
  const pending = await deps.countRecoverableJobs();

  // 5. Prune aged idempotency receipts so the ledger stays
  //    bounded. Hygiene only — a prune failure must never break the reclaim.
  const prunedReceipts = await deps.pruneReceipts().catch((error) => {
    reportServerError(error, {
      surface: "queue-backstop",
      tags: { step: "prune-receipts" },
    });
    return 0;
  });

  return {
    released,
    deadLettered: deadLettered.length,
    rejectedRenders,
    stuckRendersRejected,
    pending,
    prunedReceipts,
  };
}
