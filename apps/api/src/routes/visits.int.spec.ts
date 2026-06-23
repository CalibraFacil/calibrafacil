import { beforeEach, describe, expect, it } from "vitest";
import { visitsRouter } from "./visits";
import { db } from "@calibra-facil/db";
import {
  calibrationVisit,
  customer,
  organization,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the visits router.
// Only the better-auth session is mocked (see test/integration/setup.ts);
// withLabPermission -> requireLabAuth -> requireOrganization -> requireOrgType ->
// requirePermission and the unit-scope resolver run for real against the seeded
// Postgres. This proves what the vi.mock(db) tier cannot: tenant isolation
// enforced by the handler's WHERE clause.
//
// RBAC surface:
//   - GET / and GET /:id → withLabPermission({ request: ["read"] })
//     All lab roles (member, operator, technician, admin) have request:read.
//   - POST /:id/confirm, POST /:id/cancel, PATCH /:id, POST /:id/complete,
//     POST /:id/assign → withLabPermission({ request: ["update"] })
//     "member" role lacks request:update → 403.
//     "operator" and above have request:update → 2xx.
//
// Proven properties:
//   REQ-VISIT-001  GET / returns ONLY the authed org's visits — two orgs, exact count
//   REQ-VISIT-002  Cross-tenant GET /:id leaks no data
//   REQ-VISIT-003  POST /:id/cancel as member → 403 (RBAC gate)
//   REQ-VISIT-004  POST /:id/cancel as operator → 200, persists CANCELLED state
//   REQ-VISIT-005  POST /:id/confirm as member → 403 (RBAC gate)
//   REQ-VISIT-006  POST /:id/confirm as admin → 200, persists CONFIRMED state, org-scoped
//   REQ-VISIT-007  Unit-scope: visit in another org's unit is hidden from this org's member
//   REQ-VISIT-008  Unauthenticated → 401

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so this file stays self-contained; parallel
// makers cannot conflict with the shared seed.ts.
// ---------------------------------------------------------------------------

/** Insert a minimal CLIENT org (required for customer.authOrganizationId FK). */
async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/**
 * Seed a customer row owned by a LAB org.
 * Returns the customer.id (needed as calibration_visit.customer_id FK).
 */
async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
  name?: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);

  const [row] = await db
    .insert(customer)
    .values({
      name: params.name ?? `Customer of ${params.labOrgId}`,
      labOrganizationId: params.labOrgId,
      authOrganizationId: params.clientOrgId,
    })
    .returning({ id: customer.id });

  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/**
 * Seed a calibration_visit row scoped to an org + unit + customer.
 * status defaults to PROPOSED.  scheduledAt is required for confirm tests.
 */
