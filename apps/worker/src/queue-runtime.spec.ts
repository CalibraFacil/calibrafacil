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

import { hostname } from "node:os";
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
  rejectDeadLetteredCertificateRenders,
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

vi.mock("@calibra-facil/jobs-core", () => ({
  default: { queue: workerQueue },
}));

import {
  defaultWorkerId,
  drainQueue,
  processQueueBatch,
  readQueueConfig,
} from "./queue-runtime";

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
  completeQueueJob.mockResolvedValue(true);
  failQueueJob.mockResolvedValue(true);
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
    expect(failQueueJob).toHaveBeenCalledWith(1, CONFIG.workerId, realError);
    // MUTATION CHECK: reinstating the generic-string clobber makes this go RED.
    expect(failQueueJob).not.toHaveBeenCalledWith(
      1,
      CONFIG.workerId,
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

    expect(completeQueueJob).toHaveBeenCalledWith(2, CONFIG.workerId);
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
      CONFIG.workerId,
      "Job was not acknowledged by worker",
    );
  });

  it("when the whole batch throws, each job is failed with the thrown error", async () => {
    const job = makeJob(4);
    claimOnce(job);
    const batchError = new Error("worker.queue exploded");
    workerQueue.mockRejectedValueOnce(batchError);

    await drainQueue(fakeEnv, CONFIG);

    expect(failQueueJob).toHaveBeenCalledWith(4, CONFIG.workerId, batchError);
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
    expect(completeQueueJob).toHaveBeenCalledWith(10, CONFIG.workerId);
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
    expect(completeQueueJob).toHaveBeenCalledWith(11, CONFIG.workerId);
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
    expect(failQueueJob).toHaveBeenCalledWith(12, CONFIG.workerId, realError);
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
    expect(completeQueueJob).toHaveBeenCalledWith(13, CONFIG.workerId);
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
      CONFIG.workerId,
      "queue receipt lease held by another worker",
    );
  });

  it("REQ-QFENCE-005: a fenced-out completion does not settle the receipt the new owner holds", async () => {
    const job = makeJob(18);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("enforce");
    completeQueueJob.mockResolvedValueOnce(false);
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(completeQueueJob).toHaveBeenCalledWith(18, CONFIG.workerId);
    expect(completeQueueReceipt).not.toHaveBeenCalled();
    expect(releaseQueueReceipt).not.toHaveBeenCalled();
  });

  it("REQ-QFENCE-005: a fenced-out failure does not release the receipt the new owner holds", async () => {
    const job = makeJob(19);
    claimOnce(job);
    readQueueReceiptsMode.mockReturnValue("enforce");
    failQueueJob.mockResolvedValueOnce(false);
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.retry(new Error("late"));
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(failQueueJob).toHaveBeenCalledWith(
      19,
      CONFIG.workerId,
      expect.any(Error),
    );
    expect(completeQueueReceipt).not.toHaveBeenCalled();
    expect(releaseQueueReceipt).not.toHaveBeenCalled();
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
    expect(completeQueueJob).toHaveBeenCalledWith(15, CONFIG.workerId);
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
    expect(completeQueueJob).toHaveBeenCalledWith(16, CONFIG.workerId);
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
    expect(failQueueJob).toHaveBeenCalledWith(17, CONFIG.workerId, batchError);
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
    expect(completeQueueJob).toHaveBeenCalledWith(50, CONFIG.workerId);
  });

  it("REQ-QDL-001: nothing is rejected when the reclaim dead-lettered no row", async () => {
    claimQueueJobs.mockResolvedValue([]);

    await drainQueue(fakeEnv, CONFIG);

    expect(rejectDeadLetteredCertificateRenders).not.toHaveBeenCalled();
  });
});

