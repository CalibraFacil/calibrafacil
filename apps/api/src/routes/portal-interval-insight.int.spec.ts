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
  subjectToLegalMetrology?: boolean;
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
      status: "ACTIVE",
      subjectToLegalMetrology: params.subjectToLegalMetrology ?? false,
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

  it("returns LEGAL_FIXED for a legal-metrology asset", async () => {
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
      subjectToLegalMetrology: true,
    });
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const body = await (await get(assetId)).json();
    expect(body.classification).toBe("LEGAL_FIXED");
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
});
