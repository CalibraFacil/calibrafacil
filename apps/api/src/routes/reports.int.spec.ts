import { beforeEach, describe, expect, it } from "vitest";
import { reportsRouter } from "./reports";
import { db } from "@calibra-facil/db";
import {
  organization,
  customer,
  assetType,
  asset,
  service,
  calibrationJob,
} from "@calibra-facil/db/schema";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the reportsRouter.
// Only the better-auth session is mocked (see test/integration/setup.ts).
// requireLabProtected -> requireOrgType("LAB") -> requireConsolidatedReportingAccess
// all run for real against the seeded Postgres.
//
// Proven properties:
//  REQ-RPT-001  Unauthenticated -> 401
//  REQ-RPT-002  role=member (canAccessConsolidatedView=false) -> 403
//  REQ-RPT-003  role=technician -> 403
//  REQ-RPT-004  role=admin (canAccessConsolidatedView=true) -> 200
//  REQ-RPT-005  Tenant isolation: org B's calibration jobs are NOT counted in org A's report
//  REQ-RPT-006  Unit-scope: unitIds param restricts executive-overview to selected units only
//  REQ-RPT-007  /consolidated/summary returns the same isolation guarantee
//  REQ-RPT-008  /consolidated/comparison returns the same isolation guarantee
//  REQ-RPT-009  /consolidated/trend returns the same isolation guarantee

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so this file is self-contained
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

/** Seed a customer linked to a LAB org. Returns the customer id. */
async function seedCustomer(params: {
  labOrganizationId: string;
  name?: string;
}): Promise<number> {
  const clientOrgId = `client-${params.labOrganizationId}-${Math.random().toString(36).slice(2, 8)}`;
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

/** Seed an asset type. Returns the type id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({
      name: "Test Instrument",
      slug,
      definition: [],
    })
    .returning({ id: assetType.id });

  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/** Seed an asset. Returns the asset id. */
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
      name: "Test Asset",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
    })
    .returning({ id: asset.id });

  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/** Seed a service (calibration offering). Returns the service id. */
async function seedCalibrationService(params: {
  organizationId: string;
  unitId: number;
}): Promise<number> {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: "Test Calibration Service",
      isActive: true,
    })
    .returning({ id: service.id });

  if (!row) throw new Error("seedCalibrationService: insert failed");
  return row.id;
}

/**
 * Seed a calibration job. Returns the job id.
 * The job is created with status=DRAFT (open) by default.
 */
