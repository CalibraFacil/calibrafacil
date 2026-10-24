/**
 * certificate-input.int.spec.ts — the frozen input of a certificate (ISO/IEC
 * 17025 §7.8: the report reflects the approved record), against a real
 * Postgres and the real approval command.
 *
 *   REQ-CIN-1  the approval builds and persists the `certificate_input`
 *              document in the SAME transaction as the status change and its
 *              audit event; the audit row records its sha256
 *   REQ-CIN-3  the document is immutable once approved; an amendment is a new
 *              job with its own frozen input
 *   REQ-CIN-5  it is a tenant row (organization_id), 1:1 with its job
 *
 * Only the better-auth session, the queue, notifications and the image storage
 * are faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@calibra-facil/certificate-data";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  certificateInput,
  customer,
  jobAuditLog,
  member,
  memberVisualSignature,
  organization,
  service,
  user,
} from "@calibra-facil/db/schema";
import {
  buildOrganizationLogoUrl,
  organizationLogoKey,
} from "@calibra-facil/shared/storage-keys";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { loginPerRequestHeader } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { outsideApplication } from "../../../test/integration/rls-shadow-mode";
import {
  insertJob,
  setJobStatus,
} from "../../../test/integration/job-fixtures";
import { seedOrg } from "../../../test/integration/seed";
import { jobsRouter } from "../../routes/jobs";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  stageFails: { value: false },
  readImage: vi.fn(),
}));

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueue,
}));

vi.mock("../../lib/background-job-outbox", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/background-job-outbox")>();
  return {
    ...actual,
    // Fails AFTER the status write, the freeze and the audit row of the
    // approval transaction: everything it wrote must roll back together.
    stageBackgroundJob: vi.fn(
      async (...args: Parameters<typeof actual.stageBackgroundJob>) => {
        if (mocks.stageFails.value) throw new Error("queue unavailable");
        return actual.stageBackgroundJob(...args);
      },
    ),
  };
});

vi.mock("../../lib/certificate-input-images", () => ({
  readCertificateImage: mocks.readImage,
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const ORG = "org-a";
const MAKER = "user-maker";
const CHECKER = "user-checker";
const LOGO_KEY = organizationLogoKey({
  org: { id: ORG, slug: ORG },
  timestamp: 1_760_000_000_000,
  uniqueId: "logo-1",
}).key;
const SIGNATURE_KEY = "signatures/org-a/checker.png";
const LOGO_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const SIGNATURE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);

function dataUrl(bytes: Uint8Array, type: string) {
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

function sha256Of(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

async function seedFixture() {
  const org = await seedOrg({ orgId: ORG, userId: MAKER, role: "admin" });
  await db.insert(user).values({
    id: CHECKER,
    name: "Ana Aprovadora",
    email: "checker@lab.test",
  });
  await db.insert(member).values({
    id: `member-${CHECKER}`,
    organizationId: ORG,
    userId: CHECKER,
    role: "admin",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  await db.insert(memberVisualSignature).values({
    memberId: `member-${CHECKER}`,
    organizationId: ORG,
    r2Key: SIGNATURE_KEY,
    contentType: "image/png",
    width: 10,
    height: 10,
    fileSize: SIGNATURE_BYTES.length,
  });
  await db
    .update(organization)
    .set({
      name: "Laboratório Um",
      cnpj: "12345678000199",
      accreditationNumber: "0123",
      accreditationBody: "Cgcre",
      accreditationActive: true,
      accreditationValidFrom: new Date("2025-01-01T00:00:00.000Z"),
      accreditationValidUntil: new Date("2099-12-31T00:00:00.000Z"),
      city: "Curitiba",
      state: "PR",
      technicalManagerName: "Maria Responsável",
      technicalManagerTitle: "Gerente Técnica",
      logo: buildOrganizationLogoUrl(LOGO_KEY, "https://api.example.com"),
    })
    .where(eq(organization.id, ORG));

  await db.insert(organization).values({
    id: "client-a",
    name: "Client A",
    slug: "client-a",
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const [cust] = await db
    .insert(customer)
    .values({
      name: "Cliente SA",
      taxId: "98765432000100",
      labOrganizationId: ORG,
      authOrganizationId: "client-a",
    })
    .returning({ id: customer.id });
  const [type] = await db
    .insert(assetType)
    .values({ name: "AT", slug: "at-a", definition: [] })
    .returning({ id: assetType.id });
  if (!cust || !type) throw new Error("seed failed");
  const [ast] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId: cust.id,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${cust.id})`,
      assetTypeId: type.id,
      name: "Balança Analítica",
      serialNumber: "SN-1",
      tag: "TAG-1",
      manufacturer: "Fabricante",
      model: "MOD-100",
    })
    .returning({ id: asset.id });
  const [svc] = await db
    .insert(service)
    .values({
      organizationId: ORG,
      unitId: org.unitId,
      name: "Service",
      isActive: true,
    })
    .returning({ id: service.id });
  if (!ast || !svc) throw new Error("seed failed");
  return {
    unitId: org.unitId,
    customerId: cust.id,
    assetId: ast.id,
    serviceId: svc.id,
  };
}

async function seedReviewJob(
  fixture: Fixture,
  overrides: Partial<typeof calibrationJob.$inferInsert> = {},
): Promise<number> {
  const row = await insertJob({
    jobId: `CAL-2026-${Math.floor(Math.random() * 1e6)}`,
    organizationId: ORG,
    unitId: fixture.unitId,
    customerId: fixture.customerId,
    assetId: fixture.assetId,
    serviceId: fixture.serviceId,
    createdBy: MAKER,
    technicianId: MAKER,
    status: "REVIEW",
    performedAt: new Date("2026-03-09T09:00:00.000Z"),
    methodSnapshot: {
      methodId: 1,
      methodName: "Calibração de balança",
      methodVersion: 2,
      accreditedScope: true,
      engineVersion: "1.4.0",
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
    },
    data: { pontos: [{ carga_nominal: "500" }] },
    results: { erro: ["-0.52"], u_expandida: ["0.12"], fator_k: ["2"] },
    standardsSnapshot: [
      {
        id: 11,
        name: "Massa padrão 1 kg",
        certificateNumber: "RBC-777",
        calibratedBy: "Laboratório RBC",
        calibrationDate: "2025-12-01",
        nextCalibrationDate: "2027-12-01",
        uncertainty: 0.001,
        uncertaintyUnit: "g",
        coverageFactor: 2,
      },
    ],
    certificateName: "cert",
    ...overrides,
  });
  return row.id;
}

async function approve(jobId: number, userId = CHECKER) {
  loginPerRequestHeader(ORG);
  return jobsRouter.request(`/${jobId}/approve`, {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-test-user-id": userId },
    body: JSON.stringify({}),
  });
}

async function frozenRows(jobId: number) {
  return db
    .select()
    .from(certificateInput)
    .where(
      and(
        eq(certificateInput.jobId, jobId),
        eq(certificateInput.organizationId, ORG),
      ),
    );
}

async function jobStatus(jobId: number) {
  const [row] = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(
      and(eq(calibrationJob.id, jobId), eq(calibrationJob.organizationId, ORG)),
    );
  return row?.status;
}

async function approveAuditRows(jobId: number) {
  const rows = await db
    .select({ action: jobAuditLog.action, changes: jobAuditLog.changes })
    .from(jobAuditLog)
    .where(
      and(eq(jobAuditLog.jobId, jobId), eq(jobAuditLog.organizationId, ORG)),
    );
  return rows.filter((row) => row.action === "approve");
}

async function expectTriggerRefusal(run: () => Promise<unknown>) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "the database must refuse the write").not.toBeNull();
  const cause = field(error, "cause");
  const message = `${error instanceof Error ? error.message : ""} ${
    cause instanceof Error ? cause.message : ""
  }`;
  expect(message).toMatch(/certificate_input|immutable/);
}

beforeEach(async () => {
  await truncateAll();
  mocks.enqueue.mockReset();
  mocks.enqueue.mockResolvedValue({ messageId: "test-noop" });
  mocks.stageFails.value = false;
  mocks.readImage.mockReset();
  mocks.readImage.mockImplementation(async (key: string) => {
    if (key === LOGO_KEY) return LOGO_BYTES;
    if (key === SIGNATURE_KEY) return SIGNATURE_BYTES;
    return null;
  });
});

describe("REQ-CIN-1: approval freezes the certificate input", () => {
  it("REQ-CIN-1 [HIGH RISK] persists the frozen document with everything the renderer needs, and records its sha256 on the approve audit row", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);

    const response = await approve(jobId);
    expect(response.status).toBe(200);

    const rows = await frozenRows(jobId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error("no frozen row");
    expect(row.organizationId).toBe(ORG);
    expect(row.schemaVersion).toBe(1);
    expect(row.layoutKey).toBe("calibration-certificate-fixed");
    expect(row.engineVersion).toBe("1.4.0");

    const input = row.input;
    const job = field(input, "job");
    // lab identity and accreditation
    expect(field(job, "lab")).toMatchObject({
      name: "Laboratório Um",
      cnpj: "12345678000199",
      accreditationNumber: "0123",
      accreditationBody: "Cgcre",
      accreditationActive: true,
      city: "Curitiba",
      technicalManagerTitle: "Gerente Técnica",
      // the logo object, embedded: it is deleted when the lab uploads another
      logo: dataUrl(LOGO_BYTES, "image/png"),
    });
    // signatory identity, role and drawn signature
    expect(field(job, "approverName")).toBe("Ana Aprovadora");
    expect(field(job, "approverSignatureUrl")).toBe(
      dataUrl(SIGNATURE_BYTES, "image/png"),
    );
    // customer and asset
    expect(field(job, "customer")).toMatchObject({
      name: "Cliente SA",
      taxId: "98765432000100",
    });
    expect(field(job, "asset")).toMatchObject({
      name: "Balança Analítica",
      serialNumber: "SN-1",
      tag: "TAG-1",
    });
    // execution results, standards snapshot, method identification
    expect(field(job, "results")).toEqual({
      erro: ["-0.52"],
      u_expandida: ["0.12"],
      fator_k: ["2"],
    });
    expect(field(job, "standardsSnapshot")).toMatchObject([
      { certificateNumber: "RBC-777", calibratedBy: "Laboratório RBC" },
    ]);
    expect(field(job, "methodSnapshot")).toMatchObject({
      methodName: "Calibração de balança",
      methodVersion: 2,
    });
    // the seal decision, as of approved_at
    const [approved] = await db
      .select({ approvedAt: calibrationJob.approvedAt })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.id, jobId),
          eq(calibrationJob.organizationId, ORG),
        ),
      );
    expect(field(input, "seal")).toEqual({
      accredited: true,
      evaluatedAt: approved?.approvedAt?.toISOString(),
    });
    expect(field(job, "approvedAt")).toBe(approved?.approvedAt?.toISOString());

    // the stored hash is the hash of the stored document, and the audit row
    // of the same approval records it
    expect(row.sha256).toBe(sha256Of(input));
    const audit = await approveAuditRows(jobId);
    expect(audit).toHaveLength(1);
    expect(field(audit[0]?.changes, "certificateInputSha256")).toBe(row.sha256);
  });

  it("REQ-CIN-1 [HIGH RISK] a failure after the freeze rolls back the status, the frozen input and the audit row together", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    mocks.stageFails.value = true;

    const response = await approve(jobId);

    expect(response.status).toBe(500);
    expect(await jobStatus(jobId)).toBe("REVIEW");
    expect(await frozenRows(jobId)).toHaveLength(0);
    expect(await approveAuditRows(jobId)).toHaveLength(0);
  });

  it("REQ-CIN-1 [HIGH RISK] an image storage failure aborts the approval instead of freezing a certificate without its image", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    mocks.readImage.mockRejectedValue(new Error("storage down"));

    const response = await approve(jobId);

    expect(response.status).toBe(500);
    expect(await jobStatus(jobId)).toBe("REVIEW");
    expect(await frozenRows(jobId)).toHaveLength(0);
  });

  it("REQ-CIN-1 [HIGH RISK] the images are read from storage BEFORE the approval transaction: the job row is not locked while storage is called", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    const lockedDuringRead: boolean[] = [];
    mocks.readImage.mockImplementation(async (key: string) => {
      // The approval's own transaction holds FOR UPDATE on the job: FOR SHARE NOWAIT
      // fails (55P03) if a storage read were made while it is open.
      try {
        // The probe is the spec's own connection, not the application under
        // test (under the RLS shadow report a request runs as `calibra_app`).
        await outsideApplication(() =>
          db.transaction((tx) =>
            tx.execute(
              sql`select id from calibration_job where id = ${jobId} for share nowait`,
            ),
          ),
        );
        lockedDuringRead.push(false);
      } catch {
        lockedDuringRead.push(true);
      }
      return key === LOGO_KEY ? LOGO_BYTES : SIGNATURE_BYTES;
    });

    expect((await approve(jobId)).status).toBe(200);

    // the logo and the signature were both read
    expect(lockedDuringRead).toEqual([false, false]);
  });

  it("REQ-CIN-1 [HIGH RISK] a logo replaced between the storage read and the lock is a retryable conflict: nothing frozen, the retry freezes the new one", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    const newKey = organizationLogoKey({
      org: { id: ORG, slug: ORG },
      timestamp: 1_770_000_000_000,
      uniqueId: "logo-2",
    }).key;
    const newBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 4, 4]);
    let replaced = false;
    mocks.readImage.mockImplementation(async (key: string) => {
      if (key === LOGO_KEY && !replaced) {
        replaced = true;
        // the lab uploads another logo while the approval is being prepared
        await db
          .update(organization)
          .set({
            logo: buildOrganizationLogoUrl(newKey, "https://api.example.com"),
          })
          .where(eq(organization.id, ORG));
        return LOGO_BYTES;
      }
      if (key === newKey) return newBytes;
      return key === LOGO_KEY ? LOGO_BYTES : SIGNATURE_BYTES;
    });

    const conflict = await approve(jobId);

    expect(conflict.status).toBe(409);
    expect(await jobStatus(jobId)).toBe("REVIEW");
    expect(await frozenRows(jobId)).toHaveLength(0);
    expect(await approveAuditRows(jobId)).toHaveLength(0);

    expect((await approve(jobId)).status).toBe(200);
    const [row] = await frozenRows(jobId);
    expect(field(field(field(row?.input, "job"), "lab"), "logo")).toBe(
      dataUrl(newBytes, "image/png"),
    );
  });

  it("REQ-CIN-1 an image that no object backs is frozen as absent (logo kept as stored, no signature), like the render did before", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    mocks.readImage.mockResolvedValue(null);

    expect((await approve(jobId)).status).toBe(200);

    const [row] = await frozenRows(jobId);
    const job = field(row?.input, "job");
    expect(field(field(job, "lab"), "logo")).toBe(
      buildOrganizationLogoUrl(LOGO_KEY, "https://api.example.com"),
    );
    expect(field(job, "approverSignatureUrl")).toBeNull();
  });

  it("REQ-CIN-1 a lab whose accreditation vigência has ended at approval is frozen without the seal", async () => {
    const fixture = await seedFixture();
    await db
      .update(organization)
      .set({ accreditationValidUntil: new Date("2026-01-31T00:00:00.000Z") })
      .where(eq(organization.id, ORG));
    const jobId = await seedReviewJob(fixture);

    expect((await approve(jobId)).status).toBe(200);

    const [row] = await frozenRows(jobId);
    expect(field(field(row?.input, "seal"), "accredited")).toBe(false);
  });

  it("REQ-CIN-1 [HIGH RISK] an approval reverted after a failed dispatch leaves no frozen input behind, and the retry freezes a fresh one", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    mocks.enqueue.mockRejectedValueOnce(new Error("queue down"));

    const failed = await approve(jobId);
    expect(failed.status).not.toBe(200);
    expect(await jobStatus(jobId)).toBe("REVIEW");
    expect(await frozenRows(jobId)).toHaveLength(0);

    // the lab changed while the approval was being retried: the new input
    // describes the record as approved NOW
    await db
      .update(organization)
      .set({ name: "Laboratório Renomeado" })
      .where(eq(organization.id, ORG));
    expect((await approve(jobId)).status).toBe(200);
    const rows = await frozenRows(jobId);
    expect(rows).toHaveLength(1);
    expect(field(field(field(rows[0]?.input, "job"), "lab"), "name")).toBe(
      "Laboratório Renomeado",
    );
  });

  it("REQ-CIN-1 a job rejected after a render failure and approved again replaces its stale frozen input", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    expect((await approve(jobId)).status).toBe(200);
    const [first] = await frozenRows(jobId);

    // the worker rejected the render; the job is corrected and resubmitted
    await setJobStatus(jobId, "REVIEW");
    await db
      .update(organization)
      .set({ name: "Laboratório Renomeado" })
      .where(eq(organization.id, ORG));

    expect((await approve(jobId)).status).toBe(200);

    const rows = await frozenRows(jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sha256).not.toBe(first?.sha256);
    expect(field(field(field(rows[0]?.input, "job"), "lab"), "name")).toBe(
      "Laboratório Renomeado",
    );
  });
});

describe("REQ-CIN-3: the frozen input is immutable after approval", () => {
  it("REQ-CIN-3 [HIGH RISK] the database refuses to change or delete the input of an approved job", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    expect((await approve(jobId)).status).toBe(200);
    const [before] = await frozenRows(jobId);

    // GENERATING_PDF: released, rendering
    await expectTriggerRefusal(() =>
      db
        .update(certificateInput)
        .set({ input: { tampered: true } })
        .where(eq(certificateInput.jobId, jobId)),
    );
    await expectTriggerRefusal(() =>
      db
        .update(certificateInput)
        .set({ sha256: "0".repeat(64) })
        .where(eq(certificateInput.jobId, jobId)),
    );
    await expectTriggerRefusal(() =>
      db.delete(certificateInput).where(eq(certificateInput.jobId, jobId)),
    );

    // APPROVED: issued
    await setJobStatus(jobId, "APPROVED");
    await expectTriggerRefusal(() =>
      db
        .update(certificateInput)
        .set({ input: { tampered: true } })
        .where(eq(certificateInput.jobId, jobId)),
    );
    await expectTriggerRefusal(() =>
      db.delete(certificateInput).where(eq(certificateInput.jobId, jobId)),
    );

    const [after] = await frozenRows(jobId);
    expect(after?.input).toEqual(before?.input);
    expect(after?.sha256).toBe(before?.sha256);
  });

  it("REQ-CIN-3 the one allowed way out is the job being back in REVIEW (the approval did not complete)", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    expect((await approve(jobId)).status).toBe(200);

    await setJobStatus(jobId, "REVIEW");
    await db.delete(certificateInput).where(eq(certificateInput.jobId, jobId));

    expect(await frozenRows(jobId)).toHaveLength(0);
  });

  it("REQ-CIN-3 the seed escape hatch lifts the guard for one transaction only", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    expect((await approve(jobId)).status).toBe(200);

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );
      await tx
        .update(certificateInput)
        .set({ engineVersion: "rewritten" })
        .where(eq(certificateInput.jobId, jobId));
    });
    await expectTriggerRefusal(() =>
      db
        .update(certificateInput)
        .set({ engineVersion: "again" })
        .where(eq(certificateInput.jobId, jobId)),
    );
  });

  it("REQ-CIN-3 [HIGH RISK] an amendment is a new job with its own frozen input; the original's stays untouched", async () => {
    const fixture = await seedFixture();
    const originalId = await seedReviewJob(fixture);
    expect((await approve(originalId)).status).toBe(200);
    const [originalFrozen] = await frozenRows(originalId);

    // the worker issued the certificate
    await setJobStatus(originalId, "APPROVED");

    loginPerRequestHeader(ORG);
    const amend = await jobsRouter.request(`/${originalId}/amend`, {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-test-user-id": MAKER },
      body: JSON.stringify({ reason: "Erro de digitação no cliente" }),
    });
    expect(amend.status).toBe(201);

    const [amended] = await db
      .select({ id: calibrationJob.id, jobId: calibrationJob.jobId })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.supersedesId, originalId),
          eq(calibrationJob.organizationId, ORG),
        ),
      );
    if (!amended) throw new Error("no amendment created");
    // the clone starts without a frozen input: it is approved on its own
    expect(await frozenRows(amended.id)).toHaveLength(0);

    await setJobStatus(amended.id, "REVIEW");
    await db
      .update(customer)
      .set({ name: "Cliente SA (corrigido)" })
      .where(eq(customer.labOrganizationId, ORG));
    expect((await approve(amended.id)).status).toBe(200);

    const [amendedFrozen] = await frozenRows(amended.id);
    expect(amendedFrozen?.id).not.toBe(originalFrozen?.id);
    expect(amendedFrozen?.sha256).not.toBe(originalFrozen?.sha256);
    const job = field(amendedFrozen?.input, "job");
    expect(field(field(job, "customer"), "name")).toBe(
      "Cliente SA (corrigido)",
    );
    expect(field(job, "supersedesId")).toBe(originalId);
    expect(field(job, "amendmentReason")).toBe("Erro de digitação no cliente");
    expect(field(job, "amendmentNumber")).toBe(1);
    expect(field(job, "originalJobId")).toBeTruthy();

    // the original still describes the certificate as it was approved
    const [originalAfter] = await frozenRows(originalId);
    expect(originalAfter?.input).toEqual(originalFrozen?.input);
    expect(
      field(field(field(originalAfter?.input, "job"), "customer"), "name"),
    ).toBe("Cliente SA");
  });
});

describe("REQ-CIN-5: certificate_input is a tenant row, 1:1 with its job", () => {
  it("REQ-CIN-5 carries the job's organization and allows one row per job", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    expect((await approve(jobId)).status).toBe(200);
    const [row] = await frozenRows(jobId);
    if (!row) throw new Error("no frozen row");

    expect(row.organizationId).toBe(ORG);
    await expect(
      db.insert(certificateInput).values({
        organizationId: row.organizationId,
        jobId,
        schemaVersion: row.schemaVersion,
        input: row.input,
        sha256: row.sha256,
        layoutKey: row.layoutKey,
        layoutVersion: row.layoutVersion,
      }),
    ).rejects.toThrow();
  });

  it("REQ-CIN-5 the composite (job_id, organization_id) key refuses a row that points at another tenant's job", async () => {
    const fixture = await seedFixture();
    const jobId = await seedReviewJob(fixture);
    await seedOrg({ orgId: "org-b", userId: "user-b" });

    await expect(
      db.insert(certificateInput).values({
        organizationId: "org-b",
        jobId,
        schemaVersion: 1,
        input: {},
        sha256: "0".repeat(64),
        layoutKey: "calibration-certificate-fixed",
        layoutVersion: "1.0.0",
      }),
    ).rejects.toThrow();
  });
});
