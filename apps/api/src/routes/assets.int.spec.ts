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
//  REQ-MLR-030   Lab LEGAL write persists Track-2 + derives the date, leaves Track-1 untouched
//  REQ-MLR-031   Switching to INDUSTRIAL clears Track-2, keeps the customer interval
//  REQ-MLR-032   A regime change writes an asset_audit_log row
//  REQ-MLR-033   PUT regime change without equipment:update -> 403

const JSON_HEADERS = { "content-type": "application/json" };

// A valid regulated (Track-2) verification periodicity: taxímetro-style fixed 24 months
// anchored to the last verification. Validated by RegulatedIntervalSchema at the route.
const LEGAL_REGULATED = {
  kind: "fixed_months",
  valueMonths: 24,
  anchor: "last_verification",
  regulationReference: "Portaria Inmetro nº 124/2022",
  operationalizedByDelegate: false,
};

// A regulated period anchored to the installation date (hidrômetro-style ceiling).
// Track-2: next_legal_verification_date = installed_at + valueMonths (REQ-INSTALL-002).
const LEGAL_FROM_INSTALL = {
  kind: "max_months_from_install",
  valueMonths: 84,
  anchor: "install_year",
  regulationReference: "Portaria Inmetro nº 155/2022",
  operationalizedByDelegate: false,
};

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

  // REQ-MLR-030 ---------------------------------------------------------------
  it(
    "REQ-MLR-030 [HIGH]: lab LEGAL write persists the regulated period + derives next_legal_verification_date, and leaves the customer interval (Track 1) untouched",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-mlr-030");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cid,
        assetTypeId: typeId,
        tag: "TAG-MLR-030",
      });

      // Simulate a customer-owned calibration interval already set (Track 1) + a last date.
      await db
        .update(asset)
        .set({
          calibrationIntervalMonths: 12,
          intervalSetBy: "customer_confirmed",
          nextCalibrationDate: new Date("2025-01-15T00:00:00.000Z"),
          lastCalibrationDate: new Date("2024-01-15T00:00:00.000Z"),
        })
        .where(eq(asset.id, assetId));

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request(`/${assetId}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          metrologyRegime: "LEGAL",
          regulatedInterval: LEGAL_REGULATED,
        }),
      });
      expect(res.status).toBe(200);

      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1);
      // Track 2 persisted + derived.
      expect(row?.metrologyRegime).toBe("LEGAL");
      expect(row?.subjectToLegalMetrology).toBe(true);
      expect(row?.regulatedInterval).toMatchObject({
        kind: "fixed_months",
        valueMonths: 24,
        regulationReference: "Portaria Inmetro nº 124/2022",
      });
      // 2024-01-15 + 24 months.
      expect(row?.nextLegalVerificationDate?.toISOString().slice(0, 10)).toBe(
        "2026-01-15",
      );
      // Track 1 (customer-owned) is NOT touched by the regime write.
      expect(row?.calibrationIntervalMonths).toBe(12);
      expect(row?.intervalSetBy).toBe("customer_confirmed");
      expect(row?.nextCalibrationDate?.toISOString().slice(0, 10)).toBe(
        "2025-01-15",
      );
    },
  );

  // REQ-MLR-031 ---------------------------------------------------------------
  it(
    "REQ-MLR-031 [HIGH]: switching to INDUSTRIAL clears the regulated period (Track 2) and keeps the customer interval (Track 1)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-mlr-031");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cid,
        assetTypeId: typeId,
        tag: "TAG-MLR-031",
      });

      // Start as a LEGAL asset with a regulated period AND a customer-owned interval.
      await db
        .update(asset)
        .set({
          metrologyRegime: "LEGAL",
          subjectToLegalMetrology: true,
          regulatedInterval: LEGAL_REGULATED,
          nextLegalVerificationDate: new Date("2026-01-15T00:00:00.000Z"),
          calibrationIntervalMonths: 12,
          intervalSetBy: "customer_confirmed",
        })
        .where(eq(asset.id, assetId));

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request(`/${assetId}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({ metrologyRegime: "INDUSTRIAL" }),
      });
      expect(res.status).toBe(200);

      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1);
      expect(row?.metrologyRegime).toBe("INDUSTRIAL");
      expect(row?.subjectToLegalMetrology).toBe(false);
      expect(row?.regulatedInterval).toBeNull();
      expect(row?.nextLegalVerificationDate).toBeNull();
      // Customer-owned interval (Track 1) is intact.
      expect(row?.calibrationIntervalMonths).toBe(12);
      expect(row?.intervalSetBy).toBe("customer_confirmed");
    },
  );

  // REQ-MLR-032 ---------------------------------------------------------------
  it(
    "REQ-MLR-032 [HIGH]: a regime / regulated-interval change writes an asset_audit_log row",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-mlr-032");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cid,
        assetTypeId: typeId,
        tag: "TAG-MLR-032",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request(`/${assetId}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          metrologyRegime: "LEGAL",
          regulatedInterval: LEGAL_REGULATED,
        }),
      });
      expect(res.status).toBe(200);

      const logs = await db
        .select()
        .from(assetAuditLog)
        .where(eq(assetAuditLog.assetId, assetId));
      const updateLog = logs.find((l) => l.action === "update");
      expect(updateLog).toBeTruthy();
      expect(updateLog?.performedBy).toBe(org.userId);
      // The regime change is captured in the audit diff (INDUSTRIAL -> LEGAL).
      expect(updateLog?.changes).toHaveProperty("metrologyRegime");
    },
  );

  // REQ-INSTALL-002 / 003 / 004 ------------------------------------------------
  it(
    "REQ-INSTALL-002/004 [HIGH]: lab creates a LEGAL asset with max_months_from_install + installed_at -> next_legal_verification_date = installed + valueMonths",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-install-002");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request("/", {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          customerId: cid,
          assetTypeId: typeId,
          name: "Hidrômetro",
          serialNumber: "SN-INSTALL-002",
          tag: "TAG-INSTALL-002",
          metrologyRegime: "LEGAL",
          regulatedInterval: LEGAL_FROM_INSTALL,
          installedAt: "2020-03-01T00:00:00.000Z",
        }),
      });
      expect(res.status).toBe(201);
      const created = await res.json();

      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.id, created.id))
        .limit(1);
      // REQ-INSTALL-004: the installation date is persisted.
      expect(row?.installedAt?.toISOString()).toBe("2020-03-01T00:00:00.000Z");
      // REQ-INSTALL-002: 2020-03-01 + 84 months = 2027-03-01 (ceiling from install).
      expect(row?.nextLegalVerificationDate?.toISOString().slice(0, 10)).toBe(
        "2027-03-01",
      );
    },
  );

  it(
    "REQ-INSTALL-003 [HIGH]: a LEGAL max_months_from_install asset with installed_at null leaves next_legal_verification_date null (no fabricated date)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-install-003");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cid,
        assetTypeId: typeId,
        tag: "TAG-INSTALL-003",
      });

      // A last verification IS present — proves the date is NOT fabricated from it.
      await db
        .update(asset)
        .set({ lastCalibrationDate: new Date("2024-01-15T00:00:00.000Z") })
        .where(eq(asset.id, assetId));

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request(`/${assetId}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          metrologyRegime: "LEGAL",
          regulatedInterval: LEGAL_FROM_INSTALL,
        }),
      });
      expect(res.status).toBe(200);

      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1);
      expect(row?.installedAt).toBeNull();
      expect(row?.nextLegalVerificationDate).toBeNull();
    },
  );

  it(
    "REQ-INSTALL-002/004 [HIGH]: PUT setting installed_at on a LEGAL max_months_from_install asset derives the date",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-install-002b");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cid,
        assetTypeId: typeId,
        tag: "TAG-INSTALL-002B",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request(`/${assetId}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          metrologyRegime: "LEGAL",
          regulatedInterval: LEGAL_FROM_INSTALL,
          installedAt: "2018-06-10T00:00:00.000Z",
        }),
      });
      expect(res.status).toBe(200);

      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1);
      expect(row?.installedAt?.toISOString()).toBe("2018-06-10T00:00:00.000Z");
      // 2018-06-10 + 84 months = 2025-06-10.
      expect(row?.nextLegalVerificationDate?.toISOString().slice(0, 10)).toBe(
        "2025-06-10",
      );
    },
  );

  // REQ-MLR-033 ---------------------------------------------------------------
  it(
    "REQ-MLR-033 [HIGH]: PUT a regime / regulated-interval change as role=member -> 403 (equipment:update not granted)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      const typeId = await seedAssetType("type-mlr-033");
      const cid = await seedCustomer({ labOrganizationId: org.orgId });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cid,
        assetTypeId: typeId,
        tag: "TAG-MLR-033",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await assetsRouter.request(`/${assetId}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          metrologyRegime: "LEGAL",
          regulatedInterval: LEGAL_REGULATED,
        }),
      });
      expect(res.status).toBe(403);
    },
  );
});
