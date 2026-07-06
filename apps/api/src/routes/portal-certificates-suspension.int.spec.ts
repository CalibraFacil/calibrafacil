import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { portalRouter } from "./portal";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  organization,
} from "@calibra-facil/db/schema";
import { loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
  seedService,
} from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for SEC-05 (#640): the four portal
// certificate routes (list + single + download + reference-standard download)
// used only `requirePortalAuth`, skipping the `organization.status = SUSPENDED`
// gate that `requirePortalProtected` (requirePortalAuth + requireOrganization +
// requirePortalAccess) applies to the rest of the portal. A client of a
// SUSPENDED org could still list/download certificates.
//
// Only the portal better-auth getSession is mocked (see test/integration/
// setup.ts); requireOrganization's suspension check + resolvePortalAccessible-
// CustomerIds tenant scoping run for real against a seeded ephemeral Postgres.
//
// The suspension gate lives in requireOrganization (middleware/permission.ts):
// when the active org's status is "SUSPENDED" it throws HTTPException(403,
// "Conta suspensa. Entre em contato com o suporte da CalibraFácil."). The gate
// runs BEFORE the handler, so it fires regardless of the URL cert id.

// The portal resolves the host lab from the request Origin (getPortalLabScope).
// A default/local host yields labScope=null with blocked=false — the clean path:
// scope is resolved purely from customer.authOrganizationId.
const LOCAL_ORIGIN = { origin: "http://localhost" };

/** A global asset type (asset rows need one). */
async function seedAssetType(): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({
      name: "Balança Digital",
      slug: "balanca-digital",
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/** Seed an asset owned by a customer, unit-scoped to the lab. */
async function seedAsset(params: {
  labUnitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      // #638b made lab_organization_id NOT NULL — derive it from the owning customer.
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      unitId: params.labUnitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: `Balança ${params.tag}`,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/**
 * Seed one APPROVED calibration job (= a portal-visible certificate) for a
 * customer. certificateUrl and standardsSnapshot are intentionally left null so
 * the two download routes reach their handler and return a deterministic
 * non-403 result (400 "no document" / 404 "padrão não encontrado") without any
 * R2 dependency — which is exactly what proves the suspension gate (403) is the
 * NEW behavior, not incidental.
 */
async function seedApprovedCertificate(params: {
  labOrgId: string;
  labUnitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
  jobId: string;
}): Promise<number> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const [row] = await db
    .insert(calibrationJob)
    .values({
      jobId: params.jobId,
      organizationId: params.labOrgId,
      unitId: params.labUnitId,
      customerId: params.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      methodSnapshot: { accreditedScope: false },
      status: "APPROVED",
      createdBy: params.createdBy,
      performedAt: now,
      approvedAt: now,
    })
    .returning({ id: calibrationJob.id });
  if (!row) throw new Error("seedApprovedCertificate: insert failed");
  return row.id;
}

describe("portalRouter certificate routes — SUSPENDED org gate (SEC-05)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-SEC-PORT-001 [HIGH RISK]: WHILE the client org is SUSPENDED, all four
  // certificate routes SHALL reject with 403 — the same status the rest of the
  // portal (requirePortalProtected → requireOrganization) returns for a
  // suspended org. Today (requirePortalAuth only) a suspended org still reaches
  // the handler: list/detail → 200, download → 400, standard → 404. The
  // "suspensa" body text pins the rejection to requireOrganization's gate
  // rather than any other 403 (getPortalLabScope / requirePortalAccess).
  // =========================================================================
  it("REQ-SEC-PORT-001: SUSPENDED client org is rejected (403) on all 4 certificate routes", async () => {
    const ctx = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });
    const assetTypeId = await seedAssetType();
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });
    const serviceId = await seedService({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração",
    });
    const certId = await seedApprovedCertificate({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId,
      serviceId,
      createdBy: ctx.portalUserId,
      jobId: "CAL-SUSP-1",
    });

    // Backoffice-suspend the portal session's active (CLIENT) organization.
    await db
      .update(organization)
      .set({ status: "SUSPENDED" })
      .where(eq(organization.id, ctx.clientOrgId));

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const paths = [
      "/certificates",
      `/certificates/${certId}`,
      `/certificates/${certId}/download`,
      `/certificates/${certId}/reference-standards/1/certificate/download`,
    ];

    for (const path of paths) {
      const res = await portalRouter.request(path, { headers: LOCAL_ORIGIN });
      expect(res.status, `suspended org must be blocked on ${path}`).toBe(403);
      const bodyText = await res.text();
      expect(
        bodyText,
        `403 on ${path} must come from the suspension gate`,
      ).toContain("suspensa");
    }
  });

  // =========================================================================
  // REQ-SEC-PORT-002: WHILE the org is ACTIVE, all four routes SHALL continue
  // to serve (no regression) with tenant scoping intact. Customer B (same lab)
  // is seeded so a scope regression would surface B's cert in A's list or make
  // B's cert resolvable to A — the suite asserts it does NOT.
  // =========================================================================
  it("REQ-SEC-PORT-002: ACTIVE client org still served on all 4 routes, tenant scope intact", async () => {
    const ctx = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });
    const assetTypeId = await seedAssetType();
    const serviceId = await seedService({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração",
    });

    const assetAId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });
    const certAId = await seedApprovedCertificate({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId: assetAId,
      serviceId,
      createdBy: ctx.portalUserId,
      jobId: "CAL-A-1",
    });

    const assetBId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: customerBId,
      assetTypeId,
      tag: "EQ-B1",
    });
    const certBId = await seedApprovedCertificate({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: customerBId,
      assetId: assetBId,
      serviceId,
      createdBy: ctx.portalUserId,
      jobId: "CAL-B-1",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    // GET /certificates → 200; only A's cert is listed (B's is scoped out).
    const listRes = await portalRouter.request("/certificates", {
      headers: LOCAL_ORIGIN,
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const listedJobIds = listBody.data.map(
      (row: { jobId: string }) => row.jobId,
    );
    expect(listedJobIds).toContain("CAL-A-1");
    expect(listedJobIds).not.toContain("CAL-B-1");

    // GET /certificates/:id → 200 for A's own cert.
    const detailRes = await portalRouter.request(`/certificates/${certAId}`, {
      headers: LOCAL_ORIGIN,
    });
    expect(detailRes.status).toBe(200);

    // GET /certificates/:id → 404 for B's cert (tenant scope intact, NOT 403).
    const detailBRes = await portalRouter.request(`/certificates/${certBId}`, {
      headers: LOCAL_ORIGIN,
    });
    expect(detailBRes.status).not.toBe(403);
    expect(detailBRes.status).toBe(404);

    // GET /certificates/:id/download → handler reached (cert found, no
    // document yet → 400), NOT blocked by the suspension gate.
    const downloadRes = await portalRouter.request(
      `/certificates/${certAId}/download`,
      { headers: LOCAL_ORIGIN },
    );
    expect(downloadRes.status).not.toBe(403);
    expect(downloadRes.status).toBe(400);

    // GET .../reference-standards/:standardId/certificate/download →
    // handler reached (cert found, no standards snapshot → 404), NOT 403.
    const standardRes = await portalRouter.request(
      `/certificates/${certAId}/reference-standards/1/certificate/download`,
      { headers: LOCAL_ORIGIN },
    );
    expect(standardRes.status).not.toBe(403);
    expect(standardRes.status).toBe(404);
  });
});
