import { beforeEach, describe, expect, it } from "vitest";
import { trainingRecordsRouter } from "./training-records";
import { db } from "@calibra-facil/db";
import {
  trainingRecord,
  trainingRecordAuditLog,
} from "@calibra-facil/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the training-records router.
// Only the better-auth session is mocked (see test/integration/setup.ts):
//   requireLabAuth → requireOrganization → requireOrgType("LAB") → requirePermission
// all run for real against a seeded Postgres.
//
// REAL CONTRACT discovered from training-records.ts + permission.ts + access.ts:
//
//  Guard on every route: ...withLabPermission({ competence: [...] })
//    = requireLabAuth + requireOrganization + requireOrgType("LAB") + requirePermission
//    (training-records.ts lines 32, 105, 159, 253, 326, 378)
//
//  Permission per route (the resource is `competence`, NOT a "training" resource):
//    GET  "/"            competence:["read"]    (line 32)
//    GET  "/:id"         competence:["read"]    (line 105)
//    POST "/"            competence:["create"]  (line 159)
//    PUT  "/:id"         competence:["update"]  (line 253)
//    POST "/:id/complete"competence:["update"]  (line 326)
//    DELETE "/:id"       competence:["delete"]  (line 378)
//
//  Who holds each competence action (packages/auth/src/access.ts):
//    competence:read   → member, operator, technician, admin, owner
//    competence:create → technician, admin, owner   (member + operator: read only)
//    competence:update → admin, owner               (technician: create+read only)
//    competence:delete → admin, owner
//  `competence` is in UNIT_SCOPED_RESOURCES (permission.ts line 357), so
//  getEffectivePermissionRole maps a seeded member's role to its self-healed
//  unitRole (getDefaultUnitRole: technician→technician, member/operator→member).
//  Net effect for these tests matches the org-role table above.
//
//  TENANT SCOPING: training_record is ORG-scoped (organization_id column,
//  schema.ts line 7817). The WHERE clause on every read/mutation pins
//  organizationId = member.organizationId (training-records.ts lines 41, 141,
//  271, 342, 393). There is NO unitId column on training_record and the route
//  never filters by unit → REQ-TR-004 (unit isolation) is structurally N/A.

const JSON_HEADERS = { "content-type": "application/json" } as const;

// ---------------------------------------------------------------------------
// Inline domain seed helper — NOT added to the shared seed.ts
// ---------------------------------------------------------------------------

