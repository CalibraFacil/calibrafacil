import { beforeEach, describe, expect, it } from "vitest";
import { serviceOrdersRouter } from "./service-orders";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  organizationUnit,
  serviceOrder,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the serviceOrdersRouter.
// Only the better-auth session is mocked (see test/integration/setup.ts);
// withLabPermission → requireLabAuth → requireOrganization → requireOrgType →
// requirePermission and the unit-scope resolver run for real against the seeded
// Postgres. This proves what the vi.mock(db) tier cannot: tenant isolation
// enforced by the handler's WHERE clause.
//
// RBAC surface (lab router only — portal/public routers are distinct Hono apps):
//   - GET /  and  GET /:id       → withLabPermission({ service_order: ["read"] })
//       member/operator/technician/admin all have service_order:read → 200.
//   - POST /                     → withLabPermission({ service_order: ["create"] })
//       member and admin both have service_order:create → 201 when asset valid.
//   - POST /:id/cancel           → withLabPermission({ service_order: ["cancel"] })
//       member  lacks service_order:cancel → 403.
//       admin   has  service_order:cancel  → 200.
//   - POST /:id/assign-technician → withLabPermission({ service_order: ["assign_technician"] })
//       operator lacks service_order:assign_technician → 403.
//       admin    has  service_order:assign_technician  → 200.
//
// Proven properties:
//   REQ-SO-001  GET / returns ONLY the authed org's service orders — two orgs, exact count
//   REQ-SO-002  Cross-tenant GET /:id (numeric id) → 404, no data leak
//   REQ-SO-003  POST /:id/cancel as member → 403 (service_order:cancel absent)
//   REQ-SO-004  POST /:id/cancel as admin  → 200, persists "canceled" state
//   REQ-SO-005  Unit-scope: service orders in unit-B are hidden from a unit-A–scoped member
//   REQ-SO-006  POST /:id/assign-technician as operator → 403 (service_order:assign_technician absent)
//   REQ-SO-007  POST / (create) as admin → 201, returned OS belongs to calling org
//   REQ-SO-008  Unauthenticated → 401

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline for self-containment; never touch shared files.
// ---------------------------------------------------------------------------

/** Seed a CLIENT org (required as customer.authOrganizationId FK). */
async function seedClientOrg(clientOrgId: string): Promise<void> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client Org ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: now,
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/**
 * Seed a customer owned by a LAB org. Returns the customer.id.
 * clientOrgId must be unique per call site within a test; truncateAll wipes
 * everything between tests so deterministic ids are fine.
 */
