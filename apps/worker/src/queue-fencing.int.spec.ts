import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  claimQueueJobs,
  completeQueueJob,
  enqueueQueueJob,
  failQueueJob,
  releaseStaleQueueJobs,
} from "@calibra-facil/db/queue";
import { appQueueJob } from "@calibra-facil/db/schema";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";

// Real-DB tier for queue lease fencing. A worker whose lease expired and whose
// row was reclaimed by another worker must not be able to settle (complete or
// fail) the row: only the CURRENT lock holder of a PROCESSING row may. The
// fence is pure SQL semantics (locked_by + status in the UPDATE's WHERE), which
// the mocked unit tier cannot prove.
//
// Also covers the receipts default: with QUEUE_RECEIPTS_MODE unset the ledger
// runs in enforce mode, so a duplicate delivery of a completed row is not
// re-executed.

const { workerQueue } = vi.hoisted(() => ({ workerQueue: vi.fn() }));

vi.mock("./index.js", () => ({
  default: { queue: workerQueue },
}));

import { drainQueue } from "./queue-runtime";

const CONFIG = {
  workerId: "int-test-worker",
  batchSize: 10,
  pollIntervalMs: 0,
  staleAfterMs: 10 * 60_000,
};

const SAVED_MODE = process.env.QUEUE_RECEIPTS_MODE;

beforeEach(async () => {
  vi.clearAllMocks();
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (SAVED_MODE === undefined) delete process.env.QUEUE_RECEIPTS_MODE;
  else process.env.QUEUE_RECEIPTS_MODE = SAVED_MODE;
});

async function rowOf(id: number) {
  const [row] = await db
    .select()
    .from(appQueueJob)
    .where(eq(appQueueJob.id, id));
  return row!;
}

// Worker A claims the row, its lease expires, the reclaim returns the row to
// PENDING, and worker B claims it: the row is now B's.
async function seedReclaimedRow() {
  const id = await enqueueQueueJob({
    type: "CERTIFICATE",
    jobId: 1,
    userId: "user-1",
  });
  const [claimedByA] = await claimQueueJobs("worker-a", 1);
  expect(claimedByA?.id).toBe(id);

  await db.execute(sql`
    update app_queue_job
    set locked_at = now() - interval '1 hour'
    where id = ${id}
  `);
  expect((await releaseStaleQueueJobs(10 * 60_000)).released).toBe(1);

  const [claimedByB] = await claimQueueJobs("worker-b", 1);
  expect(claimedByB?.id).toBe(id);
  return id;
}

