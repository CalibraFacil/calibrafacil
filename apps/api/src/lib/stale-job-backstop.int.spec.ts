import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertJobs } from "../../test/integration/job-fixtures";
import { eq, sql } from "drizzle-orm";
import { releaseStaleQueueJobs } from "@calibra-facil/db/queue";
import { rejectCertificateRender } from "@calibra-facil/db/queue-render-recovery";
import {
  appQueueJob,
  asset,
  assetType,
  calibrationJob,
  certificateNumberingProfile,
  certificateNumberingSequence,
  customer,
  issuedCertificateSnapshot,
  jobAuditLog,
  service,
  user,
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

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedJob(
  org: SeededOrg,
  params: {
    jobNumber: string;
    status?: JobStatus;
    updatedAt?: Date;
    approvedBy?: string | null;
    createdBy?: string;
    rejectionReason?: string;
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
  const [seeded] = await insertJobs({
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
    createdBy: params.createdBy ?? org.userId,
    approvedBy:
      params.approvedBy === undefined ? org.userId : params.approvedBy,
    rejectionReason: params.rejectionReason,
    createdAt: EPOCH,
    updatedAt: params.updatedAt ?? new Date(),
  });
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

/** Issued snapshot for a job (a GENERATING_PDF job should have none: it must stay put). */
async function seedSnapshot(org: SeededOrg, jobId: number) {
  const [row] = await db
    .insert(issuedCertificateSnapshot)
    .values({
      organizationId: org.orgId,
      jobId,
      certificateNumber: `CAL-${jobId}`,
      pdfR2Key: `certs/${jobId}.pdf`,
      pdfSha256: "a".repeat(64),
      renderPipeline: "FIXED_LAYOUT",
      layoutKey: "calibration-certificate-fixed",
      layoutVersion: "1.0.0",
      rendererVersion: "worker/1",
      renderPolicy: {
        converter: "gotenberg-chromium",
        layoutKey: "calibration-certificate-fixed",
        layoutVersion: "1.0.0",
      },
      inputDataSnapshot: {},
      status: "ISSUED",
    })
    .returning();
  return row!;
}

async function seedNumbering(org: SeededOrg) {
  const [profile] = await db
    .insert(certificateNumberingProfile)
    .values({
      organizationId: org.orgId,
      config: {
        labCode: "LAB",
        numberTemplate: "{labCode}-{sequence}",
        certificateNameTemplate: "{labCode}-{sequence}",
        sequence: {
          resetScope: "never",
          startAt: 1,
          increment: 1,
          padding: 4,
        },
      },
    })
    .returning();
  await db.insert(certificateNumberingSequence).values({
    organizationId: org.orgId,
    profileId: profile!.id,
    sequenceKey: "never",
    currentValue: 7,
  });
}

/** What REQ-QDL-004 says must never move: issued snapshots and numbering state. */
async function evidenceState() {
  return {
    snapshots: await db.select().from(issuedCertificateSnapshot),
    profiles: await db.select().from(certificateNumberingProfile),
    sequences: await db.select().from(certificateNumberingSequence),
  };
}

/**
 * Makes every job_audit_log insert fail, to prove the status change and its
 * audit row commit or roll back together. Returns the function that removes it.
 */
async function refuseAuditInserts() {
  await db.execute(sql`
    create function qdl_refuse_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit insert refused'; end $$
  `);
  await db.execute(sql`
    create trigger qdl_refuse_audit before insert on job_audit_log
    for each row execute function qdl_refuse_audit()
  `);
  return async () => {
    await db.execute(sql`drop trigger qdl_refuse_audit on job_audit_log`);
    await db.execute(sql`drop function qdl_refuse_audit()`);
  };
}

/**
 * Makes the COMMIT of any calibration_job -> RENDER_FAILED update fail (a deferred
 * constraint trigger fires at commit). The audit row is written before that, so
 * it is only rolled back if it shares the status change's transaction.
 */
async function refuseRejectionCommit() {
  await db.execute(sql`
    create function qdl_refuse_commit() returns trigger language plpgsql as $$
    begin raise exception 'commit refused'; end $$
  `);
  await db.execute(sql`
    create constraint trigger qdl_refuse_commit after update on calibration_job
    deferrable initially deferred for each row
    when (new.status = 'RENDER_FAILED')
    execute function qdl_refuse_commit()
  `);
  return async () => {
    await db.execute(sql`drop trigger qdl_refuse_commit on calibration_job`);
    await db.execute(sql`drop function qdl_refuse_commit()`);
  };
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
  it("REQ-QDL-002 a dead-lettered certificate job goes GENERATING_PDF -> RENDER_FAILED with an audit row", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0001" });
    await seedSnapshot(org, job.id);
    await seedNumbering(org);
    const evidenceBefore = await evidenceState();
    const queued = await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 3,
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.deadLettered).toBe(1);
    expect(result.rejectedRenders).toBe(1);
    // REQ-QDL-004: the issued snapshot and the numbering state do not move.
    expect(await evidenceState()).toEqual(evidenceBefore);

    const rejected = await jobRow(job.id);
    expect(rejected.status).toBe("RENDER_FAILED");
    expect(rejected.rejectionReason).toMatch(/^Erro ao gerar certificado: .+/);
    expect(rejected.rejectedBy).toBe(org.userId);
    expect(rejected.rejectedAt).toBeInstanceOf(Date);

    const audit = await auditRows(job.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "certificate_error",
      performedBy: org.userId,
      // The marker tells an automatic rejection from the approver's own action.
      changes: {
        status: { old: "GENERATING_PDF", new: "RENDER_FAILED" },
        source: "queue-backstop",
        reason: "dead-lettered",
        queueJobId: queued.id,
      },
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
    await seedSnapshot(org, job.id);
    await seedNumbering(org);
    const evidenceBefore = await evidenceState();
    // A finished/failed queue row is not "live".
    await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "FAILED",
      attempts: 3,
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.stuckRendersRejected).toBe(1);
    expect(await evidenceState()).toEqual(evidenceBefore);
    const rejected = await jobRow(job.id);
    expect(rejected.status).toBe("RENDER_FAILED");
    expect(rejected.rejectionReason).toMatch(/^Erro ao gerar certificado: .+/);
    expect(rejected.rejectedBy).toBe(org.userId);
    expect(rejected.rejectedAt).toBeInstanceOf(Date);
    const audit = await auditRows(job.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "certificate_error",
      performedBy: org.userId,
      changes: {
        status: { old: "GENERATING_PDF", new: "RENDER_FAILED" },
        source: "queue-backstop",
        reason: "stuck-render",
      },
    });
  });

  it("REQ-QDL-003 the actor falls back to the job's creator when no approver is recorded", async () => {
    const org = await seedOrg();
    await db.insert(user).values({
      id: "creator-1",
      name: "Criador",
      email: "creator-1@lab.test",
    });
    const job = await seedJob(org, {
      jobNumber: "CAL-QDL-0017",
      updatedAt: new Date(Date.now() - 2 * HOUR_MS),
      approvedBy: null,
      createdBy: "creator-1",
    });

    const result = await runStaleJobBackstop(backstopOverrides);

    expect(result.stuckRendersRejected).toBe(1);
    const rejected = await jobRow(job.id);
    expect(rejected.status).toBe("RENDER_FAILED");
    expect(rejected.rejectedBy).toBe("creator-1");
    const audit = await auditRows(job.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.performedBy).toBe("creator-1");
  });

  it("REQ-QDL-003 the actor is the approver, not the creator, when both are recorded", async () => {
    const org = await seedOrg();
    await db.insert(user).values({
      id: "creator-2",
      name: "Criador",
      email: "creator-2@lab.test",
    });
    const job = await seedJob(org, {
      jobNumber: "CAL-QDL-0018",
      updatedAt: new Date(Date.now() - 2 * HOUR_MS),
      createdBy: "creator-2",
    });

    await runStaleJobBackstop(backstopOverrides);

    expect((await jobRow(job.id)).rejectedBy).toBe(org.userId);
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
    expect(rejectedA.status).toBe("RENDER_FAILED");
    expect(rejectedA.rejectedBy).toBe("user-a");
    expect(rejectedB.status).toBe("RENDER_FAILED");
    expect(rejectedB.rejectedBy).toBe("user-b");
  });
});

