import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  certificateRelease,
  portalExportJob,
  service,
  type MethodSnapshot,
} from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
} from "../../test/integration/seed";

// Real-DB + real-RBAC integration tier for the portal AUDIT PACK endpoints
// (#738) — a customer-facing bulk export, so the two properties that matter
// most are (1) tenant scope: a portal session can only export ITS customers'
// certificates, and (2) the certificate release gate: payment-held
// certificates block/never enter a pack. Only the portal getSession and the
// queue side-effect are mocked; scope resolution, the gate lookup and the
// portal_export_job writes all run against a seeded Postgres.

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

import { portalRouter } from "./portal";
import { enqueueBackgroundJob } from "../lib/background-jobs";

const LOCAL_ORIGIN = { origin: "http://localhost" };
const JSON_HEADERS = {
  ...LOCAL_ORIGIN,
  "Content-Type": "application/json",
};

// Fake-but-shaped R2 env: presigned-URL generation is pure local signing, so
// the download happy path works without any real bucket.
const R2_TEST_ENV = {
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET_NAME: "documents-test",
  R2_MEDIA_BUCKET_NAME: "media-test",
};

const VALID_BODY = {
  dateFrom: "2026-01-01",
  dateTo: "2026-12-31",
  include: {
    certificates: true,
    fleetReport: true,
    verificationIndex: true,
  },
};

/** Minimal MethodSnapshot: the audit-pack routes never read it, but the
 * column is NOT NULL (deep-freeze invariant). */
function minimalMethodSnapshot(): MethodSnapshot {
  return {
    methodId: 0,
    methodName: "Método de Teste",
    methodVersion: 1,
    accreditedScope: false,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  };
}

/** Seed an APPROVED calibration job with a certificate for a customer. */
async function seedApprovedCertificate(params: {
  labOrgId: string;
  labUnitId: number;
  customerId: number;
  userId: string;
  jobNumber: string;
  approvedAt?: Date;
  releaseStatus?: "RELEASED" | "HELD_FOR_PAYMENT" | "HELD_FOR_BILLING";
}): Promise<number> {
  const approvedAt = params.approvedAt ?? new Date("2026-03-10T12:00:00.000Z");

  const [assetTypeRow] = await db
    .insert(assetType)
    .values({
      name: `Tipo ${params.jobNumber}`,
      slug: `tipo-${params.jobNumber.toLowerCase()}`,
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!assetTypeRow) throw new Error("assetType insert failed");

  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: params.labUnitId,
      customerId: params.customerId,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      assetTypeId: assetTypeRow.id,
      name: `Instrumento ${params.jobNumber}`,
      serialNumber: `SN-${params.jobNumber}`,
      tag: `TAG-${params.jobNumber}`,
      status: "ACTIVE",
    })
    .returning({ id: asset.id });
  if (!assetRow) throw new Error("asset insert failed");

  const [serviceRow] = await db
    .insert(service)
    .values({
      unitId: params.labUnitId,
      organizationId: params.labOrgId,
      name: `Serviço ${params.jobNumber}`,
    })
    .returning({ id: service.id });
  if (!serviceRow) throw new Error("service insert failed");

  const [jobRow] = await db
    .insert(calibrationJob)
    .values({
      jobId: params.jobNumber,
      certificateName: params.jobNumber,
      organizationId: params.labOrgId,
      unitId: params.labUnitId,
      customerId: params.customerId,
      assetId: assetRow.id,
      serviceId: serviceRow.id,
      methodSnapshot: minimalMethodSnapshot(),
      status: "APPROVED",
      certificateUrl: `https://certificates.calibrafacil.com/org/test/${params.jobNumber}.pdf`,
      performedAt: approvedAt,
      approvedAt,
      approvedBy: params.userId,
      createdBy: params.userId,
    })
    .returning({ id: calibrationJob.id });
  if (!jobRow) throw new Error("calibration_job insert failed");

  if (params.releaseStatus) {
    await db.insert(certificateRelease).values({
      organizationId: params.labOrgId,
      calibrationJobId: jobRow.id,
      status: params.releaseStatus,
    });
  }
  return jobRow.id;
}

