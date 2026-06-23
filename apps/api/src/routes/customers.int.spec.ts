import { beforeEach, describe, expect, it } from "vitest";
import { customersRouter } from "./customers";
import { db } from "@calibra-facil/db";
import {
  customer,
  customerAuditLog,
  organization,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test. Only the better-auth session is mocked
// (see test/integration/setup.ts); requireLabAuth -> requireOrganization ->
// requireOrgType -> requirePermission and the unit-scope resolver run for real
// against a seeded Postgres. This proves what the vi.mock(db) tier cannot:
// tenant isolation enforced by the handler's WHERE clause.

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Inline domain seed helper — NOT in shared seed.ts to keep makers conflict-free.
// ---------------------------------------------------------------------------

type SeededCustomer = { customerId: number; authOrgId: string };

/**
 * Seed a CLIENT organization + customer row owned by a given lab org.
 * The authOrganizationId is required by the FK; we insert a minimal CLIENT org
 * directly rather than calling the portal service-account machinery.
 */
async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
  name: string;
  email?: string;
}): Promise<SeededCustomer> {
  // Insert a minimal CLIENT org for the FK.
  await db.insert(organization).values({
    id: params.clientOrgId,
    name: `Client Org ${params.clientOrgId}`,
    slug: params.clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const [row] = await db
    .insert(customer)
    .values({
      name: params.name,
      email: params.email ?? null,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrgId,
    })
    .returning({ id: customer.id });

  if (!row) throw new Error("seedCustomer: insert failed");
  return { customerId: row.id, authOrgId: params.clientOrgId };
}

// ---------------------------------------------------------------------------

describe("customersRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-CUST-001: GET / returns ONLY the authenticated org's customers
  // =========================================================================
  it(
    "REQ-CUST-001: GET / returns only the authenticated org's customers (tenant isolation)",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      await seedCustomer({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a1",
        name: "Acme São Paulo",
      });
      await seedCustomer({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a2",
        name: "Acme Rio",
      });
      await seedCustomer({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Beta Industries",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await customersRouter.request("/?page=1&limit=50", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      const names = body.data.map((c: { name: string }) => c.name);
      // Org A sees both of its own customers
      expect(names).toContain("Acme São Paulo");
      expect(names).toContain("Acme Rio");
      // Org B's customer must NOT appear
      expect(names).not.toContain("Beta Industries");
      expect(body.pagination.total).toBe(2);
    },
  );

  // =========================================================================
  // REQ-CUST-002: Cross-tenant GET /:id — no data leak
  // =========================================================================
  it(
    "REQ-CUST-002: GET /:id of another org's customer is denied — no cross-tenant read",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const { customerId: bCustomerId } = await seedCustomer({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Beta Industries",
        email: "secret@beta.test",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await customersRouter.request(`/${bCustomerId}`, {
        headers: JSON_HEADERS,
      });

      // resolveCustomerRouteId scopes by labOrganizationId: org B's customer
      // is invisible to org A, resolves to null, returns 400 "ID invalido".
      // The critical security property: org B's customer data (name, email) is
      // NEVER returned across the tenant boundary.
      expect([400, 404]).toContain(res.status);
      const body = await res.json();
      // No sensitive fields of org B's record leak through
      expect(body).not.toHaveProperty("email");
      expect(body).not.toHaveProperty("name");
    },
  );

  // =========================================================================
  // REQ-CUST-003: POST / as member -> 403 (RBAC: client:create denied)
  // =========================================================================
  it(
    "REQ-CUST-003: POST / as member -> 403 (RBAC gate fires before business logic)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await customersRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Blocked Customer" }),
      });

      expect(res.status).toBe(403);
    },
  );

  // =========================================================================
  // REQ-CUST-004: PUT /:id as member -> 403 (client:update denied)
  // =========================================================================
  it(
    "REQ-CUST-004: PUT /:id as member -> 403 (insufficient role for update)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });

      const { customerId } = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: "client-a1",
        name: "Original Name",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await customersRouter.request(`/${customerId}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Should Not Update" }),
      });

      expect(res.status).toBe(403);
    },
  );

  // =========================================================================
  // REQ-CUST-005: PUT /:id as operator -> 200, persists update + audit log
  // =========================================================================
  it(
    "REQ-CUST-005: PUT /:id as operator -> 200, persists updated name + audit log entry",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "operator" });

      const { customerId } = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: "client-a1",
        name: "Original Name",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await customersRouter.request(`/${customerId}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Updated Name" }),
      });

      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.name).toBe("Updated Name");
      // Tenant-scoped: the returned record belongs to the calling org
      expect(updated.labOrganizationId).toBe(org.orgId);

      // Verify the change was persisted to the DB
      const [dbRow] = await db
        .select({ name: customer.name })
        .from(customer)
        .where(eq(customer.id, customerId));
      expect(dbRow?.name).toBe("Updated Name");

      // Audit log must record the change
      const auditEntries = await db
        .select({
          action: customerAuditLog.action,
          performedBy: customerAuditLog.performedBy,
        })
        .from(customerAuditLog)
        .where(eq(customerAuditLog.customerId, customerId));
      expect(auditEntries.length).toBeGreaterThanOrEqual(1);
      const entry = auditEntries[0];
      expect(entry?.action).toBe("update");
      expect(entry?.performedBy).toBe(org.userId);
    },
  );

  // =========================================================================
  // REQ-CUST-006: DELETE /:id as member -> 403 (client:delete denied)
  // =========================================================================
  it(
    "REQ-CUST-006: DELETE /:id as member -> 403 (insufficient role for delete)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });

      const { customerId } = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: "client-a1",
        name: "Protected Customer",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await customersRouter.request(`/${customerId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(403);
    },
  );

  // =========================================================================
  // REQ-CUST-007: DELETE /:id cross-tenant blocked; own customer succeeds
  // =========================================================================
  it(
    "REQ-CUST-007: DELETE /:id as operator — cross-tenant blocked, own customer succeeds",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "operator" });
      const orgB = await seedOrg({ orgId: "org-b", role: "operator" });

      const { customerId: ownCustomerId } = await seedCustomer({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a1",
        name: "Own Customer",
      });
      const { customerId: foreignCustomerId } = await seedCustomer({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Foreign Customer",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

      // Attempt to delete org B's customer — must be denied
      const crossRes = await customersRouter.request(`/${foreignCustomerId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      expect([400, 404]).toContain(crossRes.status);

      // Verify org B's customer still exists (not deleted)
      const [stillThere] = await db
        .select({ id: customer.id })
        .from(customer)
        .where(
          and(
            eq(customer.id, foreignCustomerId),
            eq(customer.labOrganizationId, orgB.orgId),
          ),
        );
      expect(stillThere).toBeDefined();

      // Own customer delete should succeed
      const ownRes = await customersRouter.request(`/${ownCustomerId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      expect(ownRes.status).toBe(200);

      // Verify own customer is gone from the DB
      const [gone] = await db
        .select({ id: customer.id })
        .from(customer)
        .where(eq(customer.id, ownCustomerId));
      expect(gone).toBeUndefined();
    },
  );

  // =========================================================================
  // REQ-CUST-008: GET /search returns only the authed org's matching customers
  // =========================================================================
  it(
    "REQ-CUST-008: GET /search returns only the authenticated org's matching customers",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "member" });
      const orgB = await seedOrg({ orgId: "org-b", role: "member" });

      await seedCustomer({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a1",
        name: "Shared Name Corp",
      });
      await seedCustomer({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Shared Name Corp",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

      const res = await customersRouter.request(
        "/search?query=Shared+Name&limit=10",
        { headers: JSON_HEADERS },
      );

      expect(res.status).toBe(200);
      const results = await res.json();
      // Exactly 1 result: only org A's customer (same name exists in org B but must not appear)
      expect(results).toHaveLength(1);
    },
  );

  // =========================================================================
  // REQ-CUST-009: Unauthenticated -> 401
  // =========================================================================
  it("REQ-CUST-009: unauthenticated request -> 401", async () => {
    logout();
    const res = await customersRouter.request("/?page=1&limit=50", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });
});
