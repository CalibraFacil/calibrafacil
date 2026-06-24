import { beforeEach, describe, expect, it } from "vitest";
import { environmentalLimitsRouter } from "./environmental-limits";
import { db } from "@calibra-facil/db";
import {
  environmentalLimits,
  organizationUnit,
  assetType,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the environmental-limits router.
// Only the better-auth session is mocked (see test/integration/setup.ts);
// requireLabAuth -> requireOrganization -> requireOrgType("LAB") +
// requireUnitOperationalSettingsManager and resolveMemberUnitScope /
// resolveAccessibleUnitContext all run for real against the seeded Postgres.
//
// Access model (quoted from environmental-limits.ts):
//   .get("/", ...requireLabProtected, requireOrgType("LAB"), ...)
//     -> requireUnitOperationalSettingsManager(memberData)
//   .put("/", ...requireLabProtected, requireOrgType("LAB"), ...)
//     -> requireUnitOperationalSettingsManager(memberData)
// requireUnitOperationalSettingsManager -> isUnitScopedManagementRole, which is
// true ONLY for role owner/admin OR unitRole "unit_admin". A seeded `member`
// (default unit assignment role "member") therefore gets 403 on read AND write.
//
// The table is org + unit scoped: every WHERE filters on BOTH
// environmentalLimits.organizationId == member.organizationId AND
// environmentalLimits.unitId == unit.unitId.
//
// Proven properties:
//  REQ-EL-001  GET / returns ONLY the authed org's limits (tenant isolation)
//  REQ-EL-002  PUT as member -> 403; PUT as admin -> 200 + persists (re-queried)
//  REQ-EL-003  Unauthenticated -> 401
//  REQ-EL-004  GET scoped to unit-A excludes unit-B limits (unit isolation)
//  Core happy-path  PUT create -> GET read round-trip persists

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so parallel makers cannot conflict with seed.ts.
// ---------------------------------------------------------------------------

/** Seed an asset type with no required spec fields. Returns the type id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({
      name: `Type ${slug}`,
      slug,
      definition: [],
    })
    .returning({ id: assetType.id });

  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/**
 * Seed an environmental-limits row scoped to an org + unit (+ optional asset
 * type). Returns the created row id.
 */
async function seedEnvLimit(params: {
  organizationId: string;
  unitId: number;
  assetTypeId?: number | null;
  temperatureMin?: number;
  temperatureMax?: number;
  updatedBy: string;
}): Promise<number> {
  const [row] = await db
    .insert(environmentalLimits)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      assetTypeId: params.assetTypeId ?? null,
      temperatureMin: params.temperatureMin ?? 18,
      temperatureMax: params.temperatureMax ?? 25,
      humidityMin: 40,
      humidityMax: 60,
      pressureMin: 980,
      pressureMax: 1040,
      updatedBy: params.updatedBy,
    })
    .returning({ id: environmentalLimits.id });

  if (!row) throw new Error("seedEnvLimit: insert failed");
  return row.id;
}

