import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { releaseStaleQueueJobs } from "@calibra-facil/db/queue";
import {
  appQueueJob,
  calibrationJob,
  jobAuditLog,
} from "@calibra-facil/db/schema";
import { db, truncateAll } from "../test/integration/db";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

// Real-DB tier for the crash dead-letter: a job that kills the worker process
// never reaches failQueueJob, so its lease expires with attempts == max_attempts.
// drainQueue's lease reclaim must dead-letter it (FAILED, not PENDING — else it
// is re-claimed forever) and reject the certificate it left in GENERATING_PDF.

const { workerQueue } = vi.hoisted(() => ({ workerQueue: vi.fn() }));

vi.mock("@calibra-facil/jobs-core", () => ({
  default: { queue: workerQueue },
}));

import { drainQueue } from "./queue-runtime";
import { makeTestEnv } from "../test/integration/env";

const CONFIG = {
  workerId: "int-test-worker",
  batchSize: 10,
  pollIntervalMs: 0,
  staleAfterMs: 10 * 60_000,
};

const EXPIRED_LEASE = () => new Date(Date.now() - 60 * 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await truncateAll();
});

async function seedCrashedRow(params: {
  jobId: number;
  userId: string;
  attempts: number;
}) {
  const [row] = await db
    .insert(appQueueJob)
    .values({
      type: "CERTIFICATE",
      payload: {
        type: "CERTIFICATE",
        jobId: params.jobId,
        userId: params.userId,
      },
      status: "PROCESSING",
      attempts: params.attempts,
      maxAttempts: 3,
      lockedBy: "crashed-worker",
      lockedAt: EXPIRED_LEASE(),
    })
    .returning();
  return row!;
}

async function jobRow(id: number) {
  const [row] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, id));
  return row!;
}

describe("drainQueue dead-letters a worker crash on the final attempt", () => {
  it("REQ-QDL-001 REQ-QDL-002 the row becomes FAILED (never re-claimed) and its GENERATING_PDF job is RENDER_FAILED with an audit row", async () => {
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
    });
    const row = await seedCrashedRow({
      jobId: job.jobId,
      userId: org.userId,
      attempts: 3,
    });

    const processed = await drainQueue(makeTestEnv(), CONFIG);

    // The worker was never handed the crashed row again.
    expect(processed).toBe(0);
    expect(workerQueue).not.toHaveBeenCalled();

    const [queueRow] = await db
      .select()
      .from(appQueueJob)
      .where(eq(appQueueJob.id, row.id));
    expect(queueRow?.status).toBe("FAILED");
    expect(queueRow?.attempts).toBe(3);
    expect(queueRow?.lockedAt).toBeNull();

    const rejected = await jobRow(job.jobId);
    expect(rejected.status).toBe("RENDER_FAILED");
    expect(rejected.rejectionReason).toMatch(/^Erro ao gerar certificado: /);
    expect(rejected.rejectedBy).toBe(org.userId);
    expect(rejected.rejectedAt).toBeInstanceOf(Date);

    const audit = await db
      .select()
      .from(jobAuditLog)
      .where(eq(jobAuditLog.jobId, job.jobId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "certificate_error",
      performedBy: org.userId,
      changes: { status: { old: "GENERATING_PDF", new: "RENDER_FAILED" } },
    });

    // A second drain finds nothing to do: no loop, no second audit row.
    await drainQueue(makeTestEnv(), CONFIG);
    expect(workerQueue).not.toHaveBeenCalled();
    expect(
      await db
        .select()
        .from(jobAuditLog)
        .where(eq(jobAuditLog.jobId, job.jobId)),
    ).toHaveLength(1);
  });

  it("REQ-QDL-001 a crashed row below the limit is retried, and its job stays GENERATING_PDF", async () => {
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
    });
    const row = await seedCrashedRow({
      jobId: job.jobId,
      userId: org.userId,
      attempts: 2,
    });
    workerQueue.mockImplementation(
      async (batch: { messages: Array<{ ack: () => void }> }) => {
        for (const message of batch.messages) message.ack();
      },
    );

    const processed = await drainQueue(makeTestEnv(), CONFIG);

    expect(processed).toBe(1);
    expect(workerQueue).toHaveBeenCalledTimes(1);
    const [queueRow] = await db
      .select()
      .from(appQueueJob)
      .where(eq(appQueueJob.id, row.id));
    expect(queueRow?.status).toBe("COMPLETED");
    expect(queueRow?.attempts).toBe(3);
    expect((await jobRow(job.jobId)).status).toBe("GENERATING_PDF");
  });

  it("REQ-QDL-004 a dead-lettered row whose job is already APPROVED leaves the job untouched", async () => {
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      status: "APPROVED",
    });
    await seedCrashedRow({
      jobId: job.jobId,
      userId: org.userId,
      attempts: 3,
    });

    await drainQueue(makeTestEnv(), CONFIG);

    const untouched = await jobRow(job.jobId);
    expect(untouched.status).toBe("APPROVED");
    expect(untouched.rejectionReason).toBeNull();
    expect(
      await db
        .select()
        .from(jobAuditLog)
        .where(eq(jobAuditLog.jobId, job.jobId)),
    ).toHaveLength(0);
  });
});

