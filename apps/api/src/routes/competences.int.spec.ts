import { beforeEach, describe, expect, it } from "vitest";
import { competencesRouter } from "./competences";
import { db } from "@calibra-facil/db";
import {
  personnelCompetence,
  personnelCompetenceAuditLog,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the competences router.
// Only the better-auth session is mocked (see test/integration/setup.ts).
// requireLabAuth → requireOrganization → requireOrgType("LAB") → requirePermission
// all run for real against a seeded Postgres. This proves tenant isolation enforced
// by the WHERE clause on organizationId, and RBAC enforced by role permission checks.
//
// RBAC summary for competences:
//   competence:read   → member, operator, technician, admin, owner
//   competence:create → technician, admin, owner
//   competence:update → admin, owner
//   competence:delete → admin, owner
//   competence:evaluate → admin, owner

const JSON_HEADERS = { "content-type": "application/json" } as const;

// ---------------------------------------------------------------------------
// Inline domain seed helper — NOT added to the shared seed.ts
// ---------------------------------------------------------------------------

/** Seed a personnel_competence row scoped to an org. Returns the created id. */
async function seedCompetence(params: {
  organizationId: string;
  userId: string;
  requestedBy: string;
  createdBy: string;
  scopeDescription?: string;
  status?: string;
}): Promise<number> {
  const [row] = await db
    .insert(personnelCompetence)
    .values({
      organizationId: params.organizationId,
      userId: params.userId,
      requestedBy: params.requestedBy,
      createdBy: params.createdBy,
      scopeDescription: params.scopeDescription ?? "Calibração de manômetros",
      status: "REQUESTED",
    })
    .returning({ id: personnelCompetence.id });
  if (!row) throw new Error("seedCompetence: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("competencesRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-COMP-001 — tenant isolation on GET /
  it("GET / returns only the authenticated org's competences (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedCompetence({
      organizationId: orgA.orgId,
      userId: orgA.userId,
      requestedBy: orgA.userId,
      createdBy: orgA.userId,
      scopeDescription: "Competence A",
    });
    await seedCompetence({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      requestedBy: orgB.userId,
      createdBy: orgB.userId,
      scopeDescription: "Competence B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await competencesRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const descriptions = body.data.map(
      (c: { scopeDescription: string }) => c.scopeDescription,
    );
    expect(descriptions).toContain("Competence A");
    expect(descriptions).not.toContain("Competence B");
    expect(body.pagination.total).toBe(1);
  });

  // REQ-COMP-002 — cross-tenant read on GET /:id returns 404, no data leak
  it("GET /:id of another org's competence returns 404 (no cross-tenant read)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const bCompId = await seedCompetence({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      requestedBy: orgB.userId,
      createdBy: orgB.userId,
      scopeDescription: "Org B secret scope",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await competencesRouter.request(`/${bCompId}`, {
      headers: JSON_HEADERS,
    });

    // The WHERE clause includes organizationId = orgA → no row found → 404
    expect(res.status).toBe(404);
    const body = await res.json();
    // Must NOT expose Org B's data in the error body
    expect(body).not.toHaveProperty("scopeDescription");
    expect(JSON.stringify(body)).not.toContain("Org B secret scope");
  });

  // REQ-COMP-003 — POST / as member → 403 (competence:create denied)
  it("POST / as role=member -> 403 (RBAC: competence:create denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await competencesRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        userId: org.userId,
        scopeDescription: "Should be blocked",
      }),
    });

    expect(res.status).toBe(403);
  });

  // REQ-COMP-004 — POST / as operator → 403 (competence:create denied for operator)
  it("POST / as role=operator -> 403 (RBAC: competence:create denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await competencesRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        userId: org.userId,
        scopeDescription: "Should be blocked",
      }),
    });

    expect(res.status).toBe(403);
  });

  // REQ-COMP-005 — POST / as admin → 201, persisted with correct org, audit log written
  it("POST / as admin -> 201, persists competence scoped to the correct org + audit log", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await competencesRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        userId: org.userId,
        scopeDescription: "Calibração de balanças classe III",
      }),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.organizationId).toBe(org.orgId);
    expect(created.userId).toBe(org.userId);
    expect(created.scopeDescription).toBe("Calibração de balanças classe III");
    expect(created.status).toBe("REQUESTED");

    // Audit log must be written
    const audit = await db
      .select()
      .from(personnelCompetenceAuditLog)
      .where(
        and(
          eq(personnelCompetenceAuditLog.competenceId, created.id),
          eq(personnelCompetenceAuditLog.action, "create"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.performedBy).toBe(org.userId);
  });

  // REQ-COMP-006 — POST / as technician → 201 (technician has competence:create)
  it("POST / as role=technician -> 201 (technician has competence:create)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "technician" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await competencesRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        userId: org.userId,
        scopeDescription: "Calibração de termômetros",
      }),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.organizationId).toBe(org.orgId);
  });

  // REQ-COMP-007 — PUT /:id as technician → 403 (competence:update denied for technician)
  it("PUT /:id as role=technician -> 403 (RBAC: competence:update denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "technician" });

    const compId = await seedCompetence({
      organizationId: org.orgId,
      userId: org.userId,
      requestedBy: org.userId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await competencesRouter.request(`/${compId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ notes: "Should be blocked" }),
    });

    expect(res.status).toBe(403);
  });

  // REQ-COMP-008 — PUT /:id as admin updates competence and writes audit log
  it("PUT /:id as admin -> 200, updates competence + audit log", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });

    const compId = await seedCompetence({
      organizationId: org.orgId,
      userId: org.userId,
      requestedBy: org.userId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await competencesRouter.request(`/${compId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        notes: "Updated notes by admin",
        scopeDescription: "Updated scope",
      }),
    });

    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.notes).toBe("Updated notes by admin");

    // Audit log entry created
    const audit = await db
      .select()
      .from(personnelCompetenceAuditLog)
      .where(
        and(
          eq(personnelCompetenceAuditLog.competenceId, compId),
          eq(personnelCompetenceAuditLog.action, "update"),
        ),
      );
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]?.performedBy).toBe(org.userId);
  });

  // REQ-COMP-009 — DELETE /:id as member → 403 (competence:delete denied)
  it("DELETE /:id as role=member -> 403 (RBAC: competence:delete denied)", async () => {
    const orgAdmin = await seedOrg({ orgId: "org-admin", role: "admin" });
    const orgMember = await seedOrg({ orgId: "org-member", role: "member" });

    // Seed a competence in the member's own org for the test
    const compId = await seedCompetence({
      organizationId: orgMember.orgId,
      userId: orgMember.userId,
      requestedBy: orgMember.userId,
      createdBy: orgMember.userId,
    });

    loginAs({ userId: orgMember.userId, organizationId: orgMember.orgId });
    const res = await competencesRouter.request(`/${compId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(403);

    // Ensure the row still exists (not deleted)
    const rows = await db
      .select({ id: personnelCompetence.id })
      .from(personnelCompetence)
      .where(eq(personnelCompetence.id, compId));
    expect(rows).toHaveLength(1);

    // Reference orgAdmin to avoid unused-variable lint
    expect(orgAdmin.orgId).toBeDefined();
  });

  // REQ-COMP-010 — DELETE /:id as admin soft-deletes the competence
  it("DELETE /:id as admin -> 200, soft-deletes the competence", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });

    const compId = await seedCompetence({
      organizationId: org.orgId,
      userId: org.userId,
      requestedBy: org.userId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await competencesRouter.request(`/${compId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBeDefined();

    // The row must have deletedAt set (soft delete), not physically removed
    const [row] = await db
      .select({ deletedAt: personnelCompetence.deletedAt })
      .from(personnelCompetence)
      .where(eq(personnelCompetence.id, compId));
    expect(row?.deletedAt).not.toBeNull();
  });

  // REQ-COMP-011 — POST /:id/evaluate as technician → 403 (competence:evaluate denied)
  it("POST /:id/evaluate as role=technician -> 403 (RBAC: competence:evaluate denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "technician" });

    // Seed competence with PENDING_EVALUATION status directly
    const [row] = await db
      .insert(personnelCompetence)
      .values({
        organizationId: org.orgId,
        userId: org.userId,
        requestedBy: org.userId,
        createdBy: org.userId,
        scopeDescription: "Test evaluate scope",
        status: "PENDING_EVALUATION",
      })
      .returning({ id: personnelCompetence.id });
    if (!row) throw new Error("Failed to seed PENDING_EVALUATION competence");
    const compId = row.id;

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await competencesRouter.request(`/${compId}/evaluate`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ passed: true }),
    });

    expect(res.status).toBe(403);
  });

  // REQ-COMP-012 — POST /:id/evaluate as admin approves competence → ACTIVE
  it("POST /:id/evaluate as admin with passed=true -> 200, competence status=ACTIVE", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });

    const [row] = await db
      .insert(personnelCompetence)
      .values({
        organizationId: org.orgId,
        userId: org.userId,
        requestedBy: org.userId,
        createdBy: org.userId,
        scopeDescription: "Evaluation scope",
        status: "PENDING_EVALUATION",
      })
      .returning({ id: personnelCompetence.id });
    if (!row) throw new Error("Failed to seed PENDING_EVALUATION competence");
    const compId = row.id;

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await competencesRouter.request(`/${compId}/evaluate`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        passed: true,
        qualifiedAt: "2026-01-01T00:00:00.000Z",
      }),
    });

    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.status).toBe("ACTIVE");
    expect(updated.evaluatedBy).toBe(org.userId);

    // Audit log entry
    const audit = await db
      .select()
      .from(personnelCompetenceAuditLog)
      .where(
        and(
          eq(personnelCompetenceAuditLog.competenceId, compId),
          eq(personnelCompetenceAuditLog.action, "approve"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  // REQ-COMP-013 — unauthenticated → 401
  it("GET / unauthenticated -> 401", async () => {
    logout();
    const res = await competencesRouter.request("/", { headers: JSON_HEADERS });
    expect(res.status).toBe(401);
  });

  // REQ-COMP-014 — GET /matrix returns only the authed org's data
  it("GET /matrix returns only the authenticated org's technicians and competences", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedCompetence({
      organizationId: orgA.orgId,
      userId: orgA.userId,
      requestedBy: orgA.userId,
      createdBy: orgA.userId,
      scopeDescription: "Matrix scope A",
    });
    await seedCompetence({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      requestedBy: orgB.userId,
      createdBy: orgB.userId,
      scopeDescription: "Matrix scope B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await competencesRouter.request("/matrix", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Technicians list must include orgA's user but not orgB's
    const techUserIds = body.technicians.map(
      (t: { userId: string }) => t.userId,
    );
    expect(techUserIds).toContain(orgA.userId);
    expect(techUserIds).not.toContain(orgB.userId);

    // Competences list must include orgA's but not orgB's
    const compOrgIds = body.competences.map(
      (c: { userId: string }) => c.userId,
    );
    expect(compOrgIds).toContain(orgA.userId);
    expect(compOrgIds).not.toContain(orgB.userId);
  });

  // REQ-COMP-015 — GET /:id/audit-log cross-tenant → 404
  it("GET /:id/audit-log of another org's competence returns 404", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const bCompId = await seedCompetence({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      requestedBy: orgB.userId,
      createdBy: orgB.userId,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await competencesRouter.request(`/${bCompId}/audit-log`, {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(404);
  });
});
