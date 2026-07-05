/**
 * dashboard.int.spec.ts — Real-DB + real-RBAC integration tests for the
 * READ-ONLY dashboard aggregation router (`GET /stats`).
 *
 * Only the better-auth session is mocked (see test/integration/setup.ts);
 * requireLabAuth → requireOrganization → requireOrgType("LAB") →
 * requirePermission({ calibration: ["read"] }) and buildUnitScopeCondition run
 * for real against a seeded Postgres.
 *
 * The router is a single endpoint that COUNTs/SUMs rows across many domains.
 * The chief risk for an aggregate is a cross-org / cross-unit leak: a count that
 * silently folds in another tenant's rows. Every isolation assertion below seeds
 * a SECOND tenant's data that WOULD inflate org-A's number if the org/unit filter
 * regressed, so the filter is the sole thing keeping it out (no tautology).
 *
 * Proven properties (oracle):
 *   REQ-DASH-001  Tenant isolation of aggregates — org A's stats count ONLY
 *                 org A's data, across a unit-scoped aggregate (pendingCalibrations)
 *                 AND an org-only cross-domain aggregate (openNonConformances).
 *   REQ-DASH-002  Unit isolation — an admin scoped to unit A (x-active-unit-id)
 *                 sees only unit-A job aggregates, not unit-B's (same org).
 *   REQ-DASH-003  Unauthenticated → 401 via the real guard.
 *   REQ-DASH-004  calibration:read gate admits a member role → 200.
 *   REQ-DASH-005  Happy path — /stats returns the documented shape with correct
 *                 numbers for seeded data.
 *
 * The route guard (dashboard.ts L53):
 *   .get("/stats", ...withLabPermission({ calibration: ["read"] }), ...)
 *   withLabPermission = requireLabAuth + requireOrganization + requireOrgType("LAB")
 *                       + requirePermission({ calibration: ["read"] })
 * Org scope (dashboard.ts L116 etc.):
 *   eq(calibrationJob.organizationId, memberData.organizationId)
 * Unit scope (dashboard.ts L68/L117):
 *   jobUnitScopeCondition = buildUnitScopeCondition(calibrationJob.unitId, memberData)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { dashboardRouter } from "./dashboard";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  organization,
  organizationUnit,
  assetType,
  asset,
  customer,
  service,
  nonConformance,
} from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };
const NOW = new Date("2026-01-01T00:00:00.000Z");

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so this file is self-contained and parallel
// worktrees cannot conflict with the shared seed.ts.
// ---------------------------------------------------------------------------

/** Insert a minimal CLIENT org (required for customer.authOrganizationId FK). */
async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: NOW,
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/** Seed a customer owned by a LAB org. Returns customer.id. */
async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: `Customer of ${params.labOrgId}`,
      labOrganizationId: params.labOrgId,
      authOrganizationId: params.clientOrgId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/** Seed an assetType. Returns assetType.id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: `Asset Type ${slug}`, slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/** Seed an asset. Returns asset.id. */
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
      // SEC-03b (#638): per-org tag uniqueness — derive lab org from the customer.
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      assetTypeId: params.assetTypeId,
      name: "Test Instrument",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/** Seed a service. Returns service.id. */
async function seedService(params: {
  organizationId: string;
  unitId: number;
}): Promise<number> {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: `Service ${params.organizationId}-${params.unitId}`,
      isActive: true,
    })
    .returning({ id: service.id });
  if (!row) throw new Error("seedService: insert failed");
  return row.id;
}

/** Minimal valid MethodSnapshot (NOT-NULL JSONB on calibration_job). */
function minimalMethodSnapshot() {
  return {
    methodId: 1,
    methodName: "Test Method",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  } satisfies Record<string, unknown>;
}

type JobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "GENERATING_PDF"
  | "CANCELED";

/** Seed a calibration_job row. Returns the DB-assigned numeric id. */
async function seedJob(params: {
  jobId: string;
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
  status?: JobStatus;
}): Promise<number> {
  const [row] = await db
    .insert(calibrationJob)
    .values({
      jobId: params.jobId,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      createdBy: params.createdBy,
      status: params.status ?? "DRAFT",
      methodSnapshot: minimalMethodSnapshot(),
      certificateName: params.jobId,
    })
    .returning({ id: calibrationJob.id });
  if (!row) throw new Error("seedJob: insert failed");
  return row.id;
}

