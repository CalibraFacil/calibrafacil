import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { releaseStaleQueueJobs } from "@calibra-facil/db/queue";
import {
  appQueueJob,
  asset,
  assetType,
  calibrationJob,
  customer,
  jobAuditLog,
  service,
  type AppQueueJobStatus,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { db, truncateAll } from "../../test/integration/db";
import { seedOrg, type SeededOrg } from "../../test/integration/seed";
import { runStaleJobBackstop } from "./stale-job-backstop";

// Real-Postgres tier for the crash/dead-letter backstop. The tenant SQL guard
// runs in enforce mode here (test/integration/setup.ts), so every statement the
// backstop issues against calibration_job must carry an organization predicate
// or sit on the "cron-queue" allowlist.
//
//   REQ-QDL-001  an expired lease on the FINAL attempt dead-letters the row
//   REQ-QDL-002  a dead-lettered certificate render rejects its GENERATING_PDF job
//   REQ-QDL-003  a render stuck GENERATING_PDF with no live queue row is rejected
//   REQ-QDL-004  APPROVED / SUPERSEDED jobs are never touched

const EPOCH = new Date("2026-01-01T00:00:00.000Z");
const HOUR_MS = 60 * 60_000;
const STUCK_AFTER_MS = HOUR_MS;

beforeEach(async () => {
  await truncateAll();
});

async function seedJob(
  org: SeededOrg,
  params: {
    jobNumber: string;
    status?: JobStatus;
    updatedAt?: Date;
    approvedBy?: string | null;
  },
) {
  const [customerRow] = await db
    .insert(customer)
    .values({
      name: `Cliente ${params.jobNumber}`,
      taxId: "11111111000111",
      authOrganizationId: org.orgId,
      labOrganizationId: org.orgId,
      createdAt: EPOCH,
    })
    .returning();
  const [assetTypeRow] = await db
    .insert(assetType)
    .values({
      name: `Balança ${params.jobNumber}`,
      slug: `balanca-${params.jobNumber.toLowerCase()}`,
      definition: [],
      createdAt: EPOCH,
    })
    .returning();
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId: customerRow!.id,
      labOrganizationId: org.orgId,
      assetTypeId: assetTypeRow!.id,
      name: "Balança",
      serialNumber: `SN-${params.jobNumber}`,
      tag: `TAG-${params.jobNumber}`,
      createdAt: EPOCH,
    })
    .returning();
  const [serviceRow] = await db
    .insert(service)
    .values({
      unitId: org.unitId,
      organizationId: org.orgId,
      name: "Calibração",
      createdAt: EPOCH,
    })
    .returning();
  const [seeded] = await db
    .insert(calibrationJob)
    .values({
      jobId: params.jobNumber,
      certificateName: params.jobNumber,
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: customerRow!.id,
      assetId: assetRow!.id,
      serviceId: serviceRow!.id,
      methodSnapshot: {
        methodId: 0,
        methodName: "M",
        methodVersion: 1,
        accreditedScope: false,
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
      },
      status: params.status ?? "GENERATING_PDF",
      performedAt: EPOCH,
      createdBy: org.userId,
      approvedBy:
        params.approvedBy === undefined ? org.userId : params.approvedBy,
      createdAt: EPOCH,
      updatedAt: params.updatedAt ?? new Date(),
    })
    .returning();
  return seeded!;
}

async function seedQueueRow(params: {
  jobId: number;
  userId: string;
  status: AppQueueJobStatus;
  attempts: number;
  maxAttempts?: number;
  lockedAt?: Date | null;
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
      status: params.status,
      attempts: params.attempts,
      maxAttempts: params.maxAttempts ?? 3,
      lockedBy: params.status === "PROCESSING" ? "dead-worker" : null,
      lockedAt:
        params.lockedAt === undefined
          ? params.status === "PROCESSING"
            ? new Date(Date.now() - HOUR_MS)
            : null
          : params.lockedAt,
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

async function jobRow(id: number) {
  const [row] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, id));
  return row!;
}

async function auditRows(jobId: number) {
  return db.select().from(jobAuditLog).where(eq(jobAuditLog.jobId, jobId));
}

const backstopOverrides = {
  resolveDocumentWorkerUrl: () => null,
  stuckRenderAfterMs: STUCK_AFTER_MS,
};

describe("releaseStaleQueueJobs (real Postgres)", () => {
  it("REQ-QDL-001 an expired lease on the final attempt becomes FAILED, one below the limit becomes PENDING", async () => {
    const org = await seedOrg();
    const last = await seedQueueRow({
      jobId: 1,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 3,
      maxAttempts: 3,
    });
    const below = await seedQueueRow({
      jobId: 2,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 2,
      maxAttempts: 3,
    });

    const result = await releaseStaleQueueJobs(10 * 60_000);

    expect(result.released).toBe(1);
    expect(result.deadLettered).toEqual([
      {
        id: last.id,
        type: "CERTIFICATE",
        payload: { type: "CERTIFICATE", jobId: 1, userId: org.userId },
      },
    ]);

    const failed = await queueRow(last.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.lockedBy).toBeNull();
    expect(failed.lockedAt).toBeNull();
    expect(failed.lastError).toMatch(/final attempt/i);
    expect(failed.availableAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 5_000,
    );

    const retried = await queueRow(below.id);
    expect(retried.status).toBe("PENDING");
    expect(retried.lockedBy).toBeNull();
    expect(retried.lockedAt).toBeNull();
  });

  it("REQ-QDL-001 a lease that has not expired is left alone, even on the final attempt", async () => {
    const org = await seedOrg();
    const live = await seedQueueRow({
      jobId: 1,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 3,
      lockedAt: new Date(),
    });

    const result = await releaseStaleQueueJobs(10 * 60_000);

    expect(result).toEqual({ released: 0, deadLettered: [] });
    expect((await queueRow(live.id)).status).toBe("PROCESSING");
  });
});