/** Seed a training_record row scoped to an org. Returns the created id. */
async function seedTrainingRecord(params: {
  organizationId: string;
  userId: string;
  createdBy: string;
  title?: string;
}): Promise<number> {
  const [row] = await db
    .insert(trainingRecord)
    .values({
      organizationId: params.organizationId,
      userId: params.userId,
      createdBy: params.createdBy,
      title: params.title ?? "Treinamento GUM",
      type: "internal",
      status: "planned",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning({ id: trainingRecord.id });
  if (!row) throw new Error("seedTrainingRecord: insert failed");
  return row.id;
}

function validCreateBody(userId: string, title: string) {
  return {
    userId,
    title,
    type: "internal",
    startDate: "2026-02-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("trainingRecordsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ===========================================================================
  // REQ-TR-001 [HIGH RISK] — tenant read isolation (training_record is org-scoped)
  // ===========================================================================
  it("REQ-TR-001: GET / returns only the authenticated org's training records (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedTrainingRecord({
      organizationId: orgA.orgId,
      userId: orgA.userId,
      createdBy: orgA.userId,
      title: "Training A",
    });
    await seedTrainingRecord({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      createdBy: orgB.userId,
      title: "Training B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await trainingRecordsRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const titles = body.data.map((r: { title: string }) => r.title);
    expect(titles).toContain("Training A");
    expect(titles).not.toContain("Training B");
    expect(body.pagination.total).toBe(1);
  });

  // REQ-TR-001 (cont.) — cross-tenant GET /:id returns 404, leaks nothing
  it("REQ-TR-001: GET /:id of another org's training record returns 404 (no cross-tenant read)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const bRecordId = await seedTrainingRecord({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      createdBy: orgB.userId,
      title: "Org B confidential training",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await trainingRecordsRouter.request(`/${bRecordId}`, {
      headers: JSON_HEADERS,
    });

    // WHERE pins organizationId = orgA → no row → 404, no data leak
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).not.toHaveProperty("title");
    expect(JSON.stringify(body)).not.toContain("Org B confidential training");
  });

  // ===========================================================================
  // REQ-TR-002 [HIGH RISK] — RBAC on writes via the REAL requirePermission guard
  // ===========================================================================

  // POST / needs competence:create — member does NOT have it → 403
  it("REQ-TR-002: POST / as role=member -> 403 (RBAC: competence:create denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await trainingRecordsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(validCreateBody(org.userId, "Blocked training")),
    });

    expect(res.status).toBe(403);

    // No row persisted by the blocked request
    const rows = await db
      .select({ id: trainingRecord.id })
      .from(trainingRecord)
      .where(eq(trainingRecord.organizationId, org.orgId));
    expect(rows).toHaveLength(0);
  });

  // POST / as operator → 403 (operator holds competence:read only)
  it("REQ-TR-002: POST / as role=operator -> 403 (RBAC: competence:create denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await trainingRecordsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(validCreateBody(org.userId, "Blocked training")),
    });

    expect(res.status).toBe(403);
  });

  // POST / as technician → 201 (technician HAS competence:create) + DB-persisted
  it("REQ-TR-002: POST / as role=technician -> 201, persists training record + audit log", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "technician" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await trainingRecordsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(validCreateBody(org.userId, "Treinamento técnico")),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.organizationId).toBe(org.orgId);
    expect(created.userId).toBe(org.userId);
    expect(created.title).toBe("Treinamento técnico");
    expect(created.status).toBe("planned");

    // Re-query: the row is actually in Postgres, scoped to the right org
    const [persisted] = await db
      .select()
      .from(trainingRecord)
      .where(eq(trainingRecord.id, created.id));
    expect(persisted?.organizationId).toBe(org.orgId);
    expect(persisted?.title).toBe("Treinamento técnico");

    // Audit log written on create
    const audit = await db
      .select()
      .from(trainingRecordAuditLog)
      .where(
        and(
          eq(trainingRecordAuditLog.trainingRecordId, created.id),
          eq(trainingRecordAuditLog.action, "create"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.performedBy).toBe(org.userId);
  });

  // PUT /:id needs competence:update — technician does NOT have it → 403
  it("REQ-TR-002: PUT /:id as role=technician -> 403 (RBAC: competence:update denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "technician" });
    const recordId = await seedTrainingRecord({
      organizationId: org.orgId,
      userId: org.userId,
      createdBy: org.userId,
      title: "Original title",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await trainingRecordsRouter.request(`/${recordId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: "Should be blocked" }),
    });

    expect(res.status).toBe(403);

    // Title unchanged in DB
    const [row] = await db
      .select({ title: trainingRecord.title })
      .from(trainingRecord)
      .where(eq(trainingRecord.id, recordId));
    expect(row?.title).toBe("Original title");
  });

  // PUT /:id as admin → 200, persists update + audit log
  it("REQ-TR-002: PUT /:id as admin -> 200, updates record + audit log", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const recordId = await seedTrainingRecord({
      organizationId: org.orgId,
      userId: org.userId,
      createdBy: org.userId,
      title: "Before update",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await trainingRecordsRouter.request(`/${recordId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: "After update by admin" }),
    });

    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe("After update by admin");

    const [row] = await db
      .select({ title: trainingRecord.title })
      .from(trainingRecord)
      .where(eq(trainingRecord.id, recordId));
    expect(row?.title).toBe("After update by admin");

    const audit = await db
      .select()
      .from(trainingRecordAuditLog)
      .where(
        and(
          eq(trainingRecordAuditLog.trainingRecordId, recordId),
          eq(trainingRecordAuditLog.action, "update"),
        ),
      );
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]?.performedBy).toBe(org.userId);
  });

  // DELETE /:id needs competence:delete — member does NOT have it → 403
  it("REQ-TR-002: DELETE /:id as role=member -> 403 (RBAC: competence:delete denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    const recordId = await seedTrainingRecord({
      organizationId: org.orgId,
      userId: org.userId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await trainingRecordsRouter.request(`/${recordId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(403);

    // Row not soft-deleted by the blocked request
    const [row] = await db
      .select({ deletedAt: trainingRecord.deletedAt })
      .from(trainingRecord)
      .where(eq(trainingRecord.id, recordId));
    expect(row?.deletedAt).toBeNull();
  });

  // DELETE /:id as admin → 200, soft-deletes the record + audit log
  it("REQ-TR-002: DELETE /:id as admin -> 200, soft-deletes the training record", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const recordId = await seedTrainingRecord({
      organizationId: org.orgId,
      userId: org.userId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await trainingRecordsRouter.request(`/${recordId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBeDefined();

    // Soft delete: row still present, deletedAt set
    const [row] = await db
      .select({ deletedAt: trainingRecord.deletedAt })
      .from(trainingRecord)
      .where(eq(trainingRecord.id, recordId));
    expect(row?.deletedAt).not.toBeNull();

    const audit = await db
      .select()
      .from(trainingRecordAuditLog)
      .where(
        and(
          eq(trainingRecordAuditLog.trainingRecordId, recordId),
          eq(trainingRecordAuditLog.action, "delete"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  // ===========================================================================
  // REQ-TR-003 — unauthenticated → 401 (real requireLabAuth, getSession -> null)
  // ===========================================================================
  it("REQ-TR-003: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await trainingRecordsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  it("REQ-TR-003: POST / unauthenticated -> 401 (no write without a session)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    logout();
    const res = await trainingRecordsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(validCreateBody(org.userId, "Anon training")),
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // REQ-TR-004 — unit isolation: N/A
  // ---------------------------------------------------------------------------
  // training_record has NO unitId column (schema.ts lines 7813-7857) and the
  // router never filters by unit — only by organizationId. Unit-scoped tenant
  // isolation does not exist for this resource, so asserting it would be a
  // fabrication. The org-scoping contract is covered by REQ-TR-001 instead.
  // (No test body: documenting the structural N/A reason here.)
  // ===========================================================================

  // ===========================================================================
  // Happy-path create -> read round-trip persists across requests
  // ===========================================================================
  it("create -> read round-trip persists (POST then GET /:id and GET /)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const createRes = await trainingRecordsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(
        validCreateBody(org.userId, "Calibração de balanças classe III"),
      ),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    // GET /:id returns the just-created record
    const getOneRes = await trainingRecordsRouter.request(`/${created.id}`, {
      headers: JSON_HEADERS,
    });
    expect(getOneRes.status).toBe(200);
    const fetched = await getOneRes.json();
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe("Calibração de balanças classe III");
    expect(fetched.organizationId).toBe(org.orgId);

    // GET / lists it (and only it)
    const listRes = await trainingRecordsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const ids = list.data.map((r: { id: number }) => r.id);
    expect(ids).toContain(created.id);
    expect(list.pagination.total).toBe(1);

    // Sanity: it is not soft-deleted
    const [row] = await db
      .select({ id: trainingRecord.id })
      .from(trainingRecord)
      .where(
        and(
          eq(trainingRecord.id, created.id),
          isNull(trainingRecord.deletedAt),
        ),
      );
    expect(row?.id).toBe(created.id);
  });
});
