/**
 * standards-org-scope.int.spec.ts - P2-18d [HIGH RISK].
 *
 * The reference-standard handlers the other standards specs do not reach (ISO/IEC
 * 17025 §6.4, §7.10): GET /search, the mass composition-profile catalog
 * (POST/PUT/DELETE), GET /:id/label, POST /:id/renew, GET /:id/audit-log, and the
 * out-of-tolerance recall workflow (PUT status change, GET /:id/impacted-certificates,
 * GET /:id/recall, POST /:id/recall/send). Real recall library (standards-contract
 * stubs it). Success paths and cross-laboratory negatives, run as the owner here and
 * as `calibra_app` by `pnpm --filter @calibra-facil/api rls:shadow-report`.
 *
 *   REQ-18D-STD-1  search / label / audit-log answer for the lab's own standard and
 *                  nothing of lab B's.
 *   REQ-18D-STD-2  composition profiles: create, duplicate 409, update, soft delete;
 *                  lab B's profile id is a 404.
 *   REQ-18D-STD-3  renew writes the new certificate data and the audited reason, and
 *                  returns an OUT_OF_TOLERANCE standard to ACTIVE.
 *   REQ-18D-STD-4  Flagging OUT_OF_TOLERANCE opens ONE typed NC and a DRAFT recall;
 *                  impacted-certificates finds the approved certificate that used the
 *                  standard; recall/send stamps the approval, writes ONE notification
 *                  per certificate and enqueues its PDF job only after the commit.
 *   REQ-18D-STD-5  Lab B's standard / certificate ids never cross: 404 on every handler
 *                  and recall/send refuses another lab's job.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, systemDb } from "@calibra-facil/db";
import {
  jobStandard,
  massCompositionProfile,
  nonConformance,
  ootNotification,
  referenceStandard,
  referenceStandardAuditLog,
  referenceStandardCalibration,
  referenceStandardCertificateDocument,
  standardRecall,
} from "@calibra-facil/db/schema";
import { standardsRouter } from "./standards";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import { uploadToR2 } from "../lib/storage";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedStandard } from "../../test/integration/seed";
import { setJobStatus } from "../../test/integration/job-fixtures";
import { seedJobForOrg } from "../../test/integration/tenant-refs";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storage")>();
  return {
    ...actual,
    createR2Client: vi.fn(() => ({})),
    uploadToR2: vi.fn().mockResolvedValue(undefined),
    generatePresignedUrl: vi
      .fn()
      .mockResolvedValue("https://storage.example.test/signed.pdf"),
  };
});

vi.mock("@calibra-facil/notifications", () => ({
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
  notifyNCEscalatedToCapa: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" } as const;

const PROFILE = {
  profileKey: "E2-100g",
  profileClass: "E2",
  nominal: "100 g",
  nominalG: 100,
  value: 100.00002,
  uncertainty: 0.00005,
} as const;

async function twoLabs() {
  const a = await seedOrg({ orgId: "org-a", userId: "user-a", role: "admin" });
  const b = await seedOrg({ orgId: "org-b", userId: "user-b", role: "admin" });
  const standardA = await seedStandard({
    organizationId: a.orgId,
    unitId: a.unitId,
    createdBy: a.userId,
    name: "Massa padrão A",
  });
  const standardB = await seedStandard({
    organizationId: b.orgId,
    unitId: b.unitId,
    createdBy: b.userId,
    name: "Massa padrão B",
  });
  loginAs({ userId: a.userId, organizationId: a.orgId });
  return { a, b, standardA, standardB };
}

function request(path: string, method: string, body?: unknown) {
  return standardsRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function standardStatus(id: number) {
  const [row] = await db
    .select({ status: referenceStandard.status })
    .from(referenceStandard)
    .where(eq(referenceStandard.id, id));
  return row?.status;
}

async function auditActions(standardId: number) {
  const rows = await db
    .select({ action: referenceStandardAuditLog.action })
    .from(referenceStandardAuditLog)
    .where(eq(referenceStandardAuditLog.standardId, standardId));
  return rows.map((row) => row.action);
}

/** An APPROVED certificate of `orgId` that used `standardId`. */
async function seedApprovedCertificate(params: {
  orgId: string;
  unitId: number;
  createdBy: string;
  standardId: number;
}) {
  const { jobId } = await seedJobForOrg({
    orgId: params.orgId,
    unitId: params.unitId,
    createdBy: params.createdBy,
  });
  await setJobStatus(jobId, "APPROVED", { approvedAt: new Date() });
  await db.insert(jobStandard).values({
    organizationId: params.orgId,
    jobId,
    standardId: params.standardId,
    usedAt: new Date(),
  });
  return jobId;
}

