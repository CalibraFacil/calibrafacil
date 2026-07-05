import { beforeEach, describe, expect, it } from "vitest";
import { customersRouter } from "./customers";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetType,
  customer,
  customerAuditLog,
  organization,
} from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
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

/** Seed an asset owned by a customer (unit-scoped to the lab). Returns asset id. */
async function seedAsset(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: `Instrumento ${params.tag}`,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/** Seed an asset_type (blueprint). Returns asset_type id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: `AT ${slug}`, slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
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

  // =========================================================================
  // REQ-CMP-AUD-001 (#649): the deletion audit row must SURVIVE the deletion
  // it documents (ISO/IEC 17025 append-only trail). Before the fix the
  // customer_id FK cascaded and the row self-deleted.
  // =========================================================================
  it(
    "REQ-CMP-AUD-001: DELETE /:id keeps the 'delete' audit row after the customer is gone",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const seeded = await seedCustomer({
        labOrgId: orgA.orgId,
        clientOrgId: "client-aud",
        name: "Cliente Auditável",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await customersRouter.request(`/${seeded.customerId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      expect(res.status).toBe(200);

      // The customer row is gone…
      const remaining = await db
        .select()
        .from(customer)
        .where(eq(customer.id, seeded.customerId));
      expect(remaining).toHaveLength(0);

      // …but the deletion's audit row persists, with enough data to be useful
      // without the original row (REQ-CMP-AUD-003: id + name + actor + timestamp).
      const logs = await db
        .select()
        .from(customerAuditLog)
        .where(
          and(
            eq(customerAuditLog.customerId, seeded.customerId),
            eq(customerAuditLog.action, "delete"),
          ),
        );
      expect(logs).toHaveLength(1);
      expect(logs[0]?.performedBy).toBe(orgA.userId);
      expect(logs[0]?.performedAt).toBeInstanceOf(Date);
      expect(logs[0]?.changes).toMatchObject({
        customer: { old: { name: "Cliente Auditável" }, new: null },
      });
    },
  );

  // =========================================================================
  // REQ-CMP-AUD-010a [HIGH RISK] (#692 / CMP-07): deleting a customer cascades
  // its assets (asset.customer_id → customer, intentional). The asset audit
  // trail must SURVIVE that cascade — the append-only ISO/IEC 17025 trail must
  // keep both the pre-existing history AND a fresh 'delete' row per asset.
  //
  // Before the fix: (1) the route wrote NO 'delete' audit row for the cascaded
  // assets, and (2) asset_audit_log.asset_id → asset ON DELETE CASCADE erased
  // the pre-existing rows too, so the deletion left no trace.
  // =========================================================================
  it(
    "REQ-CMP-AUD-010a: DELETE /:id keeps each asset's audit trail (+ fresh 'delete' row) after the cascade",
    async () => {
      const org = await seedOrg({ orgId: "org-aud-asset", role: "admin" });
      const { customerId } = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: "client-aud-asset",
        name: "Cliente com Ativos",
      });

      const assetTypeId = await seedAssetType("balanca-aud");
      const assetA = await seedAsset({
        unitId: org.unitId,
        customerId,
        assetTypeId,
        tag: "AUD-A",
      });
      const assetB = await seedAsset({
        unitId: org.unitId,
        customerId,
        assetTypeId,
        tag: "AUD-B",
      });

      // Pre-existing history for each asset (would be cascade-erased today).
      await db.insert(assetAuditLog).values([
        {
          assetId: assetA,
          action: "create",
          changes: { asset: { old: null, new: { tag: "AUD-A" } } },
          performedBy: org.userId,
        },
        {
          assetId: assetB,
          action: "create",
          changes: { asset: { old: null, new: { tag: "AUD-B" } } },
          performedBy: org.userId,
        },
      ]);

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await customersRouter.request(`/${customerId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      expect(res.status).toBe(200);

      // The customer and its cascaded assets are gone…
      const remainingCustomer = await db
        .select()
        .from(customer)
        .where(eq(customer.id, customerId));
      expect(remainingCustomer).toHaveLength(0);
      const remainingAssets = await db
        .select()
        .from(asset)
        .where(inArray(asset.id, [assetA, assetB]));
      expect(remainingAssets).toHaveLength(0);

      // …but each asset's audit trail SURVIVES: the pre-existing 'create' row
      // AND a fresh 'delete' row inserted by the route before the cascade.
      for (const assetId of [assetA, assetB]) {
        const logs = await db
          .select()
          .from(assetAuditLog)
          .where(eq(assetAuditLog.assetId, assetId));
        const actions = logs.map((l) => l.action).toSorted();
        expect(actions).toEqual(["create", "delete"]);

        const deleteRow = logs.find((l) => l.action === "delete");
        expect(deleteRow?.performedBy).toBe(org.userId);
        expect(deleteRow?.performedAt).toBeInstanceOf(Date);
        // The 'delete' row captures the full pre-delete asset row (old) → null.
        expect(deleteRow?.changes).toMatchObject({
          asset: { old: { id: assetId }, new: null },
        });
      }
    },
  );
});
