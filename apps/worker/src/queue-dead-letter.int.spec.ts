import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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

vi.mock("./index.js", () => ({
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
  it("REQ-QDL-001 REQ-QDL-002 the row becomes FAILED (never re-claimed) and its GENERATING_PDF job is REJECTED with an audit row", async () => {
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
    expect(rejected.status).toBe("REJECTED");
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
      changes: { status: { old: "GENERATING_PDF", new: "REJECTED" } },
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