/** Seed an OPEN (not "resolved") non_conformance row scoped to an org. */
async function seedNC(params: {
  orgId: string;
  detectedByUserId: string;
  suffix: string;
}): Promise<number> {
  const [row] = await db
    .insert(nonConformance)
    .values({
      ncNumber: `NC-2026-${params.suffix}`,
      organizationId: params.orgId,
      type: "work",
      description: "Medicao fora de tolerancia",
      detectedBy: params.detectedByUserId,
      detectedAt: NOW,
      status: "open",
      createdBy: params.detectedByUserId,
    })
    .returning({ id: nonConformance.id });
  if (!row) throw new Error("seedNC: insert failed");
  return row.id;
}

/** Seed a non-default ACTIVE unit. Returns organizationUnit.id. */
async function seedUnit(params: {
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
  if (!row) throw new Error("seedUnit: insert failed");
  return row.id;
}

/**
 * Seed a complete domain fixture for one org (org + unit + user + member +
 * client-org + customer + assetType + asset + service). Returns the IDs needed
 * to seed calibration jobs.
 */
async function seedDashboardFixture(params: {
  orgId: string;
  userId: string;
  role?: "owner" | "admin" | "technician" | "operator" | "member";
  tagSuffix?: string;
}) {
  const org = await seedOrg({
    orgId: params.orgId,
    userId: params.userId,
    role: params.role ?? "admin",
  });

  const customerId = await seedCustomer({
    labOrgId: params.orgId,
    clientOrgId: `client-${params.orgId}`,
  });

  const tagSuffix = params.tagSuffix ?? params.orgId;
  const assetTypeId = await seedAssetType(`at-${tagSuffix}`);
  const assetId = await seedAsset({
    unitId: org.unitId,
    customerId,
    assetTypeId,
    tag: `TAG-${tagSuffix}`,
  });
  const serviceId = await seedService({
    organizationId: params.orgId,
    unitId: org.unitId,
  });

  return { ...org, customerId, assetTypeId, assetId, serviceId };
}

// ---------------------------------------------------------------------------

describe("dashboardRouter — real DB + real middleware (READ-ONLY aggregation)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-DASH-001 [HIGH RISK]: Tenant isolation of aggregates.
  //
  // Mutation-RED proof (org filter): in dashboard.ts, replacing the org predicate
  //   eq(calibrationJob.organizationId, memberData.organizationId)
  // with eq(calibrationJob.organizationId, calibrationJob.organizationId) on the
  // pending query makes pendingCalibrations include org-B's 3 jobs → 2 ≠ 5 → RED.
  // Likewise dropping eq(nonConformance.organizationId, ...) makes
  // openNonConformances include org-B's NCs → 1 ≠ 3 → RED.
  // =========================================================================
  it(
    "REQ-DASH-001: /stats counts ONLY the caller's org — job + NC aggregates exclude org B's rows",
    async () => {
      const orgA = await seedDashboardFixture({
        orgId: "org-a",
        userId: "user-a",
        tagSuffix: "a",
      });
      const orgB = await seedDashboardFixture({
        orgId: "org-b",
        userId: "user-b",
        tagSuffix: "b",
      });

      // Org A: 2 "pending" jobs (DRAFT + REVIEW are in the pending set).
      await seedJob({
        jobId: "A-1",
        organizationId: "org-a",
        unitId: orgA.unitId,
        customerId: orgA.customerId,
        assetId: orgA.assetId,
        serviceId: orgA.serviceId,
        createdBy: orgA.userId,
        status: "DRAFT",
      });
      await seedJob({
        jobId: "A-2",
        organizationId: "org-a",
        unitId: orgA.unitId,
        customerId: orgA.customerId,
        assetId: orgA.assetId,
        serviceId: orgA.serviceId,
        createdBy: orgA.userId,
        status: "REVIEW",
      });

      // Org B: 3 "pending" jobs that WOULD inflate org A's count if the org
      // filter regressed (DRAFT, IN_PROGRESS, REVIEW are all in the pending set).
      for (const [i, status] of (
        ["DRAFT", "IN_PROGRESS", "REVIEW"] as const
      ).entries()) {
        await seedJob({
          jobId: `B-${i}`,
          organizationId: "org-b",
          unitId: orgB.unitId,
          customerId: orgB.customerId,
          assetId: orgB.assetId,
          serviceId: orgB.serviceId,
          createdBy: orgB.userId,
          status,
        });
      }

      // Org A: 1 open NC. Org B: 2 open NCs (would leak into org A's count).
      await seedNC({
        orgId: "org-a",
        detectedByUserId: orgA.userId,
        suffix: "A1",
      });
      await seedNC({
        orgId: "org-b",
        detectedByUserId: orgB.userId,
        suffix: "B1",
      });
      await seedNC({
        orgId: "org-b",
        detectedByUserId: orgB.userId,
        suffix: "B2",
      });

      loginAs({ userId: orgA.userId, organizationId: "org-a" });
      const res = await dashboardRouter.request("/stats", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Unit-scoped + org-scoped aggregate: only org A's 2 pending jobs.
      expect(body.pendingCalibrations).toBe(2);
      // Org-only (cross-domain) aggregate: only org A's 1 open NC.
      expect(body.openNonConformances).toBe(1);
    },
  );

  // =========================================================================
  // REQ-DASH-002: Unit isolation.
  //
  // An admin with x-active-unit-id = unit A → selectedUnitScope "unit",
  // activeUnitId = unit A → jobUnitScopeCondition = eq(unitId, unitA).
  // Mutation-RED proof (unit filter): removing jobUnitScopeCondition from the
  // pending query (so only the org filter remains) makes pendingCalibrations
  // include unit B's job (same org) → 1 ≠ 2 → RED.
  // =========================================================================
  it(
    "REQ-DASH-002: admin scoped to unit A sees only unit-A job aggregates, not unit B's (same org)",
    async () => {
      const org = await seedDashboardFixture({
        orgId: "org-a",
        userId: "user-a",
        tagSuffix: "a",
      });
      const unitA = org.unitId; // default "Matriz" unit

      // Second unit B in the SAME org, with its own asset (asset.unitId = B).
      const unitB = await seedUnit({
        organizationId: "org-a",
        name: "Filial B",
        slug: "filial-b",
        createdBy: org.userId,
      });
      const assetB = await seedAsset({
        unitId: unitB,
        customerId: org.customerId,
        assetTypeId: org.assetTypeId,
        tag: "TAG-B",
      });
      const serviceB = await seedService({
        organizationId: "org-a",
        unitId: unitB,
      });

      // Unit A: 1 pending job.
      await seedJob({
        jobId: "UA-1",
        organizationId: "org-a",
        unitId: unitA,
        customerId: org.customerId,
        assetId: org.assetId,
        serviceId: org.serviceId,
        createdBy: org.userId,
        status: "DRAFT",
      });
      // Unit B (same org): 1 pending job that WOULD leak if the unit filter died.
      await seedJob({
        jobId: "UB-1",
        organizationId: "org-a",
        unitId: unitB,
        customerId: org.customerId,
        assetId: assetB,
        serviceId: serviceB,
        createdBy: org.userId,
        status: "IN_PROGRESS",
      });

      loginAs({ userId: org.userId, organizationId: "org-a" });
      const res = await dashboardRouter.request("/stats", {
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(unitA) },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // Only unit A's 1 pending job — unit B's job is excluded by the unit scope.
      expect(body.pendingCalibrations).toBe(1);
    },
  );

  // Sanity-check that the unit filter is load-bearing in REQ-DASH-002: when the
  // SAME admin selects scope "all", both units fold in (proves the seeded data is
  // genuinely cross-unit, so the scoped count above is not a seeding artifact).
  it(
    "REQ-DASH-002 (counter-proof): same org under scope=all counts both units' pending jobs",
    async () => {
      const org = await seedDashboardFixture({
        orgId: "org-a",
        userId: "user-a",
        tagSuffix: "a",
      });
      const unitB = await seedUnit({
        organizationId: "org-a",
        name: "Filial B",
        slug: "filial-b",
        createdBy: org.userId,
      });
      const assetB = await seedAsset({
        unitId: unitB,
        customerId: org.customerId,
        assetTypeId: org.assetTypeId,
        tag: "TAG-B",
      });
      const serviceB = await seedService({
        organizationId: "org-a",
        unitId: unitB,
      });
      await seedJob({
        jobId: "UA-1",
        organizationId: "org-a",
        unitId: org.unitId,
        customerId: org.customerId,
        assetId: org.assetId,
        serviceId: org.serviceId,
        createdBy: org.userId,
        status: "DRAFT",
      });
      await seedJob({
        jobId: "UB-1",
        organizationId: "org-a",
        unitId: unitB,
        customerId: org.customerId,
        assetId: assetB,
        serviceId: serviceB,
        createdBy: org.userId,
        status: "IN_PROGRESS",
      });

      loginAs({ userId: org.userId, organizationId: "org-a" });
      const res = await dashboardRouter.request("/stats", {
        headers: { ...JSON_HEADERS, "x-active-unit-id": "all" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pendingCalibrations).toBe(2);
    },
  );

  // =========================================================================
  // REQ-DASH-003: Unauthenticated → 401 (requireLabAuth, first in the chain).
  // =========================================================================
  it("REQ-DASH-003: GET /stats unauthenticated → 401", async () => {
    logout();
    const res = await dashboardRouter.request("/stats", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // REQ-DASH-004: calibration:read is held broadly — a member role passes the
  // gate and gets a 200 (read is intentionally not role-restricted here).
  // =========================================================================
  it("REQ-DASH-004: role=member passes the calibration:read gate → 200", async () => {
    const org = await seedDashboardFixture({
      orgId: "org-a",
      userId: "user-a",
      role: "member",
      tagSuffix: "a",
    });
    loginAs({ userId: org.userId, organizationId: "org-a" });
    const res = await dashboardRouter.request("/stats", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(200);
  });

  // =========================================================================
  // REQ-DASH-005: Happy path — documented shape + correct numbers.
  // =========================================================================
  it(
    "REQ-DASH-005: /stats returns the documented shape with correct seeded numbers",
    async () => {
      const org = await seedDashboardFixture({
        orgId: "org-a",
        userId: "user-a",
        tagSuffix: "a",
      });

      // 1 DRAFT + 1 REVIEW = 2 pending. 1 NC open.
      await seedJob({
        jobId: "H-1",
        organizationId: "org-a",
        unitId: org.unitId,
        customerId: org.customerId,
        assetId: org.assetId,
        serviceId: org.serviceId,
        createdBy: org.userId,
        status: "DRAFT",
      });
      await seedJob({
        jobId: "H-2",
        organizationId: "org-a",
        unitId: org.unitId,
        customerId: org.customerId,
        assetId: org.assetId,
        serviceId: org.serviceId,
        createdBy: org.userId,
        status: "REVIEW",
      });
      await seedNC({
        orgId: "org-a",
        detectedByUserId: org.userId,
        suffix: "H1",
      });

      loginAs({ userId: org.userId, organizationId: "org-a" });
      const res = await dashboardRouter.request("/stats", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Documented KPI fields are present and well-typed.
      for (const key of [
        "pendingCalibrations",
        "approvedThisMonth",
        "rejectedThisMonth",
        "approvalRate",
        "expiringStandards",
        "overdueJobs",
        "openNonConformances",
        "capasOpen",
        "serviceOrdersInProgress",
      ] as const) {
        expect(typeof body[key]).toBe("number");
      }
      expect(Array.isArray(body.statusBreakdown)).toBe(true);
      expect(Array.isArray(body.recentJobs)).toBe(true);
      expect(Array.isArray(body.calibrationTrend)).toBe(true);

      // Correct numbers for the seeded data.
      expect(body.pendingCalibrations).toBe(2);
      expect(body.openNonConformances).toBe(1);
      // No approve/reject decisions this month → approvalRate defaults to 100.
      expect(body.approvedThisMonth).toBe(0);
      expect(body.rejectedThisMonth).toBe(0);
      expect(body.approvalRate).toBe(100);

      // recentJobs reflects exactly the 2 seeded jobs (org + unit scoped).
      const recentJobIds = body.recentJobs.map(
        (j: { jobId: string }) => j.jobId,
      );
      expect(recentJobIds).toContain("H-1");
      expect(recentJobIds).toContain("H-2");
      expect(body.recentJobs).toHaveLength(2);

      // statusBreakdown carries DRAFT + REVIEW counts of 1 each.
      const statusMap = new Map<string, number>(
        body.statusBreakdown.map((s: { status: string; count: number }) => [
          s.status,
          s.count,
        ]),
      );
      expect(statusMap.get("DRAFT")).toBe(1);
      expect(statusMap.get("REVIEW")).toBe(1);
    },
  );
});
