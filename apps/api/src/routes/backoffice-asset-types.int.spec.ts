import { beforeEach, describe, expect, it } from "vitest";
import { backofficeRouter } from "./backoffice";
import { db } from "@calibra-facil/db";
import { assetType, asset, platformEventLog } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAsBackoffice, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedCustomer } from "../../test/integration/seed";
import { user } from "@calibra-facil/db/schema";

/** platform_event_log.actor_user_id has an FK to user — seed the ops actor. */
async function seedPlatformAdmin(userId = "ops-admin"): Promise<string> {
  await db.insert(user).values({
    id: userId,
    name: "Ops Admin",
    email: `${userId}@calibrafacil.com`,
    emailVerified: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  return userId;
}

/**
 * backoffice-asset-types.int.spec.ts — real-DB integration tests for the
 * platform-curated asset-type catalog writes (#637).
 *
 * REQ-SEC-AT-002: a platform_admin can create/update/delete global types
 *                 (DB-verified) and every mutation lands in platform_event_log.
 * REQ-SEC-AT-002b [HIGH RISK]: platform_operator and plain "user" roles are
 *                 refused (requirePlatformAdmin is ADMIN-only), rows untouched.
 * Cross-tenant in-use guard: a type referenced by ANY org's asset cannot be
 *                 deleted.
 */

const JSON_HEADERS = {
  "content-type": "application/json",
  host: "dev-api.calibrafacil.com",
};

const ONE_FIELD = [
  { key: "resolution", label: "Resolução", type: "number", required: true },
];

function createBody(slug = "balanca-ops") {
  return JSON.stringify({
    name: "Balança Ops",
    slug,
    description: "Criado pelo backoffice",
    definition: ONE_FIELD,
  });
}

async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: `Tipo ${slug}`, slug, definition: ONE_FIELD })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType failed");
  return row.id;
}

describe("backoffice /asset-types — real DB + real middleware (via parent router chain)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-SEC-AT-002: platform_admin CRUD round-trip (DB + platform_event_log verified)", async () => {
    await seedPlatformAdmin();
    loginAsBackoffice({ userId: "ops-admin", role: "platform_admin" });

    // CREATE
    const created = await backofficeRouter.request("/asset-types", {
      method: "POST",
      headers: JSON_HEADERS,
      body: createBody(),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.slug).toBe("balanca-ops");

    // UPDATE
    const updated = await backofficeRouter.request(
      `/asset-types/${createdBody.id}`,
      {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Balança Ops v2" }),
      },
    );
    expect(updated.status).toBe(200);
    const [rowAfterUpdate] = await db
      .select()
      .from(assetType)
      .where(eq(assetType.id, createdBody.id));
    expect(rowAfterUpdate?.name).toBe("Balança Ops v2");

    // DELETE (unused type)
    const deleted = await backofficeRouter.request(
      `/asset-types/${createdBody.id}`,
      { method: "DELETE", headers: JSON_HEADERS },
    );
    expect(deleted.status).toBe(200);
    const rowsAfterDelete = await db
      .select()
      .from(assetType)
      .where(eq(assetType.id, createdBody.id));
    expect(rowsAfterDelete).toHaveLength(0);

    // Audit: all three mutations logged
    const events = await db
      .select({ action: platformEventLog.action })
      .from(platformEventLog)
      .where(eq(platformEventLog.entityType, "asset_type"));
    const actions = events.map((e) => e.action).sort();
    expect(actions).toEqual([
      "asset_type.create",
      "asset_type.delete",
      "asset_type.update",
    ]);
  });

  it("REQ-SEC-AT-002b [HIGH RISK]: platform_operator and role 'user' -> 403, nothing persisted", async () => {
    for (const role of ["platform_operator", "user"]) {
      loginAsBackoffice({ userId: `ops-${role}`, role });
      const res = await backofficeRouter.request("/asset-types", {
        method: "POST",
        headers: JSON_HEADERS,
        body: createBody(`blocked-${role}`),
      });
      expect(res.status).toBe(403);
    }

    const rows = await db.select().from(assetType);
    expect(rows).toHaveLength(0);
  });

  it("unauthenticated -> 401/403, nothing persisted", async () => {
    logout();
    const res = await backofficeRouter.request("/asset-types", {
      method: "POST",
      headers: JSON_HEADERS,
      body: createBody("anon"),
    });
    expect([401, 403]).toContain(res.status);
    expect(await db.select().from(assetType)).toHaveLength(0);
  });

  it("cross-tenant in-use guard: a type referenced by ANY org's asset cannot be deleted", async () => {
    const typeId = await seedAssetType("em-uso");
    const org = await seedOrg({ orgId: "org-x", role: "admin" });
    const customerId = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Cliente X",
    });
    await db.insert(asset).values({
      labOrganizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      tag: "AST-1",
      name: "Balança em uso",
      serialNumber: "SN-AST-1",
      assetTypeId: typeId,
    });

    await seedPlatformAdmin();
    loginAsBackoffice({ userId: "ops-admin", role: "platform_admin" });
    const res = await backofficeRouter.request(`/asset-types/${typeId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(400);

    const rows = await db
      .select()
      .from(assetType)
      .where(eq(assetType.id, typeId));
    expect(rows).toHaveLength(1);
  });

  it("slug collision -> 400 (global uniqueness preserved)", async () => {
    await seedAssetType("duplicado");
    await seedPlatformAdmin();
    loginAsBackoffice({ userId: "ops-admin", role: "platform_admin" });

    const res = await backofficeRouter.request("/asset-types", {
      method: "POST",
      headers: JSON_HEADERS,
      body: createBody("duplicado"),
    });
    expect(res.status).toBe(400);
  });
});
