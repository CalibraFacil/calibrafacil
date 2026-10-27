/**
 * certificate-lifecycle.int.spec.ts: the amendment lifecycle and the withdrawal
 * of an issued certificate, against a real Postgres (roadmap 2 B3; ISO/IEC
 * 17025 §7.8.8 amendments, §7.10 nonconforming work). The issuance half (the
 * replacement's certificate supersedes the original in the same transaction) is
 * in apps/worker/src/certificate-lifecycle.int.spec.ts.
 *
 *   REQ-B3-A1  opening an amendment leaves the original APPROVED and valid
 *              (verification page, job detail), with a DRAFT clone
 *   REQ-B3-A2  one amendment in progress per original, also under concurrency
 *   REQ-B3-A3  cancelling the draft leaves the original untouched and amendable
 *              again; the database index agrees (a CANCELED amendment is not "in
 *              progress")
 *   REQ-B3-A4  the clone carries the whole technical record of the original
 *   REQ-B3-A5  a withdrawn certificate is not amended
 *   REQ-B3-W1  withdraw: role, mandatory reason, audit row, event, verification
 *              page, once only, issued certificates only, laboratory scope
 *   REQ-B3-W2  the status events are append-only, for the owner (trigger) and
 *              for calibra_app (grant), and carry their CHECKs
 */

import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  issuedCertificateSnapshot,
  issuedCertificateStatusEvent,
  jobAuditLog,
} from "@calibra-facil/db/schema";
import { setJobStatus } from "../../../test/integration/job-fixtures";
import { truncateAll } from "../../../test/integration/db";
import { loginAs } from "../../../test/integration/setup";
import { seedOrg } from "../../../test/integration/seed";
import { openAppRoleDb, sqlStateOf } from "../../../test/integration/rls";
import {
  seedExtraMember,
  seedJobForOrg,
} from "../../../test/integration/tenant-refs";
import { jobsRouter } from "../../routes/jobs";
import { verifyRouter } from "../../routes/verify";
import type { JobLifecycleActor } from "./job-actor";
import { amendJob } from "./amend-job";
import { cancelJob } from "./cancel-job";
import { withdrawCertificate } from "./withdraw-certificate";

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
}));

const ORG = "org-b3";
const OTHER_ORG = "org-b3-other";
const ADMIN = "user-b3-admin";
const OWNER = "user-b3-owner";
const TECH = "user-b3-tech";
const JSON_HEADERS = { "content-type": "application/json" };
const AMEND_REASON = "Erro de digitacao no certificado";
const WITHDRAW_REASON = "Padrao de referencia recolhido pelo fabricante";

const admin: JobLifecycleActor = {
  kind: "user",
  userId: ADMIN,
  ipAddress: "203.0.113.7",
};