async function readExportRows() {
  return db
    .select({
      id: portalExportJob.id,
      authOrganizationId: portalExportJob.authOrganizationId,
      status: portalExportJob.status,
      params: portalExportJob.params,
    })
    .from(portalExportJob);
}

beforeEach(async () => {
  await truncateAll();
  vi.mocked(enqueueBackgroundJob).mockClear();
});

describe("portalRouter /audit-packs — real DB + real portal middleware", () => {
  it("REQ-AP-001: POST creates a PENDING export scoped to the session's customer and enqueues AUDIT_PACK", async () => {
    const ctx = await seedPortalContext();
    await seedApprovedCertificate({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      userId: ctx.portalUserId,
      jobNumber: "CAL-2026-0001",
      releaseStatus: "RELEASED",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRouter.request("/audit-packs", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("PENDING");

    const rows = await readExportRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("export row missing");
    expect(row.authOrganizationId).toBe(ctx.clientOrgId);
    // The frozen scope carries exactly the session customer — nothing else.
    expect(row.params.customerIds).toEqual([ctx.customerId]);

    expect(vi.mocked(enqueueBackgroundJob)).toHaveBeenCalledWith(
      { type: "AUDIT_PACK", exportId: row.id, userId: ctx.portalUserId },
      { idempotencyKey: `audit-pack-${row.id}` },
    );
  });

  it("REQ-AP-002 [HIGH RISK] release gate at enqueue: a period with only payment-held certificates is rejected", async () => {
    const ctx = await seedPortalContext();
    await seedApprovedCertificate({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      userId: ctx.portalUserId,
      jobNumber: "CAL-2026-0001",
      releaseStatus: "HELD_FOR_PAYMENT",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRouter.request("/audit-packs", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Nenhum certificado disponível");
    expect(await readExportRows()).toHaveLength(0);
    expect(vi.mocked(enqueueBackgroundJob)).not.toHaveBeenCalled();
  });

  it("REQ-AP-003: request validation — inverted period and empty content selection are 400s", async () => {
    const ctx = await seedPortalContext();
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const inverted = await portalRouter.request("/audit-packs", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ...VALID_BODY,
        dateFrom: "2026-12-31",
        dateTo: "2026-01-01",
      }),
    });
    expect(inverted.status).toBe(400);

    const noContent = await portalRouter.request("/audit-packs", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ...VALID_BODY,
        include: {
          certificates: false,
          fleetReport: false,
          verificationIndex: false,
        },
      }),
    });
    expect(noContent.status).toBe(400);
    expect(await readExportRows()).toHaveLength(0);
  });

  it("REQ-AP-004 tenant scope: a unitId pointing at another lab customer is rejected", async () => {
    const ctx = await seedPortalContext();
    const customerBId = await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRouter.request("/audit-packs", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_BODY, unitId: customerBId }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Unidade inválida");
    expect(await readExportRows()).toHaveLength(0);
  });

  it("REQ-AP-005 [HIGH RISK] GET lists only the active CLIENT org's packs — customer B's never leak", async () => {
    const ctx = await seedPortalContext();
    await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    const baseParams = {
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      unitId: null,
      include: {
        certificates: true,
        fleetReport: true,
        verificationIndex: true,
      },
    };
    await db.insert(portalExportJob).values([
      {
        kind: "AUDIT_PACK",
        labOrganizationId: ctx.labOrgId,
        authOrganizationId: ctx.clientOrgId,
        requestedByUserId: ctx.portalUserId,
        params: { ...baseParams, customerIds: [ctx.customerId] },
        status: "COMPLETED",
      },
      {
        kind: "AUDIT_PACK",
        labOrganizationId: ctx.labOrgId,
        authOrganizationId: "portal-client-b",
        requestedByUserId: "portal-user-b",
        params: { ...baseParams, customerIds: [999] },
        status: "COMPLETED",
      },
    ]);

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRouter.request("/audit-packs", {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  it("REQ-AP-006 download guards: not-ready 400, expired 410, and a since-held certificate blocks with 409", async () => {
    const ctx = await seedPortalContext();
    const jobId = await seedApprovedCertificate({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      userId: ctx.portalUserId,
      jobNumber: "CAL-2026-0001",
      releaseStatus: "RELEASED",
    });

    const baseRow = {
      kind: "AUDIT_PACK" as const,
      labOrganizationId: ctx.labOrgId,
      authOrganizationId: ctx.clientOrgId,
      requestedByUserId: ctx.portalUserId,
      params: {
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        unitId: null,
        include: {
          certificates: true,
          fleetReport: true,
          verificationIndex: true,
        },
        customerIds: [ctx.customerId],
      },
    };
    const inserted = await db
      .insert(portalExportJob)
      .values([
        { ...baseRow, status: "PENDING" },
        {
          ...baseRow,
          status: "COMPLETED",
          r2Key: "org/test/portal-exports/2/pacote.zip",
          includedJobIds: [jobId],
          expiresAt: new Date(Date.now() - 60_000),
        },
        {
          ...baseRow,
          status: "COMPLETED",
          r2Key: "org/test/portal-exports/3/pacote.zip",
          includedJobIds: [jobId],
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      ])
      .returning();
    const pendingRow = inserted[0];
    const expiredRow = inserted[1];
    const readyRow = inserted[2];
    if (!pendingRow || !expiredRow || !readyRow) {
      throw new Error("export rows missing");
    }

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const pending = await portalRouter.request(
      `/audit-packs/${pendingRow.id}/download`,
      { headers: LOCAL_ORIGIN },
      R2_TEST_ENV,
    );
    expect(pending.status).toBe(400);

    const expired = await portalRouter.request(
      `/audit-packs/${expiredRow.id}/download`,
      { headers: LOCAL_ORIGIN },
      R2_TEST_ENV,
    );
    expect(expired.status).toBe(410);

    // The pack was generated while released; the certificate is then HELD —
    // the download re-check must refuse to hand out the ZIP.
    await db
      .update(certificateRelease)
      .set({ status: "HELD_FOR_PAYMENT" })
      .where(sql`${certificateRelease.calibrationJobId} = ${jobId}`);
    const held = await portalRouter.request(
      `/audit-packs/${readyRow.id}/download`,
      { headers: LOCAL_ORIGIN },
      R2_TEST_ENV,
    );
    expect(held.status).toBe(409);

    // Released again -> presigned URL issued.
    await db
      .update(certificateRelease)
      .set({ status: "RELEASED" })
      .where(sql`${certificateRelease.calibrationJobId} = ${jobId}`);
    const ready = await portalRouter.request(
      `/audit-packs/${readyRow.id}/download`,
      { headers: LOCAL_ORIGIN },
      R2_TEST_ENV,
    );
    expect(ready.status).toBe(200);
    const readyBody = await ready.json();
    expect(readyBody.url).toContain("portal-exports");
    expect(readyBody.filename).toBe(
      "pacote-auditoria-2026-01-01-a-2026-12-31.zip",
    );
  });

  it("REQ-AP-007 tenant scope on download: another CLIENT org's pack id is a 404", async () => {
    const ctx = await seedPortalContext();
    await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });
    const [foreign] = await db
      .insert(portalExportJob)
      .values({
        kind: "AUDIT_PACK",
        labOrganizationId: ctx.labOrgId,
        authOrganizationId: "portal-client-b",
        requestedByUserId: "portal-user-b",
        params: {
          dateFrom: "2026-01-01",
          dateTo: "2026-12-31",
          unitId: null,
          include: {
            certificates: true,
            fleetReport: true,
            verificationIndex: true,
          },
          customerIds: [999],
        },
        status: "COMPLETED",
        r2Key: "org/test/portal-exports/9/pacote.zip",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!foreign) throw new Error("foreign export row missing");

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRouter.request(
      `/audit-packs/${foreign.id}/download`,
      { headers: LOCAL_ORIGIN },
      R2_TEST_ENV,
    );
    expect(res.status).toBe(404);
  });
});
