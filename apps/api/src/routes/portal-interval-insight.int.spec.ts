import { beforeEach, describe, expect, it } from "vitest";
import { portalRouter } from "./portal";
import { db } from "@calibra-facil/db";
import { asset, assetType, calibrationJob } from "@calibra-facil/db/schema";

type AsFoundConformity = "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";
import { loginAsPortal, logoutPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
  seedService,
} from "../../test/integration/seed";

// Real-DB integration test for GET /api/portal/assets/:id/interval-insight (Phase C2):
// the engine runs on the asset's approved as-found history, tenant-scoped, with the
// legal-metrology guard. Only the portal getSession is mocked.

const LOCAL_ORIGIN = { origin: "http://localhost" };

async function ensureAssetType(): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: "Balança", slug: "balanca", definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("ensureAssetType failed");
  return row.id;
}

async function seedAsset(params: {
  labUnitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
  model?: string;
  metrologyRegime?: "INDUSTRIAL" | "LEGAL" | "UNKNOWN";
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.labUnitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: `Ativo ${params.tag}`,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      model: params.model ?? null,
      status: "ACTIVE",
      metrologyRegime: params.metrologyRegime ?? "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset failed");
  return row.id;
}

function minimalMethodSnapshot() {
  return {
    methodId: 1,
    methodName: "Test",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  } satisfies Record<string, unknown>;
}

let jobSeq = 0;

async function seedApprovedJob(params: {
  labOrgId: string;
  labUnitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
  approvedAt: Date;
  conformity: AsFoundConformity;
  margins: number[] | null;
}): Promise<void> {
  jobSeq += 1;
  await db.insert(calibrationJob).values({
    jobId: `JOB-INS-${jobSeq}`,
    organizationId: params.labOrgId,
    unitId: params.labUnitId,
    customerId: params.customerId,
    assetId: params.assetId,
    serviceId: params.serviceId,
    createdBy: params.createdBy,
    status: "APPROVED",
    approvedAt: params.approvedAt,
    asFoundConformity: params.conformity,
    asFoundMargins: params.margins,
    methodSnapshot: minimalMethodSnapshot(),
    certificateName: `JOB-INS-${jobSeq}`,
  });
}

function get(assetId: number | string) {
  return portalRouter.request(`/assets/${assetId}/interval-insight`, {
    headers: LOCAL_ORIGIN,
  });
}

function getReport(assetId: number | string) {
  return portalRouter.request(`/assets/${assetId}/interval-insight/report`, {
    headers: LOCAL_ORIGIN,
  });
}

const FALLING = [
  { iso: "2024-01-01T00:00:00.000Z", margin: 1.0 },
  { iso: "2024-07-01T00:00:00.000Z", margin: 0.8 },
  { iso: "2025-01-01T00:00:00.000Z", margin: 0.6 },
  { iso: "2025-07-01T00:00:00.000Z", margin: 0.4 },
  { iso: "2026-01-01T00:00:00.000Z", margin: 0.2 },
];