// REQ-QDL-002 / REQ-QDL-004: the rejection is a compare-and-set on the job's
// status. REVIEW / CANCELED / REJECTED jobs are NOT protected by the 0115
// immutability trigger, so only the status predicate keeps them out of reach.
const NOT_GENERATING = [
  "REVIEW",
  "CANCELED",
  "REJECTED",
  "RENDER_FAILED",
  "SUPERSEDED",
] as const;

describe.each(NOT_GENERATING)(
  "a job that is %s is never rejected by the backstop (real Postgres)",
  (status) => {
    async function seedNotGenerating(org: SeededOrg, jobNumber: string) {
      const job = await seedJob(org, {
        jobNumber,
        status,
        updatedAt: new Date(Date.now() - 2 * HOUR_MS),
        rejectionReason:
          status === "REJECTED" ? "Reprovado pelo revisor" : undefined,
      });
      await seedSnapshot(org, job.id);
      await seedNumbering(org);
      return job;
    }

    it(`REQ-QDL-002 REQ-QDL-004 a dead-lettered certificate row pointing at a ${status} job leaves the job, its audit log, the snapshot and the numbering unchanged`, async () => {
      const org = await seedOrg();
      const job = await seedNotGenerating(org, "CAL-QDL-0100");
      await seedQueueRow({
        jobId: job.id,
        userId: org.userId,
        status: "PROCESSING",
        attempts: 3,
      });
      const jobBefore = await jobRow(job.id);
      const evidenceBefore = await evidenceState();

      const result = await runStaleJobBackstop(backstopOverrides);

      expect(result.deadLettered).toBe(1);
      expect(result.rejectedRenders).toBe(0);
      expect(await jobRow(job.id)).toEqual(jobBefore);
      expect(await auditRows(job.id)).toEqual([]);
      expect(await evidenceState()).toEqual(evidenceBefore);
    });

    it(`REQ-QDL-003 REQ-QDL-004 the stuck-render sweep leaves a ${status} job, its audit log, the snapshot and the numbering unchanged`, async () => {
      const org = await seedOrg();
      const job = await seedNotGenerating(org, "CAL-QDL-0101");
      const jobBefore = await jobRow(job.id);
      const evidenceBefore = await evidenceState();

      const result = await runStaleJobBackstop(backstopOverrides);

      expect(result.stuckRendersRejected).toBe(0);
      expect(await jobRow(job.id)).toEqual(jobBefore);
      expect(await auditRows(job.id)).toEqual([]);
      expect(await evidenceState()).toEqual(evidenceBefore);
    });

    it(`REQ-QDL-002 the rejection itself is a compare-and-set on status: ${status} is refused even when it is addressed directly`, async () => {
      const org = await seedOrg();
      const job = await seedNotGenerating(org, "CAL-QDL-0102");
      const jobBefore = await jobRow(job.id);

      await expect(
        rejectCertificateRender({
          jobId: job.id,
          organizationId: org.orgId,
          rejectedBy: org.userId,
          reason: "teste",
          trigger: "stuck-render",
        }),
      ).resolves.toBe(false);

      expect(await jobRow(job.id)).toEqual(jobBefore);
      expect(await auditRows(job.id)).toEqual([]);
    });
  },
);

