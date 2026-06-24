import { beforeEach, describe, expect, it } from "vitest";
import { apiKeysRouter } from "./api-keys";
import { db } from "@calibra-facil/db";
import { organizationApiKey, subscription } from "@calibra-facil/db/schema";
import { createApiKeySecret } from "../lib/api-keys";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the API-key custody router.
// Only the better-auth lab session is mocked (test/integration/setup.ts); the
// full guard chain — requireLabAuth -> requireOrganization -> requireOrgType ->
// requirePermission/requireRole (and requireFeature on mint) — runs for real
// against a seeded Postgres. This proves what a vi.mock(db) tier cannot: the
// SECURITY property that org A can never see/use/revoke org B's API keys.
//
// API-key custody is sensitive: we seed test keys in the ephemeral DB and never
// print the raw secret plaintext. The `secret` returned by mint is asserted to
// EXIST (round-trip), never logged, and the persisted column is the sha-256
// keyHash — the spec asserts ROUTE behavior (list/create/revoke + tenant
// isolation), not the crypto internals.
//
// Real guards per route (apps/api/src/routes/api-keys.ts):
//   GET  /            requireLabProtected, requireOrgType("LAB"),
//                     requireRole(["admin","owner"])          [lines 76-78]
//                     scope: eq(organizationApiKey.organizationId, member.org)  [line 93]
//   POST /            withLabPermission({ organization:["update"] }),
//                     requireRole(["admin","owner"]), requireFeature("api")  [lines 101-103]
//   POST /:id/revoke  withLabPermission({ organization:["update"] }),
//                     requireRole(["admin","owner"])          [lines 233-234]
//                     scope: and(eq(id), eq(organizationId))  [lines 241-244]

const JSON_HEADERS = { "content-type": "application/json" };

type SeededKey = { id: string };

/**
 * Seed an API key row scoped ONLY by organizationId (the table's sole tenant
 * discriminator — no unitId column), so a leak in the isolation tests cannot be
 * masked by a sibling filter. Distinct keyHash per row (keyHash is unique).
 * Never returns/prints the raw secret.
 */
async function seedApiKey(params: {
  orgId: string;
  userId: string;
  id: string;
  name: string;
  revokedAt?: Date | null;
}): Promise<SeededKey> {
  const { keyPrefix, keyHash } = createApiKeySecret();
  await db.insert(organizationApiKey).values({
    id: params.id,
    organizationId: params.orgId,
    name: params.name,
    keyPrefix,
    keyHash,
    scopes: ["customers:read"],
    createdBy: params.userId,
    revokedAt: params.revokedAt ?? null,
  });
  return { id: params.id };
}

/** Grant the "api" feature by seeding an active PROFESSIONAL subscription
 * (requireFeature("api") reads the plan via the subscription row, not overrides). */
async function seedApiPlan(orgId: string): Promise<void> {
  await db.insert(subscription).values({
    organizationId: orgId,
    planId: "PROFESSIONAL",
    status: "ACTIVE",
  });
}

