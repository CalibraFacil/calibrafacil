import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  claimQueueJobs,
  enqueueQueueJob,
  failQueueJob,
} from "@calibra-facil/db/queue";
import { appQueueJob } from "@calibra-facil/db/schema";
import { db, truncateAll } from "../test/integration/db";

// Real-DB tier for what a failed attempt does to a queue row (retry with
// backoff, or FAILED once the attempts are spent) and for the enqueue refusal
// of a payload its consumers could not parse. The mocked unit tier in
// packages/db only echoed the values the test fed it.

beforeEach(async () => {
  await truncateAll();
});

async function rowOf(id: number) {
  const [row] = await db
    .select()
    .from(appQueueJob)
    .where(eq(appQueueJob.id, id));
  return row!;
}

async function enqueueAndClaim(maxAttempts: number) {
  const id = await enqueueQueueJob(
    { type: "CERTIFICATE", jobId: 1, userId: "user-1" },
    { maxAttempts },
  );
  const [claimed] = await claimQueueJobs("worker-a", 1);
  expect(claimed?.id).toBe(id);
  return id;
}

describe("failing a claimed queue row (real Postgres)", () => {
  it("below the attempt limit the row returns to PENDING, five seconds out after the first attempt", async () => {
    const id = await enqueueAndClaim(3);
    const before = Date.now();

    await expect(
      failQueueJob(id, "worker-a", new Error("temporary failure")),
    ).resolves.toBe(true);

    const row = await rowOf(id);
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.lockedBy).toBeNull();
    expect(row.lockedAt).toBeNull();
    expect(row.lastError).toBe("temporary failure");
    const delay = row.availableAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(5_000);
    expect(delay).toBeLessThan(15_000);
  });

  it("a row on its last attempt is FAILED, never retried, and keeps the reason", async () => {
    const id = await enqueueAndClaim(1);

    await expect(
      failQueueJob(id, "worker-a", "permanent failure"),
    ).resolves.toBe(true);

    const row = await rowOf(id);
    expect(row.status).toBe("FAILED");
    expect(row.lockedBy).toBeNull();
    expect(row.lastError).toBe("permanent failure");
    await expect(claimQueueJobs("worker-b", 1)).resolves.toEqual([]);
  });
});

describe("enqueueing a queue row (real Postgres)", () => {
  it("REQ-Q-2 stores the parsed payload with unknown keys stripped", async () => {
    // Built apart so the excess key is data, not a literal the compiler refuses.
    const message = {
      type: "LABEL",
      jobId: 1,
      userId: "u",
      leaked: "x",
    } as const;
    const id = await enqueueQueueJob(message);

    expect((await rowOf(id)).payload).toEqual({
      type: "LABEL",
      jobId: 1,
      userId: "u",
    });
  });

  it("REQ-Q-2 refuses a payload that fails its schema, an unknown type and a cron-only timer, writing no row", async () => {
    const refused = await Promise.allSettled([
      // @ts-expect-error -- jobId must be a number: the parameter is the typed union, not unknown
      enqueueQueueJob({ type: "LABEL", jobId: "1", userId: "u" }),
      // @ts-expect-error -- not a member of the union
      enqueueQueueJob({ type: "SHIP_PIZZA" }),
      // @ts-expect-error -- cron-only timers are not queue jobs
      enqueueQueueJob({ type: "PORTAL_DIGEST" }),
    ]);

    expect(refused.map((outcome) => outcome.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(
      String(refused[0]?.status === "rejected" && refused[0].reason),
    ).toMatch(/jobId/);
    expect(await db.select().from(appQueueJob)).toEqual([]);
  });
});