/** A job row with every technical field filled in, then walked to APPROVED. */
async function seedApprovedOriginal() {
  const org = await seedOrg({ orgId: ORG, userId: ADMIN, role: "admin" });
  await seedExtraMember({
    orgId: ORG,
    userId: OWNER,
    role: "owner",
    unitId: org.unitId,
    unitRole: "admin",
  });
  await seedExtraMember({
    orgId: ORG,
    userId: TECH,
    role: "technician",
    unitId: org.unitId,
    unitRole: "technician",
  });
  const { jobId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: ADMIN,
  });
  const performedAt = new Date("2026-03-10T14:30:00.000Z");
  await db
    .update(calibrationJob)
    .set({
      performedAt,
      dueDate: new Date("2026-04-01T00:00:00.000Z"),
      technicianId: TECH,
      data: { points: [{ nominal: "500" }, { nominal: "1000" }] },
      results: { erro: ["-0.52", "-1.04"], u_expandida: ["0.12", "0.13"] },
      standardsSnapshot: [
        {
          id: 77,
          name: "Massa padrao 1 kg",
          certificateNumber: "PAD-0001",
          calibrationDate: "2026-02-01",
          uncertainty: 0.01,
          uncertaintyUnit: "g",
          coverageFactor: 2,
        },
      ],
      assetSnapshot: {
        assetId: 1,
        assetTypeId: 1,
        assetTypeName: "Balanca",
        assetTypeSlug: "balanca",
        baseMeasurementUnit: "g",
        name: "Balanca como calibrada (nome da epoca)",
        tag: "TAG-ORIGINAL",
        serialNumber: "SN-ORIGINAL",
        manufacturer: "Fabricante",
        model: "M1",
        specifications: { capacidade: "1 kg" },
        capturedAt: "2026-03-10T14:00:00.000Z",
      },
      environmentalSnapshot: {
        temperature: { value: 20.4, unit: "C" },
        humidity: { value: 48, unit: "%" },
      },
      calibrationLocationSnapshot: {
        type: "customer_site",
        addressText: "Rua do Cliente, 10",
      },
      calibrationPhaseSnapshot: { phases: [{ name: "as-found" }] },
      methodDeviations: "Ponto de 750 g omitido a pedido do cliente",
    })
    .where(eq(calibrationJob.id, jobId));
  await setJobStatus(jobId, "APPROVED", {
    approvedAt: new Date(),
    approvedBy: ADMIN,
  });
  const [snapshot] = await db
    .insert(issuedCertificateSnapshot)
    .values({
      organizationId: ORG,
      jobId,
      certificateNumber: `JOB-${ORG}`,
      pdfR2Key: `org/${ORG}/certificates/${jobId}.pdf`,
      pdfSha256: "a".repeat(64),
      inputDataSnapshot: {},
      issuedBy: ADMIN,
      renderPipeline: "FIXED_LAYOUT",
    })
    .returning({ id: issuedCertificateSnapshot.id });
  if (!snapshot) throw new Error("snapshot not inserted");
  await db.insert(issuedCertificateStatusEvent).values({
    organizationId: ORG,
    certificateId: snapshot.id,
    jobId,
    event: "ISSUED",
    actorUserId: ADMIN,
    source: "worker",
  });
  return { org, jobId, certificateId: snapshot.id };
}

async function jobRow(id: number) {
  const [row] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, id));
  if (!row) throw new Error(`job ${id} not found`);
  return row;
}

async function auditActions(id: number) {
  const rows = await db
    .select({ action: jobAuditLog.action })
    .from(jobAuditLog)
    .where(and(eq(jobAuditLog.jobId, id), eq(jobAuditLog.organizationId, ORG)))
    .orderBy(jobAuditLog.id);
  return rows.map((row) => row.action);
}

async function events(jobId: number) {
  return db
    .select()
    .from(issuedCertificateStatusEvent)
    .where(eq(issuedCertificateStatusEvent.jobId, jobId))
    .orderBy(issuedCertificateStatusEvent.id);
}

async function verification(jobId: number) {
  const { verificationToken } = await jobRow(jobId);
  const res = await verifyRouter.request(`/${verificationToken}`);
  expect(res.status).toBe(200);
  return res.json();
}

const amend = (jobId: number, organizationId = ORG) =>
  amendJob({
    actor: admin,
    jobId,
    organizationId,
    unitScope: null,
    reason: AMEND_REASON,
  });

const withdraw = (
  jobId: number,
  reason = WITHDRAW_REASON,
  organizationId = ORG,
) =>
  withdrawCertificate({
    actor: admin,
    jobId,
    organizationId,
    unitScope: null,
    reason,
  });

