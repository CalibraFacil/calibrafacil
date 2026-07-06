/**
 * service-orders-sec08.int.spec.ts — SEC-08 defense-in-depth tenant-scoping for
 * the final UPDATE in `updateServiceOrder` (PATCH /service-orders/:id).
 *
 * Context: the module resolved + guarded the target OS with an org/unit-scoped
 * SELECT, then issued the UPDATE with `WHERE id = X` only. SEC-08 repeats the
 * tenant predicate (organizationId + unit scope) in the UPDATE's own WHERE so the
 * write stays tenant-scoped even if a future refactor drops the guarding read.
 * This is a resilience change with NO observable behavior delta for legitimate
 * same-org callers — the guarding SELECT already 404s a cross-tenant PATCH today.
 *
 * Real DB + real RBAC; only the better-auth session is mocked (test/integration/
 * setup.ts). requireLabAuth → requireOrganization → requireOrgType("LAB") →
 * withLabPermission({ service_order: ["update"] }) all run for real.
 *
 *   REQ-SEC-UPD-002  Same-org PATCH still updates the OS (no regression): the added
 *                    org/unit predicate does NOT exclude a legitimate same-org row.
 *   REQ-SEC-UPD-001  Cross-tenant PATCH → 404 AND org B's OS is byte-unchanged
 *                    (the tenant-scoped UPDATE never touches another org's row).
 *
 * NOTE (test-first): this sweep is "não explorável hoje" — the guarding SELECT
 * already short-circuits a cross-tenant PATCH before the UPDATE, so no assertion
 * can be made RED against today's code without first deleting that SELECT. These
 * specs therefore lock the contract green: REQ-SEC-UPD-002 proves no regression,
 * and REQ-SEC-UPD-001 pins the tenant-isolation end-state that the now-scoped
 * UPDATE preserves even under the future "SELECT removed" refactor.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { serviceOrdersRouter } from "./service-orders";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  serviceOrder,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline for self-containment; never touch shared files.
// ---------------------------------------------------------------------------

/** Seed a CLIENT org (required as customer.authOrganizationId FK). */
async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client Org ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/** Seed a customer owned by a LAB org. Returns the customer.id. */
async function seedCustomer(params: {
  labOrganizationId: string;
  clientOrgId: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: `Customer of ${params.labOrganizationId}`,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrganizationId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/** Seed an asset type with no required spec fields. Returns the id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: "Test Instrument", slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/** Seed an asset scoped to a unit + customer. Returns the asset id. */
async function seedAsset(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      // #638b made lab_organization_id NOT NULL — derive it from the owning customer.
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: "Test Asset",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/** Seed a minimal service order row. Returns the created service order id. */
async function seedServiceOrder(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  openedByUserId: string;
  serviceOrderNumber: string;
  claimedDefect: string;
}): Promise<number> {
  const [row] = await db
    .insert(serviceOrder)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      openedByUserId: params.openedByUserId,
      serviceOrderNumber: params.serviceOrderNumber,
      status: "awaiting_quote_approval",
      claimedDefect: params.claimedDefect,
      intakeCondition: "Test condition",
      intakeType: "counter",
      deliveryMethod: "pickup_at_lab",
      priority: "normal",
      totalQuotedCents: 0,
      totalApprovedCents: 0,
      evaluationFeeCents: 0,
      evaluationFeeApplied: false,
      isExternalService: false,
    })
    .returning({ id: serviceOrder.id });
  if (!row) throw new Error("seedServiceOrder: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("serviceOrdersRouter PATCH /:id — SEC-08 tenant-scoped UPDATE (real DB + real RBAC)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // REQ-SEC-UPD-002 — no regression for the legitimate same-org caller
  // -------------------------------------------------------------------------
  it("REQ-SEC-UPD-002: same-org PATCH updates the OS (org/unit predicate does not exclude the legit row)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const typeId = await seedAssetType("type-sec08-002");
    const custA = await seedCustomer({
      labOrganizationId: orgA.orgId,
      clientOrgId: "client-a-sec08-002",
    });
    const assetA = await seedAsset({
      unitId: orgA.unitId,
      customerId: custA,
      assetTypeId: typeId,
      tag: "TAG-A-SEC08-002",
    });
    const orderA = await seedServiceOrder({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      customerId: custA,
      assetId: assetA,
      openedByUserId: orgA.userId,
      serviceOrderNumber: "OS-A-SEC08-002",
      claimedDefect: "Defeito informado original",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await serviceOrdersRouter.request(`/${orderA}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ claimedDefect: "Defeito atualizado pelo lab" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.claimedDefect).toBe("Defeito atualizado pelo lab");

    // DB-verify: the row was actually mutated by the scoped UPDATE.
    const [row] = await db
      .select({ claimedDefect: serviceOrder.claimedDefect })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, orderA));
    expect(row?.claimedDefect).toBe("Defeito atualizado pelo lab");
  });

  // -------------------------------------------------------------------------
  // REQ-SEC-UPD-001 — cross-tenant PATCH → 404 and org B's OS is byte-unchanged
  // -------------------------------------------------------------------------
  it("REQ-SEC-UPD-001: org A PATCH on org B's OS → 404, org B's OS claimedDefect unchanged (DB-verified)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    const typeId = await seedAssetType("type-sec08-001");
    const custB = await seedCustomer({
      labOrganizationId: orgB.orgId,
      clientOrgId: "client-b-sec08-001",
    });
    const assetB = await seedAsset({
      unitId: orgB.unitId,
      customerId: custB,
      assetTypeId: typeId,
      tag: "TAG-B-SEC08-001",
    });
    const orderB = await seedServiceOrder({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      customerId: custB,
      assetId: assetB,
      openedByUserId: orgB.userId,
      serviceOrderNumber: "OS-B-SEC08-001",
      claimedDefect: "Defeito da org B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await serviceOrdersRouter.request(`/${orderB}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ claimedDefect: "tentativa cross-tenant" }),
    });

    expect(res.status).toBe(404);

    // DB-verify: org B's OS is byte-unchanged — a silent mutation that still
    // 404'd would fail this too.
    const [row] = await db
      .select({ claimedDefect: serviceOrder.claimedDefect })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, orderB));
    expect(row?.claimedDefect).toBe("Defeito da org B");
  });
});
