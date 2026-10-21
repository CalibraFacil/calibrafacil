/**
 * Unit tests for the DB-queue runtime failure recording (issue #653 / REL-04,
 * REQ-REL-OBS-002).
 *
 * The runtime used to clobber `app_queue_job.last_error` with the generic string
 * "Job was not acknowledged by worker" for every non-acked job, discarding the
 * REAL error the worker's queue handler caught. These tests prove the runtime
 * now forwards the real error to `failQueueJob` (which stores its `.message`),
 * so `app_queue_job.last_error` shows why a job actually failed.
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
  renewQueueJobLease,
  workerQueue,
  claimQueueReceipt,
  completeQueueReceipt,
  releaseQueueReceipt,
  readQueueReceiptsMode,
  rejectDeadLetteredCertificateRenders,
} = vi.hoisted(() => ({
  claimQueueJobs: vi.fn(),
  completeQueueJob: vi.fn(),
  failQueueJob: vi.fn(),
  releaseStaleQueueJobs: vi.fn(),
  renewQueueJobLease: vi.fn(),
  workerQueue: vi.fn(),
  claimQueueReceipt: vi.fn(),
  completeQueueReceipt: vi.fn(),
  releaseQueueReceipt: vi.fn(),
  readQueueReceiptsMode: vi.fn(),
  rejectDeadLetteredCertificateRenders: vi.fn(),
}));

vi.mock("@calibra-facil/db/queue-render-recovery", () => ({
  rejectDeadLetteredCertificateRenders,
}));

vi.mock("@calibra-facil/db/queue", () => ({
  claimQueueJobs,
  completeQueueJob,
  failQueueJob,
  releaseStaleQueueJobs,
  renewQueueJobLease,
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
  releaseStaleQueueJobs.mockResolvedValue({ released: 0, deadLettered: [] });
  rejectDeadLetteredCertificateRenders.mockResolvedValue(0);
  renewQueueJobLease.mockResolvedValue(true);
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

describe("queue-runtime delivery attempt", () => {
  it("REQ-WRETRY-005 hands the worker each message's attempt and the row's max attempts", async () => {
    const job = { ...makeJob(20), attempts: 2, maxAttempts: 3 };
    claimOnce(job);
    let seen: { attempt?: number; maxAttempts?: number } | undefined;
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      const message = batch.messages[0];
      seen = { attempt: message?.attempt, maxAttempts: message?.maxAttempts };
      message?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(seen).toEqual({ attempt: 2, maxAttempts: 3 });
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

describe("queue-runtime dead-letter handling (REQ-QDL-001, REQ-QDL-002)", () => {
  const deadLettered = [
    {
      id: 41,
      type: "CERTIFICATE",
      payload: { type: "CERTIFICATE", jobId: 7, userId: "user-1" },
    },
  ];

  it("REQ-QDL-002: rows the lease reclaim dead-lettered are handed to the certificate-render rejection", async () => {
    releaseStaleQueueJobs.mockResolvedValue({ released: 0, deadLettered });
    claimQueueJobs.mockResolvedValue([]);

    await drainQueue(fakeEnv, CONFIG);

    expect(rejectDeadLetteredCertificateRenders).toHaveBeenCalledWith(
      deadLettered,
    );
  });

  it("REQ-QDL-002: a failure rejecting the dead-lettered renders never stops the drain", async () => {
    releaseStaleQueueJobs.mockResolvedValue({ released: 0, deadLettered });
    rejectDeadLetteredCertificateRenders.mockRejectedValue(
      new Error("db down"),
    );
    claimOnce(makeJob(50));
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await expect(drainQueue(fakeEnv, CONFIG)).resolves.toBe(1);
    expect(completeQueueJob).toHaveBeenCalledWith(50);
  });

  it("REQ-QDL-001: nothing is rejected when the reclaim dead-lettered no row", async () => {
    claimQueueJobs.mockResolvedValue([]);

    await drainQueue(fakeEnv, CONFIG);

    expect(rejectDeadLetteredCertificateRenders).not.toHaveBeenCalled();
  });
});

describe("queue-runtime lease renewal (REQ-QDL-001)", () => {
  function claimMany(...jobs: Array<ReturnType<typeof makeJob>>) {
    claimQueueJobs.mockResolvedValueOnce(jobs).mockResolvedValue([]);
  }

  it("REQ-QDL-001: renews each claimed row's lease right before that row is processed", async () => {
    const order: string[] = [];
    claimMany(makeJob(60), makeJob(61));
    renewQueueJobLease.mockImplementation(async (id: number) => {
      order.push(`renew-${id}`);
      return true;
    });
    workerQueue.mockImplementation(async (batch: MessageBatchLike) => {
      order.push(`run-${batch.messages.length}`);
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    // Interleaved: the second lease is renewed only after the first job ran.
    expect(order).toEqual(["renew-60", "run-1", "renew-61", "run-1"]);
    expect(renewQueueJobLease).toHaveBeenCalledWith(60, CONFIG.workerId);
    expect(renewQueueJobLease).toHaveBeenCalledWith(61, CONFIG.workerId);
    expect(completeQueueJob).toHaveBeenCalledWith(60);
    expect(completeQueueJob).toHaveBeenCalledWith(61);
  });

  it("REQ-QDL-001: a row whose lease was lost is neither processed nor failed nor completed", async () => {
    claimMany(makeJob(70), makeJob(71));
    renewQueueJobLease.mockImplementation(async (id: number) => id !== 71);
    workerQueue.mockImplementation(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(workerQueue).toHaveBeenCalledTimes(1);
    expect(completeQueueJob).toHaveBeenCalledTimes(1);
    expect(completeQueueJob).toHaveBeenCalledWith(70);
    expect(failQueueJob).not.toHaveBeenCalled();
  });

  it("REQ-QDL-001: releases the idempotency receipt of a row whose lease was lost", async () => {
    claimMany(makeJob(72));
    readQueueReceiptsMode.mockReturnValue("enforce");
    renewQueueJobLease.mockResolvedValue(false);

    await drainQueue(fakeEnv, CONFIG);

    expect(workerQueue).not.toHaveBeenCalled();
    expect(releaseQueueReceipt).toHaveBeenCalledWith({
      jobType: "CERTIFICATE",
      idempotencyKey: "app-queue-72",
    });
    expect(failQueueJob).not.toHaveBeenCalled();
  });

  it("REQ-QDL-001: a renewal that cannot be recorded does not block the job (fail open)", async () => {
    claimMany(makeJob(73));
    renewQueueJobLease.mockRejectedValue(new Error("db blip"));
    workerQueue.mockImplementation(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(workerQueue).toHaveBeenCalledTimes(1);
    expect(completeQueueJob).toHaveBeenCalledWith(73);
  });

  it("REQ-QDL-001: one job's batch failure no longer fails the rows queued behind it", async () => {
    claimMany(makeJob(74), makeJob(75));
    const boom = new Error("worker.queue exploded");
    workerQueue
      .mockRejectedValueOnce(boom)
      .mockImplementationOnce(async (batch: MessageBatchLike) => {
        batch.messages[0]?.ack();
      });

    await drainQueue(fakeEnv, CONFIG);

    expect(failQueueJob).toHaveBeenCalledWith(74, boom);
    expect(completeQueueJob).toHaveBeenCalledWith(75);
    expect(failQueueJob).not.toHaveBeenCalledWith(75, expect.anything());
  });
});

// Minimal structural type for the mocked batch the worker handler receives.
interface MessageBatchLike {
  messages: Array<{
    attempt?: number;
    maxAttempts?: number;
    ack: () => void;
    retry: (error?: unknown) => void;
  }>;
}
