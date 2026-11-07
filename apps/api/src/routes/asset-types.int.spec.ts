import { beforeEach, describe, expect, it } from "vitest";
import { assetTypesRouter } from "./asset-types";
import { db } from "@calibra-facil/db";
import { assetType, organization } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the asset-types router.
// Only the better-auth session is mocked (see test/integration/setup.ts); the
// real guard chains run against the seeded Postgres:
//
//   GET  routes  -> withPermission     = requireAuth + requireOrganization + requirePermission({ equipment:["read"] })
//   write routes -> withLabPermission  = requireLabAuth + requireOrganization + requireOrgType("LAB") + requirePermission({ equipment:[create|update|delete] })
//
// IMPORTANT DOMAIN NOTE (read before trusting the EARS criteria literally):
// `asset_type` is a GLOBAL, platform-wide catalog. The schema has NO
// organizationId and NO unitId (slug is globally `.unique()`), and the route's
// SELECTs carry no org/unit WHERE clause. Asset types are shared blueprints, not
// tenant-scoped data — so there is NO per-tenant row isolation to assert, and no
// unit scoping. The genuine, regression-catchable security properties here are:
//   * mutation requires the `equipment` WRITE permission (member -> 403)
//   * mutation requires a LAB org (requireOrgType("LAB"))
//   * every route requires authentication (401)
// REQ-AT-001 / REQ-AT-004 are therefore re-bound to the REAL contract (shared
// catalog + write-gate), not a fabricated isolation rule. See the final report.

// The GET routes use withPermission -> requireAuth, which tries the PORTAL
// Better-Auth instance first. Unlike the fully-mocked lab session, the real
// portal getSession needs to resolve a baseURL from the request Host; a
// headerless synthetic request throws "Dynamic baseURL could not be resolved".
// A realistic Host header (every real HTTP request carries one) lets the portal
// auth resolve, find no portal cookie, return null, and fall through to the
// mocked lab auth — exactly the production control flow.
const JSON_HEADERS = {
  "content-type": "application/json",
  host: "dev-api.calibrafacil.com",
};

// CreateAssetTypeSchema requires `definition` to hold at least one field
// blueprint (`.min(1)`), so we supply one valid field on every create payload.
const ONE_FIELD = [
  { key: "resolution", label: "Resolução", type: "number", required: true },
];

function createBody(overrides?: {
  name?: string;
  slug?: string;
  description?: string;
}) {
  return JSON.stringify({
    name: overrides?.name ?? "Balança de Teste",
    slug: overrides?.slug ?? "balanca-teste",
    description: overrides?.description ?? "Tipo de ativo de teste",
    definition: ONE_FIELD,
  });
}

/** Seed a global asset-type row directly. Returns the created id. */
async function seedAssetType(params: {
  name: string;
  slug: string;
}): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: params.name, slug: params.slug, definition: ONE_FIELD })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