function postWithdraw(jobId: number, body: unknown) {
  return jobsRouter.request(`/${jobId}/certificate/withdraw`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe("certificate lifecycle (real Postgres)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe("amendment", () => {
    it("REQ-B3-A1 [HIGH RISK]: opening an amendment leaves the original APPROVED and valid on the verification page", async () => {
      const { jobId } = await seedApprovedOriginal();

      const result = await amend(jobId);

      if (result.status !== "ok") throw new Error(result.status);
      expect(result.amendedJob).toMatchObject({
        status: "DRAFT",
        supersedesId: jobId,
        amendmentNumber: 1,
        amendmentReason: AMEND_REASON,
      });
      expect(await jobRow(jobId)).toMatchObject({
        status: "APPROVED",
        supersededById: null,
        supersededAt: null,
      });
      expect(await auditActions(jobId)).toEqual(["amendment_started"]);
      expect(await auditActions(result.amendedJob.id)).toEqual([
        "create_amendment",
      ]);
      expect(
        await events(jobId).then((rows) => rows.map((r) => r.event)),
      ).toEqual(["ISSUED"]);

      const page = await verification(jobId);
      expect(page).toMatchObject({
        valid: true,
        status: "APPROVED",
        certificateStatus: "ISSUED",
        isSuperseded: false,
        supersededBy: null,
        withdrawnAt: null,
      });
    });

    it("REQ-B3-A1: the job detail of the original names the amendment in progress", async () => {
      const { org, jobId } = await seedApprovedOriginal();
      loginAs({ userId: ADMIN, organizationId: org.orgId });
      const result = await amend(jobId);
      if (result.status !== "ok") throw new Error(result.status);

      const res = await jobsRouter.request(`/${jobId}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        status: "APPROVED",
        certificateLifecycle: { status: "ISSUED" },
        amendmentInProgress: {
          id: result.amendedJob.id,
          jobId: result.amendedJob.jobId,
          status: "DRAFT",
        },
      });
    });

    it("REQ-B3-A2: a second amendment of the same certificate is refused with the one in progress named", async () => {
      const { org, jobId } = await seedApprovedOriginal();
      loginAs({ userId: ADMIN, organizationId: org.orgId });
      const first = await amend(jobId);
      if (first.status !== "ok") throw new Error(first.status);

      const second = await amend(jobId);
      expect(second).toMatchObject({
        status: "amendment_in_progress",
        amendedJobId: first.amendedJob.id,
        error: { code: "job_amendment_in_progress", status: 409 },
      });

      const res = await jobsRouter.request(`/${jobId}/amend`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: AMEND_REASON }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "job_amendment_in_progress",
        details: { amendedJobId: first.amendedJob.id },
      });
      const clones = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(eq(calibrationJob.supersedesId, jobId));
      expect(clones).toHaveLength(1);
    });

    it("REQ-B3-A2 [HIGH RISK]: two concurrent amendments create exactly one draft", async () => {
      const { jobId } = await seedApprovedOriginal();

      const results = await Promise.all([amend(jobId), amend(jobId)]);

      expect(results.map((r) => r.status).toSorted()).toEqual([
        "amendment_in_progress",
        "ok",
      ]);
      const clones = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(eq(calibrationJob.supersedesId, jobId));
      expect(clones).toHaveLength(1);
    });

    it("REQ-B3-A3 [HIGH RISK]: cancelling the draft leaves the original APPROVED, audited, and amendable again", async () => {
      const { jobId } = await seedApprovedOriginal();
      const first = await amend(jobId);
      if (first.status !== "ok") throw new Error(first.status);
      const before = await jobRow(jobId);

      const canceled = await cancelJob({
        actor: admin,
        jobId: first.amendedJob.id,
        organizationId: ORG,
        unitScope: null,
        reason: "Retificacao aberta por engano",
      });

      expect(canceled.status).toBe("ok");
      expect(await jobRow(jobId)).toEqual(before);
      expect(await auditActions(jobId)).toEqual([
        "amendment_started",
        "amendment_canceled",
      ]);
      expect((await verification(jobId)).valid).toBe(true);

      // The slot is free again: a new amendment is opened for the same original.
      const again = await amend(jobId);
      expect(again).toMatchObject({ status: "ok", amendmentNumber: 1 });
    });

    it("REQ-B3-A3: the unique index counts an open amendment, not a CANCELED one", async () => {
      const { org, jobId } = await seedApprovedOriginal();
      const first = await amend(jobId);
      if (first.status !== "ok") throw new Error(first.status);
      const clone = await jobRow(first.amendedJob.id);
      const sibling = {
        organizationId: org.orgId,
        unitId: clone.unitId,
        customerId: clone.customerId,
        assetId: clone.assetId,
        serviceId: clone.serviceId,
        methodSnapshot: clone.methodSnapshot,
        createdBy: ADMIN,
        supersedesId: jobId,
      };

      // A second open amendment of the same original: refused by the database.
      expect(
        await sqlStateOf(
          db.insert(calibrationJob).values({ ...sibling, jobId: "SIBLING-1" }),
        ),
      ).toBe("23505");

      // Once the first is CANCELED the slot is free.
      await db
        .update(calibrationJob)
        .set({ status: "CANCELED" })
        .where(eq(calibrationJob.id, clone.id));
      await db
        .insert(calibrationJob)
        .values({ ...sibling, jobId: "SIBLING-2" });
    });

    it("REQ-B3-A4 [HIGH RISK]: the amendment carries the whole technical record of the original", async () => {
      const { jobId } = await seedApprovedOriginal();
      const original = await jobRow(jobId);

      const result = await amend(jobId);

      if (result.status !== "ok") throw new Error(result.status);
      const clone = await jobRow(result.amendedJob.id);
      // Every field the original's frozen certificate input was built from.
      expect(clone.performedAt).toEqual(original.performedAt);
      expect(clone.performedAt).not.toBeNull();
      expect(clone.assetSnapshot).toEqual(original.assetSnapshot);
      expect(clone.assetSnapshot).toMatchObject({ tag: "TAG-ORIGINAL" });
      expect(clone.environmentalSnapshot).toEqual(
        original.environmentalSnapshot,
      );
      expect(clone.calibrationLocationSnapshot).toEqual(
        original.calibrationLocationSnapshot,
      );
      expect(clone.calibrationPhaseSnapshot).toEqual(
        original.calibrationPhaseSnapshot,
      );
      expect(clone.methodDeviations).toBe(original.methodDeviations);
      expect(clone.methodSnapshot).toEqual(original.methodSnapshot);
      expect(clone.standardsSnapshot).toEqual(original.standardsSnapshot);
      expect(clone.data).toEqual(original.data);
      expect(clone.results).toEqual(original.results);
      expect(clone.technicianId).toBe(original.technicianId);
      expect(clone.customerId).toBe(original.customerId);
      expect(clone.assetId).toBe(original.assetId);
      expect(clone.serviceId).toBe(original.serviceId);
      expect(clone.dueDate).toEqual(original.dueDate);
      // What the clone must walk through itself is not carried over.
      expect(clone).toMatchObject({
        status: "DRAFT",
        approvedAt: null,
        approvedBy: null,
        certificateUrl: null,
        scopeComplianceStatus: null,
        asFoundConformity: null,
      });
      expect(clone.verificationToken).not.toBe(original.verificationToken);
    });

    it("REQ-B3-A5: a withdrawn certificate is not amended", async () => {
      const { jobId } = await seedApprovedOriginal();
      await withdraw(jobId);

      const result = await amend(jobId);

      expect(result).toMatchObject({
        status: "certificate_withdrawn",
        error: { code: "job_certificate_withdrawn", status: 409 },
      });
      const clones = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(eq(calibrationJob.supersedesId, jobId));
      expect(clones).toEqual([]);
    });
  });

  describe("withdraw", () => {
    it("REQ-B3-W1 [HIGH RISK]: an admin withdraws an issued certificate: event, audit row, verification page; the job keeps its status", async () => {
      const { org, jobId, certificateId } = await seedApprovedOriginal();
      loginAs({ userId: ADMIN, organizationId: org.orgId });

      const res = await postWithdraw(jobId, { reason: WITHDRAW_REASON });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        job: { id: jobId, status: "APPROVED" },
        certificateStatus: "WITHDRAWN",
      });
      expect((await jobRow(jobId)).status).toBe("APPROVED");

      const stream = await events(jobId);
      expect(stream.map((e) => e.event)).toEqual(["ISSUED", "WITHDRAWN"]);
      expect(stream[1]).toMatchObject({
        organizationId: ORG,
        certificateId,
        reason: WITHDRAW_REASON,
        actorUserId: ADMIN,
        source: "api",
      });
      const rows = await db
        .select()
        .from(jobAuditLog)
        .where(
          and(
            eq(jobAuditLog.jobId, jobId),
            eq(jobAuditLog.action, "certificate_withdrawn"),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        performedBy: ADMIN,
        reason: WITHDRAW_REASON,
        changes: {
          certificateStatus: { old: "ISSUED", new: "WITHDRAWN" },
          reason: WITHDRAW_REASON,
        },
      });

      const page = await verification(jobId);
      expect(page).toMatchObject({
        valid: false,
        status: "APPROVED",
        certificateStatus: "WITHDRAWN",
      });
      expect(typeof page.withdrawnAt).toBe("string");

      const detail = await jobsRouter.request(`/${jobId}`);
      expect(await detail.json()).toMatchObject({
        certificateLifecycle: { status: "WITHDRAWN", reason: WITHDRAW_REASON },
      });
    });

    it("REQ-B3-W1: an owner may withdraw too; a technician may not (403) and nothing is written", async () => {
      const { org, jobId } = await seedApprovedOriginal();

      loginAs({ userId: TECH, organizationId: org.orgId });
      const denied = await postWithdraw(jobId, { reason: WITHDRAW_REASON });
      expect(denied.status).toBe(403);
      expect(await events(jobId)).toHaveLength(1);

      loginAs({ userId: OWNER, organizationId: org.orgId });
      const allowed = await postWithdraw(jobId, { reason: WITHDRAW_REASON });
      expect(allowed.status).toBe(200);
      expect(await events(jobId)).toHaveLength(2);
    });

    it("REQ-B3-W1: the reason is mandatory (missing, blank and too short are 400) and nothing is written", async () => {
      const { org, jobId } = await seedApprovedOriginal();
      loginAs({ userId: ADMIN, organizationId: org.orgId });

      const refused = await Promise.all(
        [{}, { reason: "" }, { reason: "          " }, { reason: "curto" }].map(
          (body) => postWithdraw(jobId, body),
        ),
      );
      expect(refused.map((res) => res.status)).toEqual([400, 400, 400, 400]);
      expect(await events(jobId)).toHaveLength(1);
      expect(await auditActions(jobId)).toEqual([]);
      await expect(withdraw(jobId, "   ")).rejects.toThrow();
    });

    it("REQ-B3-W1: a certificate cannot be withdrawn twice", async () => {
      const { org, jobId } = await seedApprovedOriginal();
      loginAs({ userId: ADMIN, organizationId: org.orgId });
      expect(
        (await postWithdraw(jobId, { reason: WITHDRAW_REASON })).status,
      ).toBe(200);

      const again = await postWithdraw(jobId, { reason: WITHDRAW_REASON });

      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({
        code: "certificate_already_withdrawn",
      });
      expect(await events(jobId)).toHaveLength(2);
    });

    it("REQ-B3-W1: concurrent withdrawals write exactly one event", async () => {
      const { jobId } = await seedApprovedOriginal();

      const results = await Promise.all([withdraw(jobId), withdraw(jobId)]);

      expect(results.map((r) => r.status).toSorted()).toEqual([
        "already_withdrawn",
        "ok",
      ]);
      expect(await events(jobId)).toHaveLength(2);
    });

    it("REQ-B3-W1: only an issued certificate can be withdrawn (a draft, or an approved job with no issued certificate, is refused)", async () => {
      const org = await seedOrg({ orgId: ORG, userId: ADMIN, role: "admin" });
      const { jobId } = await seedJobForOrg({
        orgId: ORG,
        unitId: org.unitId,
        createdBy: ADMIN,
      });

      expect(await withdraw(jobId)).toMatchObject({
        status: "not_issued",
        error: { code: "certificate_not_issued", status: 409 },
      });
      await setJobStatus(jobId, "APPROVED", { approvedAt: new Date() });
      expect((await withdraw(jobId)).status).toBe("not_issued");
      expect(await events(jobId)).toEqual([]);
    });

    it("REQ-B3-W1: another laboratory's certificate is not found and untouched", async () => {
      const { jobId } = await seedApprovedOriginal();
      await seedOrg({
        orgId: OTHER_ORG,
        userId: "user-b3-other",
        role: "admin",
      });

      expect(await withdraw(jobId, WITHDRAW_REASON, OTHER_ORG)).toEqual({
        status: "not_found",
      });
      expect(await events(jobId)).toHaveLength(1);
    });

    it("REQ-B3-W1: a SUPERSEDED original can be withdrawn too, and reads WITHDRAWN", async () => {
      const { jobId, certificateId } = await seedApprovedOriginal();
      const amendment = await amend(jobId);
      if (amendment.status !== "ok") throw new Error(amendment.status);
      // What the worker's issuance of the replacement does to the original.
      await db
        .update(calibrationJob)
        .set({
          status: "SUPERSEDED",
          supersededById: amendment.amendedJob.id,
          supersededAt: new Date(),
          amendmentReason: AMEND_REASON,
        })
        .where(eq(calibrationJob.id, jobId));
      await db.insert(issuedCertificateStatusEvent).values({
        organizationId: ORG,
        certificateId,
        jobId,
        event: "SUPERSEDED",
        supersededByJobId: amendment.amendedJob.id,
        reason: AMEND_REASON,
        source: "worker",
      });
      expect((await verification(jobId)).certificateStatus).toBe("SUPERSEDED");

      expect((await withdraw(jobId)).status).toBe("ok");

      expect(await verification(jobId)).toMatchObject({
        valid: false,
        certificateStatus: "WITHDRAWN",
        isSuperseded: true,
      });
    });

    it("REQ-B3-W2 [HIGH RISK]: the status events are append-only: the owner is refused by the trigger, calibra_app by its grants", async () => {
      const { jobId } = await seedApprovedOriginal();
      const [event] = await events(jobId);
      if (!event) throw new Error("no event");

      // Owner: the append-only trigger.
      expect(
        await sqlStateOf(
          db
            .update(issuedCertificateStatusEvent)
            .set({ reason: "reescrito" })
            .where(eq(issuedCertificateStatusEvent.id, event.id)),
        ),
      ).toBe("P0001");
      expect(
        await sqlStateOf(
          db
            .delete(issuedCertificateStatusEvent)
            .where(eq(issuedCertificateStatusEvent.id, event.id)),
        ),
      ).toBe("P0001");

      // calibra_app: no UPDATE / DELETE privilege at all (insufficient_privilege),
      // whatever a session sets.
      const app = openAppRoleDb();
      expect(
        await sqlStateOf(
          app.db.execute(
            sql`UPDATE issued_certificate_status_event SET reason = 'x' WHERE id = ${event.id}`,
          ),
        ),
      ).toBe("42501");
      expect(
        await sqlStateOf(
          app.db.execute(
            sql`DELETE FROM issued_certificate_status_event WHERE id = ${event.id}`,
          ),
        ),
      ).toBe("42501");
      expect(await events(jobId)).toHaveLength(1);
    });

    it("REQ-B3-W2: the table refuses a WITHDRAWN row without a reason, a SUPERSEDED row without its replacement and an unknown event", async () => {
      const { jobId, certificateId } = await seedApprovedOriginal();
      const base = {
        organizationId: ORG,
        certificateId,
        jobId,
        source: "api" as const,
      };

      expect(
        await sqlStateOf(
          db
            .insert(issuedCertificateStatusEvent)
            .values({ ...base, event: "WITHDRAWN" }),
        ),
      ).toBe("23514");
      expect(
        await sqlStateOf(
          db
            .insert(issuedCertificateStatusEvent)
            .values({ ...base, event: "WITHDRAWN", reason: "   " }),
        ),
      ).toBe("23514");
      expect(
        await sqlStateOf(
          db
            .insert(issuedCertificateStatusEvent)
            .values({ ...base, event: "SUPERSEDED" }),
        ),
      ).toBe("23514");
      expect(
        await sqlStateOf(
          db.execute(
            sql`INSERT INTO issued_certificate_status_event
                  (organization_id, certificate_id, job_id, event, source)
                VALUES (${ORG}, ${certificateId}, ${jobId}, 'VOIDED', 'api')`,
          ),
        ),
      ).toBe("23514");
    });
  });
});
