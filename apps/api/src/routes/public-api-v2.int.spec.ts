import { beforeEach, describe, expect, it } from "vitest";
import { publicApiV2Router } from "./public-api-v2";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetType,
  customer,
  entitlementOverride,
  organization,
  organizationApiKey,
} from "@calibra-facil/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createApiKeySecret } from "../lib/api-keys";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB integration test for the public API v2 router.
// No session mock is needed — auth is entirely via API key, handled by
// `requireApiKeyAuth` (hash lookup + entitlement check) and `requireApiScope`.
// The following cut-line invariants are covered:
//   REQ-PAPI-001  401 on missing / unknown key
//   REQ-PAPI-002  403 on missing "api" entitlement (FREE plan, no subscription)
//   REQ-PAPI-003  403 on missing scope; 200 on matching scope
//   REQ-PAPI-004  Tenant isolation — org A key sees only org A customers
//   REQ-PAPI-005  Cross-tenant by id — org A key + org B customer id → 404
//   REQ-PAPI-006  Revoked key → 401
//   REQ-CMP-AUD-010a (#692, public API surface) — DELETE /customers/:id must
//     write a per-asset 'delete' audit row before the customer.assets cascade,
//     and must NOT write audit rows for a cross-tenant customer it can't reach.

// ---------------------------------------------------------------------------
// Inline seed helpers
// ---------------------------------------------------------------------------

type SeededKey = {
  rawKey: string;
  keyId: string;
};

/** Seed an API key for the given org+user with a given scope list. */
async function seedApiKey(params: {
  orgId: string;
  userId: string;
  keyId: string;
  scopes: string[];
  revokedAt?: Date;
}): Promise<SeededKey> {
  const { key, keyPrefix, keyHash } = createApiKeySecret();
  await db.insert(organizationApiKey).values({
    id: params.keyId,
    organizationId: params.orgId,
    name: `Test key ${params.keyId}`,
    keyPrefix,
    keyHash,
    scopes: params.scopes,
    createdBy: params.userId,
    revokedAt: params.revokedAt ?? null,
  });
  return { rawKey: key, keyId: params.keyId };
}

/** Seed an entitlement override granting "api" unconditionally (no plan needed). */
async function seedApiEntitlement(params: { orgId: string }): Promise<void> {
  await db.insert(entitlementOverride).values({
    organizationId: params.orgId,
    feature: "api",
    reason: "test grant",
    expiresAt: null,
  });
}