describe("assetTypesRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-AT-001 ----------------------------------------------------------------
  // Re-bound to the REAL contract: the asset-type catalog is GLOBAL/shared, so a
  // member of org-A can see a type created under org-B's tenure. The property
  // worth proving is that the WRITE path is what protects the shared catalog,
  // not a per-tenant read filter. We assert (a) the shared catalog is visible
  // cross-tenant (documents the design), and (b) a non-LAB-org write is blocked
  // by requireOrgType("LAB") so the global catalog can only be mutated by labs.
  it("REQ-AT-001: GET / exposes the GLOBAL asset-type catalog to every authed org (shared, not tenant-scoped)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedOrg({ orgId: "org-b", role: "admin" });

    // Two catalog rows. There is no org column, so neither "belongs" to an org.
    await seedAssetType({ name: "Type Alpha", slug: "type-alpha" });
    await seedAssetType({ name: "Type Beta", slug: "type-beta" });

    // org-A sees BOTH rows — the catalog is global by design.
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await assetTypesRouter.request("/", {
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const slugs = body.data.map((t: { slug: string }) => t.slug);
    expect(slugs).toContain("type-alpha");
    expect(slugs).toContain("type-beta");
    // Catches a regression that accidentally drops or duplicates catalog rows.
    expect(body.data).toHaveLength(2);
  });

  // REQ-AT-001b ---------------------------------------------------------------
  // #637: no write route exists on the lab router at all — a CLIENT org (like
  // any tenant) gets 404 on POST. The global catalog is seeded centrally
  // (`packages/db/src/seed-asset-types.ts`), never written by a tenant.
  it("REQ-AT-001b: POST / from a CLIENT org -> 404 (write routes removed)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });

    // Flip the seeded org to CLIENT to exercise requireOrgType("LAB").
    await db
      .update(organization)
      .set({ type: "CLIENT" })
      .where(eq(organization.id, orgA.orgId));

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await assetTypesRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
      body: createBody({ slug: "client-blocked" }),
    });

    expect(res.status).toBe(404);

    // The blocked row must NOT have been persisted.
    const rows = await db
      .select()
      .from(assetType)
      .where(eq(assetType.slug, "client-blocked"));
    expect(rows).toHaveLength(0);
  });

  // REQ-AT-002 (#637) -----------------------------------------------------
  // The asset-type catalog is GLOBAL — it is curated CENTRALLY in
  // `packages/db/src/seed-asset-types.ts`. The lab router no longer exposes any
  // write route: a tenant admin (owner of org A) must not be able to mutate a
  // catalog shared with every other tenant. Hono returns 404 for the removed
  // routes; the security property is "no lab-side write path exists at all".

  it("REQ-SEC-AT-001: POST / as LAB admin -> 404 (write routes removed), nothing persisted", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await assetTypesRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: createBody(),
    });
    expect(res.status).toBe(404);

    const rows = await db
      .select()
      .from(assetType)
      .where(eq(assetType.slug, "balanca-teste"));
    expect(rows).toHaveLength(0);
  });

  it("REQ-SEC-AT-001: PUT /:id and DELETE /:id as LAB admin -> 404, row untouched", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    const typeId = await seedAssetType({
      name: "Paquímetro",
      slug: "paquimetro",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const put = await assetTypesRouter.request(`/${typeId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(put.status).toBe(404);

    const del = await assetTypesRouter.request(`/${typeId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });
    expect(del.status).toBe(404);

    const [row] = await db
      .select()
      .from(assetType)
      .where(eq(assetType.id, typeId));
    expect(row?.name).toBe("Paquímetro");
  });

  it("REQ-AT-003: unauthenticated POST / -> 404 (route removed; nothing persisted)", async () => {
    logout();
    const res = await assetTypesRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: createBody(),
    });
    expect(res.status).toBe(404);

    const rows = await db
      .select()
      .from(assetType)
      .where(eq(assetType.slug, "balanca-teste"));
    expect(rows).toHaveLength(0);
  });

  it("REQ-AT-003: unauthenticated GET / -> 401 and serves no catalog data", async () => {
    // Seed a row that MUST NOT be readable without a session.
    await seedAssetType({ name: "Secret Type", slug: "secret-type" });

    logout();
    // With a Host header the portal auth resolves to null (no portal cookie) and
    // requireAuth falls through to the mocked lab auth (also null) -> 401.
    const res = await assetTypesRouter.request("/", { headers: JSON_HEADERS });

    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("secret-type");
  });

  // REQ-AT-004 ----------------------------------------------------------------
  // N/A: asset_type is org-scoped? No — it is GLOBAL. The table has no unitId
  // (and no organizationId), so there is no unit dimension to filter on. We
  // assert the structural fact so a future migration that adds a unitId column
  // forces this test (and the whole isolation story) to be revisited.
  it("REQ-AT-004: N/A — asset_type is a GLOBAL catalog (no unitId / no organizationId column)", async () => {
    const cols = Object.keys(assetType);
    expect(cols).not.toContain("unitId");
    expect(cols).not.toContain("organizationId");
  });

  // Core happy-path round-trip ------------------------------------------------
  // create -> read-back. There is no org/unit stamp on asset_type (global
  // catalog), so we assert the create persists and the very next GET /:id reads
  // the same row back.
  it("happy path (read-only): a seeded type round-trips through GET /:id", async () => {
    const adminOrg = await seedOrg({ orgId: "org-admin", role: "admin" });
    const typeId = await seedAssetType({
      name: "Balança de Teste",
      slug: "balanca-teste",
    });

    loginAs({ userId: adminOrg.userId, organizationId: adminOrg.orgId });
    const res = await assetTypesRouter.request(`/${typeId}`, {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(adminOrg.unitId),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("balanca-teste");
    expect(body.definition).toEqual(ONE_FIELD);
  });
});
