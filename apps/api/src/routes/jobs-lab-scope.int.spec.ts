/**
 * jobs-lab-scope.int.spec.ts — the calibration-job routes (P2-18f) that the other
 * job specs do not reach on the success path, each with a cross-laboratory
 * negative: laboratory B's job (by id or by certificate number) used in
 * laboratory A's session answers 404, with nothing read or written.
 *
 * Real DB + real RBAC (only the better-auth session is mocked, see
 * test/integration/setup.ts). The handlers run their statements in
 * `orgDb(lab).transaction`, so this file is also what the RLS shadow report
 * (`pnpm --filter @calibra-facil/api rls:shadow-report --files ...`) replays as
 * `calibra_app` to prove the routes carry the laboratory in every statement.
 *
 *   REQ-JOB-SCOPE-1  GET /search, /:id/label, /:id/label-commands read only the laboratory's jobs
 *   REQ-JOB-SCOPE-2  GET /:id/audit-log returns the job's trail, never another laboratory's
 *   REQ-JOB-SCOPE-3  GET /:id/amendment-chain walks the chain inside the laboratory
 *   REQ-JOB-SCOPE-4  GET /:id/download, /:id/download-label, GET /technicians/list
 *   REQ-JOB-SCOPE-5  DELETE /:id (cancel) writes the job and its audit row in the laboratory's transaction
 *   REQ-JOB-SCOPE-6  atomicity: a failing notification insert leaves no NC (POST /:id/flag-oot)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import { appendJobEvent } from "@calibra-facil/db/job-events";
import {
  calibrationJob,
  jobAuditLog,
  nonConformance,
  ootNotification,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { jobsRouter } from "./jobs";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { insertJobs, setJobStatus } from "../../test/integration/job-fixtures";
import {
  seedExtraMember,
  seedJobForOrg,
} from "../../test/integration/tenant-refs";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };

type Lab = Awaited<ReturnType<typeof seedLab>>;

/** A laboratory with one admin, one DRAFT job and the rows the job references. */
async function seedLab(orgId: string) {
  const org = await seedOrg({ orgId, userId: `admin-${orgId}`, role: "admin" });
  const seeded = await seedJobForOrg({
    orgId,
    unitId: org.unitId,
    createdBy: org.userId,
  });
  const [job] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, seeded.jobId));
  if (!job) throw new Error("seedLab: job not found");
  return { ...org, ...seeded, job };
}

async function seedWorld() {
  const a = await seedLab("org-a");
  const b = await seedLab("org-b");
  loginAs({ userId: a.userId, organizationId: a.orgId });
  return { a, b };
}

function get(path: string) {
  return jobsRouter.request(path);
}

