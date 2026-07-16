import { beforeEach, describe, expect, it } from "vitest";
import { accreditedScopeRouter } from "./accredited-scope";
import { db } from "@calibra-facil/db";
import {
  accreditedScopeLine,
  accreditedScopeLineAuditLog,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the accredited-scope router
// (#427 — ISO/IEC 17025 §7.6/§7.8.3 CMC guard, Phase 0). Only the better-auth
// session is mocked (test/integration/setup.ts); requireLabProtected +
// requireOrgType("LAB") + requireUnitOperationalSettingsManager all run for
// real against the seeded Postgres.
//
// Access model mirrors environmental-limits: reads and writes both require a
// unit operational-settings manager (owner/admin or unit_admin).
//
// Proven properties:
//  REQ-CMC-001  GET / returns ONLY the authed org's scope lines (tenant isolation)
//  REQ-CMC-002  PUT as member -> 403; PUT as admin -> 200 + persists + audit row
//  REQ-CMC-003  Unauthenticated -> 401
//  REQ-CMC-004  Grandeza/unit mismatch -> 400 (registry coherence)
//  REQ-CMC-005  DELETE removes the line and leaves an audit row (soft reference)

const JSON_HEADERS = { "content-type": "application/json" };

const validLine = {
  quantityKind: "mass",
  rangeMin: 0,
  rangeMax: 500,
  rangeUnit: "g",
  cmcType: "fixed",
  cmcA: 0.01,
  cmcUnit: "g",
};

async function seedScopeLine(params: {
  organizationId: string;
  unitId: number;
  cmcA?: number;
  updatedBy: string;
}): Promise<number> {
  const [row] = await db
    .insert(accreditedScopeLine)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      quantityKind: "mass",
      rangeMin: 0,
      rangeMax: 500,
      rangeUnit: "g",
      cmcType: "fixed",
      cmcA: params.cmcA ?? 0.01,
      cmcUnit: "g",
      updatedBy: params.updatedBy,
    })
    .returning({ id: accreditedScopeLine.id });

  if (!row) throw new Error("seedScopeLine: insert failed");
  return row.id;
}

describe("accreditedScopeRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-CMC-001 --------------------------------------------------------------
  it("REQ-CMC-001: GET / returns only the authenticated org's lines (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedScopeLine({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      cmcA: 0.01,
      updatedBy: orgA.userId,
    });
    // Cross-org leak row deliberately on ORG-A's unit id, so organizationId is
    // the sole discriminator (same rationale as the environmental spec).
    await seedScopeLine({
      organizationId: orgB.orgId,
      unitId: orgA.unitId,
      cmcA: 99.9,
      updatedBy: orgB.userId,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await accreditedScopeRouter.request("/", {
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.lines)).toBe(true);
    expect(body.lines).toHaveLength(1);
    const cmcAs = body.lines.map((l: { cmcA: number }) => l.cmcA);
    expect(cmcAs).toContain(0.01);
    expect(cmcAs).not.toContain(99.9);
  });

  // REQ-CMC-002 --------------------------------------------------------------
  it("REQ-CMC-002: PUT / as role=member -> 403 and persists nothing", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await accreditedScopeRouter.request("/", {
      method: "PUT",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify(validLine),
    });

    expect(res.status).toBe(403);
    const rows = await db
      .select()
      .from(accreditedScopeLine)
      .where(eq(accreditedScopeLine.organizationId, org.orgId));
    expect(rows).toHaveLength(0);
  });

  it("REQ-CMC-002: PUT / as role=admin -> 200, persists and writes the audit row", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await accreditedScopeRouter.request("/", {
      method: "PUT",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify(validLine),
    });

    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.data.organizationId).toBe(org.orgId);
    expect(created.data.unitId).toBe(org.unitId);
    expect(created.data.coverageFactor).toBe(2);

    const rows = await db
      .select()
      .from(accreditedScopeLine)
      .where(
        and(
          eq(accreditedScopeLine.organizationId, org.orgId),
          eq(accreditedScopeLine.unitId, org.unitId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cmcA).toBe(0.01);
    expect(rows[0]?.updatedBy).toBe(org.userId);

    // §8.4 audit trail: the create is recorded.
    const audit = await db
      .select()
      .from(accreditedScopeLineAuditLog)
      .where(eq(accreditedScopeLineAuditLog.organizationId, org.orgId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("create");
    expect(audit[0]?.performedBy).toBe(org.userId);
  });

  it("REQ-CMC-002: PUT / with id updates the line and records a field-level diff", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const lineId = await seedScopeLine({
      organizationId: org.orgId,
      unitId: org.unitId,
      cmcA: 0.01,
      updatedBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await accreditedScopeRouter.request("/", {
      method: "PUT",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ ...validLine, id: lineId, cmcA: 0.02 }),
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(accreditedScopeLine)
      .where(eq(accreditedScopeLine.id, lineId));
    expect(row?.cmcA).toBe(0.02);

    const audit = await db
      .select()
      .from(accreditedScopeLineAuditLog)
      .where(eq(accreditedScopeLineAuditLog.scopeLineId, lineId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("update");
    expect(audit[0]?.changes).toMatchObject({
      cmcA: { old: 0.01, new: 0.02 },
    });
  });

  // REQ-CMC-003 --------------------------------------------------------------
  it("REQ-CMC-003: unauthenticated GET and PUT -> 401", async () => {
    logout();
    const getRes = await accreditedScopeRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(getRes.status).toBe(401);

    const putRes = await accreditedScopeRouter.request("/", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(validLine),
    });
    expect(putRes.status).toBe(401);
  });

  // REQ-CMC-004 --------------------------------------------------------------
  it("REQ-CMC-004: PUT / with a unit that mismatches the grandeza -> 400", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await accreditedScopeRouter.request("/", {
      method: "PUT",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ ...validLine, rangeUnit: "°C" }),
    });

    expect(res.status).toBe(400);
    const rows = await db
      .select()
      .from(accreditedScopeLine)
      .where(eq(accreditedScopeLine.organizationId, org.orgId));
    expect(rows).toHaveLength(0);
  });

  // REQ-CMC-005 --------------------------------------------------------------
  it("REQ-CMC-005: DELETE /:id removes the line and leaves the audit row", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const lineId = await seedScopeLine({
      organizationId: org.orgId,
      unitId: org.unitId,
      updatedBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await accreditedScopeRouter.request(`/${lineId}`, {
      method: "DELETE",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
    });

    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(accreditedScopeLine)
      .where(eq(accreditedScopeLine.id, lineId));
    expect(rows).toHaveLength(0);

    // Soft reference: the audit row survives the deletion.
    const audit = await db
      .select()
      .from(accreditedScopeLineAuditLog)
      .where(eq(accreditedScopeLineAuditLog.scopeLineId, lineId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("delete");
  });
});