/** Seed a second ACTIVE unit within an existing org. Returns the unit id. */
async function seedExtraUnit(params: {
  organizationId: string;
  name: string;
  slug: string;
  createdBy: string;
}): Promise<number> {
  const [row] = await db
    .insert(organizationUnit)
    .values({
      organizationId: params.organizationId,
      name: params.name,
      slug: params.slug,
      status: "ACTIVE",
      isDefault: false,
      createdBy: params.createdBy,
    })
    .returning({ id: organizationUnit.id });

  if (!row) throw new Error("seedExtraUnit: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("environmentalLimitsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-EL-001 ---------------------------------------------------------------
  it(
    "REQ-EL-001: GET / returns only the authenticated org's limits (tenant isolation)",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const typeA = await seedAssetType("env-type-a-001");
      const typeB = await seedAssetType("env-type-b-001");

      // Org-A's limit: distinctive temperatureMax we can assert by value.
      await seedEnvLimit({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        assetTypeId: typeA,
        temperatureMax: 22.5,
        updatedBy: orgA.userId,
      });
      // Org-B's leak row is deliberately placed on ORG-A's unit id (a
      // cross-org row, allowed: env_limits has separate single-column FKs, no
      // composite org+unit FK). This makes `organizationId` the SOLE
      // discriminator for org-A's read: the unit filter alone can NOT hide it,
      // so if the handler's org filter regressed, this row would leak — driving
      // the assertion below RED. (Without this, distinct serial unit ids let
      // the unit filter mask a dead org filter, making the test tautological.)
      await seedEnvLimit({
        organizationId: orgB.orgId,
        unitId: orgA.unitId,
        assetTypeId: typeB,
        temperatureMax: 99.9,
        updatedBy: orgB.userId,
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await environmentalLimitsRouter.request("/", {
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.limits)).toBe(true);
      expect(body.limits).toHaveLength(1);
      const assetTypeIds = body.limits.map(
        (l: { assetTypeId: number | null }) => l.assetTypeId,
      );
      expect(assetTypeIds).toContain(typeA);
      expect(assetTypeIds).not.toContain(typeB);
      const maxes = body.limits.map(
        (l: { temperatureMax: number | null }) => l.temperatureMax,
      );
      expect(maxes).toContain(22.5);
      // Org-B's data must never cross the tenant boundary.
      expect(maxes).not.toContain(99.9);
    },
  );

  // REQ-EL-002 ---------------------------------------------------------------
  it(
    "REQ-EL-002: PUT / as role=member -> 403 (requireUnitOperationalSettingsManager denies non-managers)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      const typeId = await seedAssetType("env-type-rbac-002");

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await environmentalLimitsRouter.request("/", {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          assetTypeId: typeId,
          temperatureMin: 18,
          temperatureMax: 25,
          humidityMin: 40,
          humidityMax: 60,
          pressureMin: 980,
          pressureMax: 1040,
        }),
      });

      expect(res.status).toBe(403);

      // Nothing was persisted by the denied member.
      const rows = await db
        .select()
        .from(environmentalLimits)
        .where(eq(environmentalLimits.organizationId, org.orgId));
      expect(rows).toHaveLength(0);
    },
  );

  it(
    "REQ-EL-002: PUT / as role=admin -> 200 and persists the limit (re-queried from DB)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("env-type-rbac-002b");

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await environmentalLimitsRouter.request("/", {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          assetTypeId: typeId,
          temperatureMin: 19,
          temperatureMax: 23,
          humidityMin: 45,
          humidityMax: 55,
          pressureMin: 990,
          pressureMax: 1030,
        }),
      });

      expect(res.status).toBe(200);
      const created = await res.json();
      expect(created.data.organizationId).toBe(org.orgId);
      expect(created.data.unitId).toBe(org.unitId);
      expect(created.data.assetTypeId).toBe(typeId);

      // Re-query the DB to prove persistence with the correct org/unit scope.
      const rows = await db
        .select()
        .from(environmentalLimits)
        .where(
          and(
            eq(environmentalLimits.organizationId, org.orgId),
            eq(environmentalLimits.unitId, org.unitId),
            eq(environmentalLimits.assetTypeId, typeId),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.temperatureMin).toBe(19);
      expect(rows[0]?.temperatureMax).toBe(23);
      expect(rows[0]?.updatedBy).toBe(org.userId);
    },
  );

  // REQ-EL-003 ---------------------------------------------------------------
  it("REQ-EL-003: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await environmentalLimitsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  it("REQ-EL-003: PUT / unauthenticated -> 401 (no write without a session)", async () => {
    logout();
    const res = await environmentalLimitsRouter.request("/", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        assetTypeId: null,
        temperatureMin: 18,
        temperatureMax: 25,
        humidityMin: 40,
        humidityMax: 60,
        pressureMin: 980,
        pressureMax: 1040,
      }),
    });
    expect(res.status).toBe(401);
  });

  // REQ-EL-004 ---------------------------------------------------------------
  it(
    "REQ-EL-004: GET scoped to unit-A excludes unit-B limits (unit isolation)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const unitB = await seedExtraUnit({
        organizationId: org.orgId,
        name: "Branch",
        slug: "branch",
        createdBy: org.userId,
      });

      const typeA = await seedAssetType("env-type-unit-a-004");
      const typeB = await seedAssetType("env-type-unit-b-004");

      // Limit in the default unit (org.unitId).
      await seedEnvLimit({
        organizationId: org.orgId,
        unitId: org.unitId,
        assetTypeId: typeA,
        temperatureMax: 21.1,
        updatedBy: org.userId,
      });
      // Limit in unit B (same org) — must be hidden when scoped to unit A.
      await seedEnvLimit({
        organizationId: org.orgId,
        unitId: unitB,
        assetTypeId: typeB,
        temperatureMax: 88.8,
        updatedBy: org.userId,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await environmentalLimitsRouter.request("/", {
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.unit.unitId).toBe(org.unitId);
      const assetTypeIds = body.limits.map(
        (l: { assetTypeId: number | null }) => l.assetTypeId,
      );
      expect(assetTypeIds).toContain(typeA);
      expect(assetTypeIds).not.toContain(typeB);
      const maxes = body.limits.map(
        (l: { temperatureMax: number | null }) => l.temperatureMax,
      );
      expect(maxes).toContain(21.1);
      expect(maxes).not.toContain(88.8);
    },
  );

  // Core happy-path ----------------------------------------------------------
  it(
    "core: PUT create -> GET read round-trips for the same org+unit",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("env-type-roundtrip");

      loginAs({ userId: org.userId, organizationId: org.orgId });

      const putRes = await environmentalLimitsRouter.request("/", {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          assetTypeId: typeId,
          temperatureMin: 20,
          temperatureMax: 24,
          humidityMin: 50,
          humidityMax: 65,
          pressureMin: 1000,
          pressureMax: 1020,
        }),
      });
      expect(putRes.status).toBe(200);

      const getRes = await environmentalLimitsRouter.request("/", {
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      });
      expect(getRes.status).toBe(200);
      const body = await getRes.json();
      expect(body.limits).toHaveLength(1);
      const limit = body.limits[0];
      expect(limit.assetTypeId).toBe(typeId);
      expect(limit.assetTypeName).toBe("Type env-type-roundtrip");
      expect(limit.temperatureMin).toBe(20);
      expect(limit.temperatureMax).toBe(24);
      expect(limit.humidityMin).toBe(50);
      expect(limit.humidityMax).toBe(65);
      expect(limit.pressureMin).toBe(1000);
      expect(limit.pressureMax).toBe(1020);
    },
  );
});
