import { beforeEach, describe, expect, it } from "vitest";
import { unitsRouter } from "./units";
import { db } from "@calibra-facil/db";
import {
  member,
  organizationUnit,
  memberUnitAssignment,
  subscription,
  user,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the unitsRouter.
// Only the better-auth session is mocked (see test/integration/setup.ts);
// requireLabAuth -> requireOrganization -> withLabPermission / requireLabProtected
// + requireFeature("multi_unit") + the governance-access handler-level checks all
// run for real against the seeded Postgres.
//
// Proven properties:
//  REQ-UNIT-001  GET /admin/units returns ONLY the authed org's units (tenant isolation)
//  REQ-UNIT-002  Cross-tenant access to another org's unit by id -> denied (no data leak)
//  REQ-UNIT-003  POST /admin/units as role=member -> 403 (governance gate)
//  REQ-UNIT-004  POST /admin/units as admin -> 201, persisted and org-scoped
//  REQ-UNIT-005  PATCH /admin/units/:id as admin renames a unit and persists it
//  REQ-UNIT-006  PATCH /admin/units/:id of another org's unit -> 404 (no cross-tenant write)
//  REQ-UNIT-007  Unauthenticated requests -> 401
//  REQ-UNIT-008  PUT /admin/members/:memberId/assignments as member -> 403
//  REQ-UNIT-009  PUT /admin/members/:memberId/assignments as admin -> 200, persists assignment
//  REQ-DOM-ADM-001 PATCH /admin/members/:memberId/role demoting the LAST calibration
//                  approver -> rejected (named error) + role unchanged (separation of duties)
//  REQ-DOM-ADM-002 The same PATCH is allowed when another approver remains, and the
//                  existing last-owner protection is preserved (no regression)

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Inline seed helpers (NOT modifying shared seed.ts per the task instructions)
// ---------------------------------------------------------------------------

/** Seed an ENTERPRISE subscription so requireFeature("multi_unit") passes. */
async function seedEnterpriseSubscription(organizationId: string) {
  await db.insert(subscription).values({
    organizationId,
    planId: "ENTERPRISE",
    status: "ACTIVE",
    renewalMode: "NONE",
  });
}

/** Seed a second unit in an existing org, returns its id. */
async function seedUnit(params: {
  organizationId: string;
  createdBy: string;
  name: string;
}): Promise<number> {
  const slug = params.name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const [row] = await db
    .insert(organizationUnit)
    .values({
      organizationId: params.organizationId,
      name: params.name,
      slug,
      status: "ACTIVE",
      isDefault: false,
      createdBy: params.createdBy,
    })
    .returning({ id: organizationUnit.id });

  if (!row) throw new Error("seedUnit: insert failed");
  return row.id;
}

/** Seed an additional org member (user + member row) with a given global role. */
async function seedMember(params: {
  organizationId: string;
  role: "owner" | "admin" | "technician" | "operator" | "member";
  suffix: string;
}): Promise<string> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const userId = `user-${params.organizationId}-${params.suffix}`;
  const memberId = `member-${params.organizationId}-${params.suffix}`;

  await db.insert(user).values({
    id: userId,
    name: `User ${params.suffix}`,
    email: `${params.suffix}@${params.organizationId}.test`,
  });
  await db.insert(member).values({
    id: memberId,
    organizationId: params.organizationId,
    userId,
    role: params.role,
    createdAt: now,
  });

  return memberId;
}

// ---------------------------------------------------------------------------

