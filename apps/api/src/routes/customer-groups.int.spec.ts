import { beforeEach, describe, expect, it } from "vitest";
import { customerGroupsRouter } from "./customer-groups";
import { db } from "@calibra-facil/db";
import {
  customer,
  customerAuditLog,
  customerGroup,
  organization,
  subscription,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for customer-groups (redes/grupos). Only
// the better-auth session is mocked (see test/integration/setup.ts); the real
// guard chain — requireLabAuth -> requireOrganization -> requireOrgType("LAB") ->
// requirePermission({ client: [...] }) -> requireFeature("customer_group") — runs
// against a seeded Postgres. This proves what the vi.mock(db) tier cannot: tenant
// isolation enforced by the handler's WHERE clause (labOrganizationId) + the
// permission gate.
//
// REAL CONTRACT (quoted from customer-groups.ts):
//   GET /            withLabPermission({ client: ["read"] }) + requireFeature
//                    filter: eq(customerGroup.labOrganizationId, memberData.organizationId)  (L181)
//                    -> labOrganizationId is the SOLE discriminator on the list query.
//   POST /:id/branches  withLabPermission({ client: ["update"] }) + requireFeature
//                    group lookup: eq(customerGroup.labOrganizationId, ...)  (L312-313)
//                    branch lookup: eq(customer.labOrganizationId, ...)      (L328-329)
//                    -> writes customer.groupId + a customer_audit_log row.
//   GET /:id         withLabPermission({ client: ["read"] }) — group detail + branches.
//
// SCOPING NOTE: customer_group and customer are org-scoped by labOrganizationId
// ONLY — neither table has a unitId column (schema.ts), so unit-scope isolation
// is structurally N/A for this router. groupId is the assignment target, not a
// tenant boundary. The lab requireFeature("customer_group") gate (PROFESSIONAL+)
// runs before the handler, so every authed test seeds an ACTIVE PROFESSIONAL
// subscription; without it the gate 403s before the WHERE clause is reached.

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Inline domain seed helpers — NOT in shared seed.ts to keep makers conflict-free.
// ---------------------------------------------------------------------------

/**
 * Seed an ACTIVE PROFESSIONAL subscription so requireFeature("customer_group")
 * passes. PROFESSIONAL includes customer_group; FREE (the no-subscription
 * default) does not (packages/shared/src/plans.ts).
 */
async function seedProfessionalSubscription(
  organizationId: string,
): Promise<void> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const nextYear = new Date("2027-01-01T00:00:00.000Z");
  await db.insert(subscription).values({
    organizationId,
    planId: "PROFESSIONAL",
    status: "ACTIVE",
    renewalMode: "NONE",
    currentPeriodStart: now,
    currentPeriodEnd: nextYear,
  });
}

/**
 * Seed a customer_group owned by a lab org. The group is itself a CLIENT org
 * (authOrganizationId FK) — we insert a minimal CLIENT org for the FK rather
 * than calling the portal service-account machinery (createOrganization is on
 * the better-auth instance, which the harness stubs to getSession only).
 */
