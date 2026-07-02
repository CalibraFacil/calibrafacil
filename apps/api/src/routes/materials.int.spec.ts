import { beforeEach, describe, expect, it } from "vitest";
import { materialsRouter } from "./materials";
import { db } from "@calibra-facil/db";
import { material } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the materials catalog CRUD.
// Only the better-auth session is mocked (see test/integration/setup.ts);
// withLabPermission({ service: [...] }) and the unit-scope resolver run for
// real against the seeded Postgres. This proves what the vi.mock(db) tier
// cannot: tenant isolation enforced by the handler's WHERE clause.
//
// RBAC surface (reuses the `service` domain — commercial catalog registry):
//   - GET / and GET /:id  → service:read  (all roles)
//   - POST /              → service:create (admin/owner only)
//   - PUT /:id, DELETE /:id → service:update / service:delete (admin/owner)
//
// Proven properties:
//   REQ-MAT-001  GET / returns ONLY the authed org's materials — two orgs, exact count
//   REQ-MAT-002  Cross-tenant GET /:id → 404, no data leak
//   REQ-MAT-003  POST / as member → 403 (service:create absent for member role)
//   REQ-MAT-004  POST / as admin → 201, persists org/unit-scoped material
//   REQ-MAT-005  Duplicate SKU within the same org → 409; same SKU in ANOTHER
//                org is allowed (uniqueness is per-organization)
//   REQ-MAT-006  DELETE /:id soft-deletes (is_active=false), row survives
//   REQ-MAT-007  Unauthenticated → 401

const JSON_HEADERS = { "content-type": "application/json" };

/** Seed a material directly via Drizzle. Returns the material id. */
async function seedMaterial(params: {
  organizationId: string;
  unitId: number;
  name: string;
  sku?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(material)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: params.name,
      sku: params.sku ?? null,
      unit: "un",
    })
    .returning({ id: material.id });
  if (!row) throw new Error("seedMaterial: insert failed");
  return row.id;
}

describe("materialsRouter — real DB + real RBAC middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-MAT-001: GET / returns only the authenticated org's materials", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedMaterial({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      name: "Célula de carga 50kg",
    });
    await seedMaterial({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      name: "Display org B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await materialsRouter.request("/", { headers: JSON_HEADERS });

    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((m: { name: string }) => m.name);
    expect(names).toContain("Célula de carga 50kg");
    expect(names).not.toContain("Display org B");
    expect(body.pagination.total).toBe(1);
  });

  it("REQ-MAT-002: cross-tenant GET /:id → 404, no data leak", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    const bMaterialId = await seedMaterial({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      name: "Material B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await materialsRouter.request(`/${bMaterialId}`, {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).not.toHaveProperty("name");
  });

  it("REQ-MAT-003: POST / as role=member → 403 (service:create denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await materialsRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Blocked Material" }),
    });

    expect(res.status).toBe(403);
  });

  it("REQ-MAT-004: POST / as admin → 201, persists org/unit-scoped material", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await materialsRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({
        name: "Célula de carga 100kg",
        sku: "CEL-100",
        unitCostCents: 45_000,
        unitPriceCents: 80_000,
        controlsStock: true,
      }),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("Célula de carga 100kg");
    expect(created.sku).toBe("CEL-100");
    expect(created.organizationId).toBe(org.orgId);
    expect(created.unitId).toBe(org.unitId);
    expect(created.controlsStock).toBe(true);
    expect(created.isActive).toBe(true);
  });

  it("REQ-MAT-005: duplicate SKU in the same org → 409; same SKU in another org is allowed", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedMaterial({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      name: "Original",
      sku: "SKU-1",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const dup = await materialsRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
      body: JSON.stringify({ name: "Duplicado", sku: "SKU-1" }),
    });
    expect(dup.status).toBe(409);

    loginAs({ userId: orgB.userId, organizationId: orgB.orgId });
    const other = await materialsRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgB.unitId) },
      body: JSON.stringify({ name: "Outro laboratório", sku: "SKU-1" }),
    });
    expect(other.status).toBe(201);
  });

  it("REQ-MAT-006: DELETE /:id soft-deletes (is_active=false), row survives", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const id = await seedMaterial({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Para desativar",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await materialsRouter.request(`/${id}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(material).where(eq(material.id, id));
    expect(row).toBeDefined();
    expect(row?.isActive).toBe(false);
  });

  it("REQ-MAT-007: unauthenticated → 401", async () => {
    logout();
    const res = await materialsRouter.request("/", { headers: JSON_HEADERS });
    expect(res.status).toBe(401);
  });
});
