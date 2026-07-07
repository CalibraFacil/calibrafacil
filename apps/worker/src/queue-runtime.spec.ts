/**
 * Unit tests for the DB-queue runtime failure recording (issue #653 / REL-04,
 * REQ-REL-OBS-002).
 *
 * The runtime used to clobber `app_queue_job.last_error` with the generic string
 * "Job was not acknowledged by worker" for every non-acked job, discarding the
 * REAL error the worker's queue handler caught. These tests prove the runtime
 * now forwards the real error to `failQueueJob` (which stores its `.message`),
 * so the backoffice can surface why a job actually failed.
 *
 * Strategy: mock `@calibra-facil/db/queue` (the claim/fail/complete helpers) and
 * the worker's `queue` handler (`./index.js`) — the latter both avoids loading
 * the heavy render module graph and lets us drive the ack/retry outcome.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkerEnv } from "./queue-runtime";

const {
  claimQueueJobs,
  completeQueueJob,
  failQueueJob,
  releaseStaleQueueJobs,
  workerQueue,
  claimQueueReceipt,
  completeQueueReceipt,
  releaseQueueReceipt,
  readQueueReceiptsMode,
} = vi.hoisted(() => ({
  claimQueueJobs: vi.fn(),
  completeQueueJob: vi.fn(),
  failQueueJob: vi.fn(),
  releaseStaleQueueJobs: vi.fn(),
  workerQueue: vi.fn(),
  claimQueueReceipt: vi.fn(),
  completeQueueReceipt: vi.fn(),
  releaseQueueReceipt: vi.fn(),
  readQueueReceiptsMode: vi.fn(),
}));

vi.mock("@calibra-facil/db/queue", () => ({
  claimQueueJobs,
  completeQueueJob,
  failQueueJob,
  releaseStaleQueueJobs,
}));

// The idempotency ledger is mocked so the unit tier never touches
// a real DB; the ON CONFLICT claim semantics are proven by the real-DB tier
// (queue-receipts.int.spec.ts).
vi.mock("@calibra-facil/db/queue-receipts", () => ({
  appQueueJobReceiptKey: (id: number) => `app-queue-${id}`,
  claimQueueReceipt,
  completeQueueReceipt,
  releaseQueueReceipt,
  readQueueReceiptsMode,
}));

vi.mock("./index.js", () => ({
  default: { queue: workerQueue },
}));

import { drainQueue } from "./queue-runtime";

const CONFIG = {
  workerId: "test-worker",
  batchSize: 10,
  pollIntervalMs: 0,
  staleAfterMs: 0,
};

// drainQueue passes env straight to the (mocked) worker.queue; it is never read.
const bucket = { get: async () => null, put: async () => undefined };
const fakeEnv: WorkerEnv = {
  CERTIFICATES_BUCKET: bucket,
  MEDIA_BUCKET: bucket,
  DATABASE_URL: "postgres://test",
};

function makeJob(id: number) {
  return {
    id,
    type: "CERTIFICATE",
    payload: { type: "CERTIFICATE", jobId: String(id) },
    attempts: 1,
    maxAttempts: 3,
  };
}

/** Claim `job` once, then drain-empty so the drain loop terminates. */
function claimOnce(job: ReturnType<typeof makeJob>) {
  claimQueueJobs.mockResolvedValueOnce([job]).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  releaseStaleQueueJobs.mockResolvedValue(undefined);
  completeQueueJob.mockResolvedValue(undefined);
  failQueueJob.mockResolvedValue(undefined);
  // The failure-recording suite predates the receipt ledger — run it with the
  // ledger off; the receipt suite below drives shadow/enforce explicitly.
  readQueueReceiptsMode.mockReturnValue("off");
  claimQueueReceipt.mockResolvedValue({ outcome: "claimed", attempts: 1 });
  completeQueueReceipt.mockResolvedValue(undefined);
  releaseQueueReceipt.mockResolvedValue(undefined);
});

describe("queue-runtime failure recording (REQ-REL-OBS-002)", () => {
  it("REQ-REL-OBS-002: forwards the REAL error a failing job threw to failQueueJob (not the generic string)", async () => {
    const job = makeJob(1);
    claimOnce(job);
    const realError = new Error("gotenberg 502: upstream timeout");
    // The worker's queue handler retries with the real error on failure.
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.retry(realError);
    });

    await drainQueue(fakeEnv, CONFIG);

    // The REAL error object reaches failQueueJob (which stores error.message).
    expect(failQueueJob).toHaveBeenCalledTimes(1);
    expect(failQueueJob).toHaveBeenCalledWith(1, realError);
    // MUTATION CHECK: reinstating the generic-string clobber makes this go RED.
    expect(failQueueJob).not.toHaveBeenCalledWith(
      1,
      "Job was not acknowledged by worker",
    );
    expect(completeQueueJob).not.toHaveBeenCalled();
  });

  it("an acked job is completed and never failed", async () => {
    const job = makeJob(2);
    claimOnce(job);
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(completeQueueJob).toHaveBeenCalledWith(2);
    expect(failQueueJob).not.toHaveBeenCalled();
  });

  it("falls back to the generic message only when retry captured no error", async () => {
    const job = makeJob(3);
    claimOnce(job);
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.retry(); // no error argument
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(failQueueJob).toHaveBeenCalledWith(
      3,
      "Job was not acknowledged by worker",
    );
  });

  it("when the whole batch throws, each job is failed with the thrown error", async () => {
    const job = makeJob(4);
    claimOnce(job);
    const batchError = new Error("worker.queue exploded");
    workerQueue.mockRejectedValueOnce(batchError);

    await drainQueue(fakeEnv, CONFIG);

    expect(failQueueJob).toHaveBeenCalledWith(4, batchError);
  });
});