describe("apiKeysRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-AK-001 [HIGH RISK] — tenant read isolation.
  // Sole-discriminator construction: the org-B key differs from org-A's ONLY in
  // organizationId, so a list leak cannot be masked by any other filter.
  it("REQ-AK-001: GET / returns only the caller org's keys; org-B key is absent", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedApiKey({
      orgId: orgA.orgId,
      userId: orgA.userId,
      id: "key-a",
      name: "Key A",
    });
    await seedApiKey({
      orgId: orgB.orgId,
      userId: orgB.userId,
      id: "key-b",
      name: "Key B (leak row)",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await apiKeysRouter.request("/", { headers: JSON_HEADERS });

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids: string[] = body.data.map((k: { id: string }) => k.id);
    expect(ids).toContain("key-a");
    expect(ids).not.toContain("key-b");
    expect(body.data).toHaveLength(1);
  });

  // REQ-AK-002 [HIGH RISK] — the manage-permission/role gate.
  // A role lacking the manage permission (member) must be rejected by the real
  // guard chain; an authorized role (admin) succeeds and persists.
  // Bound to POST /:id/revoke, which has the SAME role/permission gate but no
  // requireFeature("api") — so the role result is not entangled with the tier
  // guard. The mint route shares this exact gate (proven indirectly).
  it("REQ-AK-002: revoke as role=member -> 403; as admin -> success + DB-persisted", async () => {
    // --- member is denied by the real guard ---
    const memberOrg = await seedOrg({ orgId: "org-m", role: "member" });
    const memberKey = await seedApiKey({
      orgId: memberOrg.orgId,
      userId: memberOrg.userId,
      id: "key-m",
      name: "Key M",
    });
    loginAs({ userId: memberOrg.userId, organizationId: memberOrg.orgId });

    const deniedRes = await apiKeysRouter.request(`/${memberKey.id}/revoke`, {
      method: "POST",
      headers: JSON_HEADERS,
    });
    expect(deniedRes.status).toBe(403);

    const stillActive = await db.query.organizationApiKey.findFirst({
      where: eq(organizationApiKey.id, memberKey.id),
    });
    expect(stillActive?.revokedAt).toBeNull();

    // --- admin is authorized; the key is revoked in the DB ---
    await truncateAll();
    const adminOrg = await seedOrg({ orgId: "org-ad", role: "admin" });
    const adminKey = await seedApiKey({
      orgId: adminOrg.orgId,
      userId: adminOrg.userId,
      id: "key-ad",
      name: "Key AD",
    });
    loginAs({ userId: adminOrg.userId, organizationId: adminOrg.orgId });

    const okRes = await apiKeysRouter.request(`/${adminKey.id}/revoke`, {
      method: "POST",
      headers: JSON_HEADERS,
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ success: true });

    const revoked = await db.query.organizationApiKey.findFirst({
      where: eq(organizationApiKey.id, adminKey.id),
    });
    expect(revoked?.revokedAt).not.toBeNull();
    expect(revoked?.revokedBy).toBe(adminOrg.userId);
  });

  // REQ-AK-003 [HIGH RISK] — no cross-tenant revoke.
  // org A (admin) targets org B's key id. The scope filter eq(organizationId)
  // makes the foreign key unreachable -> 404, and org B's key stays un-revoked.
  it("REQ-AK-003: revoke of another org's key -> 404, no cross-tenant revoke", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    const bKey = await seedApiKey({
      orgId: orgB.orgId,
      userId: orgB.userId,
      id: "key-b",
      name: "Key B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await apiKeysRouter.request(`/${bKey.id}/revoke`, {
      method: "POST",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(404);

    const bKeyAfter = await db.query.organizationApiKey.findFirst({
      where: eq(organizationApiKey.id, bKey.id),
    });
    expect(bKeyAfter?.revokedAt).toBeNull();
    expect(bKeyAfter?.revokedBy).toBeNull();
  });

  // REQ-AK-004 — unauthenticated -> 401 (requireLabAuth rejects a null session).
  it("REQ-AK-004: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await apiKeysRouter.request("/", { headers: JSON_HEADERS });
    expect(res.status).toBe(401);
  });

  // Happy-path — mint -> list round-trip persists.
  // requireFeature("api") on POST / is satisfied by an active PROFESSIONAL plan.
  it("happy-path: admin mints a key (201) then GET / lists it (round-trip persists)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedApiPlan(org.orgId);
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const mintRes = await apiKeysRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "CI integration key" }),
    });

    expect(mintRes.status).toBe(201);
    const minted = await mintRes.json();
    // The one-time secret is returned exactly once — assert it EXISTS, never log it.
    expect(typeof minted.secret).toBe("string");
    expect(minted.secret.length).toBeGreaterThan(0);
    expect(minted.key.name).toBe("CI integration key");
    const mintedId: string = minted.key.id;

    // Persisted in the DB under the caller's org, storing the hash (not plaintext).
    const persisted = await db.query.organizationApiKey.findFirst({
      where: eq(organizationApiKey.id, mintedId),
    });
    expect(persisted?.organizationId).toBe(org.orgId);
    expect(persisted?.name).toBe("CI integration key");
    expect(persisted?.keyHash).not.toBe(minted.secret);

    // Round-trip: it now appears in the list (without the secret).
    const listRes = await apiKeysRouter.request("/", { headers: JSON_HEADERS });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const ids: string[] = listBody.data.map((k: { id: string }) => k.id);
    expect(ids).toContain(mintedId);
    expect(listBody.data[0]).not.toHaveProperty("keyHash");
    expect(listBody.data[0]).not.toHaveProperty("secret");
  });
});
