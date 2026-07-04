import {
  countRecoverableQueueJobs,
  releaseStaleQueueJobs,
} from "@calibra-facil/db/queue";
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
//   1. reclaim expired PROCESSING leases -> PENDING,
//   2. count what is now claimable (reclaimed + any stranded PENDING),
//   3. if anything is claimable and the container is configured, wake it to drain.
//
// It NEVER enqueues and NEVER touches certificate numbering. The container
// re-claims the SAME app_queue_job row (same payload / jobId) and the write-once
// `on conflict (job_id) do nothing` issued-snapshot insert keeps issuance
// idempotent — so re-driving can never mint a second certificate number.

const DEFAULT_STALE_AFTER_MS = 10 * 60_000;

export type StaleJobBackstopResult = {
  /** How many expired PROCESSING leases were reclaimed to PENDING. */
  released: number;
  /** How many rows are claimable now (reclaimed + stranded PENDING). */
  pending: number;
  /** Whether the document worker was pinged to drain them. */
  woke: boolean;
};

export type StaleJobBackstopDeps = {
  releaseStaleJobs: (staleAfterMs: number) => Promise<number>;
  countRecoverableJobs: () => Promise<number>;
  resolveDocumentWorkerUrl: () => string | null;
  wake: (baseUrl: string) => Promise<void>;
  staleAfterMs: number;
};

function readStaleAfterMs(): number {
  const value = Number(process.env.QUEUE_STALE_AFTER_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STALE_AFTER_MS;
}

function resolveDocumentWorkerUrl(): string | null {
  const url = process.env.DOCUMENT_WORKER_URL?.trim();
  return url ? url : null;
}

function defaultDeps(): StaleJobBackstopDeps {
  return {
    releaseStaleJobs: releaseStaleQueueJobs,
    countRecoverableJobs: countRecoverableQueueJobs,
    resolveDocumentWorkerUrl,
    wake: wakeDocumentWorker,
    staleAfterMs: readStaleAfterMs(),
  };
}

export async function runStaleJobBackstop(
  overrides: Partial<StaleJobBackstopDeps> = {},
): Promise<StaleJobBackstopResult> {
  const deps = { ...defaultDeps(), ...overrides };

  // 1. Reclaim orphaned PROCESSING rows whose lease expired (dead container /
  //    crashed drain) back to PENDING. This is the same reclaim `drainQueue` does
  //    on each wake — run here on a timer so it no longer depends on a NEW enqueue.
  const released = await deps.releaseStaleJobs(deps.staleAfterMs);

  // 2. Count rows now claimable: the just-reclaimed ones plus any stranded PENDING
  //    from a dropped wake ping (README:120-125).
  const pending = await deps.countRecoverableJobs();

  // 3. Wake the container to drain them. Only re-drive existing rows — never
  //    enqueue — so certificate numbering stays write-once and idempotent.
  let woke = false;
  const documentWorkerUrl = deps.resolveDocumentWorkerUrl();
  if (pending > 0 && documentWorkerUrl) {
    await deps.wake(documentWorkerUrl);
    woke = true;
  }

  return { released, pending, woke };
}