describe("runStaleJobBackstop dead-letter handling (real Postgres)", () => {
  it("REQ-QDL-002 a dead-lettered certificate job goes GENERATING_PDF -> REJECTED with an audit row", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0001" });
    await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 3,
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.deadLettered).toBe(1);
    expect(result.rejectedRenders).toBe(1);

    const rejected = await jobRow(job.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toMatch(/^Erro ao gerar certificado: .+/);
    expect(rejected.rejectedBy).toBe(org.userId);
    expect(rejected.rejectedAt).toBeInstanceOf(Date);

    const audit = await auditRows(job.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "certificate_error",
      performedBy: org.userId,
      changes: { status: { old: "GENERATING_PDF", new: "REJECTED" } },
    });
    expect(audit[0]?.reason).toBeTruthy();
  });

  it("REQ-QDL-002 a row below the attempt limit is retried, not rejected", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0002" });
    const row = await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 2,
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.released).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect((await queueRow(row.id)).status).toBe("PENDING");
    expect((await jobRow(job.id)).status).toBe("GENERATING_PDF");
    expect(await auditRows(job.id)).toHaveLength(0);
  });

  it("REQ-QDL-002 REQ-QDL-004 a job that is already APPROVED is left alone", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, {
      jobNumber: "CAL-QDL-0003",
      status: "APPROVED",
    });
    await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 3,
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.deadLettered).toBe(1);
    expect(result.rejectedRenders).toBe(0);
    const untouched = await jobRow(job.id);
    expect(untouched.status).toBe("APPROVED");
    expect(untouched.rejectionReason).toBeNull();
    expect(untouched.rejectedBy).toBeNull();
    expect(await auditRows(job.id)).toHaveLength(0);
  });

  it("REQ-QDL-002 a newer live queue row for the same job keeps it GENERATING_PDF", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0004" });
    await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 3,
    });
    const fresh = await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PENDING",
      attempts: 0,
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.deadLettered).toBe(1);
    expect(result.rejectedRenders).toBe(0);
    expect((await jobRow(job.id)).status).toBe("GENERATING_PDF");
    expect((await queueRow(fresh.id)).status).toBe("PENDING");
  });
});

describe("runStaleJobBackstop stuck-render sweep (real Postgres)", () => {
  it("REQ-QDL-003 a GENERATING_PDF job past the threshold with no live queue row is rejected", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, {
      jobNumber: "CAL-QDL-0010",
      updatedAt: new Date(Date.now() - 2 * HOUR_MS),
    });
    // A finished/failed queue row is not "live".
    await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "FAILED",
      attempts: 3,
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.stuckRendersRejected).toBe(1);
    const rejected = await jobRow(job.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toMatch(/^Erro ao gerar certificado: .+/);
    expect(rejected.rejectedBy).toBe(org.userId);
    expect(rejected.rejectedAt).toBeInstanceOf(Date);
    const audit = await auditRows(job.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "certificate_error",
      performedBy: org.userId,
      changes: { status: { old: "GENERATING_PDF", new: "REJECTED" } },
    });
  });

  it("REQ-QDL-003 a job with a live PENDING or PROCESSING queue row is left alone", async () => {
    const org = await seedOrg();
    const old = new Date(Date.now() - 2 * HOUR_MS);
    const pending = await seedJob(org, {
      jobNumber: "CAL-QDL-0011",
      updatedAt: old,
    });
    const processing = await seedJob(org, {
      jobNumber: "CAL-QDL-0012",
      updatedAt: old,
    });
    await seedQueueRow({
      jobId: pending.id,
      userId: org.userId,
      status: "PENDING",
      attempts: 0,
    });
    await seedQueueRow({
      jobId: processing.id,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 1,
      lockedAt: new Date(),
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.stuckRendersRejected).toBe(0);
    expect((await jobRow(pending.id)).status).toBe("GENERATING_PDF");
    expect((await jobRow(processing.id)).status).toBe("GENERATING_PDF");
  });

  it("REQ-QDL-003 a job newer than the threshold is left alone", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, {
      jobNumber: "CAL-QDL-0013",
      updatedAt: new Date(Date.now() - 10 * 60_000),
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.stuckRendersRejected).toBe(0);
    expect((await jobRow(job.id)).status).toBe("GENERATING_PDF");
  });

  it("REQ-QDL-003 REQ-QDL-004 an old APPROVED job is never swept, and each tenant's stuck job is rejected under its own organization", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });
    const old = new Date(Date.now() - 3 * HOUR_MS);
    const approved = await seedJob(orgA, {
      jobNumber: "CAL-QDL-0014",
      status: "APPROVED",
      updatedAt: old,
    });
    const stuckA = await seedJob(orgA, {
      jobNumber: "CAL-QDL-0015",
      updatedAt: old,
    });
    const stuckB = await seedJob(orgB, {
      jobNumber: "CAL-QDL-0016",
      updatedAt: old,
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.stuckRendersRejected).toBe(2);
    expect((await jobRow(approved.id)).status).toBe("APPROVED");
    expect(await auditRows(approved.id)).toHaveLength(0);
    const rejectedA = await jobRow(stuckA.id);
    const rejectedB = await jobRow(stuckB.id);
    expect(rejectedA.status).toBe("REJECTED");
    expect(rejectedA.rejectedBy).toBe("user-a");
    expect(rejectedB.status).toBe("REJECTED");
    expect(rejectedB.rejectedBy).toBe("user-b");
  });
});
