import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { enqueueQueueJob } from "@calibra-facil/db/queue";
import {
  appQueueJobReceiptKey,
  claimQueueReceipt,
  completeQueueReceipt,
  pruneQueueReceipts,
  releaseQueueReceipt,
  runWithQueueReceipt,
} from "@calibra-facil/db/queue-receipts";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";

// Real-DB integration tier for the queue idempotency ledger.
//
// The claim is a single INSERT ... ON CONFLICT DO UPDATE ... WHERE upsert whose
// correctness (exactly one winner per (job_type, key), lease takeover only
// after expiry, COMPLETED is terminal) is pure SQL semantics — exactly what the
// mocked unit tier CANNOT prove. This tier runs it against a real Postgres,
// including the end-to-end enforce-mode drain: a duplicate delivery of an
// already-completed app_queue_job row settles the row WITHOUT re-running the
// worker.

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

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return [];
}

const SAVED_MODE = process.env.QUEUE_RECEIPTS_MODE;

beforeEach(async () => {
  vi.clearAllMocks();
  await truncateAll();
});

afterEach(() => {
  if (SAVED_MODE === undefined) delete process.env.QUEUE_RECEIPTS_MODE;
  else process.env.QUEUE_RECEIPTS_MODE = SAVED_MODE;
});

describe("claimQueueReceipt (real ON CONFLICT semantics)", () => {
  it("first claim wins; a live lease is duplicate-running; completion is terminal", async () => {
    const params = { jobType: "CERTIFICATE", idempotencyKey: "vq:msg-1" };

    expect(await claimQueueReceipt(params)).toEqual({
      outcome: "claimed",
      attempts: 1,
    });
    // Second claim while the first lease is live: someone else owns it.
    expect(await claimQueueReceipt(params)).toEqual({
      outcome: "duplicate-running",
    });

    await completeQueueReceipt(params);
    // COMPLETED is terminal — no lease expiry can ever resurrect it.
    expect(await claimQueueReceipt(params)).toEqual({
      outcome: "duplicate-completed",
    });
  });

  it("takes over a RUNNING receipt whose lease expired (crashed worker)", async () => {
    const params = { jobType: "LABEL", idempotencyKey: "vq:msg-2" };

    expect(
      await claimQueueReceipt({ ...params, leaseMs: 1 }),
    ).toMatchObject({ outcome: "claimed", attempts: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await claimQueueReceipt(params)).toEqual({
      outcome: "claimed",
      attempts: 2,
    });
  });

  it("release expires the lease immediately so a fast retry can re-claim", async () => {
    const params = { jobType: "CERTIFICATE", idempotencyKey: "vq:msg-3" };

    await claimQueueReceipt(params);
    await releaseQueueReceipt(params);

    expect(await claimQueueReceipt(params)).toEqual({
      outcome: "claimed",
      attempts: 2,
    });
  });

  it("exactly one concurrent claimant wins a fresh key", async () => {
    const params = { jobType: "CERTIFICATE", idempotencyKey: "vq:msg-4" };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimQueueReceipt(params)),
    );

    const winners = results.filter((result) => result.outcome === "claimed");
    expect(winners).toHaveLength(1);
    expect(
      results.filter((result) => result.outcome === "duplicate-running"),
    ).toHaveLength(4);
  });
});

describe("runWithQueueReceipt (enforce + shadow against real receipts)", () => {
  it("enforce: runs once, then skips the duplicate delivery", async () => {
    const params = {
      jobType: "CERTIFICATE",
      idempotencyKey: "vq:msg-5",
      mode: "enforce",
    } satisfies Parameters<typeof runWithQueueReceipt>[0];
    const run = vi.fn(async () => {});

    expect(await runWithQueueReceipt(params, run)).toEqual({ ran: true });
    expect(await runWithQueueReceipt(params, run)).toEqual({
      ran: false,
      reason: "duplicate-completed",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("enforce: a failed run releases the receipt so the retry executes again", async () => {
    const params = {
      jobType: "CERTIFICATE",
      idempotencyKey: "vq:msg-6",
      mode: "enforce",
    } satisfies Parameters<typeof runWithQueueReceipt>[0];
    const run = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error("gotenberg 502"));

    await expect(runWithQueueReceipt(params, run)).rejects.toThrow(
      "gotenberg 502",
    );
    expect(await runWithQueueReceipt(params, run)).toEqual({ ran: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("shadow: a completed duplicate still runs (observe-only)", async () => {
    const enforceParams = {
      jobType: "CERTIFICATE",
      idempotencyKey: "vq:msg-7",
      mode: "enforce",
    } satisfies Parameters<typeof runWithQueueReceipt>[0];
    const run = vi.fn(async () => {});

    await runWithQueueReceipt(enforceParams, run);
    expect(
      await runWithQueueReceipt(
        { ...enforceParams, mode: "shadow" },
        run,
      ),
    ).toEqual({ ran: true });
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("pruneQueueReceipts", () => {
  it("drops aged receipts and keeps fresh ones", async () => {
    const fresh = { jobType: "CERTIFICATE", idempotencyKey: "vq:fresh" };
    const aged = { jobType: "CERTIFICATE", idempotencyKey: "vq:aged" };
    await claimQueueReceipt(fresh);
    await completeQueueReceipt(fresh);
    await claimQueueReceipt(aged);
    await completeQueueReceipt(aged);
    await db.execute(sql`
      update queue_job_receipt
      set completed_at = now() - interval '40 days',
          locked_until = now() - interval '40 days'
      where idempotency_key = 'vq:aged'
    `);

    const pruned = await pruneQueueReceipts();

    expect(pruned).toBe(1);
    expect(await claimQueueReceipt(fresh)).toEqual({
      outcome: "duplicate-completed",
    });
    // The aged receipt is gone, so its key claims fresh again.
    expect(await claimQueueReceipt(aged)).toEqual({
      outcome: "claimed",
      attempts: 1,
    });
  });
});

describe("drainQueue under enforce mode (end-to-end duplicate delivery)", () => {
  it("a re-delivered completed row settles without re-running the worker", async () => {
    process.env.QUEUE_RECEIPTS_MODE = "enforce";
    const env = makeTestEnv();
    const jobId = await enqueueQueueJob({
      type: "CERTIFICATE",
      jobId: 999,
      userId: "user-1",
    });

    workerQueue.mockImplementation(
      async (batch: {
        messages: Array<{ ack: () => void }>;
      }) => {
        for (const message of batch.messages) message.ack();
      },
    );

    expect(await drainQueue(env, CONFIG)).toBe(1);
    expect(workerQueue).toHaveBeenCalledTimes(1);

    // Simulate an at-least-once re-delivery: the SAME row reappears as PENDING
    // (crash-after-work-before-complete / stale reclaim of a slow worker).
    await db.execute(sql`
      update app_queue_job
      set status = 'PENDING', locked_by = null, locked_at = null, available_at = now()
      where id = ${jobId}
    `);

    expect(await drainQueue(env, CONFIG)).toBe(1);
    // The duplicate settled the row via its COMPLETED receipt — no second run.
    expect(workerQueue).toHaveBeenCalledTimes(1);

    const result = await db.execute(
      sql`select status from app_queue_job where id = ${jobId}`,
    );
    expect(rowsOf(result)[0]?.status).toBe("COMPLETED");
  });
});