describe("standards router: search, profiles, renew, audit and recall (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
    vi.mocked(enqueueBackgroundJob)
      .mockReset()
      .mockResolvedValue({ messageId: "test-noop" });
    vi.mocked(uploadToR2).mockReset().mockResolvedValue(undefined);
  });

  it("REQ-18D-STD-1: search, label and audit-log answer for the lab's own standard only", async () => {
    const { standardA, standardB } = await twoLabs();

    const search = await request("/search?query=Massa", "GET");
    expect(search.status).toBe(200);
    const found = await search.json();
    expect(found.map((row: { name: string }) => row.name)).toEqual([
      "Massa padrão A",
    ]);

    const label = await request(`/${standardA}/label`, "GET");
    expect(label.status).toBe(200);
    expect(await label.json()).toEqual({
      id: standardA,
      label: "Massa padrão A",
    });

    const renew = await request(`/${standardA}/renew`, "POST", {
      certificateNumber: "RBC-NEW-1",
      calibrationDate: "2026-06-01",
      nextCalibrationDate: "2027-06-01",
      uncertainty: 0.001,
      reason: "Renovação anual",
    });
    expect(renew.status).toBe(200);
    const audit = await request(`/${standardA}/audit-log`, "GET");
    expect(audit.status).toBe(200);
    const trail = await audit.json();
    expect(trail.data.map((entry: { action: string }) => entry.action)).toEqual(
      ["renew"],
    );

    for (const path of [`/${standardB}/label`, `/${standardB}/audit-log`]) {
      expect((await request(path, "GET")).status, path).toBe(404);
    }
  });

  it("REQ-18D-STD-2: composition profiles are created, deduplicated, updated and soft-deleted; lab B's is a 404", async () => {
    const { a, b } = await twoLabs();
    const [foreign] = await db
      .insert(massCompositionProfile)
      .values({
        organizationId: b.orgId,
        profileKey: "E2-200g",
        profileClass: "E2",
        nominal: "200 g",
        nominalG: 200,
        value: 200,
        uncertainty: 0.0001,
        unit: "g",
        status: "ACTIVE",
      })
      .returning({ id: massCompositionProfile.id });
    if (!foreign) throw new Error("foreign profile not seeded");

    const created = await request("/composition-profiles", "POST", PROFILE);
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const duplicate = await request("/composition-profiles", "POST", PROFILE);
    expect(duplicate.status).toBe(409);

    const updated = await request(`/composition-profiles/${id}`, "PUT", {
      value: 100.00003,
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).value).toBe(100.00003);

    const list = await request("/composition-profiles", "GET");
    expect(
      (await list.json()).data.map((row: { id: number }) => row.id),
    ).toEqual([id]);

    expect(
      (await request(`/composition-profiles/${id}`, "DELETE")).status,
    ).toBe(200);
    const [row] = await db
      .select({
        deletedAt: massCompositionProfile.deletedAt,
        status: massCompositionProfile.status,
      })
      .from(massCompositionProfile)
      .where(eq(massCompositionProfile.id, id));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.status).toBe("INACTIVE");

    // Lab B's profile: neither updated nor deleted from lab A's session.
    expect(
      (
        await request(`/composition-profiles/${foreign.id}`, "PUT", {
          value: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(`/composition-profiles/${foreign.id}`, "DELETE")).status,
    ).toBe(404);
    const [untouched] = await db
      .select({ deletedAt: massCompositionProfile.deletedAt })
      .from(massCompositionProfile)
      .where(eq(massCompositionProfile.id, foreign.id));
    expect(untouched?.deletedAt).toBeNull();
    expect(a.orgId).toBe("org-a");
  });

  it("REQ-18D-STD-3: renew writes the new certificate and the reason, and returns an OUT_OF_TOLERANCE standard to ACTIVE", async () => {
    const { standardA, standardB } = await twoLabs();
    await db
      .update(referenceStandard)
      .set({ status: "OUT_OF_TOLERANCE" })
      .where(eq(referenceStandard.id, standardA));

    const res = await request(`/${standardA}/renew`, "POST", {
      certificateNumber: "RBC-RENEWED-9",
      calibrationDate: "2026-06-01",
      nextCalibrationDate: "2027-06-01",
      uncertainty: 0.001,
      reason: "Recalibrado após desvio",
    });
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(referenceStandard)
      .where(eq(referenceStandard.id, standardA));
    expect(row?.certificateNumber).toBe("RBC-RENEWED-9");
    expect(row?.status).toBe("ACTIVE");
    const [audit] = await db
      .select({
        action: referenceStandardAuditLog.action,
        reason: referenceStandardAuditLog.reason,
      })
      .from(referenceStandardAuditLog)
      .where(eq(referenceStandardAuditLog.standardId, standardA));
    expect(audit).toEqual({
      action: "renew",
      reason: "Recalibrado após desvio",
    });

    const foreign = await request(`/${standardB}/renew`, "POST", {
      certificateNumber: "X",
      calibrationDate: "2026-06-01",
      nextCalibrationDate: "2027-06-01",
      uncertainty: 0.001,
      reason: "cruzado",
    });
    expect(foreign.status).toBe(404);
    expect(await auditActions(standardB)).toEqual([]);
  });

  it("REQ-C3-1 (roadmap 2 C3): a renewal appends the new certificate to the history, keeps the previous one, and must bring values", async () => {
    const { standardA } = await twoLabs();
    const noValues = await request(`/${standardA}/renew`, "POST", {
      certificateNumber: "RBC-SEM-VALORES",
      calibrationDate: "2026-06-01",
      nextCalibrationDate: "2027-06-01",
      reason: "Renovação sem valores",
    });
    expect(noValues.status).toBe(400);

    const inverted = await request(`/${standardA}/renew`, "POST", {
      certificateNumber: "RBC-INVERTIDO",
      calibrationDate: "2026-06-01",
      nextCalibrationDate: "2026-05-01",
      uncertainty: 0.001,
      reason: "Datas invertidas",
    });
    expect(inverted.status).toBe(400);

    const before = await db
      .select({ id: referenceStandardCalibration.id })
      .from(referenceStandardCalibration)
      .where(eq(referenceStandardCalibration.standardId, standardA));
    const renewed = await request(`/${standardA}/renew`, "POST", {
      certificateNumber: "RBC-HIST-2",
      calibrationDate: "2026-06-01",
      nextCalibrationDate: "2027-06-01",
      uncertainty: 0.0021,
      reason: "Renovação anual",
    });
    expect(renewed.status).toBe(200);

    const history = await db
      .select({
        certificateNumber: referenceStandardCalibration.certificateNumber,
        uncertainty: referenceStandardCalibration.uncertainty,
        source: referenceStandardCalibration.source,
      })
      .from(referenceStandardCalibration)
      .where(eq(referenceStandardCalibration.standardId, standardA))
      .orderBy(referenceStandardCalibration.id);
    expect(history).toHaveLength(before.length + 1);
    expect(history.at(-1)).toEqual({
      certificateNumber: "RBC-HIST-2",
      uncertainty: 0.0021,
      source: "renew",
    });
  });

  it("REQ-18D-STD-4: out-of-tolerance opens one NC and a DRAFT recall; recall/send notifies each certificate once, after the commit", async () => {
    const { a, standardA } = await twoLabs();
    const certificate = await seedApprovedCertificate({
      orgId: a.orgId,
      unitId: a.unitId,
      createdBy: a.userId,
      standardId: standardA,
    });

    const flagged = await request(`/${standardA}`, "PUT", {
      status: "OUT_OF_TOLERANCE",
    });
    expect(flagged.status).toBe(200);
    const recalls = await db
      .select()
      .from(standardRecall)
      .where(eq(standardRecall.standardId, standardA));
    expect(recalls).toHaveLength(1);
    expect(recalls[0]?.status).toBe("DRAFT");
    const ncs = await db
      .select({
        type: nonConformance.type,
        triggerSource: nonConformance.triggerSource,
      })
      .from(nonConformance)
      .where(eq(nonConformance.organizationId, a.orgId));
    expect(ncs).toEqual([
      { type: "out_of_tolerance", triggerSource: "standard_recall" },
    ]);

    const impacted = await request(
      `/${standardA}/impacted-certificates`,
      "GET",
    );
    expect(impacted.status).toBe(200);
    expect(
      (await impacted.json()).data.map((row: { jobId: number }) => row.jobId),
    ).toEqual([certificate]);

    const before = await request(`/${standardA}/recall`, "GET");
    expect(before.status).toBe(200);
    const beforeBody = await before.json();
    expect(beforeBody.data.status).toBe("DRAFT");
    expect(beforeBody.data.notifications).toEqual([]);

    expect(enqueueBackgroundJob).not.toHaveBeenCalled();
    // The PDF job is enqueued after the commit: at call time the notification
    // row is already visible to another connection (the owner `db`), which it
    // would not be if the job were enqueued inside the transaction.
    const visibleAtEnqueue: number[] = [];
    vi.mocked(enqueueBackgroundJob).mockImplementation(async (message) => {
      if (message.type === "OOT_NOTIFICATION") {
        // The owner connection: a request's own `db` is the application role
        // under the shadow report and would see nothing here.
        const rows = await systemDb
          .select({ id: ootNotification.id })
          .from(ootNotification)
          .where(eq(ootNotification.id, message.notificationId));
        visibleAtEnqueue.push(rows.length);
      }
      return { messageId: "test-noop" };
    });
    const sent = await request(`/${standardA}/recall/send`, "POST", {
      jobIds: [certificate],
    });
    expect(sent.status).toBe(200);
    expect((await sent.json()).data).toMatchObject({ created: 1, skipped: 0 });

    const [recall] = await db
      .select()
      .from(standardRecall)
      .where(eq(standardRecall.standardId, standardA));
    expect(recall?.status).toBe("SENT");
    expect(recall?.approvedBy).toBe(a.userId);
    const notifications = await db
      .select({
        jobId: ootNotification.jobId,
        recallId: ootNotification.recallId,
      })
      .from(ootNotification)
      .where(eq(ootNotification.organizationId, a.orgId));
    expect(notifications).toEqual([
      { jobId: certificate, recallId: recall?.id },
    ]);
    expect(enqueueBackgroundJob).toHaveBeenCalledTimes(1);
    expect(visibleAtEnqueue).toEqual([1]);
    expect(await auditActions(standardA)).toEqual(
      expect.arrayContaining(["status_change", "recall_send"]),
    );

    // The recall's own certificate notification is unique per (recall, job).
    expect(
      await db
        .select({ id: ootNotification.id })
        .from(ootNotification)
        .where(eq(ootNotification.recallId, recall?.id ?? -1)),
    ).toHaveLength(1);
  });

  it("REQ-18D-STD-5: lab B's standard and certificate never cross on the recall handlers", async () => {
    const { a, b, standardA, standardB } = await twoLabs();
    const foreignCertificate = await seedApprovedCertificate({
      orgId: b.orgId,
      unitId: b.unitId,
      createdBy: b.userId,
      standardId: standardB,
    });
    await db
      .update(referenceStandard)
      .set({ status: "OUT_OF_TOLERANCE" })
      .where(
        and(
          eq(referenceStandard.id, standardA),
          eq(referenceStandard.organizationId, a.orgId),
        ),
      );

    for (const [path, method, body] of [
      [`/${standardB}/impacted-certificates`, "GET", undefined],
      [`/${standardB}/recall`, "GET", undefined],
      [`/${standardB}/recall/send`, "POST", { jobIds: [foreignCertificate] }],
    ] as const) {
      expect((await request(path, method, body)).status, path).toBe(404);
    }

    // Lab A's own standard refuses lab B's certificate: it is not linked to it.
    const refused = await request(`/${standardA}/recall/send`, "POST", {
      jobIds: [foreignCertificate],
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      code: "JOBS_NOT_LINKED_TO_STANDARD",
    });
    expect(
      await db
        .select({ id: ootNotification.id })
        .from(ootNotification)
        .where(eq(ootNotification.organizationId, b.orgId)),
    ).toEqual([]);
    expect(await standardStatus(standardB)).toBe("ACTIVE");
  });

  it("REQ-18D-STD-6: certificate document upload and download are scoped to the lab; a failed upload leaves a pending row and no activation audit", async () => {
    const { a, b, standardA, standardB } = await twoLabs();
    const env = { R2_BUCKET_NAME: "test-bucket" };
    const pdfForm = () => {
      const form = new FormData();
      form.set(
        "certificate",
        new File(["%PDF-1.4 teste"], "certificado.pdf", {
          type: "application/pdf",
        }),
      );
      return form;
    };
    const upload = (standardId: number) =>
      standardsRouter.request(
        `/${standardId}/certificate-document`,
        { method: "POST", body: pdfForm() },
        env,
      );
    const documentsOf = (standardId: number) =>
      db
        .select()
        .from(referenceStandardCertificateDocument)
        .where(eq(referenceStandardCertificateDocument.standardId, standardId));

    // The storage fails: the pending row (committed before the upload) stays,
    // never current, and nothing is audited as an upload.
    vi.mocked(uploadToR2).mockRejectedValueOnce(new Error("storage down"));
    const failed = await upload(standardA);
    expect(failed.status).toBe(500);
    const pending = await documentsOf(standardA);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.r2Key.startsWith("pending/")).toBe(true);
    expect(pending[0]?.isCurrent).toBe(false);
    expect(await auditActions(standardA)).not.toContain(
      "certificate_document_upload",
    );

    // The storage works: the document becomes current and the upload is audited.
    const ok = await upload(standardA);
    expect(ok.status).toBe(200);
    const current = (await documentsOf(standardA)).filter(
      (row) => row.isCurrent,
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.r2Key.startsWith("pending/")).toBe(false);
    expect(await auditActions(standardA)).toContain(
      "certificate_document_upload",
    );
    const link = await standardsRouter.request(
      `/${standardA}/certificate-document/download`,
      {},
      env,
    );
    expect(link.status).toBe(200);
    expect((await link.json()).filename).toBe("certificado.pdf");

    // Lab B's standard: no upload, no download, nothing written for it.
    const crossUpload = await upload(standardB);
    expect(crossUpload.status).toBe(404);
    expect(await documentsOf(standardB)).toEqual([]);
    await db.insert(referenceStandardCertificateDocument).values({
      standardId: standardB,
      organizationId: b.orgId,
      unitId: b.unitId,
      certificateNumber: "CERT-B",
      calibrationDate: new Date("2026-01-01T00:00:00.000Z"),
      nextCalibrationDate: new Date("2027-01-01T00:00:00.000Z"),
      fileName: "b.pdf",
      contentType: "application/pdf",
      fileSize: 10,
      sha256: "0".repeat(64),
      r2Key: "standards/b/b.pdf",
      isCurrent: true,
      uploadedBy: b.userId,
    });
    const crossDownload = await standardsRouter.request(
      `/${standardB}/certificate-document/download`,
      {},
      env,
    );
    expect(crossDownload.status).toBe(404);
    expect(a.orgId).toBe("org-a");
  });
});