describe("queue lease fencing (real Postgres)", () => {
  it("REQ-QFENCE-001 a reclaimed row's original worker cannot complete it", async () => {
    const id = await seedReclaimedRow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Fenced out: a logged no-op, not a throw.
    await expect(completeQueueJob(id, "worker-a")).resolves.toBe(false);

    const row = await rowOf(id);
    expect(row.status).toBe("PROCESSING");
    expect(row.lockedBy).toBe("worker-b");
    expect(row.lockedAt).not.toBeNull();
    expect(row.attempts).toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fenced out"));
  });

  it("REQ-QFENCE-002 a reclaimed row's original worker cannot fail it", async () => {
    const id = await seedReclaimedRow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      failQueueJob(id, "worker-a", new Error("late failure")),
    ).resolves.toBe(false);

    const row = await rowOf(id);
    expect(row.status).toBe("PROCESSING");
    expect(row.lockedBy).toBe("worker-b");
    expect(row.attempts).toBe(2);
    expect(row.lastError).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fenced out"));
  });

  it("REQ-QFENCE-003 the new owner can complete the reclaimed row", async () => {
    const id = await seedReclaimedRow();

    await expect(completeQueueJob(id, "worker-b")).resolves.toBe(true);

    const row = await rowOf(id);
    expect(row.status).toBe("COMPLETED");
    expect(row.lockedBy).toBeNull();
    expect(row.lockedAt).toBeNull();
  });

  it("REQ-QFENCE-003 the new owner can fail the reclaimed row (retry backoff)", async () => {
    const id = await seedReclaimedRow();

    await expect(
      failQueueJob(id, "worker-b", new Error("render failed")),
    ).resolves.toBe(true);

    const row = await rowOf(id);
    expect(row.status).toBe("PENDING");
    expect(row.lockedBy).toBeNull();
    expect(row.lastError).toBe("render failed");
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("REQ-QFENCE-004 a settled row cannot be re-settled, even by its former owner", async () => {
    const id = await seedReclaimedRow();
    await completeQueueJob(id, "worker-b");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(failQueueJob(id, "worker-b", "too late")).resolves.toBe(false);
    await expect(completeQueueJob(id, "worker-b")).resolves.toBe(false);

    const row = await rowOf(id);
    expect(row.status).toBe("COMPLETED");
    expect(row.lastError).toBeNull();
  });

  it("REQ-QFENCE-005 a drain whose lease was reclaimed mid-run does not overwrite the new owner", async () => {
    const env = makeTestEnv();
    const id = await enqueueQueueJob({
      type: "CERTIFICATE",
      jobId: 2,
      userId: "user-1",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    workerQueue.mockImplementationOnce(
      async (batch: { messages: Array<{ ack: () => void }> }) => {
        // While the (slow) worker runs, its lease expires and another worker
        // reclaims and claims the row.
        await db.execute(sql`
          update app_queue_job
          set status = 'PENDING', locked_by = null, locked_at = null
          where id = ${id}
        `);
        await claimQueueJobs("worker-b", 1);
        for (const message of batch.messages) message.ack();
      },
    );

    await drainQueue(env, CONFIG);

    const row = await rowOf(id);
    expect(row.status).toBe("PROCESSING");
    expect(row.lockedBy).toBe("worker-b");
  });
});

describe("queue receipts default mode (real Postgres)", () => {
  it("REQ-QFENCE-006 with QUEUE_RECEIPTS_MODE unset a duplicate delivery is suppressed", async () => {
    delete process.env.QUEUE_RECEIPTS_MODE;
    const env = makeTestEnv();
    const jobId = await enqueueQueueJob({
      type: "CERTIFICATE",
      jobId: 999,
      userId: "user-1",
    });
    workerQueue.mockImplementation(
      async (batch: { messages: Array<{ ack: () => void }> }) => {
        for (const message of batch.messages) message.ack();
      },
    );

    expect(await drainQueue(env, CONFIG)).toBe(1);
    expect(workerQueue).toHaveBeenCalledTimes(1);

    // At-least-once re-delivery: the SAME row reappears as PENDING.
    await db.execute(sql`
      update app_queue_job
      set status = 'PENDING', locked_by = null, locked_at = null, available_at = now()
      where id = ${jobId}
    `);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await drainQueue(env, CONFIG)).toBe(1);
    expect(workerQueue).toHaveBeenCalledTimes(1);
    expect((await rowOf(jobId)).status).toBe("COMPLETED");
  });

  it("REQ-QFENCE-007 shadow stays available as an explicit opt-out (duplicate still runs)", async () => {
    process.env.QUEUE_RECEIPTS_MODE = "shadow";
    const env = makeTestEnv();
    const jobId = await enqueueQueueJob({
      type: "CERTIFICATE",
      jobId: 998,
      userId: "user-1",
    });
    workerQueue.mockImplementation(
      async (batch: { messages: Array<{ ack: () => void }> }) => {
        for (const message of batch.messages) message.ack();
      },
    );

    await drainQueue(env, CONFIG);
    await db.execute(sql`
      update app_queue_job
      set status = 'PENDING', locked_by = null, locked_at = null, available_at = now()
      where id = ${jobId}
    `);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await drainQueue(env, CONFIG);

    expect(workerQueue).toHaveBeenCalledTimes(2);
  });
});