async function seedCalibrationJob(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
  status?: "DRAFT" | "IN_PROGRESS" | "REVIEW" | "APPROVED" | "REJECTED";
  approvedAt?: Date;
  rejectedAt?: Date;
  dueDate?: Date;
}): Promise<number> {
  const counter = Math.floor(Math.random() * 9999999);
  const [row] = await db
    .insert(calibrationJob)
    .values({
      jobId: `JOB-${params.organizationId.slice(0, 4)}-${counter}`,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      createdBy: params.createdBy,
      methodSnapshot: {},
      status: params.status ?? "DRAFT",
      approvedAt: params.approvedAt ?? null,
      rejectedAt: params.rejectedAt ?? null,
      dueDate: params.dueDate ?? null,
    })
    .returning({ id: calibrationJob.id });

  if (!row) throw new Error("seedCalibrationJob: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reportsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-RPT-001 ---------------------------------------------------------------
  it("REQ-RPT-001: GET /consolidated/executive-overview unauthenticated -> 401", async () => {
    logout();
    const res = await reportsRouter.request(
      "/consolidated/executive-overview",
      { headers: JSON_HEADERS },
    );
    expect(res.status).toBe(401);
  });

  // REQ-RPT-002 ---------------------------------------------------------------
  it(
    "REQ-RPT-002: GET /consolidated/executive-overview as role=member -> 403 (canAccessConsolidatedView=false)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await reportsRouter.request(
        "/consolidated/executive-overview",
        { headers: JSON_HEADERS },
      );

      expect(res.status).toBe(403);
    },
  );

  // REQ-RPT-003 ---------------------------------------------------------------
  it(
    "REQ-RPT-003: GET /consolidated/executive-overview as role=technician -> 403",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "technician" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await reportsRouter.request(
        "/consolidated/executive-overview",
        { headers: JSON_HEADERS },
      );

      expect(res.status).toBe(403);
    },
  );

  // REQ-RPT-004 ---------------------------------------------------------------
  it(
    "REQ-RPT-004: GET /consolidated/executive-overview as role=admin -> 200",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await reportsRouter.request(
        "/consolidated/executive-overview",
        { headers: JSON_HEADERS },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("metrics");
      expect(body).toHaveProperty("period");
    },
  );

  // REQ-RPT-005 ---------------------------------------------------------------
  it(
    "REQ-RPT-005: Tenant isolation — org B's calibration jobs are NOT counted in org A's executive-overview",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      // Shared asset type
      const typeId = await seedAssetType("type-rpt-005");

      // Org A: 1 DRAFT job (should appear as pendingCalibrations=1)
      const custA = await seedCustomer({ labOrganizationId: orgA.orgId });
      const svcA = await seedCalibrationService({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
      });
      const assetA = await seedAsset({
        unitId: orgA.unitId,
        customerId: custA,
        assetTypeId: typeId,
        tag: "TAG-RPT-A1",
      });
      await seedCalibrationJob({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        assetId: assetA,
        serviceId: svcA,
        createdBy: orgA.userId,
        status: "DRAFT",
      });

      // Org B: 5 DRAFT jobs — must NOT inflate org A's count
      const custB = await seedCustomer({ labOrganizationId: orgB.orgId });
      const svcB = await seedCalibrationService({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
      });
      await Promise.all(
        [0, 1, 2, 3, 4].map(async (i) => {
          const assetBi = await seedAsset({
            unitId: orgB.unitId,
            customerId: custB,
            assetTypeId: typeId,
            tag: `TAG-RPT-B${i}`,
          });
          await seedCalibrationJob({
            organizationId: orgB.orgId,
            unitId: orgB.unitId,
            customerId: custB,
            assetId: assetBi,
            serviceId: svcB,
            createdBy: orgB.userId,
            status: "DRAFT",
          });
        }),
      );

      // Query as org A
      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await reportsRouter.request(
        "/consolidated/executive-overview",
        { headers: JSON_HEADERS },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      // Org A has exactly 1 pending job; org B's 5 must NOT be included
      expect(body.metrics.pendingCalibrations).toBe(1);
    },
  );

  // REQ-RPT-006 ---------------------------------------------------------------
  it(
    "REQ-RPT-006: Unit-scope — unitIds param restricts executive-overview to selected units",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });

      // Seed a second unit within org A
      const { organizationUnit } = await import("@calibra-facil/db/schema");
      const [unitB] = await db
        .insert(organizationUnit)
        .values({
          organizationId: org.orgId,
          name: "Branch",
          slug: "branch-rpt",
          status: "ACTIVE",
          isDefault: false,
          createdBy: org.userId,
        })
        .returning({ id: organizationUnit.id });

      if (!unitB) throw new Error("seedUnitB: insert failed");

      const typeId = await seedAssetType("type-rpt-006");
      const cust = await seedCustomer({ labOrganizationId: org.orgId });

      // Service in default unit (Matriz)
      const svcMatriz = await seedCalibrationService({
        organizationId: org.orgId,
        unitId: org.unitId,
      });
      // Service in unit B
      const svcBranch = await seedCalibrationService({
        organizationId: org.orgId,
        unitId: unitB.id,
      });

      // 1 job in Matriz, 3 jobs in Branch
      const assetMatriz = await seedAsset({
        unitId: org.unitId,
        customerId: cust,
        assetTypeId: typeId,
        tag: "TAG-RPT-MATRIZ",
      });
      await seedCalibrationJob({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        assetId: assetMatriz,
        serviceId: svcMatriz,
        createdBy: org.userId,
        status: "DRAFT",
      });

      await Promise.all(
        [0, 1, 2].map(async (i) => {
          const assetBi = await seedAsset({
            unitId: unitB.id,
            customerId: cust,
            assetTypeId: typeId,
            tag: `TAG-RPT-BR${i}`,
          });
          await seedCalibrationJob({
            organizationId: org.orgId,
            unitId: unitB.id,
            customerId: cust,
            assetId: assetBi,
            serviceId: svcBranch,
            createdBy: org.userId,
            status: "DRAFT",
          });
        }),
      );

      loginAs({ userId: org.userId, organizationId: org.orgId });

      // Request scoped to only Matriz unit
      const res = await reportsRouter.request(
        `/consolidated/executive-overview?unitIds=${org.unitId}`,
        { headers: JSON_HEADERS },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      // Only 1 job from Matriz; Branch's 3 are excluded
      expect(body.metrics.pendingCalibrations).toBe(1);
      // The scopeSummary must reflect that only 1 unit is selected
      expect(body.scopeSummary.unitsIncluded).toBe(1);
    },
  );

  // REQ-RPT-007 ---------------------------------------------------------------
  it(
    "REQ-RPT-007: GET /consolidated/summary tenant isolation — org B's jobs excluded from org A's summary",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const typeId = await seedAssetType("type-rpt-007");

      const custA = await seedCustomer({ labOrganizationId: orgA.orgId });
      const svcA = await seedCalibrationService({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
      });
      const assetA = await seedAsset({
        unitId: orgA.unitId,
        customerId: custA,
        assetTypeId: typeId,
        tag: "TAG-RPT-S-A1",
      });
      await seedCalibrationJob({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        assetId: assetA,
        serviceId: svcA,
        createdBy: orgA.userId,
        status: "IN_PROGRESS",
      });

      // Org B seeds 10 IN_PROGRESS jobs
      const custB = await seedCustomer({ labOrganizationId: orgB.orgId });
      const svcB = await seedCalibrationService({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
      });
      await Promise.all(
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(async (i) => {
          const assetBi = await seedAsset({
            unitId: orgB.unitId,
            customerId: custB,
            assetTypeId: typeId,
            tag: `TAG-RPT-S-B${i}`,
          });
          await seedCalibrationJob({
            organizationId: orgB.orgId,
            unitId: orgB.unitId,
            customerId: custB,
            assetId: assetBi,
            serviceId: svcB,
            createdBy: orgB.userId,
            status: "IN_PROGRESS",
          });
        }),
      );

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await reportsRouter.request("/consolidated/summary", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Only org A's 1 job must appear; org B's 10 are excluded
      expect(body.metrics.pendingCalibrations).toBe(1);
    },
  );

  // REQ-RPT-008 ---------------------------------------------------------------
  it(
    "REQ-RPT-008: GET /consolidated/comparison tenant isolation — org B's jobs excluded from org A's comparison rows",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const typeId = await seedAssetType("type-rpt-008");

      const custA = await seedCustomer({ labOrganizationId: orgA.orgId });
      const svcA = await seedCalibrationService({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
      });

      // Org A: 2 REVIEW jobs in its unit
      await Promise.all(
        [0, 1].map(async (i) => {
          const assetAi = await seedAsset({
            unitId: orgA.unitId,
            customerId: custA,
            assetTypeId: typeId,
            tag: `TAG-RPT-C-A${i}`,
          });
          await seedCalibrationJob({
            organizationId: orgA.orgId,
            unitId: orgA.unitId,
            customerId: custA,
            assetId: assetAi,
            serviceId: svcA,
            createdBy: orgA.userId,
            status: "REVIEW",
          });
        }),
      );

      // Org B: 7 REVIEW jobs
      const custB = await seedCustomer({ labOrganizationId: orgB.orgId });
      const svcB = await seedCalibrationService({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
      });
      await Promise.all(
        [0, 1, 2, 3, 4, 5, 6].map(async (i) => {
          const assetBi = await seedAsset({
            unitId: orgB.unitId,
            customerId: custB,
            assetTypeId: typeId,
            tag: `TAG-RPT-C-B${i}`,
          });
          await seedCalibrationJob({
            organizationId: orgB.orgId,
            unitId: orgB.unitId,
            customerId: custB,
            assetId: assetBi,
            serviceId: svcB,
            createdBy: orgB.userId,
            status: "REVIEW",
          });
        }),
      );

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await reportsRouter.request("/consolidated/comparison", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // body.rows is an untyped JSON array; use index access + number coercion
      // rather than `as` casts (which are banned by oxlint consistent-type-assertions).
      const rows: Array<Record<string, unknown>> = Array.isArray(body.rows)
        ? body.rows
        : [];

      // Comparison shows rows for org A's units only; total pending must be 2
      const totalPending = rows.reduce(
        (sum, row) => sum + Number(row.pendingNow),
        0,
      );
      expect(totalPending).toBe(2);

      // Org B's unit must not appear in the rows at all
      const unitIds = rows.map((row) => row.unitId);
      expect(unitIds).not.toContain(orgB.unitId);
    },
  );

  // REQ-RPT-009 ---------------------------------------------------------------
  it(
    "REQ-RPT-009: GET /consolidated/trend tenant isolation — org B's approved jobs excluded from org A's trend data",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      const typeId = await seedAssetType("type-rpt-009");
      const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

      // Org A: 1 APPROVED job within the last 30 days
      const custA = await seedCustomer({ labOrganizationId: orgA.orgId });
      const svcA = await seedCalibrationService({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
      });
      const assetA = await seedAsset({
        unitId: orgA.unitId,
        customerId: custA,
        assetTypeId: typeId,
        tag: "TAG-RPT-T-A1",
      });
      await seedCalibrationJob({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: custA,
        assetId: assetA,
        serviceId: svcA,
        createdBy: orgA.userId,
        status: "APPROVED",
        approvedAt: recent,
      });

      // Org B: 4 APPROVED jobs within the last 30 days
      const custB = await seedCustomer({ labOrganizationId: orgB.orgId });
      const svcB = await seedCalibrationService({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
      });
      await Promise.all(
        [0, 1, 2, 3].map(async (i) => {
          const assetBi = await seedAsset({
            unitId: orgB.unitId,
            customerId: custB,
            assetTypeId: typeId,
            tag: `TAG-RPT-T-B${i}`,
          });
          await seedCalibrationJob({
            organizationId: orgB.orgId,
            unitId: orgB.unitId,
            customerId: custB,
            assetId: assetBi,
            serviceId: svcB,
            createdBy: orgB.userId,
            status: "APPROVED",
            approvedAt: recent,
          });
        }),
      );

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await reportsRouter.request("/consolidated/trend", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // body.data is an untyped JSON array; use index access + number coercion
      // rather than `as` casts (banned by oxlint consistent-type-assertions).
      const dataPoints: Array<Record<string, unknown>> = Array.isArray(body.data)
        ? body.data
        : [];

      // Trend data for org A: exactly 1 approved in the date bucket
      const totalApproved = dataPoints.reduce(
        (sum, point) => sum + Number(point.approved),
        0,
      );
      expect(totalApproved).toBe(1);
    },
  );

  // RBAC gate for /consolidated/summary
  it(
    "REQ-RPT-002b: GET /consolidated/summary as role=operator -> 403",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "operator" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await reportsRouter.request("/consolidated/summary", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(403);
    },
  );

  // RBAC gate for /consolidated/comparison
  it(
    "REQ-RPT-002c: GET /consolidated/comparison as role=member -> 403",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await reportsRouter.request("/consolidated/comparison", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(403);
    },
  );

  // RBAC gate for /consolidated/trend
  it(
    "REQ-RPT-002d: GET /consolidated/trend as role=technician -> 403",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "technician" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await reportsRouter.request("/consolidated/trend", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(403);
    },
  );
});