async function seedCustomer(params: {
  labOrganizationId: string;
  clientOrgId: string;
  name?: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: params.name ?? `Customer of ${params.labOrganizationId}`,
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
  name?: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: params.name ?? "Test Asset",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      subjectToLegalMetrology: false,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/**
 * Seed a minimal service order directly via Drizzle (bypassing the full
 * createInitialServiceOrderRecords workflow). Used for read / mutation tests
 * where we only need the row to exist, not the full workflow to have run.
 * Returns the created service order id.
 */
async function seedServiceOrder(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  openedByUserId: string;
  serviceOrderNumber?: string;
  status?: typeof serviceOrder.$inferInsert["status"];
}): Promise<number> {
  const [row] = await db
    .insert(serviceOrder)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      openedByUserId: params.openedByUserId,
      serviceOrderNumber:
        params.serviceOrderNumber ??
        `OS-${params.organizationId}-${Date.now()}`,
      status: params.status ?? "awaiting_tech_evaluation",
      claimedDefect: "Test defect",
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

describe("serviceOrdersRouter — real DB + real RBAC middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ==========================================================================
  // REQ-SO-001: GET / returns ONLY the authed org's service orders
  // ==========================================================================
  it(
    "REQ-SO-001: GET / returns only the authenticated org's service orders — exact count, no cross-tenant leak",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const typeId = await seedAssetType("type-so-001");

      const custA = await seedCustomer({
        labOrganizationId: orgA.orgId,
        clientOrgId: "client-a-001",
        name: "Customer Alpha",
      });
      const custB = await seedCustomer({
        labOrganizationId: orgB.orgId,
        clientOrgId: "client-b-001",
        name: "Customer Beta",
      });

      const assetA = await seedAsset({
        unitId: orgA.unitId,
        customerId: custA,
        assetTypeId: typeId,
        tag: "TAG-A-001",
        name: "Asset Alpha",
      });
      const assetB = await seedAsset({
        unitId: orgB.unitId,
        customerId: custB,
        assetTypeId: typeId,
        tag: "TAG-B-001",
        name: "Asset Beta",
      });

      // 2 orders for org A, 1 for org B
      await seedServiceOrder({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        assetId: assetA,
        openedByUserId: orgA.userId,
        serviceOrderNumber: "OS-A-0001",
      });
      await seedServiceOrder({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        assetId: assetA,
        openedByUserId: orgA.userId,
        serviceOrderNumber: "OS-A-0002",
      });
      await seedServiceOrder({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        assetId: assetB,
        openedByUserId: orgB.userId,
        serviceOrderNumber: "OS-B-0001",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await serviceOrdersRouter.request("/", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // Exactly 2 orders (org A's), not 3
      expect(body.pagination.total).toBe(2);
      expect(body.data).toHaveLength(2);
      // All returned records belong to org A's customer
      const customerNames = body.data.map(
        (so: { customerName: string }) => so.customerName,
      );
      expect(customerNames.every((n: string) => n === "Customer Alpha")).toBe(
        true,
      );
    },
  );

  // ==========================================================================
  // REQ-SO-002: Cross-tenant GET /:id — no data leak
  // ==========================================================================
  it(
    "REQ-SO-002: GET /:id of another org's service order → 404, no data returned",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const typeId = await seedAssetType("type-so-002");
      const custB = await seedCustomer({
        labOrganizationId: orgB.orgId,
        clientOrgId: "client-b-002",
        name: "Secret Customer B",
      });
      const assetB = await seedAsset({
        unitId: orgB.unitId,
        customerId: custB,
        assetTypeId: typeId,
        tag: "TAG-B-002",
      });
      const orderBId = await seedServiceOrder({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        assetId: assetB,
        openedByUserId: orgB.userId,
        serviceOrderNumber: "OS-B-002",
      });

      // Org A tries to read org B's service order by numeric id
      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await serviceOrdersRouter.request(`/${orderBId}`, {
        headers: JSON_HEADERS,
      });

      // getServiceOrderDetail scopes by organizationId → null → 404
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).not.toHaveProperty("customerName");
      expect(body).not.toHaveProperty("customerId");
      expect(body).not.toHaveProperty("data");
    },
  );

  // ==========================================================================
  // REQ-SO-003: POST /:id/cancel as member → 403
  // ==========================================================================
  it(
    "REQ-SO-003: POST /:id/cancel as member → 403 (service_order:cancel absent for member role)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      const typeId = await seedAssetType("type-so-003");
      const cust = await seedCustomer({
        labOrganizationId: org.orgId,
        clientOrgId: "client-a-003",
      });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cust,
        assetTypeId: typeId,
        tag: "TAG-003",
      });
      const orderId = await seedServiceOrder({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-003",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await serviceOrdersRouter.request(`/${orderId}/cancel`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Should be blocked by RBAC" }),
      });

      expect(res.status).toBe(403);

      // Verify the order was NOT cancelled in the DB
      const [row] = await db
        .select({ status: serviceOrder.status })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      expect(row?.status).toBe("awaiting_tech_evaluation");
    },
  );

  // ==========================================================================
  // REQ-SO-004: POST /:id/cancel as admin → 200, persists "canceled"
  // ==========================================================================
  it(
    "REQ-SO-004: POST /:id/cancel as admin → 200, service order persists as canceled, org-scoped",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-so-004");
      const cust = await seedCustomer({
        labOrganizationId: org.orgId,
        clientOrgId: "client-a-004",
      });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cust,
        assetTypeId: typeId,
        tag: "TAG-004",
      });
      const orderId = await seedServiceOrder({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-004",
        status: "awaiting_tech_evaluation",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await serviceOrdersRouter.request(`/${orderId}/cancel`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Client withdrew request" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe("canceled");
      expect(body.data.cancelReason).toBe("Client withdrew request");
      // Org-scope: the returned record belongs to the calling org
      expect(body.data.organizationId).toBe(org.orgId);

      // Verify persisted to DB
      const [row] = await db
        .select({
          status: serviceOrder.status,
          cancelReason: serviceOrder.cancelReason,
          organizationId: serviceOrder.organizationId,
        })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      expect(row?.status).toBe("canceled");
      expect(row?.cancelReason).toBe("Client withdrew request");
      expect(row?.organizationId).toBe(org.orgId);
    },
  );

  // ==========================================================================
  // REQ-SO-005: Unit-scope — service orders in another unit are hidden
  // ==========================================================================
  it(
    "REQ-SO-005: GET / with unit scope — service orders in another unit within the same org are excluded",
    async () => {
      // Seed ONE org with TWO units. Authenticate as a user whose active unit
      // is unit-A and confirm unit-B orders are invisible.
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });

      // Create a second unit in the same org
      const [unitB] = await db
        .insert(organizationUnit)
        .values({
          organizationId: orgA.orgId,
          name: "Unit B",
          slug: "unit-b",
          status: "ACTIVE",
          isDefault: false,
          createdBy: orgA.userId,
        })
        .returning({ id: organizationUnit.id });
      if (!unitB) throw new Error("unit-B insert failed");

      const typeId = await seedAssetType("type-so-005");
      const custA = await seedCustomer({
        labOrganizationId: orgA.orgId,
        clientOrgId: "client-a-005",
        name: "Customer A",
      });

      const assetUnitA = await seedAsset({
        unitId: orgA.unitId,
        customerId: custA,
        assetTypeId: typeId,
        tag: "TAG-005-A",
      });
      const assetUnitB = await seedAsset({
        unitId: unitB.id,
        customerId: custA,
        assetTypeId: typeId,
        tag: "TAG-005-B",
      });

      // One order per unit
      await seedServiceOrder({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        assetId: assetUnitA,
        openedByUserId: orgA.userId,
        serviceOrderNumber: "OS-UNIT-A",
      });
      await seedServiceOrder({
        organizationId: orgA.orgId,
        unitId: unitB.id,
        customerId: custA,
        assetId: assetUnitB,
        openedByUserId: orgA.userId,
        serviceOrderNumber: "OS-UNIT-B",
      });

      // Authenticate as org-a admin, scoped to unit-A only
      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await serviceOrdersRouter.request("/", {
        headers: {
          ...JSON_HEADERS,
          "x-active-unit-id": String(orgA.unitId),
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // Only unit-A's order should appear
      expect(body.pagination.total).toBe(1);
      expect(body.data).toHaveLength(1);
      const numbers = body.data.map(
        (so: { serviceOrderNumber: string }) => so.serviceOrderNumber,
      );
      expect(numbers).toContain("OS-UNIT-A");
      expect(numbers).not.toContain("OS-UNIT-B");
    },
  );

  // ==========================================================================
  // REQ-SO-006: POST /:id/assign-technician as operator → 403
  // ==========================================================================
  it(
    "REQ-SO-006: POST /:id/assign-technician as operator → 403 (service_order:assign_technician absent for operator role)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "operator" });
      const typeId = await seedAssetType("type-so-006");
      const cust = await seedCustomer({
        labOrganizationId: org.orgId,
        clientOrgId: "client-a-006",
      });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cust,
        assetTypeId: typeId,
        tag: "TAG-006",
      });
      const orderId = await seedServiceOrder({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-006",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await serviceOrdersRouter.request(
        `/${orderId}/assign-technician`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ technicianId: org.userId }),
        },
      );

      expect(res.status).toBe(403);

      // Verify technician was NOT assigned
      const [row] = await db
        .select({
          responsibleTechnicianId: serviceOrder.responsibleTechnicianId,
        })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      expect(row?.responsibleTechnicianId).toBeNull();
    },
  );

  // ==========================================================================
  // REQ-SO-007: POST / (create) as admin → 201, org-scoped
  // ==========================================================================
  it(
    "REQ-SO-007: POST / (create) as admin → 201, returned service order belongs to calling org",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-so-007");
      const custId = await seedCustomer({
        labOrganizationId: org.orgId,
        clientOrgId: "client-a-007",
        name: "Customer Create Test",
      });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: custId,
        assetTypeId: typeId,
        tag: "TAG-007",
        name: "Create Test Asset",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await serviceOrdersRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          customerId: custId,
          assetId,
          intakeType: "counter",
          priority: "normal",
          claimedDefect: "Equipment not turning on",
          intakeCondition: "Physical damage on casing",
          deliveryMethod: "pickup_at_lab",
          evaluationFeeCents: 0,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data).toBeDefined();
      // The returned order must be scoped to the calling org
      expect(body.data.organizationId).toBe(org.orgId);
      expect(body.data.unitId).toBe(org.unitId);
      expect(body.data.customerId).toBe(custId);
      expect(body.data.assetId).toBe(assetId);

      // Verify persisted in DB with correct org scope
      const [row] = await db
        .select({ organizationId: serviceOrder.organizationId })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, body.data.id));
      expect(row?.organizationId).toBe(org.orgId);
    },
  );

  // ==========================================================================
  // REQ-SO-008: Unauthenticated → 401
  // ==========================================================================
  it("REQ-SO-008: unauthenticated request → 401", async () => {
    logout();
    const res = await serviceOrdersRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });
});