describe("GET /api/portal/assets/:id/interval-insight — real DB + portal middleware", () => {
  beforeEach(async () => {
    await truncateAll();
    jobSeq = 0;
  });

  it("classifies a falling margin history as DRIFTING with a shorten suggestion", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const serviceId = await seedService({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });
    for (const point of FALLING) {
      await seedApprovedJob({
        labOrgId: ctx.labOrgId,
        labUnitId: ctx.labUnitId,
        customerId: ctx.customerId,
        assetId,
        serviceId,
        createdBy: ctx.portalUserId,
        approvedAt: new Date(point.iso),
        conformity: "CONFORMING",
        margins: [point.margin],
      });
    }

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await get(assetId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.classification).toBe("DRIFTING");
    expect(body.recommendation.action).toBe("shorten");
    expect(body.series).toHaveLength(5);
    expect(body.fingerprint).toMatch(/^sha256:/);
  });

  it("borrows from the family (M5_family) when single-unit history is thin", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const serviceId = await seedService({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração",
    });
    // Target: same model, but only 1 approved job (thin → would be INSUFFICIENT alone).
    const targetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-T",
      model: "BAL-X",
    });
    await seedApprovedJob({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId: targetId,
      serviceId,
      createdBy: ctx.portalUserId,
      approvedAt: new Date("2025-06-01T00:00:00.000Z"),
      conformity: "CONFORMING",
      margins: [0.5],
    });
    // 3 siblings (same assetType + model), each 3 approved CONFORMING jobs → family ≥ 8.
    for (let s = 0; s < 3; s += 1) {
      const sibId = await seedAsset({
        labUnitId: ctx.labUnitId,
        customerId: ctx.customerId,
        assetTypeId,
        tag: `EQ-S${s}`,
        model: "BAL-X",
      });
      for (let j = 0; j < 3; j += 1) {
        await seedApprovedJob({
          labOrgId: ctx.labOrgId,
          labUnitId: ctx.labUnitId,
          customerId: ctx.customerId,
          assetId: sibId,
          serviceId,
          createdBy: ctx.portalUserId,
          approvedAt: new Date(`2024-0${j * 3 + 1}-01T00:00:00.000Z`),
          conformity: "CONFORMING",
          margins: [0.5],
        });
      }
    }

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const body = await (await get(targetId)).json();
    expect(body.classification).toBe("STABLE");
    expect(body.recommendation.method).toBe("M5_family");
  });

  // REQ-ENGINE-DATA-003 [HIGH RISK]: the family pool must NOT leak across tenants.
  it("excludes another tenant's siblings from the family pool", async () => {
    const assetTypeId = await ensureAssetType();
    const ctxA = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "client-b",
      portalUserId: "user-b",
      customerName: "Customer B",
    });
    const serviceId = await seedService({
      organizationId: ctxA.labOrgId,
      unitId: ctxA.labUnitId,
      name: "Calibração",
    });
    const targetId = await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: ctxA.customerId,
      assetTypeId,
      tag: "EQ-T",
      model: "BAL-X",
    });
    await seedApprovedJob({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: ctxA.customerId,
      assetId: targetId,
      serviceId,
      createdBy: ctxA.portalUserId,
      approvedAt: new Date("2025-06-01T00:00:00.000Z"),
      conformity: "CONFORMING",
      margins: [0.5],
    });
    // 3 siblings owned by Customer B (same type+model, 9 jobs) — would make the family
    // ≥ 8 if the customerId scope on the pool regressed. They must be excluded.
    for (let s = 0; s < 3; s += 1) {
      const sibId = await seedAsset({
        labUnitId: ctxA.labUnitId,
        customerId: customerBId,
        assetTypeId,
        tag: `EQ-B${s}`,
        model: "BAL-X",
      });
      for (let j = 0; j < 3; j += 1) {
        await seedApprovedJob({
          labOrgId: ctxA.labOrgId,
          labUnitId: ctxA.labUnitId,
          customerId: customerBId,
          assetId: sibId,
          serviceId,
          createdBy: ctxA.portalUserId,
          approvedAt: new Date(`2024-0${j * 3 + 1}-01T00:00:00.000Z`),
          conformity: "CONFORMING",
          margins: [0.5],
        });
      }
    }

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const body = await (await get(targetId)).json();
    // No cross-tenant borrow → the thin target stays INSUFFICIENT_DATA.
    expect(body.classification).toBe("INSUFFICIENT_DATA");
  });

  // REQ-ENGINE-DATA-003 [HIGH RISK]: legal-metrology siblings must NOT enter the pool.
  it("excludes legal-metrology siblings from the family pool", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const serviceId = await seedService({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração",
    });
    const targetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-TY",
      model: "BAL-Y",
    });
    await seedApprovedJob({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId: targetId,
      serviceId,
      createdBy: ctx.portalUserId,
      approvedAt: new Date("2025-06-01T00:00:00.000Z"),
      conformity: "CONFORMING",
      margins: [0.5],
    });
    // 3 legal-metrology siblings (same tenant, type, model, 9 jobs) — excluded from the pool.
    for (let s = 0; s < 3; s += 1) {
      const sibId = await seedAsset({
        labUnitId: ctx.labUnitId,
        customerId: ctx.customerId,
        assetTypeId,
        tag: `EQ-LM${s}`,
        model: "BAL-Y",
        metrologyRegime: "LEGAL",
      });
      for (let j = 0; j < 3; j += 1) {
        await seedApprovedJob({
          labOrgId: ctx.labOrgId,
          labUnitId: ctx.labUnitId,
          customerId: ctx.customerId,
          assetId: sibId,
          serviceId,
          createdBy: ctx.portalUserId,
          approvedAt: new Date(`2024-0${j * 3 + 1}-01T00:00:00.000Z`),
          conformity: "CONFORMING",
          margins: [0.5],
        });
      }
    }

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const body = await (await get(targetId)).json();
    expect(body.classification).toBe("INSUFFICIENT_DATA");
  });

  it("returns INSUFFICIENT_DATA below the cycle floor", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A2",
    });
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await get(assetId);
    expect(res.status).toBe(200);
    expect((await res.json()).classification).toBe("INSUFFICIENT_DATA");
  });

  // REQ-MLR-050: the engine is regime-agnostic — a legal-metrology asset is analyzed like
  // any other (no LEGAL_FIXED). With no calibration history it is simply INSUFFICIENT_DATA.
  it("REQ-MLR-050: analyzes a legal-metrology asset like any other (no LEGAL_FIXED)", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-LM",
      metrologyRegime: "LEGAL",
    });
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const body = await (await get(assetId)).json();
    expect(body.classification).toBe("INSUFFICIENT_DATA");
    expect(body.recommendation).toBeNull();
  });

  it("does not expose another tenant's asset (404)", async () => {
    const assetTypeId = await ensureAssetType();
    const ctxA = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "client-b",
      portalUserId: "user-b",
      customerName: "Customer B",
    });
    const bAssetId = await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      assetTypeId,
      tag: "EQ-B1",
    });
    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    expect((await get(bAssetId)).status).toBe(404);
  });

  it("rejects an unauthenticated request (401)", async () => {
    logoutPortal();
    expect((await get(1)).status).toBe(401);
  });

  // REQ-ENGINE-REPORT-001/002: a printable HTML report that is NOT a certificate.
  it("renders a printable HTML report with the §7.8.4.3 disclaimer (not a certificate)", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const serviceId = await seedService({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-RPT",
    });
    for (const point of FALLING) {
      await seedApprovedJob({
        labOrgId: ctx.labOrgId,
        labUnitId: ctx.labUnitId,
        customerId: ctx.customerId,
        assetId,
        serviceId,
        createdBy: ctx.portalUserId,
        approvedAt: new Date(point.iso),
        conformity: "CONFORMING",
        margins: [point.margin],
      });
    }

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await getReport(assetId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Relatório de análise de periodicidade");
    expect(html).toContain("Derivando"); // classification rendered
    expect(html).toContain("EQ-RPT"); // asset tag
    expect(html).toContain("não é um certificado"); // §7.8.4.3 disclaimer
    expect(html).not.toContain("Certificado de Calibração"); // REQ-ENGINE-REPORT-002
  });

  it("does not expose another tenant's report (404)", async () => {
    const assetTypeId = await ensureAssetType();
    const ctxA = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "client-b",
      portalUserId: "user-b",
      customerName: "Customer B",
    });
    const bAssetId = await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      assetTypeId,
      tag: "EQ-B-RPT",
    });
    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    expect((await getReport(bAssetId)).status).toBe(404);
  });
});