describe("rejectCertificateRender guards (real Postgres)", () => {
  const request = (org: SeededOrg, jobId: number) => ({
    jobId,
    organizationId: org.orgId,
    rejectedBy: org.userId,
    reason: "teste",
    trigger: "dead-lettered" as const,
  });

  it("REQ-QDL-002 rejects a GENERATING_PDF job of the organization", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0110" });

    await expect(rejectCertificateRender(request(org, job.id))).resolves.toBe(
      true,
    );
    expect((await jobRow(job.id)).status).toBe("RENDER_FAILED");
  });

  it("REQ-QDL-002 another organization's id never rejects the job", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });
    const job = await seedJob(orgA, { jobNumber: "CAL-QDL-0111" });

    await expect(
      rejectCertificateRender({ ...request(orgB, job.id) }),
    ).resolves.toBe(false);
    expect((await jobRow(job.id)).status).toBe("GENERATING_PDF");
    expect(await auditRows(job.id)).toEqual([]);
  });

  it("REQ-QDL-003 a job touched after the sweep read it is not rejected", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0112" });

    await expect(
      rejectCertificateRender({
        ...request(org, job.id),
        notUpdatedSince: new Date(Date.now() - HOUR_MS),
      }),
    ).resolves.toBe(false);
    expect((await jobRow(job.id)).status).toBe("GENERATING_PDF");
  });

  it("REQ-QDL-002 a live queue row for the job blocks the rejection", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0113" });
    await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PENDING",
      attempts: 0,
    });

    await expect(rejectCertificateRender(request(org, job.id))).resolves.toBe(
      false,
    );
    expect((await jobRow(job.id)).status).toBe("GENERATING_PDF");
  });
});

describe("the rejection and its audit row are one transaction (real Postgres)", () => {
  it("REQ-QDL-002 a failing audit insert rolls back the status change of a dead-lettered render", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0120" });
    await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 3,
    });
    const jobBefore = await jobRow(job.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const restore = await refuseAuditInserts();

    try {
      const result = await runStaleJobBackstop(backstopOverrides);
      expect(result.deadLettered).toBe(1);
      expect(result.rejectedRenders).toBe(0);
    } finally {
      await restore();
    }

    // Neither half survived: the job is still GENERATING_PDF, untouched.
    expect(await jobRow(job.id)).toEqual(jobBefore);
    expect(await auditRows(job.id)).toEqual([]);
  });

  it("REQ-QDL-002 an audit row written before a failed commit does not outlive the rolled-back status change", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, { jobNumber: "CAL-QDL-0122" });
    await seedQueueRow({
      jobId: job.id,
      userId: org.userId,
      status: "PROCESSING",
      attempts: 3,
    });
    const jobBefore = await jobRow(job.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const restore = await refuseRejectionCommit();

    try {
      const result = await runStaleJobBackstop(backstopOverrides);
      expect(result.rejectedRenders).toBe(0);
    } finally {
      await restore();
    }

    expect(await jobRow(job.id)).toEqual(jobBefore);
    expect(await auditRows(job.id)).toEqual([]);
  });

  it("REQ-QDL-003 a failing audit insert rolls back the status change of a stuck render", async () => {
    const org = await seedOrg();
    const job = await seedJob(org, {
      jobNumber: "CAL-QDL-0121",
      updatedAt: new Date(Date.now() - 2 * HOUR_MS),
    });
    const jobBefore = await jobRow(job.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const restore = await refuseAuditInserts();

    try {
      const result = await runStaleJobBackstop(backstopOverrides);
      expect(result.stuckRendersRejected).toBe(0);
    } finally {
      await restore();
    }

    expect(await jobRow(job.id)).toEqual(jobBefore);
    expect(await auditRows(job.id)).toEqual([]);
  });
});
