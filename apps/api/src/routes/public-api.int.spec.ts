import { beforeEach, describe, expect, it } from "vitest";
import { publicApiRouter } from "./public-api";
import { createApiKeySecret } from "../lib/api-keys";
import { truncateAll } from "../../test/integration/db";
import {
  seedApiEntitlement,
  seedApiKey,
  seedCustomer,
  seedOrg,
} from "../../test/integration/seed";

// Real-DB integration test for the EXTERNAL integrator API (`publicApiRouter`,
// v1), which is gated entirely by `requireApiKeyAuth` + `requireApiScope`. There
// is NO session mock here: every request authenticates purely from a real seeded
// `organization_api_key` row whose `keyHash` matches the production hash fn, sent
// as `Authorization: Bearer <rawKey>`. The key's `organizationId` is therefore
// the SOLE tenant discriminator — exactly what these cut-line invariants prove.
//
//   REQ-PAPI-001 [HIGH RISK]  Tenant isolation: org-A key returns ONLY org-A
//                             customers; org-B data is absent (by name AND id).
//   REQ-PAPI-002 [HIGH RISK]  Missing / invalid Authorization → 401.
//   REQ-PAPI-003              Scope gate: key without customers:read → 403;
//                             with the scope → 200.
//   happy-path                Org-A key returns org-A data in the documented shape.

describe("publicApiRouter (v1) — real DB, api-key auth cut-line invariants", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ===========================================================================
  // REQ-PAPI-001 [HIGH RISK] — org-A's key returns ONLY org-A's customers.
  // Org-B's customer is seeded against the SAME endpoint: it WOULD appear if the
  // `eq(customer.labOrganizationId, apiKey.organizationId)` scope regressed. The
  // api-key's organizationId is the sole discriminator (both keys are entitled +
  // scoped identically). Mutation-proof: neutralizing that filter makes org-B's
  // row leak → the not.toContain + toHaveLength(1) assertions go RED.
  // ===========================================================================
  it("REQ-PAPI-001: GET /customers returns only the key's org — org-B absent by name and id", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    const orgB = await seedOrg({ orgId: "org-b" });

    // Both orgs are api-entitled so entitlement can't be the discriminator.
    await seedApiEntitlement({ organizationId: orgA.orgId });
    await seedApiEntitlement({ organizationId: orgB.orgId });

    const { rawKey } = await seedApiKey({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      keyId: "key-a",
      scopes: ["customers:read"],
    });

    const idA = await seedCustomer({
      labOrganizationId: orgA.orgId,
      name: "Cliente Org A",
      taxId: "11111111000111",
    });
    // Org-B leak row: same endpoint, would surface if org scope regressed.
    const idB = await seedCustomer({
      labOrganizationId: orgB.orgId,
      name: "Cliente Org B (leak canary)",
      taxId: "22222222000122",
    });

    const res = await publicApiRouter.request("/customers?limit=100", {
      headers: { authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((row: { name: string }) => row.name);
    const ids = body.data.map((row: { id: number }) => row.id);

    // Org-A present.
    expect(names).toContain("Cliente Org A");
    expect(ids).toContain(idA);

    // Org-B absent — the SOLE tenant discriminator is the key's organizationId.
    expect(names).not.toContain("Cliente Org B (leak canary)");
    expect(ids).not.toContain(idB);

    // Exactly one row (org-A only), so a regression can't hide behind dedup.
    expect(body.data).toHaveLength(1);
  });

  // ===========================================================================
  // REQ-PAPI-002 [HIGH RISK] — auth gate via the real `requireApiKeyAuth`.
  // No Authorization header → "API key ausente" → 401. A syntactically valid but
  // unknown key (hash absent from DB) → "API key inválida" → 401. Mutation-proof:
  // dropping the `requireApiKeyAuth` use() would let the request reach the handler
  // (and 200/500 instead of 401) → RED.
  // ===========================================================================
  it("REQ-PAPI-002: no Authorization → 401; valid-format unknown key → 401", async () => {
    await seedOrg({ orgId: "org-a" });

    const resNoAuth = await publicApiRouter.request("/customers");
    expect(resNoAuth.status).toBe(401);
    expect(await resNoAuth.text()).toContain("ausente");

    // Well-formed key never inserted → hash lookup misses → invalid.
    const { key: unknownKey } = createApiKeySecret();
    const resUnknown = await publicApiRouter.request("/customers", {
      headers: { authorization: `Bearer ${unknownKey}` },
    });
    expect(resUnknown.status).toBe(401);
    expect(await resUnknown.text()).toContain("inválida");
  });

  // ===========================================================================
  // REQ-PAPI-003 — scope gate via the real `requireApiScope("customers:read")`.
  // Both keys belong to the same api-entitled org, so scope is the only variable.
  // Without customers:read → 403 (message names the missing scope); with it → 200.
  // Mutation-proof: removing the requireApiScope guard makes the no-scope key 200
  // → the 403 expectation goes RED.
  // ===========================================================================
  it("REQ-PAPI-003: key without customers:read → 403; key with the scope → 200", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    await seedApiEntitlement({ organizationId: orgA.orgId });

    const { rawKey: keyNoScope } = await seedApiKey({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      keyId: "key-no-scope",
      scopes: ["assets:read"], // deliberately excludes customers:read
    });
    const resNoScope = await publicApiRouter.request("/customers", {
      headers: { authorization: `Bearer ${keyNoScope}` },
    });
    expect(resNoScope.status).toBe(403);
    expect(await resNoScope.text()).toContain("customers:read");

    const { rawKey: keyWithScope } = await seedApiKey({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      keyId: "key-with-scope",
      scopes: ["customers:read"],
    });
    const resWithScope = await publicApiRouter.request("/customers", {
      headers: { authorization: `Bearer ${keyWithScope}` },
    });
    expect(resWithScope.status).toBe(200);
  });

  // ===========================================================================
  // happy-path — org-A's key returns org-A's customer in the documented shape:
  // `{ data: [{ id, name, taxId, email, phone, createdAt, updatedAt }], page, limit }`.
  // Also asserts the `x-api-key` header path authenticates (the middleware accepts
  // either Authorization: Bearer or x-api-key).
  // ===========================================================================
  it("happy-path: returns org-A's customer in the documented response shape", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    await seedApiEntitlement({ organizationId: orgA.orgId });
    const { rawKey } = await seedApiKey({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      keyId: "key-a",
      scopes: ["customers:read"],
    });

    const customerId = await seedCustomer({
      labOrganizationId: orgA.orgId,
      name: "Acme Metrologia",
      taxId: "33333333000133",
    });

    // x-api-key header path (the middleware's other accepted credential location).
    const res = await publicApiRouter.request("/customers", {
      headers: { "x-api-key": rawKey },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);

    const [row] = body.data;
    expect(row.id).toBe(customerId);
    expect(row.name).toBe("Acme Metrologia");
    expect(row.taxId).toBe("33333333000133");
    // The documented projection exposes exactly these fields.
    expect(Object.keys(row).sort()).toEqual(
      [
        "createdAt",
        "email",
        "id",
        "name",
        "phone",
        "taxId",
        "updatedAt",
      ].sort(),
    );
  });
});
