import { beforeEach, describe, expect, it } from "vitest";
import { assetsRouter } from "./assets";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  assetAuditLog,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the assets router.
// Only the better-auth session is mocked (see test/integration/setup.ts);
// withLabPermission -> requireOrganization -> requirePermission and the
// unit-scope resolver run for real against the seeded Postgres.
//
// Proven properties:
//  REQ-ASSET-01  GET / returns ONLY the authed org's assets (tenant isolation)
//  REQ-ASSET-02  Cross-tenant GET /:id leaks no data
//  REQ-ASSET-03  POST / as member (equipment:create absent) -> 403
//  REQ-ASSET-04  POST / as admin -> 201, persists with correct org/unit scope + audit log
//  REQ-ASSET-05  Unit-scope filter: asset in unit-B is hidden from unit-A member
//  REQ-ASSET-06  Unauthenticated requests -> 401

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so this file stays self-contained and parallel
// makers cannot conflict with the shared seed.ts
// ---------------------------------------------------------------------------

/** Seed a CLIENT organization (required as customer.authOrganizationId). */
async function seedClientOrg(clientOrgId: string): Promise<void> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client Org ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: now,
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/** Seed a customer row linked to a LAB org. Returns the customer id. */
async function seedCustomer(params: {
  labOrganizationId: string;
  name?: string;
}): Promise<number> {
  const clientOrgId = `client-org-for-${params.labOrganizationId}-${Date.now()}`;
  await seedClientOrg(clientOrgId);

  const [row] = await db
    .insert(customer)
    .values({
      name: params.name ?? `Customer of ${params.labOrganizationId}`,
      authOrganizationId: clientOrgId,
      labOrganizationId: params.labOrganizationId,
    })
    .returning({ id: customer.id });

  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/** Seed an asset type with no required spec fields. Returns the type id. */
async function seedAssetType(slug?: string): Promise<number> {
  const uniqueSlug = slug ?? `test-type-${Date.now()}`;
  const [row] = await db
    .insert(assetType)
    .values({
      name: "Test Instrument",
      slug: uniqueSlug,
      definition: [],
    })
    .returning({ id: assetType.id });

  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/**
 * Seed an asset scoped to a unit, customer, and asset type.
 * Returns the created asset id.
 */
async function seedAsset(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
  name?: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: params.name ?? "Test Asset",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      subjectToLegalMetrology: false,
    })
    .returning({ id: asset.id });

  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assetsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-ASSET-01 ---------------------------------------------------------------
  it(
    "REQ-ASSET-01: GET / returns only the authenticated org's assets (tenant isolation)",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const typeId = await seedAssetType("type-iso-01");
      const customerA = await seedCustomer({ labOrganizationId: orgA.orgId, name: "Cust A" });
      const customerB = await seedCustomer({ labOrganizationId: orgB.orgId, name: "Cust B" });

      await seedAsset({ unitId: orgA.unitId, customerId: customerA, assetTypeId: typeId, tag: "TAG-A1", name: "Asset A" });
      await seedAsset({ unitId: orgB.unitId, customerId: customerB, assetTypeId: typeId, tag: "TAG-B1", name: "Asset B" });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await assetsRouter.request("/", {
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      const tags = body.data.map((a: { tag: string }) => a.tag);
      expect(tags).toContain("TAG-A1");
      expect(tags).not.toContain("TAG-B1");
      expect(body.pagination.total).toBe(1);
    },
  );

  // REQ-ASSET-02 ---------------------------------------------------------------
  it(
    "REQ-ASSET-02: GET /:id of another org's asset leaks no data (cross-tenant isolation)",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const typeId = await seedAssetType("type-iso-02");
      const customerB = await seedCustomer({ labOrganizationId: orgB.orgId, name: "Cust B" });
      const assetBId = await seedAsset({
        unitId: orgB.unitId,
        customerId: customerB,
        assetTypeId: typeId,
        tag: "TAG-B-CROSS",
        name: "Org B Asset",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      // Use the numeric id directly — resolveAssetRouteId scopes by
      // customer.labOrganizationId so the foreign asset resolves to null -> 400
      const res = await assetsRouter.request(`/${assetBId}`, {
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
      });

      // The route id resolver scopes by org; the foreign asset yields null -> 400.
      // Org B's data is never returned across the tenant boundary.
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).not.toHaveProperty("name");
      expect(body).not.toHaveProperty("tag");
    },
  );

  // REQ-ASSET-03 ---------------------------------------------------------------
  it(
    "REQ-ASSET-03: POST / as role=member -> 403 (equipment:create not granted to member)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      const typeId = await seedAssetType("type-iso-03");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request("/", {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          customerId: cid,
          assetTypeId: typeId,
          name: "Blocked Asset",
          serialNumber: "SN-BLOCKED",
          tag: "TAG-BLOCKED",
        }),
      });

      expect(res.status).toBe(403);
    },
  );

  // REQ-ASSET-04 ---------------------------------------------------------------
  it(
    "REQ-ASSET-04: POST / as admin -> 201, persists org/unit-scoped asset + audit log entry",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-iso-04");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request("/", {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          customerId: cid,
          assetTypeId: typeId,
          name: "New Asset",
          serialNumber: "SN-NEW-001",
          tag: "TAG-NEW-001",
        }),
      });

      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.name).toBe("New Asset");
      expect(created.tag).toBe("TAG-NEW-001");
      // Asset is persisted under the active unit from the header
      expect(created.unitId).toBe(org.unitId);

      // Audit log must have one "create" entry performed by the authed user
      const logs = await db
        .select()
        .from(assetAuditLog)
        .where(eq(assetAuditLog.assetId, created.id));
      expect(logs).toHaveLength(1);
      expect(logs[0]?.action).toBe("create");
      expect(logs[0]?.performedBy).toBe(org.userId);
    },
  );

  // REQ-ASSET-05 ---------------------------------------------------------------
  it(
    "REQ-ASSET-05: Unit-scope — asset in unit-B is excluded when requesting with unit-A header",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });

      // Seed a second unit within the same org
      const { organizationUnit } = await import("@calibra-facil/db/schema");
      const [unitB] = await db
        .insert(organizationUnit)
        .values({
          organizationId: org.orgId,
          name: "Branch",
          slug: "branch",
          status: "ACTIVE",
          isDefault: false,
          createdBy: org.userId,
        })
        .returning({ id: organizationUnit.id });

      if (!unitB) throw new Error("failed to seed unit B");

      const typeId = await seedAssetType("type-iso-05");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });

      // Asset in default unit (org.unitId)
      await seedAsset({ unitId: org.unitId, customerId: cid, assetTypeId: typeId, tag: "TAG-UNIT-A", name: "Unit-A Asset" });
      // Asset in unit B
      await seedAsset({ unitId: unitB.id, customerId: cid, assetTypeId: typeId, tag: "TAG-UNIT-B", name: "Unit-B Asset" });

      // Request scoped to unit A only
      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request("/", {
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      const tags = body.data.map((a: { tag: string }) => a.tag);
      expect(tags).toContain("TAG-UNIT-A");
      expect(tags).not.toContain("TAG-UNIT-B");
    },
  );

  // REQ-ASSET-06 ---------------------------------------------------------------
  it("REQ-ASSET-06: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await assetsRouter.request("/", { headers: JSON_HEADERS });
    expect(res.status).toBe(401);
  });
});