async function seedVisit(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  createdBy: string;
  status?: "PROPOSED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  scheduledAt?: Date;
  technicianId?: string;
}): Promise<number> {
  const [row] = await db
    .insert(calibrationVisit)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      createdBy: params.createdBy,
      status: params.status ?? "PROPOSED",
      scheduledAt: params.scheduledAt ?? null,
      technicianId: params.technicianId ?? null,
    })
    .returning({ id: calibrationVisit.id });

  if (!row) throw new Error("seedVisit: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------

describe("visitsRouter — real DB + real RBAC middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-VISIT-001: GET / returns ONLY the authed org's visits (tenant isolation)
  // =========================================================================
  it(
    "REQ-VISIT-001: GET / returns only the authenticated org's visits — exact count, no cross-tenant leak",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const custA = await seedCustomer({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a1",
        name: "Customer Alpha",
      });
      const custB = await seedCustomer({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Customer Beta",
      });

      // Seed 2 visits for org A and 1 for org B
      await seedVisit({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        createdBy: orgA.userId,
      });
      await seedVisit({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        createdBy: orgA.userId,
      });
      await seedVisit({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        createdBy: orgB.userId,
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await visitsRouter.request("/", { headers: JSON_HEADERS });

      expect(res.status).toBe(200);
      const body = await res.json();
      // Exactly 2 visits (org A's), not 3
      expect(body.pagination.total).toBe(2);
      expect(body.data).toHaveLength(2);
      // All returned records belong to org A's customer
      const customerNames = body.data.map(
        (v: { customerName: string }) => v.customerName,
      );
      expect(
        customerNames.every((n: string) => n === "Customer Alpha"),
      ).toBe(true);
    },
  );

  // =========================================================================
  // REQ-VISIT-002: Cross-tenant GET /:id — no data leak
  // =========================================================================
  it(
    "REQ-VISIT-002: GET /:id of another org's visit → 404, no data returned",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const custB = await seedCustomer({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Secret Customer B",
      });
      const visitBId = await seedVisit({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        createdBy: orgB.userId,
      });

      // Org A tries to read org B's visit by id
      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await visitsRouter.request(`/${visitBId}`, {
        headers: JSON_HEADERS,
      });

      // getScopedVisit scopes by org+unit → null → 404; org B's data never leaks
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).not.toHaveProperty("customerId");
      expect(body).not.toHaveProperty("customerName");
    },
  );

  // =========================================================================
  // REQ-VISIT-003: POST /:id/cancel as member → 403 (insufficient role)
  // =========================================================================
  it(
    "REQ-VISIT-003: POST /:id/cancel as member → 403 (request:update absent for member role)",
    async () => {
      // "member" role has request:["read"] only — no "update"
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      const cust = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: "client-a1",
      });
      const visitId = await seedVisit({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        createdBy: org.userId,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await visitsRouter.request(`/${visitId}/cancel`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Should be blocked" }),
      });

      expect(res.status).toBe(403);

      // Verify the visit was NOT cancelled in the DB
      const [row] = await db
        .select({ status: calibrationVisit.status })
        .from(calibrationVisit)
        .where(eq(calibrationVisit.id, visitId));
      expect(row?.status).toBe("PROPOSED");
    },
  );

  // =========================================================================
  // REQ-VISIT-004: POST /:id/cancel as operator → 200, persists CANCELLED
  // =========================================================================
  it(
    "REQ-VISIT-004: POST /:id/cancel as operator → 200, visit persists as CANCELLED, org-scoped",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "operator" });
      const cust = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: "client-a1",
      });
      const visitId = await seedVisit({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        createdBy: org.userId,
        status: "PROPOSED",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await visitsRouter.request(`/${visitId}/cancel`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Client request" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("CANCELLED");
      expect(body.cancelReason).toBe("Client request");
      // Verify org scope: the returned record belongs to the calling org
      expect(body.organizationId).toBe(org.orgId);

      // Verify persisted to DB
      const [row] = await db
        .select({
          status: calibrationVisit.status,
          cancelReason: calibrationVisit.cancelReason,
        })
        .from(calibrationVisit)
        .where(eq(calibrationVisit.id, visitId));
      expect(row?.status).toBe("CANCELLED");
      expect(row?.cancelReason).toBe("Client request");
    },
  );

  // =========================================================================
  // REQ-VISIT-005: POST /:id/confirm as member → 403
  // =========================================================================
  it(
    "REQ-VISIT-005: POST /:id/confirm as member → 403 (request:update absent)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      const cust = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: "client-a1",
      });
      const visitId = await seedVisit({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        createdBy: org.userId,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await visitsRouter.request(`/${visitId}/confirm`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          scheduledAt: "2026-07-01T09:00:00.000Z",
          technicianId: org.userId,
        }),
      });

      expect(res.status).toBe(403);
    },
  );

  // =========================================================================
  // REQ-VISIT-006: POST /:id/confirm as admin → 200, persists CONFIRMED, org-scoped
  // =========================================================================
  it(
    "REQ-VISIT-006: POST /:id/confirm as admin → 200, visit persists as CONFIRMED with org scope",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const cust = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: "client-a1",
      });
      const visitId = await seedVisit({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        createdBy: org.userId,
        status: "PROPOSED",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await visitsRouter.request(`/${visitId}/confirm`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          scheduledAt: "2026-08-15T10:00:00.000Z",
          technicianId: org.userId,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("CONFIRMED");
      expect(body.technicianId).toBe(org.userId);
      expect(body.organizationId).toBe(org.orgId);
      expect(body.unitId).toBe(org.unitId);

      // Verify persisted to DB
      const [row] = await db
        .select({
          status: calibrationVisit.status,
          technicianId: calibrationVisit.technicianId,
          organizationId: calibrationVisit.organizationId,
        })
        .from(calibrationVisit)
        .where(eq(calibrationVisit.id, visitId));
      expect(row?.status).toBe("CONFIRMED");
      expect(row?.technicianId).toBe(org.userId);
      expect(row?.organizationId).toBe(org.orgId);
    },
  );

  // =========================================================================
  // REQ-VISIT-007: Unit-scope filtering — visit in another org's unit is hidden
  // =========================================================================
  it(
    "REQ-VISIT-007: GET / with unit scope — visits belonging to another org's unit are excluded",
    async () => {
      // Two separate orgs each with their own default unit. An admin scoped to
      // org A should see only its unit's visits, not org B's.
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const custA = await seedCustomer({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a1",
        name: "Customer Alpha",
      });
      const custB = await seedCustomer({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Customer Beta",
      });

      // One visit per org, each in their own unit
      await seedVisit({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        createdBy: orgA.userId,
      });
      await seedVisit({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        createdBy: orgB.userId,
      });

      // Authenticate as org A, scoped to org A's unit
      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await visitsRouter.request("/", {
        headers: {
          ...JSON_HEADERS,
          "x-active-unit-id": String(orgA.unitId),
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // Only 1 visit (orgA's), org B's visit is excluded
      expect(body.pagination.total).toBe(1);
      expect(body.data).toHaveLength(1);
      const customerNames = body.data.map(
        (v: { customerName: string }) => v.customerName,
      );
      expect(customerNames).toContain("Customer Alpha");
      expect(customerNames).not.toContain("Customer Beta");
    },
  );

  // =========================================================================
  // REQ-VISIT-008: Unauthenticated → 401
  // =========================================================================
  it("REQ-VISIT-008: unauthenticated request → 401", async () => {
    logout();
    const res = await visitsRouter.request("/", { headers: JSON_HEADERS });
    expect(res.status).toBe(401);
  });
});
