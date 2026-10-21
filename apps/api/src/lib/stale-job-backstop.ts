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
import { wakeDocumentWorker } from "./background-jobs";

// REL-03 — periodic orphan-job backstop (#652).
//
// `releaseStaleQueueJobs` (the lease reclaim) and the drain only run INSIDE
// `drainQueue` / `processQueueBatch`, which fire when a NEW job is enqueued. In
// low volume a render job stuck in GENERATING_PDF / PENDING past its lease is
// therefore never re-claimed — it sits forever with no error (see
// services/document-worker/README.md:120-125).
//
// This backstop re-runs the SAME reclaim + drain-wake on a timer (the
// `queue-backstop` cron), independent of any new enqueue, so a stuck job is
// recovered within a bounded interval:
//   1. reclaim expired PROCESSING leases -> PENDING (or FAILED when the lease
//      expired on the row's final attempt: a job that crashes the worker process
//      must not be re-claimed forever),
//   2. reject the GENERATING_PDF certificate of every row dead-lettered in (1),
//   3. reject certificates stuck in GENERATING_PDF past STUCK_RENDER_AFTER_MS
//      with no live queue row (a Vercel Queue message dropped after its retries),
//   4. count what is now claimable (reclaimed + any stranded PENDING),
//   5. if anything is claimable and the container is configured, wake it to drain.
//
// Steps 2-3 only ever move a job GENERATING_PDF -> REJECTED (compare-and-set,
// with an audit row): the same transition the worker makes when it is alive to.
// The backstop NEVER enqueues and NEVER touches certificate numbering. The
// container re-claims the SAME app_queue_job row (same payload / jobId) and the
// write-once `on conflict (job_id) do nothing` issued-snapshot insert keeps
// issuance idempotent — so re-driving can never mint a second certificate number.

const DEFAULT_STALE_AFTER_MS = 10 * 60_000;
const DEFAULT_STUCK_RENDER_AFTER_MS = 60 * 60_000;

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
  /** Whether the document worker was pinged to drain them. */
  woke: boolean;
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
  resolveDocumentWorkerUrl: () => string | null;
  wake: (baseUrl: string) => Promise<void>;
  pruneReceipts: () => Promise<number>;
  staleAfterMs: number;
  /** A GENERATING_PDF job older than this with no live queue row is rejected. */
  stuckRenderAfterMs: number;
};

function readPositiveMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveDocumentWorkerUrl(): string | null {
  const url = process.env.DOCUMENT_WORKER_URL?.trim();
  return url ? url : null;
}

function defaultDeps(): StaleJobBackstopDeps {
  return {
    releaseStaleJobs: releaseStaleQueueJobs,
    rejectDeadLetteredRenders: rejectDeadLetteredCertificateRenders,
    rejectStuckRenders: rejectStuckCertificateRenders,
    countRecoverableJobs: countRecoverableQueueJobs,
    resolveDocumentWorkerUrl,
    wake: wakeDocumentWorker,
    pruneReceipts: pruneQueueReceipts,
    staleAfterMs: readPositiveMs(
      "QUEUE_STALE_AFTER_MS",
      DEFAULT_STALE_AFTER_MS,
    ),
    stuckRenderAfterMs: readPositiveMs(
      "STUCK_RENDER_AFTER_MS",
      DEFAULT_STUCK_RENDER_AFTER_MS,
    ),
  };
}

export async function runStaleJobBackstop(
  overrides: Partial<StaleJobBackstopDeps> = {},
): Promise<StaleJobBackstopResult> {
  const deps = { ...defaultDeps(), ...overrides };

  // 1. Reclaim orphaned PROCESSING rows whose lease expired (dead container /
  //    crashed drain) back to PENDING — or dead-letter them to FAILED when the
  //    lease expired on their final attempt. This is the same reclaim `drainQueue`
  //    does on each wake — run here on a timer so it no longer depends on a NEW
  //    enqueue.
  const { released, deadLettered } = await deps.releaseStaleJobs(
    deps.staleAfterMs,
  );

  // 2. A dead-lettered certificate render will never run again: move its job out
  //    of GENERATING_PDF. Best-effort — the sweep below is the safety net.
  const rejectedRenders = await deps
    .rejectDeadLetteredRenders(deadLettered)
    .catch((error) => {
      console.error(
        "[QueueDeadLetter] failed to reject dead-lettered renders",
        error,
      );
      return 0;
    });

  // 3. Certificates stranded in GENERATING_PDF with no queue row left to move
  //    them (e.g. a Vercel Queue message dropped after its retries).
  const stuckRendersRejected = await deps
    .rejectStuckRenders(deps.stuckRenderAfterMs)
    .catch((error) => {
      console.error("[QueueDeadLetter] failed to sweep stuck renders", error);
      return 0;
    });

  // 4. Count rows now claimable: the just-reclaimed ones plus any stranded PENDING
  //    from a dropped wake ping (README:120-125).
  const pending = await deps.countRecoverableJobs();

  // 5. Wake the container to drain them. Only re-drive existing rows — never
  //    enqueue — so certificate numbering stays write-once and idempotent.
  let woke = false;
  const documentWorkerUrl = deps.resolveDocumentWorkerUrl();
  if (pending > 0 && documentWorkerUrl) {
    await deps.wake(documentWorkerUrl);
    woke = true;
  }

  // 6. Prune aged idempotency receipts so the ledger stays
  //    bounded. Hygiene only — a prune failure must never break the reclaim.
  const prunedReceipts = await deps.pruneReceipts().catch((error) => {
    console.error("[QueueReceipt] failed to prune receipts", error);
    return 0;
  });

  return {
    released,
    deadLettered: deadLettered.length,
    rejectedRenders,
    stuckRendersRejected,
    pending,
    woke,
    prunedReceipts,
  };
}