describe("unitsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-UNIT-001: Tenant isolation — GET /admin/units returns ONLY the authed org's units
  it("REQ-UNIT-001: GET /admin/units returns only the authenticated org's units (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedEnterpriseSubscription(orgA.orgId);
    await seedEnterpriseSubscription(orgB.orgId);

    // Seed an extra unit for org B (to ensure its presence is not leaked)
    await seedUnit({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      name: "Filial B-Extra",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await unitsRouter.request("/admin/units", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Org A's list should contain its own "Matriz" unit (seeded by seedOrg)
    const names = body.data.map((u: { name: string }) => u.name);
    expect(names).toContain("Matriz");

    // Org B's "Filial B-Extra" unit must NOT appear in org A's list
    expect(names).not.toContain("Filial B-Extra");

    // Definite count: org A has exactly 1 unit (the default "Matriz")
    expect(body.data).toHaveLength(1);
  });

  // REQ-UNIT-002: Cross-tenant — PATCH /admin/units/:id of another org's unit -> 404 (no data leak)
  it("REQ-UNIT-002: PATCH /admin/units/:id of another org's unit -> 404 (no cross-tenant write)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedEnterpriseSubscription(orgA.orgId);
    await seedEnterpriseSubscription(orgB.orgId);

    // PATCH org B's default unit (Matriz) from org A's session
    const bUnitId = orgB.unitId;

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await unitsRouter.request(`/admin/units/${bUnitId}`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
      body: JSON.stringify({ name: "Hacked Name" }),
    });

    // Handler scopes the lookup to memberData.organizationId -> 404 not found
    expect(res.status).toBe(404);

    // Verify org B's unit name was NOT changed in the DB
    const [row] = await db
      .select({ name: organizationUnit.name })
      .from(organizationUnit)
      .where(eq(organizationUnit.id, bUnitId));
    expect(row?.name).toBe("Matriz");
  });

  // REQ-UNIT-003: RBAC gate — POST /admin/units as role=member -> 403
  it("REQ-UNIT-003: POST /admin/units as role=member -> 403 (canManageOrganizationUnits denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    await seedEnterpriseSubscription(org.orgId);

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request("/admin/units", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Nova Filial" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  // REQ-UNIT-004: Authorized create — POST /admin/units as admin -> 201, org-scoped
  it("REQ-UNIT-004: POST /admin/units as admin -> 201, persists unit scoped to org", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedEnterpriseSubscription(org.orgId);

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request("/admin/units", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Filial Centro" }),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("Filial Centro");
    expect(created.organizationId).toBe(org.orgId);
    expect(created.slug).toBe("filial-centro");

    // Verify persisted in DB with correct org scope
    const [row] = await db
      .select({ name: organizationUnit.name, organizationId: organizationUnit.organizationId })
      .from(organizationUnit)
      .where(
        and(
          eq(organizationUnit.id, created.id),
          eq(organizationUnit.organizationId, org.orgId),
        ),
      );
    expect(row?.name).toBe("Filial Centro");
    expect(row?.organizationId).toBe(org.orgId);
  });

  // REQ-UNIT-005: PATCH /admin/units/:id as admin -> 200, rename persists
  it("REQ-UNIT-005: PATCH /admin/units/:id as admin -> 200, renames unit and persists", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedEnterpriseSubscription(org.orgId);

    // Use the default "Matriz" unit (seeded by seedOrg) as the target
    const targetUnitId = org.unitId;

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request(`/admin/units/${targetUnitId}`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Sede Principal" }),
    });

    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.name).toBe("Sede Principal");

    // Verify persisted in DB
    const [row] = await db
      .select({ name: organizationUnit.name })
      .from(organizationUnit)
      .where(eq(organizationUnit.id, targetUnitId));
    expect(row?.name).toBe("Sede Principal");
  });

  // REQ-UNIT-006: Cross-tenant read — GET /admin/units shows ONLY own org's units with exact count
  it("REQ-UNIT-006: GET /admin/units excludes other org units — definite count", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedEnterpriseSubscription(orgA.orgId);
    await seedEnterpriseSubscription(orgB.orgId);

    // Seed 2 extra units for org B
    await seedUnit({ organizationId: orgB.orgId, createdBy: orgB.userId, name: "Filial B1" });
    await seedUnit({ organizationId: orgB.orgId, createdBy: orgB.userId, name: "Filial B2" });

    // Seed 1 extra unit for org A
    await seedUnit({ organizationId: orgA.orgId, createdBy: orgA.userId, name: "Filial A1" });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await unitsRouter.request("/admin/units", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Org A should see exactly 2 units (Matriz + Filial A1)
    expect(body.data).toHaveLength(2);
    const names = body.data.map((u: { name: string }) => u.name);
    expect(names).toContain("Matriz");
    expect(names).toContain("Filial A1");
    // Org B's units must NOT appear
    expect(names).not.toContain("Filial B1");
    expect(names).not.toContain("Filial B2");
  });

  // REQ-UNIT-007: Unauthenticated -> 401
  it("REQ-UNIT-007: GET /admin/units unauthenticated -> 401", async () => {
    logout();
    const res = await unitsRouter.request("/admin/units", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  // REQ-UNIT-008: PUT /admin/members/:memberId/assignments as role=member -> 403
  it("REQ-UNIT-008: PUT /admin/members/:memberId/assignments as role=member -> 403 (canManageAssignments denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    await seedEnterpriseSubscription(org.orgId);

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request(
      `/admin/members/${org.memberId}/assignments`,
      {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          assignments: [{ unitId: org.unitId, role: "member" }],
        }),
      },
    );

    expect(res.status).toBe(403);
  });

  // REQ-UNIT-009: PUT /admin/members/:memberId/assignments as admin -> 200, persists assignment
  it("REQ-UNIT-009: PUT /admin/members/:memberId/assignments as admin -> 200, persists unit assignment", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedEnterpriseSubscription(org.orgId);

    // Seed a second unit and a second member (technician) to assign
    const extraUnitId = await seedUnit({
      organizationId: org.orgId,
      createdBy: org.userId,
      name: "Filial Norte",
    });

    // Seed a second user + member in the same org (technician role)
    const { db: rawDb } = await import("@calibra-facil/db");
    const { user, member } = await import("@calibra-facil/db/schema");
    const techUserId = "user-tech-org-a";
    const techMemberId = "member-tech-org-a";
    const now = new Date("2026-01-01T00:00:00.000Z");

    await rawDb.insert(user).values({
      id: techUserId,
      name: "Tech User",
      email: "tech@org-a.test",
    });
    await rawDb.insert(member).values({
      id: techMemberId,
      organizationId: org.orgId,
      userId: techUserId,
      role: "technician",
      createdAt: now,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request(
      `/admin/members/${techMemberId}/assignments`,
      {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          assignments: [{ unitId: extraUnitId, role: "technician" }],
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify the assignment was persisted in the DB
    const assignments = await db
      .select({
        unitId: memberUnitAssignment.unitId,
        role: memberUnitAssignment.role,
      })
      .from(memberUnitAssignment)
      .where(
        and(
          eq(memberUnitAssignment.memberId, techMemberId),
          eq(memberUnitAssignment.organizationId, org.orgId),
        ),
      );

    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.unitId).toBe(extraUnitId);
    expect(assignments[0]?.role).toBe("technician");
  });

  // REQ-DOM-ADM-001: demoting the ONLY calibration approver is rejected + role unchanged.
  // "Approver" is derived from the real ISO 17025 separation-of-duties matrix
  // (calibrationWorkflowPermissions.canApprove -> {admin, owner}); this org's single
  // member is a global admin, so demoting them would leave zero approvers.
  it("REQ-DOM-ADM-001: demoting the only calibration approver is rejected with a named error and the role is unchanged", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request(
      `/admin/members/${org.memberId}/role`,
      {
        method: "PATCH",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({ role: "technician" }),
      },
    );

    // Rejected with a NAMED error (the separation-of-duties invariant).
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("LAST_CALIBRATION_APPROVER");

    // The role MUST be unchanged in the DB — still an approver.
    const [row] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.id, org.memberId));
    expect(row?.role).toBe("admin");
  });

  // REQ-DOM-ADM-002: allowed when another approver (a second admin) remains.
  it("REQ-DOM-ADM-002: demoting an approver is allowed when another admin approver remains", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" }); // adminA (viewer)
    const adminBId = await seedMember({
      organizationId: org.orgId,
      role: "admin",
      suffix: "admin-b",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request(`/admin/members/${adminBId}/role`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ role: "technician" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const [row] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.id, adminBId));
    expect(row?.role).toBe("technician");
  });

  // REQ-DOM-ADM-002: owner is ALSO an approver (derived from the mapping), so
  // demoting the last admin is allowed while an owner remains.
  it("REQ-DOM-ADM-002: demoting the last admin is allowed when an owner (also an approver) remains", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "owner" }); // owner (viewer)
    const adminId = await seedMember({
      organizationId: org.orgId,
      role: "admin",
      suffix: "admin-b",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request(`/admin/members/${adminId}/role`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ role: "member" }),
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.id, adminId));
    expect(row?.role).toBe("member");
  });

  // REQ-DOM-ADM-002: the pre-existing last-owner protection stays intact.
  it("REQ-DOM-ADM-002: the existing last-owner protection is preserved (owner cannot be changed here)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "owner" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await unitsRouter.request(
      `/admin/members/${org.memberId}/role`,
      {
        method: "PATCH",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({ role: "admin" }),
      },
    );

    expect(res.status).toBe(400);
    const [row] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.id, org.memberId));
    expect(row?.role).toBe("owner");
  });
});
