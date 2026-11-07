import { beforeEach, describe, expect, it } from "vitest";
import { servicesRouter } from "./services";
import { db } from "@calibra-facil/db";
import { serviceAuditLog } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedService } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test. Only the better-auth session is mocked
// (see test/integration/setup.ts); requireLabAuth -> requireOrganization ->
// requireOrgType -> requirePermission and the unit-scope resolver run for real
// against a seeded Postgres. This proves what the vi.mock(db) tier cannot:
// tenant isolation enforced by the handler's WHERE clause.

const JSON_HEADERS = { "content-type": "application/json" };

describe("servicesRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("GET / returns only the authenticated org's services (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedService({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      name: "Service A",
    });
    await seedService({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      name: "Service B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await servicesRouter.request("/", { headers: JSON_HEADERS });

    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((s: { name: string }) => s.name);
    expect(names).toContain("Service A");
    expect(names).not.toContain("Service B");
    expect(body.pagination.total).toBe(1);
  });

  it("GET /:id of another org's service is denied, returns no data (no cross-tenant read)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    const bServiceId = await seedService({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      name: "Service B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await servicesRouter.request(`/${bServiceId}`, {
      headers: JSON_HEADERS,
    });

    // resolveServiceRouteId scopes by org+unit, so a foreign id resolves to null
    // -> 400 "ID inválido". The security property is what matters: org B's
    // service data is never returned across the tenant boundary.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).not.toHaveProperty("name");
  });

  it("POST / as role=member -> 403 (RBAC: service:create denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await servicesRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Blocked Service" }),
    });

    expect(res.status).toBe(403);
  });

  it("POST / as admin (with active unit) -> 201, persists service + audit log", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await servicesRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "New Service" }),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("New Service");
    expect(created.organizationId).toBe(org.orgId);
    expect(created.unitId).toBe(org.unitId);

    const audit = await db
      .select()
      .from(serviceAuditLog)
      .where(eq(serviceAuditLog.serviceId, created.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("create");
    expect(audit[0]?.performedBy).toBe(org.userId);
  });

  it("GET / unauthenticated -> 401", async () => {
    logout();
    const res = await servicesRouter.request("/", { headers: JSON_HEADERS });
    expect(res.status).toBe(401);
  });
});