describe("queue-runtime claims one row at a time (REQ-QDL-001)", () => {
  // claimQueueJobs mock backed by a tiny in-memory queue so the test can see
  // which rows are PENDING / PROCESSING at any moment.
  function useInMemoryQueue(ids: number[]) {
    const status = new Map<number, "PENDING" | "PROCESSING">(
      ids.map((id) => [id, "PENDING"]),
    );
    claimQueueJobs.mockImplementation(
      async (_workerId: string, limit: number) => {
        const claimed: ReturnType<typeof makeJob>[] = [];
        for (const [id, state] of status) {
          if (claimed.length >= limit) break;
          if (state !== "PENDING") continue;
          status.set(id, "PROCESSING");
          claimed.push(makeJob(id));
        }
        return claimed;
      },
    );
    completeQueueJob.mockImplementation(async (id: number) => {
      status.delete(id);
      return true;
    });
    return status;
  }

  it("REQ-QDL-001: a slow first job does not leave a second row PROCESSING while it runs", async () => {
    const status = useInMemoryQueue([80, 81]);
    let secondWhileFirstRuns: string | undefined;
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      secondWhileFirstRuns = status.get(81);
      batch.messages[0]?.ack();
    });
    workerQueue.mockImplementationOnce(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    // While the first job ran, the second row was still PENDING and unclaimed.
    expect(secondWhileFirstRuns).toBe("PENDING");
    expect(workerQueue).toHaveBeenCalledTimes(2);
    expect(completeQueueJob).toHaveBeenNthCalledWith(1, 80, CONFIG.workerId);
    expect(completeQueueJob).toHaveBeenNthCalledWith(2, 81, CONFIG.workerId);
  });

  it("REQ-QDL-001: every claim asks for exactly one row", async () => {
    useInMemoryQueue([82, 83, 84]);
    workerQueue.mockImplementation(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await drainQueue(fakeEnv, CONFIG);

    expect(claimQueueJobs.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [, limit] of claimQueueJobs.mock.calls) {
      expect(limit).toBe(1);
    }
  });

  it("REQ-QDL-001: no more than batchSize rows are claimed per batch", async () => {
    useInMemoryQueue([85, 86, 87]);
    workerQueue.mockImplementation(async (batch: MessageBatchLike) => {
      batch.messages[0]?.ack();
    });

    await expect(
      processQueueBatch(fakeEnv, { ...CONFIG, batchSize: 2 }),
    ).resolves.toBe(2);

    expect(workerQueue).toHaveBeenCalledTimes(2);
    expect(completeQueueJob).not.toHaveBeenCalledWith(87, CONFIG.workerId);
  });

  it("REQ-QDL-001: one job's failure does not fail the rows behind it", async () => {
    useInMemoryQueue([88, 89]);
    const boom = new Error("worker.queue exploded");
    workerQueue
      .mockRejectedValueOnce(boom)
      .mockImplementationOnce(async (batch: MessageBatchLike) => {
        batch.messages[0]?.ack();
      });

    await drainQueue(fakeEnv, CONFIG);

    expect(failQueueJob).toHaveBeenCalledWith(88, CONFIG.workerId, boom);
    expect(completeQueueJob).toHaveBeenCalledWith(89, CONFIG.workerId);
    expect(failQueueJob).not.toHaveBeenCalledWith(
      89,
      CONFIG.workerId,
      expect.anything(),
    );
  });
});

describe("queue-runtime graceful shutdown", () => {
  function useInMemoryQueue(ids: number[]) {
    const pending = [...ids];
    claimQueueJobs.mockImplementation(async () => {
      const id = pending.shift();
      return id === undefined ? [] : [makeJob(id)];
    });
  }

  it("claims nothing more once a shutdown has begun, after the job in hand settles", async () => {
    useInMemoryQueue([301, 302, 303]);
    let stopping = false;
    workerQueue.mockImplementation(async (batch: MessageBatchLike) => {
      // The signal arrives while the first job is running.
      stopping = true;
      batch.messages[0]?.ack();
    });

    const claimed = await processQueueBatch(fakeEnv, CONFIG, () => stopping);

    expect(claimed).toBe(1);
    expect(completeQueueJob).toHaveBeenCalledTimes(1);
    expect(completeQueueJob).toHaveBeenCalledWith(301, CONFIG.workerId);
  });

  it("claims no job at all when the shutdown began before the poll", async () => {
    useInMemoryQueue([311]);

    const claimed = await processQueueBatch(fakeEnv, CONFIG, () => true);

    expect(claimed).toBe(0);
    expect(claimQueueJobs).not.toHaveBeenCalled();
  });

  it("drainQueue stops between batches", async () => {
    useInMemoryQueue([321, 322]);
    let stopping = false;
    workerQueue.mockImplementation(async (batch: MessageBatchLike) => {
      stopping = true;
      batch.messages[0]?.ack();
    });

    const processed = await drainQueue(fakeEnv, CONFIG, 1_000, () => stopping);

    expect(processed).toBe(1);
  });
});

describe("worker id", () => {
  it("differs per process start and carries the host name and pid, so replicas never share one", () => {
    const first = defaultWorkerId();
    const second = defaultWorkerId();

    expect(first).not.toBe(second);
    expect(first).toContain(hostname());
    expect(first).toContain(String(process.pid));
  });

  it("WORKER_ID overrides the generated one", () => {
    vi.stubEnv("WORKER_ID", "replica-a");
    try {
      expect(readQueueConfig().workerId).toBe("replica-a");
    } finally {
      vi.unstubAllEnvs();
    }
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