// Rows are claimed one at a time: a row queued behind a slow job must stay
// PENDING (no lease at all) until its own turn, so the lease reclaim can never
// dead-letter it — and reject a healthy certificate — while it merely waits.
async function seedPending(
  jobId: number,
  userId: string,
  attempts = 0,
): Promise<{ id: number }> {
  const [row] = await db
    .insert(appQueueJob)
    .values({
      type: "CERTIFICATE",
      payload: { type: "CERTIFICATE", jobId, userId },
      status: "PENDING",
      attempts,
      maxAttempts: 3,
    })
    .returning();
  return row!;
}

async function queueRow(id: number) {
  const [row] = await db
    .select()
    .from(appQueueJob)
    .where(eq(appQueueJob.id, id));
  return row!;
}

type MessageBatchLike = { messages: Array<{ ack: () => void }> };

describe("drainQueue claims one row at a time", () => {
  it("REQ-QDL-001 a slow first job leaves the second row PENDING and unclaimed while it runs", async () => {
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const first = await seedPending(1, org.userId);
    const second = await seedPending(2, org.userId);
    let secondWhileFirstRuns: Awaited<ReturnType<typeof queueRow>> | undefined;

    workerQueue
      .mockImplementationOnce(async (batch: MessageBatchLike) => {
        secondWhileFirstRuns = await queueRow(second.id);
        for (const message of batch.messages) message.ack();
      })
      .mockImplementationOnce(async (batch: MessageBatchLike) => {
        // Its own turn: only now is the row claimed.
        expect((await queueRow(second.id)).status).toBe("PROCESSING");
        for (const message of batch.messages) message.ack();
      });

    await drainQueue(makeTestEnv(), CONFIG);

    expect(secondWhileFirstRuns?.status).toBe("PENDING");
    expect(secondWhileFirstRuns?.lockedBy).toBeNull();
    expect(secondWhileFirstRuns?.lockedAt).toBeNull();
    expect(secondWhileFirstRuns?.attempts).toBe(0);
    expect(workerQueue).toHaveBeenCalledTimes(2);
    expect((await queueRow(first.id)).status).toBe("COMPLETED");
    const done = await queueRow(second.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.attempts).toBe(1);
  });

  it("REQ-QDL-001 a final-attempt row waiting behind a slow job is not dead-lettered by a concurrent reclaim", async () => {
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
    });
    await seedPending(1, org.userId);
    // Claiming this row makes attempts 3 of 3: its final attempt.
    const waiting = await seedPending(job.jobId, org.userId, 2);
    let reclaimed: { released: number; deadLettered: unknown[] } | undefined;
    let waitingDuring: Awaited<ReturnType<typeof queueRow>> | undefined;

    workerQueue
      .mockImplementationOnce(async (batch: MessageBatchLike) => {
        // The first job is slow. Another drainer / the backstop cron reclaims
        // meanwhile, long after the whole batch would have been claimed.
        reclaimed = await releaseStaleQueueJobs(0);
        waitingDuring = await queueRow(waiting.id);
        for (const message of batch.messages) message.ack();
      })
      .mockImplementationOnce(async (batch: MessageBatchLike) => {
        for (const message of batch.messages) message.ack();
      });

    await drainQueue(makeTestEnv(), CONFIG);

    // The reclaim only touched the running first row (a 0ms lease counts it as
    // expired, and it has attempts left); the waiting row was PENDING, so it was
    // never dead-lettered.
    expect(reclaimed?.deadLettered).toEqual([]);
    expect(waitingDuring?.status).toBe("PENDING");
    const finished = await queueRow(waiting.id);
    expect(finished.status).toBe("COMPLETED");
    expect(finished.attempts).toBe(3);
    // Its certificate was not rejected.
    const [certificate] = await db
      .select()
      .from(calibrationJob)
      .where(eq(calibrationJob.id, job.jobId));
    expect(certificate?.status).toBe("GENERATING_PDF");
  });
});