async function seedGroup(params: {
  labOrgId: string;
  clientOrgId: string;
  name: string;
}): Promise<number> {
  await db.insert(organization).values({
    id: params.clientOrgId,
    name: `Group Client Org ${params.clientOrgId}`,
    slug: params.clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const [row] = await db
    .insert(customerGroup)
    .values({
      name: params.name,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrgId,
    })
    .returning({ id: customerGroup.id });

  if (!row) throw new Error("seedGroup: insert failed");
  return row.id;
}

/** Seed a branch customer owned by a lab org (its own CLIENT org for the FK). */
async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
  name: string;
}): Promise<number> {
  await db.insert(organization).values({
    id: params.clientOrgId,
    name: `Customer Client Org ${params.clientOrgId}`,
    slug: params.clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const [row] = await db
    .insert(customer)
    .values({
      name: params.name,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrgId,
    })
    .returning({ id: customer.id });

  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------

describe("customerGroupsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-CG-001 [HIGH RISK]: tenant read isolation. The GET / list query filters
  // SOLELY by eq(customerGroup.labOrganizationId, memberData.organizationId)
  // (customer-groups.ts L181) — there is no unit/group sibling predicate, so the
  // org filter is the sole discriminator. The org-B leak group is identical in
  // shape; only its labOrganizationId differs. Mutation-RED proof: neutralizing
  // that predicate to eq(customerGroup.id, customerGroup.id) makes org B's group
  // appear in org A's list, turning this assertion red.
  it("REQ-CG-001: GET / returns only the authed lab org's groups (tenant read isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedProfessionalSubscription(orgA.orgId);
    await seedProfessionalSubscription(orgB.orgId);

    await seedGroup({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a-grp",
      name: "Rede A",
    });
    // Leak row: same shape, different lab owner — labOrganizationId is the only
    // thing that should keep it out of org A's list.
    await seedGroup({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b-grp",
      name: "Rede B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await customerGroupsRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((g: { name: string }) => g.name);
    expect(names).toContain("Rede A");
    expect(names).not.toContain("Rede B");
    expect(body.data).toHaveLength(1);
  });

  // REQ-CG-002 [HIGH RISK]: RBAC on the write path. POST /:id/branches is gated by
  // withLabPermission({ client: ["update"] }) (customer-groups.ts L293). role=member
  // has client:["read"] only (packages/auth/src/access.ts member role) -> the real
  // requirePermission middleware throws 403 before the handler. Mutation-RED proof:
  // relaxing the route's required permission to { client: ["read"] } lets member
  // through, so the 403 expectation goes red.
  it("REQ-CG-002a: POST /:id/branches as role=member -> 403 (client:update denied by real guard)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    await seedProfessionalSubscription(org.orgId);
    const groupId = await seedGroup({
      labOrgId: org.orgId,
      clientOrgId: "client-a-grp",
      name: "Rede A",
    });
    const customerId = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a-branch",
      name: "Filial A",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await customerGroupsRouter.request(`/${groupId}/branches`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ customerId }),
    });

    expect(res.status).toBe(403);

    // No write leaked past the denied guard.
    const [after] = await db
      .select({ groupId: customer.groupId })
      .from(customer)
      .where(eq(customer.id, customerId));
    expect(after?.groupId).toBeNull();
  });

  // Authorized counterpart: admin has full client perms -> assignment persists.
  // This is the positive control proving the 403 above is the permission gate,
  // not an unrelated failure on the same route.
  it("REQ-CG-002b: POST /:id/branches as admin -> 200, branch persisted + audit logged", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    const groupId = await seedGroup({
      labOrgId: org.orgId,
      clientOrgId: "client-a-grp",
      name: "Rede A",
    });
    const customerId = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a-branch",
      name: "Filial A",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await customerGroupsRouter.request(`/${groupId}/branches`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ customerId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // DB-persisted: re-query the branch (not the response body).
    const [after] = await db
      .select({ groupId: customer.groupId })
      .from(customer)
      .where(eq(customer.id, customerId));
    expect(after?.groupId).toBe(groupId);

    // ISO 17025 clause 8.4 audit trail written by the handler.
    const audit = await db
      .select()
      .from(customerAuditLog)
      .where(eq(customerAuditLog.customerId, customerId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("group_assignment");
    expect(audit[0]?.performedBy).toBe(org.userId);
  });

  // REQ-CG-003 [HIGH RISK]: cross-tenant write rejection. Org A (admin, fully
  // authorized) targets a group that belongs to org B. The group lookup filters
  // eq(customerGroup.labOrganizationId, memberData.organizationId) (L312-313), so
  // the foreign group resolves to null -> 404, and no customer row is mutated.
  // The branch is org-A-owned so the branch-lookup is NOT the discriminator —
  // the group's labOrganizationId scope is the sole thing under test. Mutation-RED
  // proof: neutralizing the group-lookup org predicate to
  // eq(customerGroup.id, customerGroup.id) makes org A resolve org B's group ->
  // the branch is assigned cross-tenant -> 404 expectation + "no write" go red.
  it("REQ-CG-003: POST /:id/branches against another org's group -> 404, no cross-tenant write", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedProfessionalSubscription(orgA.orgId);
    await seedProfessionalSubscription(orgB.orgId);

    // Group owned by org B.
    const bGroupId = await seedGroup({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b-grp",
      name: "Rede B",
    });
    // Branch owned by org A.
    const aCustomerId = await seedCustomer({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a-branch",
      name: "Filial A",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await customerGroupsRouter.request(`/${bGroupId}/branches`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ customerId: aCustomerId }),
    });

    expect(res.status).toBe(404);

    // No cross-tenant write: the branch was never attached to org B's group.
    const [after] = await db
      .select({ groupId: customer.groupId })
      .from(customer)
      .where(eq(customer.id, aCustomerId));
    expect(after?.groupId).toBeNull();
    const audit = await db
      .select()
      .from(customerAuditLog)
      .where(eq(customerAuditLog.customerId, aCustomerId));
    expect(audit).toHaveLength(0);
  });

  // REQ-CG-004: unauthenticated -> 401 (requireLabAuth, before any handler/guard).
  it("REQ-CG-004: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await customerGroupsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  // happy-path: a write -> read round-trip persists through the real handlers.
  // POST /:id/branches attaches the branch; GET /:id returns the group with its
  // branch list. Proves the assignment is durably persisted and read back under
  // the same tenant scope.
  it("REQ-CG-005: POST /:id/branches then GET /:id round-trips the assigned branch", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    const groupId = await seedGroup({
      labOrgId: org.orgId,
      clientOrgId: "client-a-grp",
      name: "Rede A",
    });
    const customerId = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a-branch",
      name: "Filial Matriz",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    const assignRes = await customerGroupsRouter.request(
      `/${groupId}/branches`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ customerId }),
      },
    );
    expect(assignRes.status).toBe(200);

    const detailRes = await customerGroupsRouter.request(`/${groupId}`, {
      headers: JSON_HEADERS,
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.name).toBe("Rede A");
    const branchNames = detail.branches.map((b: { name: string }) => b.name);
    expect(branchNames).toContain("Filial Matriz");

    // Cross-check the persisted FK directly.
    const [persisted] = await db
      .select({ groupId: customer.groupId })
      .from(customer)
      .where(and(eq(customer.id, customerId), eq(customer.groupId, groupId)));
    expect(persisted?.groupId).toBe(groupId);
  });
});