/** Seed a minimal CLIENT org + customer row owned by a given lab org. */
async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
  name: string;
}): Promise<number> {
  await db.insert(organization).values({
    id: params.clientOrgId,
    name: `Client Org ${params.clientOrgId}`,
    slug: params.clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const [row] = await db
    .insert(customer)
    .values({
      name: params.name,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrgId,
    })
    .returning({ id: customer.id });

  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/** Seed an asset_type (blueprint). Returns asset_type id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: `AT ${slug}`, slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/** Seed an asset owned by a customer (unit-scoped to the lab). Returns asset id. */
async function seedAsset(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: `Instrumento ${params.tag}`,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------

describe("publicApiV2Router — real DB, API-key auth cut-line invariants", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-PAPI-001  Auth: missing key → 401; valid-format but unknown key → 401
  // =========================================================================
  it("REQ-PAPI-001: GET /customers with no key → 401; with syntactically-valid unknown key → 401", async () => {
    await seedOrg({ orgId: "org-a" });

    // No x-api-key header at all
    const resNoKey = await publicApiV2Router.request("/customers");
    expect(resNoKey.status).toBe(401);
    // Hono HTTPException default errorHandler returns plain-text body
    const textNoKey = await resNoKey.text();
    expect(textNoKey).toContain("ausente");

    // Syntactically valid format but hash not in DB
    const { key: unknownKey } = createApiKeySecret();
    const resUnknown = await publicApiV2Router.request("/customers", {
      headers: { "x-api-key": unknownKey },
    });
    expect(resUnknown.status).toBe(401);
    const textUnknown = await resUnknown.text();
    expect(textUnknown).toContain("inválida");
  });

  // =========================================================================
  // REQ-PAPI-002  Plan gate: key exists, org has NO "api" entitlement → 403
  // =========================================================================
  it("REQ-PAPI-002: valid key on FREE-plan org (no subscription) → GET /customers → 403", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    // No subscription seeded → FREE plan → no "api" entitlement
    const { rawKey } = await seedApiKey({
      orgId: orgA.orgId,
      userId: orgA.userId,
      keyId: "key-no-entitlement",
      scopes: ["customers:read"],
    });

    const res = await publicApiV2Router.request("/customers", {
      headers: { "x-api-key": rawKey },
    });

    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("plano");
  });

  // =========================================================================
  // REQ-PAPI-003  Scope gate: no customers:read → 403; with scope → 200
  // =========================================================================
  it("REQ-PAPI-003: api-entitled key without customers:read → 403; with scope → 200", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    await seedApiEntitlement({ orgId: orgA.orgId });

    // Key WITHOUT customers:read scope
    const { rawKey: keyNoScope } = await seedApiKey({
      orgId: orgA.orgId,
      userId: orgA.userId,
      keyId: "key-no-scope",
      scopes: ["assets:read"], // deliberately excludes customers:read
    });

    const resNoScope = await publicApiV2Router.request("/customers", {
      headers: { "x-api-key": keyNoScope },
    });
    expect(resNoScope.status).toBe(403);
    // Hono HTTPException returns plain-text body from getResponse()
    const textNoScope = await resNoScope.text();
    expect(textNoScope).toContain("customers:read");

    // Key WITH customers:read scope
    const { rawKey: keyWithScope } = await seedApiKey({
      orgId: orgA.orgId,
      userId: orgA.userId,
      keyId: "key-with-scope",
      scopes: ["customers:read"],
    });

    const resWithScope = await publicApiV2Router.request("/customers", {
      headers: { "x-api-key": keyWithScope },
    });
    expect(resWithScope.status).toBe(200);
  });

  // =========================================================================
  // REQ-PAPI-004  Tenant isolation: org A key sees ONLY org A customers
  // =========================================================================
  it("REQ-PAPI-004: GET /customers returns only org A customers — org B absent by name and id", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    const orgB = await seedOrg({ orgId: "org-b" });

    await seedApiEntitlement({ orgId: orgA.orgId });
    const { rawKey } = await seedApiKey({
      orgId: orgA.orgId,
      userId: orgA.userId,
      keyId: "key-a",
      scopes: ["customers:read"],
    });

    // Seed two customers for org A and one for org B
    const idA1 = await seedCustomer({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a1",
      name: "Acme São Paulo",
    });
    const idA2 = await seedCustomer({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a2",
      name: "Acme Rio",
    });
    const idB1 = await seedCustomer({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b1",
      name: "Beta Industries",
    });

    const res = await publicApiV2Router.request("/customers?limit=100", {
      headers: { "x-api-key": rawKey },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((c: { name: string }) => c.name);
    const ids = body.data.map((c: { id: number }) => c.id);

    // Org A's customers are present
    expect(names).toContain("Acme São Paulo");
    expect(names).toContain("Acme Rio");
    expect(ids).toContain(idA1);
    expect(ids).toContain(idA2);

    // Org B's customer is absent — definite assertion by both name and id
    expect(names).not.toContain("Beta Industries");
    expect(ids).not.toContain(idB1);

    // Exactly two results
    expect(body.data).toHaveLength(2);
  });

  // =========================================================================
  // REQ-PAPI-005  Cross-tenant by id: org A key + org B customer → 404
  // =========================================================================
  it("REQ-PAPI-005: GET /customers/:id with org A key for org B customer → 404, no data leak", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    const orgB = await seedOrg({ orgId: "org-b" });

    await seedApiEntitlement({ orgId: orgA.orgId });
    const { rawKey } = await seedApiKey({
      orgId: orgA.orgId,
      userId: orgA.userId,
      keyId: "key-a",
      scopes: ["customers:read"],
    });

    // Seed a customer belonging to org B only
    const idB1 = await seedCustomer({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b1",
      name: "Secret Beta Customer",
    });

    const res = await publicApiV2Router.request(`/customers/${idB1}`, {
      headers: { "x-api-key": rawKey },
    });

    // Must NOT return org B's data — 404 is the correct response because
    // the handler scopes its WHERE by labOrganizationId = apiKey.organizationId.
    // The handler returns c.json(buildPublicApiError(...), 404) — JSON body.
    expect(res.status).toBe(404);
    const body = await res.json();
    // Confirm no cross-tenant fields leak: the error body has no customer data
    expect(JSON.stringify(body)).not.toContain("Secret Beta Customer");
  });

  // =========================================================================
  // REQ-PAPI-006  Revoked key → 401
  // =========================================================================
  it("REQ-PAPI-006: key with revokedAt set → GET /customers → 401", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    await seedApiEntitlement({ orgId: orgA.orgId });

    const { rawKey } = await seedApiKey({
      orgId: orgA.orgId,
      userId: orgA.userId,
      keyId: "key-revoked",
      scopes: ["customers:read"],
      revokedAt: new Date("2025-01-01T00:00:00.000Z"),
    });

    const res = await publicApiV2Router.request("/customers", {
      headers: { "x-api-key": rawKey },
    });

    // requireApiKeyAuth filters isNull(revokedAt), so a revoked key is invisible
    // → "API key inválida" → 401
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toContain("inválida");
  });

  // =========================================================================
  // §7.8.4.3 — the integration surface must not attribute periodicity either:
  // an API-key (lab) client cannot set `nextCalibrationDate`; when it moves
  // `lastCalibrationDate`, next is re-derived from the CUSTOMER-owned interval.
  // =========================================================================
  it("PUT /assets/:id ignores an integration-sent nextCalibrationDate and re-derives from the customer interval", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    await seedApiEntitlement({ orgId: orgA.orgId });
    const { rawKey } = await seedApiKey({
      orgId: orgA.orgId,
      userId: orgA.userId,
      keyId: "key-assets",
      scopes: ["assets:write"],
    });
    const customerId = await seedCustomer({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a1",
      name: "Acme São Paulo",
    });
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balança", slug: "balanca", definition: [] })
      .returning({ id: assetType.id });
    const [seeded] = await db
      .insert(asset)
      .values({
        unitId: orgA.unitId,
        customerId,
        assetTypeId: type!.id,
        name: "Balança 01",
        serialNumber: "SN-01",
        tag: "TAG-01",
        status: "ACTIVE",
        lastCalibrationDate: new Date("2025-06-01T00:00:00.000Z"),
        nextCalibrationDate: new Date("2026-06-01T00:00:00.000Z"),
        // Customer-owned interval, set via the portal.
        calibrationIntervalMonths: 12,
      })
      .returning({ id: asset.id });

    const res = await publicApiV2Router.request(`/assets/${seeded!.id}`, {
      method: "PUT",
      headers: { "x-api-key": rawKey, "content-type": "application/json" },
      body: JSON.stringify({
        lastCalibrationDate: "2026-06-01T00:00:00.000Z",
        // Attempted lab attribution — must be stripped, never persisted.
        nextCalibrationDate: "2031-01-01T00:00:00.000Z",
      }),
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, seeded!.id))
      .limit(1);
    expect(row?.lastCalibrationDate?.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    // Derived: last + 12 months — NOT the integration-sent 2031 date.
    expect(row?.nextCalibrationDate?.toISOString()).toBe(
      "2027-06-01T00:00:00.000Z",
    );
  });

  // =========================================================================
  // REQ-CMP-AUD-010a [HIGH RISK] (#692 / CMP-07, PUBLIC API surface): deleting
  // a customer via the integrator DELETE /customers/:id route cascades its
  // assets (asset.customer_id → customer, intentional). Each asset's audit
  // trail must SURVIVE that cascade — the append-only ISO/IEC 17025 trail must
  // keep both the pre-existing history AND a fresh 'delete' row per asset.
  //
  // Before the fix: the route wrote NO 'delete' audit row for the cascaded
  // assets, and asset_audit_log.asset_id → asset ON DELETE CASCADE erased the
  // pre-existing rows too, so the deletion left no trace via this surface
  // either (mirrors the dashboard-route proof in customers.int.spec.ts).
  // =========================================================================
  it(
    "REQ-CMP-AUD-010a: DELETE /customers/:id (public API) keeps each asset's audit trail (+ fresh 'delete' row) after the cascade",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a" });
      await seedApiEntitlement({ orgId: orgA.orgId });
      const { rawKey } = await seedApiKey({
        orgId: orgA.orgId,
        userId: orgA.userId,
        keyId: "key-customers-write",
        scopes: ["customers:write"],
      });

      const customerId = await seedCustomer({
        labOrgId: orgA.orgId,
        clientOrgId: "client-aud-papi",
        name: "Cliente Auditável (API)",
      });

      const assetTypeId = await seedAssetType("balanca-aud-papi");
      const assetA = await seedAsset({
        unitId: orgA.unitId,
        customerId,
        assetTypeId,
        tag: "PAPI-AUD-A",
      });
      const assetB = await seedAsset({
        unitId: orgA.unitId,
        customerId,
        assetTypeId,
        tag: "PAPI-AUD-B",
      });

      // Pre-existing history for each asset (would be cascade-erased today).
      await db.insert(assetAuditLog).values([
        {
          assetId: assetA,
          action: "create",
          changes: { asset: { old: null, new: { tag: "PAPI-AUD-A" } } },
          performedBy: orgA.userId,
        },
        {
          assetId: assetB,
          action: "create",
          changes: { asset: { old: null, new: { tag: "PAPI-AUD-B" } } },
          performedBy: orgA.userId,
        },
      ]);

      const res = await publicApiV2Router.request(`/customers/${customerId}`, {
        method: "DELETE",
        headers: {
          "x-api-key": rawKey,
          "idempotency-key": `del-customer-${customerId}`,
        },
      });
      expect(res.status).toBe(200);

      // The customer and its cascaded assets are gone…
      const remainingCustomer = await db
        .select()
        .from(customer)
        .where(eq(customer.id, customerId));
      expect(remainingCustomer).toHaveLength(0);
      const remainingAssets = await db
        .select()
        .from(asset)
        .where(inArray(asset.id, [assetA, assetB]));
      expect(remainingAssets).toHaveLength(0);

      // …but each asset's audit trail SURVIVES: the pre-existing 'create' row
      // AND a fresh 'delete' row inserted by the route before the cascade.
      for (const assetId of [assetA, assetB]) {
        const logs = await db
          .select()
          .from(assetAuditLog)
          .where(eq(assetAuditLog.assetId, assetId));
        const actions = logs.map((l) => l.action).toSorted();
        expect(actions).toEqual(["create", "delete"]);

        const deleteRow = logs.find((l) => l.action === "delete");
        // apiKey.createdBy — the actor attributed to an integrator mutation.
        expect(deleteRow?.performedBy).toBe(orgA.userId);
        expect(deleteRow?.performedAt).toBeInstanceOf(Date);
        // The 'delete' row captures the full pre-delete asset row (old) → null.
        expect(deleteRow?.changes).toMatchObject({
          asset: { old: { id: assetId }, new: null },
        });
      }
    },
  );

  // =========================================================================
  // REQ-CMP-AUD-010a (public API, cross-tenant guard): an org-A key must NOT
  // be able to produce audit rows for an org-B customer's assets. The route's
  // tenant scope (labOrganizationId = apiKey.organizationId) must reject the
  // request (404) BEFORE any asset is touched, so org B's asset trail is
  // untouched — zero audit rows written, not even a spurious 'delete' row.
  // =========================================================================
  it(
    "REQ-CMP-AUD-010a: DELETE /customers/:id (public API) cross-tenant — org A key on org B customer → 404, no asset audit rows written",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a" });
      const orgB = await seedOrg({ orgId: "org-b" });
      await seedApiEntitlement({ orgId: orgA.orgId });
      const { rawKey } = await seedApiKey({
        orgId: orgA.orgId,
        userId: orgA.userId,
        keyId: "key-a-cross-delete",
        scopes: ["customers:write"],
      });

      const customerBId = await seedCustomer({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b-papi",
        name: "Beta Industries (API)",
      });
      const assetTypeId = await seedAssetType("balanca-b-papi");
      const assetB = await seedAsset({
        unitId: orgB.unitId,
        customerId: customerBId,
        assetTypeId,
        tag: "PAPI-B-ASSET",
      });

      const res = await publicApiV2Router.request(
        `/customers/${customerBId}`,
        {
          method: "DELETE",
          headers: {
            "x-api-key": rawKey,
            "idempotency-key": `del-customer-cross-${customerBId}`,
          },
        },
      );

      // resolveExternalResourceId returns the raw numeric id (org-agnostic);
      // the handler's own SELECT scoped by labOrganizationId is what rejects
      // org B's customer — 404, matching REQ-PAPI-005's cross-tenant pattern.
      expect(res.status).toBe(404);

      // Org B's customer + asset are UNTOUCHED.
      const stillThereCustomer = await db
        .select()
        .from(customer)
        .where(eq(customer.id, customerBId));
      expect(stillThereCustomer).toHaveLength(1);
      const stillThereAsset = await db
        .select()
        .from(asset)
        .where(eq(asset.id, assetB));
      expect(stillThereAsset).toHaveLength(1);

      // No audit rows were written for org B's asset — the cross-tenant guard
      // fires BEFORE any delete-audit insert would happen.
      const logs = await db
        .select()
        .from(assetAuditLog)
        .where(eq(assetAuditLog.assetId, assetB));
      expect(logs).toHaveLength(0);
    },
  );
});