describe("queue-runtime idempotency receipts", () => {
  it("off mode never touches the ledger", async () => {
    const job = makeJob(10);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("off");
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(claimQueueReceipt).not.toHaveBeenCalled();
    expect(completeQueueReceipt).not.toHaveBeenCalled();
    expect(completeQueueJob).toHaveBeenCalledWith(10);
  });

  it("claims a receipt per job (key = app_queue_job row id) and completes it on ack", async () => {
    const job = makeJob(11);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("enforce");
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(claimQueueReceipt).toHaveBeenCalledWith({
      jobType: "CERTIFICATE",
      idempotencyKey: "app-queue-11",
    });
    expect(completeQueueReceipt).toHaveBeenCalledWith({
      jobType: "CERTIFICATE",
      idempotencyKey: "app-queue-11",
    });
    expect(completeQueueJob).toHaveBeenCalledWith(11);
    expect(releaseQueueReceipt).not.toHaveBeenCalled();
  });

  it("releases (not completes) the receipt when the job fails, so retry backoff is not blocked", async () => {
    const job = makeJob(12);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("enforce");
    const realError = new Error("render failed");
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.retry(realError);
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(releaseQueueReceipt).toHaveBeenCalledWith({
      jobType: "CERTIFICATE",
      idempotencyKey: "app-queue-12",
    });
    expect(completeQueueReceipt).not.toHaveBeenCalled();
    expect(failQueueJob).toHaveBeenCalledWith(12, realError);
  });

  it("enforce: a duplicate-completed delivery settles the row WITHOUT re-running the work", async () => {
    const job = makeJob(13);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("enforce");
    claimQueueReceipt.mockResolvedValueOnce({
      outcome: "duplicate-completed",
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(workerQueue).not.toHaveBeenCalled();
    expect(completeQueueJob).toHaveBeenCalledWith(13);
    expect(failQueueJob).not.toHaveBeenCalled();
    // Not the claim owner: the receipt must not be settled by this worker.
    expect(completeQueueReceipt).not.toHaveBeenCalled();
    expect(releaseQueueReceipt).not.toHaveBeenCalled();
  });

  it("enforce: a held lease defers through the normal retry path instead of running twice", async () => {
    const job = makeJob(14);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("enforce");
    claimQueueReceipt.mockResolvedValueOnce({ outcome: "duplicate-running" });

    await drainQueue(fakeEnv, CONFIG);

    expect(workerQueue).not.toHaveBeenCalled();
    expect(completeQueueJob).not.toHaveBeenCalled();
    expect(failQueueJob).toHaveBeenCalledWith(
      14,
      "queue receipt lease held by another worker",
    );
  });

  it("shadow: a duplicate is logged but still runs, and the unowned receipt is never settled", async () => {
    const job = makeJob(15);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("shadow");
    claimQueueReceipt.mockResolvedValueOnce({
      outcome: "duplicate-completed",
    });
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(workerQueue).toHaveBeenCalledTimes(1);
    expect(completeQueueJob).toHaveBeenCalledWith(15);
    expect(completeQueueReceipt).not.toHaveBeenCalled();
    expect(releaseQueueReceipt).not.toHaveBeenCalled();
  });

  it("fails open: a ledger error never blocks the job", async () => {
    const job = makeJob(16);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("enforce");
    claimQueueReceipt.mockRejectedValueOnce(
      new Error('relation "queue_job_receipt" does not exist'),
    );
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(workerQueue).toHaveBeenCalledTimes(1);
    expect(completeQueueJob).toHaveBeenCalledWith(16);
    expect(completeQueueReceipt).not.toHaveBeenCalled();
  });

  it("whole-batch failure releases every owned receipt before failing the rows", async () => {
    const job = makeJob(17);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("enforce");
    const batchError = new Error("worker.queue exploded");
    workerQueue.mockRejectedValueOnce(batchError);

    await drainQueue(fakeEnv, CONFIG);

    expect(releaseQueueReceipt).toHaveBeenCalledWith({
      jobType: "CERTIFICATE",
      idempotencyKey: "app-queue-17",
    });
    expect(failQueueJob).toHaveBeenCalledWith(17, batchError);
  });
});

// Minimal structural type for the mocked batch the worker handler receives.
interface MessageBatchLike {
  messages: Array<{ ack: () => void; retry: (error?: unknown) => void }>;
}
