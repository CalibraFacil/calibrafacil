import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { appQueueJob } from "@calibra-facil/db/schema";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";

// Real-DB tier for typed queue payloads (REQ-Q-3). A row whose payload does not
// parse against its job schema (or whose type is unknown) can never succeed, so
// retrying it only burns attempts. The drain must dead-letter it at claim time
// (FAILED, with the reason in last_error) and keep draining the rows behind it.

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

type MessageBatchLike = {
  messages: Array<{ body: unknown; ack: () => void }>;
};

beforeEach(async () => {
  vi.clearAllMocks();
  await truncateAll();
  workerQueue.mockImplementation(async (batch: MessageBatchLike) => {
    for (const message of batch.messages) message.ack();
  });
});

// Bypasses the typed enqueue on purpose: it refuses exactly the payloads these
// tests need (rows written by an older producer, a manual fix, a bad deploy).
async function seedRawRow(payload: unknown): Promise<number> {
  const [row] = await db
    .insert(appQueueJob)
    .values({
      type: "CERTIFICATE",
      payload: sql`${JSON.stringify(payload)}::jsonb`,
      status: "PENDING",
      maxAttempts: 3,
    })
    .returning();
  if (!row) throw new Error("seed insert returned no row");
  return row.id;
}

async function rowOf(id: number) {
  const [row] = await db
    .select()
    .from(appQueueJob)
    .where(eq(appQueueJob.id, id));
  return row!;
}

describe("drainQueue dead-letters unparseable payloads", () => {
  it("REQ-Q-3 a payload failing its schema is FAILED at once with the reason, never retried, and the next row still runs", async () => {
    const bad = await seedRawRow({
      type: "CERTIFICATE",
      jobId: "not-a-number",
      userId: "user-1",
    });
    const good = await seedRawRow({
      type: "CERTIFICATE",
      jobId: 7,
      userId: "user-1",
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const processed = await drainQueue(makeTestEnv(), CONFIG);

    const badRow = await rowOf(bad);
    expect(badRow.status).toBe("FAILED");
    expect(badRow.attempts).toBe(1);
    expect(badRow.lockedBy).toBeNull();
    expect(badRow.lockedAt).toBeNull();
    expect(badRow.lastError).toContain("CERTIFICATE");
    expect(badRow.lastError).toContain("jobId");
    expect(log).toHaveBeenCalled();

    // The handler only ever saw the valid row, with its parsed payload.
    expect(workerQueue).toHaveBeenCalledTimes(1);
    const [batch] = workerQueue.mock.calls[0] ?? [];
    expect(batch.messages[0].body).toEqual({
      type: "CERTIFICATE",
      jobId: 7,
      userId: "user-1",
    });
    const goodRow = await rowOf(good);
    expect(goodRow.status).toBe("COMPLETED");
    expect(processed).toBe(1);
  });

  it("REQ-Q-3 an unknown job type is dead-lettered with a reason naming the type", async () => {
    const unknown = await seedRawRow({
      type: "SHIP_PIZZA",
      jobId: 1,
      userId: "user-1",
    });
    const good = await seedRawRow({
      type: "LABEL",
      jobId: 2,
      userId: "user-1",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await drainQueue(makeTestEnv(), CONFIG);

    const row = await rowOf(unknown);
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("SHIP_PIZZA");
    expect((await rowOf(good)).status).toBe("COMPLETED");
    expect(workerQueue).toHaveBeenCalledTimes(1);
  });

  it("REQ-Q-3 a non-object payload is dead-lettered without crashing the drain", async () => {
    const asString = await seedRawRow("just a string");
    const asArray = await seedRawRow([1, 2, 3]);
    const good = await seedRawRow({
      type: "AUDIT_PACK",
      exportId: 4,
      userId: "user-1",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await drainQueue(makeTestEnv(), CONFIG);

    expect((await rowOf(asString)).status).toBe("FAILED");
    expect((await rowOf(asArray)).status).toBe("FAILED");
    expect((await rowOf(good)).status).toBe("COMPLETED");
    expect(workerQueue).toHaveBeenCalledTimes(1);
  });

  it("REQ-Q-3 several malformed rows in a row do not stop the drain (batch of one)", async () => {
    const ids = [
      await seedRawRow({ type: "CERTIFICATE" }),
      await seedRawRow({ type: "LABEL", jobId: 1 }),
      await seedRawRow({ type: "NOPE" }),
    ];
    const good = await seedRawRow({ jobId: 9, userId: "u" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await drainQueue(makeTestEnv(), { ...CONFIG, batchSize: 1 });

    for (const id of ids) expect((await rowOf(id)).status).toBe("FAILED");
    expect((await rowOf(good)).status).toBe("COMPLETED");
    expect(workerQueue).toHaveBeenCalledTimes(1);
  });
});
