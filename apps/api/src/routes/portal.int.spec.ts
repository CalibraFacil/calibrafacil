import { beforeEach, describe, expect, it } from "vitest";
import { portalRouter } from "./portal";
import { db } from "@calibra-facil/db";
import { asset, assetType, calibrationRequest } from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { loginAsPortal, logoutPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
} from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the CLIENT PORTAL — the highest-stakes
// tenant boundary, since it is customer-facing. Only the portal better-auth
// getSession is mocked (see test/integration/setup.ts); requirePortalAuth ->
// requireOrganization -> requirePortalAccess and resolvePortalCustomerScope all
// run for real against a seeded Postgres. This proves the property the vi.mock(db)
// fast tier cannot: customer isolation enforced by the handler's
// `inArray(asset.customerId, customerIds)` WHERE clause.

// The portal resolves the host lab from the request Origin (getPortalLabScope).
// A default/local host yields labScope=null with blocked=false, which is the
// clean path: scope is then resolved purely from customer.authOrganizationId.
const LOCAL_ORIGIN = { origin: "http://localhost" };

// ---------------------------------------------------------------------------
// Inline domain seed helpers — NOT in shared seed.ts to keep makers conflict-free.
// ---------------------------------------------------------------------------

/** A global asset type (asset rows need one). Created once per test run if absent. */
async function ensureAssetType(): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({
      name: "Balança Digital",
      slug: "balanca-digital",
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!row) throw new Error("ensureAssetType: insert failed");
  return row.id;
}

/** Seed an ACTIVE asset owned by a customer, unit-scoped to the lab. */
async function seedAsset(params: {
  labUnitId: number;
  customerId: number;
  assetTypeId: number;
  name: string;
  tag: string;
  nextCalibrationDate: Date;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.labUnitId,
      customerId: params.customerId,
      // SEC-03b (#638): per-org tag uniqueness — derive lab org from the customer.
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      assetTypeId: params.assetTypeId,
      name: params.name,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      nextCalibrationDate: params.nextCalibrationDate,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/** Seed a PENDING calibration request for a customer (a second scope dimension). */
async function seedRequest(params: {
  labOrgId: string;
  labUnitId: number;
  customerId: number;
  clientOrgId: string;
  submittedBy: string;
}): Promise<number> {
  const [row] = await db
    .insert(calibrationRequest)
    .values({
      organizationId: params.labOrgId,
      unitId: params.labUnitId,
      customerId: params.customerId,
      authOrganizationId: params.clientOrgId,
      submittedBy: params.submittedBy,
      status: "PENDING",
    })
    .returning({ id: calibrationRequest.id });
  if (!row) throw new Error("seedRequest: insert failed");
  return row.id;
}

// A "due soon" date relative to now (within DUE_SOON_DAYS=30) so it lands in the
// dueSoon bucket and the bounded attention list regardless of the wall clock.
function inDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------

describe("portalRouter /overview — real DB + real portal middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-PORTAL-001 [HIGH RISK]: a portal session scoped to customer-A sees ONLY
  // customer-A's data. Customer-B's data is seeded so it WOULD appear if the
  // `inArray(..customerId, customerIds)` scope regressed — assert it is ABSENT.
  // =========================================================================
  it("REQ-PORTAL-001: portal session for customer-A sees only customer-A's data (customer isolation)", async () => {
    const assetTypeId = await ensureAssetType();

    // One shared lab owns both customers (cross-customer, same lab — the real
    // leak vector: a scope regression returns the lab's other customer too).
    const ctxA = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    // Customer A: one due-soon asset + one request.
    await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: ctxA.customerId,
      assetTypeId,
      name: "Balança A",
      tag: "EQ-A1",
      nextCalibrationDate: inDays(10),
    });
    await seedRequest({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: ctxA.customerId,
      clientOrgId: ctxA.clientOrgId,
      submittedBy: ctxA.portalUserId,
    });

    // Customer B: TWO due-soon assets + one request — strictly more than A, so
    // a regression that drops the scope would change every count and surface
    // "Balança B" by name in the attention list.
    await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      assetTypeId,
      name: "Balança B1",
      tag: "EQ-B1",
      nextCalibrationDate: inDays(5),
    });
    await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      assetTypeId,
      name: "Balança B2",
      tag: "EQ-B2",
      nextCalibrationDate: inDays(6),
    });
    await seedRequest({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      clientOrgId: "portal-client-b",
      submittedBy: "portal-user-b",
    });

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const res = await portalRouter.request("/overview", {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Customer A has exactly ONE asset and ONE request — B's three rows are absent.
    expect(body.equipment.total).toBe(1);
    expect(body.requests.total).toBe(1);

    // The attention list carries the asset name + customerName: B must not leak.
    const attentionNames = body.equipment.attention.map(
      (a: { name: string }) => a.name,
    );
    expect(attentionNames).toContain("Balança A");
    expect(attentionNames).not.toContain("Balança B1");
    expect(attentionNames).not.toContain("Balança B2");

    const attentionCustomers = body.equipment.attention.map(
      (a: { customerName: string }) => a.customerName,
    );
    expect(attentionCustomers).toEqual(["Customer A"]);
  });

  // =========================================================================
  // REQ-PORTAL-002: unauthenticated (portal getSession null) -> 401 via the
  // real requirePortalAuth.
  // =========================================================================
  it("REQ-PORTAL-002: unauthenticated portal request -> 401", async () => {
    logoutPortal();
    const res = await portalRouter.request("/overview", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // Happy path: the portal user's own data returns the expected shape + values.
  // =========================================================================
  it("returns the portal user's own overview with the expected shape", async () => {
    const assetTypeId = await ensureAssetType();

    const ctx = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });

    await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      name: "Balança A",
      tag: "EQ-A1",
      nextCalibrationDate: inDays(10),
    });
    await seedRequest({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      clientOrgId: ctx.clientOrgId,
      submittedBy: ctx.portalUserId,
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRouter.request("/overview", {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Shape: the four top-level sections the portal cockpit reads.
    expect(body).toHaveProperty("equipment");
    expect(body).toHaveProperty("certificates");
    expect(body).toHaveProperty("requests");
    expect(body).toHaveProperty("serviceOrders");

    // Values for the seeded customer: one due-soon asset, one open request.
    expect(body.equipment.total).toBe(1);
    expect(body.equipment.dueSoon).toBe(1);
    expect(body.equipment.attention).toHaveLength(1);
    expect(body.equipment.attention[0]).toMatchObject({
      name: "Balança A",
      tag: "EQ-A1",
      customerName: "Customer A",
    });
    expect(body.requests.total).toBe(1);
    expect(body.requests.open).toBe(1);
  });
});