function send(path: string, method: string, body?: unknown) {
  return jobsRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function auditRows(jobId: number) {
  return db.select().from(jobAuditLog).where(eq(jobAuditLog.jobId, jobId));
}

/** Lab A's APPROVED original and the DRAFT amendment that superseded it. */
async function seedAmendmentChain(lab: Lab) {
  const { id: _id, ...base } = lab.job;
  const [original] = await insertJobs({
    ...base,
    jobId: `${lab.job.jobId}-ORIG`,
    certificateName: `${lab.job.certificateName}-ORIG`,
    verificationToken: undefined,
    status: "DRAFT",
  });
  if (!original) throw new Error("seedAmendmentChain: original not inserted");
  const [amended] = await insertJobs({
    ...base,
    jobId: `${lab.job.jobId}-AM1`,
    certificateName: `${lab.job.certificateName}-AM1`,
    verificationToken: undefined,
    status: "DRAFT",
    supersedesId: original.id,
    amendmentNumber: 1,
    amendmentReason: "Correção",
  });
  if (!amended) throw new Error("seedAmendmentChain: amendment not inserted");
  await setJobStatus(original.id, "SUPERSEDED", {
    supersededById: amended.id,
    supersededAt: new Date("2026-02-01T00:00:00.000Z"),
    amendmentReason: "Correção",
  });
  return { original, amended };
}

describe("jobsRouter — laboratory scope (P2-18f)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-JOB-SCOPE-1: GET /search finds this laboratory's job by number and never the other laboratory's", async () => {
    const { a, b } = await seedWorld();

    const own = await get(`/search?query=${a.job.jobId}`);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual([
      { id: a.jobId, jobId: a.job.jobId, status: "DRAFT" },
    ]);

    const foreign = await get(`/search?query=${b.job.jobId}`);
    expect(foreign.status).toBe(200);
    expect(await foreign.json()).toEqual([]);
  });

  it("REQ-JOB-SCOPE-1: GET /:id/label answers for this laboratory's job (id or certificate number) and 404s the other's", async () => {
    const { a, b } = await seedWorld();

    const byId = await get(`/${a.jobId}/label`);
    expect(byId.status).toBe(200);
    expect(await byId.json()).toMatchObject({
      id: a.jobId,
      label: a.job.jobId,
    });

    const byNumber = await get(`/${a.job.jobId}/label`);
    expect(byNumber.status).toBe(200);
    expect(await byNumber.json()).toMatchObject({ id: a.jobId });

    expect((await get(`/${b.jobId}/label`)).status).toBe(404);
    expect((await get(`/${b.job.jobId}/label`)).status).toBe(404);
  });

  it("REQ-JOB-SCOPE-1: GET /:id/label-commands renders this laboratory's label and 404s the other's", async () => {
    const { a, b } = await seedWorld();

    const own = await get(`/${a.jobId}/label-commands?lang=zpl`);
    expect(own.status).toBe(200);
    expect(await own.text()).toContain(a.job.jobId);

    const foreign = await get(`/${b.jobId}/label-commands?lang=zpl`);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Job nao encontrado" });
  });

  it("REQ-JOB-SCOPE-2: GET /:id/audit-log returns the job's own trail with the performer's name; the other laboratory's job is 404", async () => {
    const { a, b } = await seedWorld();
    await appendJobEvent(db, {
      action: "update",
      organizationId: a.orgId,
      jobId: a.jobId,
      actor: { kind: "user", userId: a.userId },
      changes: { dueDate: { old: null, new: "2030-01-01" } },
    });
    await appendJobEvent(db, {
      action: "update",
      organizationId: b.orgId,
      jobId: b.jobId,
      actor: { kind: "user", userId: b.userId },
      changes: { dueDate: { old: null, new: "2031-01-01" } },
    });

    const own = await get(`/${a.jobId}/audit-log`);
    expect(own.status).toBe(200);
    const body = await own.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      action: "update",
      performedBy: a.userId,
      performerName: `User ${a.userId}`,
      changes: { dueDate: { old: null, new: "2030-01-01" } },
    });

    const foreign = await get(`/${b.jobId}/audit-log`);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Job nao encontrado" });
  });

  it("REQ-JOB-SCOPE-3: GET /:id/amendment-chain returns the whole chain from either end; the other laboratory's job is 404", async () => {
    const { a, b } = await seedWorld();
    const { original, amended } = await seedAmendmentChain(a);

    for (const [id, currentId] of [
      [original.id, original.id],
      [amended.id, amended.id],
    ] as const) {
      const res = await get(`/${id}/amendment-chain`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.map((row: { id: number }) => row.id)).toEqual([
        original.id,
        amended.id,
      ]);
      expect(
        body.data.find((row: { isCurrent: boolean }) => row.isCurrent).id,
      ).toBe(currentId);
      expect(body).toMatchObject({
        originalJobId: original.id,
        latestJobId: amended.id,
        totalAmendments: 1,
      });
    }

    expect((await get(`/${b.jobId}/amendment-chain`)).status).toBe(404);
  });

  it("REQ-JOB-SCOPE-4: GET /:id/download and /download-label answer 400 until the file exists, and 404 for the other laboratory's job", async () => {
    const { a, b } = await seedWorld();

    const noCertificate = await get(`/${a.jobId}/download`);
    expect(noCertificate.status).toBe(400);
    expect(await noCertificate.json()).toEqual({
      error: "Certificado ainda nao foi gerado",
    });
    const noLabel = await get(`/${a.jobId}/download-label`);
    expect(noLabel.status).toBe(400);
    expect(await noLabel.json()).toEqual({
      error: "Etiqueta ainda nao foi gerada",
    });

    expect((await get(`/${b.jobId}/download`)).status).toBe(404);
    expect((await get(`/${b.jobId}/download-label`)).status).toBe(404);
  });

  it("REQ-JOB-SCOPE-4: POST /:id/generate-label refuses a job that is not APPROVED and 404s the other laboratory's", async () => {
    const { a, b } = await seedWorld();

    const own = await send(`/${a.jobId}/generate-label`, "POST");
    expect(own.status).toBe(400);
    expect(await own.json()).toEqual({
      error: "Apenas jobs aprovados podem ter etiquetas geradas",
    });
    expect((await send(`/${b.jobId}/generate-label`, "POST")).status).toBe(404);
  });

  it("REQ-JOB-SCOPE-4: GET /technicians/list lists this laboratory's technicians only", async () => {
    const { a, b } = await seedWorld();
    await seedExtraMember({
      orgId: a.orgId,
      userId: "tech-a",
      role: "technician",
      unitId: a.unitId,
      unitRole: "technician",
    });
    await seedExtraMember({
      orgId: b.orgId,
      userId: "tech-b",
      role: "technician",
      unitId: b.unitId,
      unitRole: "technician",
    });

    const res = await get("/technicians/list");
    expect(res.status).toBe(200);
    const ids = (await res.json()).data.map((row: { id: string }) => row.id);
    expect(ids).toContain("tech-a");
    expect(ids).toContain(a.userId);
    expect(ids).not.toContain("tech-b");
    expect(ids).not.toContain(b.userId);
  });

  it("REQ-JOB-SCOPE-5: DELETE /:id cancels this laboratory's job and commits its audit row; the other laboratory's job is untouched", async () => {
    const { a, b } = await seedWorld();

    const foreign = await send(`/${b.jobId}`, "DELETE", { reason: "Pedido" });
    expect(foreign.status).toBe(404);
    const [stillB] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, b.jobId));
    expect(stillB?.status).toBe("DRAFT");
    expect(await auditRows(b.jobId)).toEqual([]);

    const own = await send(`/${a.jobId}`, "DELETE", { reason: "Pedido" });
    expect(own.status).toBe(200);
    const [canceled] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, a.jobId));
    expect(canceled?.status).toBe("CANCELED");
    const rows = await auditRows(a.jobId);
    expect(rows.map((row) => row.action)).toEqual(["cancel"]);
    expect(rows[0]?.organizationId).toBe(a.orgId);
    expect(rows[0]?.reason).toBe("Pedido");
  });

  it("REQ-JOB-SCOPE-6 [HIGH RISK]: POST /:id/flag-oot opens the NC and the customer notification in one transaction — a failing notification insert leaves no NC", async () => {
    const { a } = await seedWorld();
    await setJobStatus(a.jobId, "APPROVED", {
      approvedBy: a.userId,
      approvedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION scope_test_fail_oot_notification() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'scope_test: oot_notification insert forced to fail';
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER scope_test_fail_oot_notification
      BEFORE INSERT ON oot_notification
      FOR EACH ROW EXECUTE FUNCTION scope_test_fail_oot_notification()
    `);
    try {
      const res = await send(`/${a.jobId}/flag-oot`, "POST", {
        notifyCustomer: true,
      });
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS scope_test_fail_oot_notification ON oot_notification`,
      );
      await db.execute(
        sql`DROP FUNCTION IF EXISTS scope_test_fail_oot_notification()`,
      );
    }

    expect(
      await db
        .select({ id: nonConformance.id })
        .from(nonConformance)
        .where(eq(nonConformance.jobId, a.jobId)),
    ).toEqual([]);
    expect(
      await db.select({ id: ootNotification.id }).from(ootNotification),
    ).toEqual([]);
  });
});
