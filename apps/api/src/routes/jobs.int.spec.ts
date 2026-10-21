/**
 * jobs.int.spec.ts — Real-DB + real-RBAC integration tests for the calibration
 * approval workflow (ISO/IEC 17025 separation-of-duties + approved-immutable).
 *
 * Only the better-auth session and background-jobs/notifications side-effects are
 * mocked (see test/integration/setup.ts for the session mock).  requireLabAuth →
 * requireOrganization → withLabPermission and buildUnitScopeCondition run for
 * real against the seeded Postgres.  The signatory gate is a real DB query that
 * auto-passes when no authorized_signatory rows exist (our case in every test).
 *
 * Proven properties (oracle):
 *   REQ-JOB-001  Tenant isolation on approve: org A cannot act on org B's REVIEW job
 *   REQ-JOB-002  Approve requires REVIEW: distinct-admin → 2xx + GENERATING_PDF; DRAFT → 400; APPROVED → 400
 *   REQ-JOB-003  Reject requires REVIEW: REVIEW → 200 + REJECTED; DRAFT → 400
 *   REQ-JOB-004  Role separation: technician/operator/member cannot approve (403)
 *   REQ-JOB-005  Four-eyes by identity: self-approval blocked when alternate exists; solo-lab exempt; distinct approver allowed
 *   REQ-JOB-006  Approved immutable: DELETE APPROVED → 400; PUT APPROVED → 400
 *   REQ-JOB-007  Tenant isolation on read: GET / returns only own org; GET /:id cross-tenant → not found
 *   REQ-JOB-008  Unauthenticated approve → 401
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobsRouter } from "./jobs";
import {
  compileMethodDraft,
  fingerprintJson,
  type CalculationEngineLike,
} from "@calibra-facil/method-definition";
import {
  createCalculationEngine,
  METHOD_ENGINE_OPTIONS,
  normalizeEngineOptions,
} from "@calibra-facil/math-engine";
import { db, getDb } from "@calibra-facil/db";
import {
  accreditedScopeLine,
  calibrationJob,
  jobAuditLog,
  organization,
  assetType,
  asset,
  customer,
  service,
  member,
  referenceStandard,
  user,
} from "@calibra-facil/db/schema";
import {
  addCalendarDays,
  calendarDateKey,
  labToday,
} from "@calibra-facil/shared";
import { eq, sql } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// ---------------------------------------------------------------------------
// Mock background jobs and notifications — these are side-effects we don't want
// to exercise in an approval-workflow correctness test.  The signatory gate runs
// for real against the DB; it auto-passes when no authorized_signatory rows
// exist (which is the case in every test below).
// ---------------------------------------------------------------------------

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so this file is fully self-contained and
// parallel worktrees cannot conflict with the shared seed.ts.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };

/** Insert a minimal CLIENT org (required for customer.authOrganizationId FK). */
async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/**
 * Seed a customer owned by a LAB org.
 * Returns customer.id (FK for calibration_job.customer_id).
 */
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
    .values({
      name: `Asset Type ${slug}`,
      slug,
      definition: [],
    })
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

/**
 * Minimal valid MethodSnapshot (matches the MethodSnapshot type defined in
 * @calibra-facil/db/schema — required NOT-NULL JSONB on calibration_job).
 */
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

/** All valid calibration_job status values (mirrors the DB $type). */
type JobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "GENERATING_PDF"
  | "CANCELED"
  | "SUPERSEDED";

/**
 * Seed a calibration_job row with all required FKs.
 * Returns the DB-assigned numeric id.
 */
async function seedJob(params: {
  jobId: string;
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
  technicianId?: string | null;
  status?: JobStatus;
  results?: Record<string, unknown>;
  performedAt?: Date;
  methodSnapshot?: typeof calibrationJob.$inferInsert.methodSnapshot;
}): Promise<number> {
  const status: JobStatus = params.status ?? "DRAFT";
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
      technicianId: params.technicianId ?? null,
      status,
      methodSnapshot: params.methodSnapshot ?? minimalMethodSnapshot(),
      certificateName: params.jobId,
      results: params.results,
      performedAt: params.performedAt,
    })
    .returning({ id: calibrationJob.id });
  if (!row) throw new Error("seedJob: insert failed");
  return row.id;
}

/**
 * Seed a complete domain fixture for a single org: org + unit + user + member +
 * client-org + customer + assetType + asset + method + service.
 * Returns all IDs needed to seed a calibration job.
 */
async function seedJobFixture(params: {
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

describe("jobsRouter — calibration approval workflow (ISO/IEC 17025)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-JOB-001: Tenant isolation on approve
  // =========================================================================
  it("REQ-JOB-001: approve org B's REVIEW job as org A admin → not actionable; DB job stays REVIEW", async () => {
    const orgA = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });
    const orgB = await seedJobFixture({
      orgId: "org-b",
      userId: "user-b",
      tagSuffix: "b",
    });

    const jobBId = await seedJob({
      jobId: "JOB-B-001",
      organizationId: "org-b",
      unitId: orgB.unitId,
      customerId: orgB.customerId,
      assetId: orgB.assetId,
      serviceId: orgB.serviceId,
      createdBy: orgB.userId,
      status: "REVIEW",
    });

    // Org A admin tries to approve org B's job by its numeric DB id
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await jobsRouter.request(`/${jobBId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Cross-tenant approve attempt" }),
    });

    // resolveJobRouteId scopes by org+unit → id not found under org A's session
    expect(res.status).toBe(404);

    // Verify org B's job was NOT touched
    const [row] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, jobBId));
    expect(row?.status).toBe("REVIEW");
  });

  // =========================================================================
  // REQ-JOB-002: Approve requires REVIEW status
  // =========================================================================
  it("REQ-JOB-002: distinct admin approves REVIEW job → 2xx + status GENERATING_PDF + approvedBy set; DRAFT → 400; APPROVED → 400", async () => {
    const fixture = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });

    // Seed a second admin (distinct approver for four-eyes)
    const approverUserId = "user-a-approver";
    await db.insert(user).values({
      id: approverUserId,
      name: "Second Admin",
      email: `${approverUserId}@lab.test`,
    });
    await db.insert(member).values({
      id: `member-${approverUserId}`,
      organizationId: "org-a",
      userId: approverUserId,
      role: "admin",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    // Seed REVIEW job (technicianId = user-a, createdBy = user-a)
    const reviewJobId = await seedJob({
      jobId: "JOB-REVIEW-001",
      organizationId: "org-a",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      technicianId: fixture.userId,
      status: "REVIEW",
    });

    // Approve as DISTINCT admin → expect 2xx
    loginAs({ userId: approverUserId, organizationId: "org-a" });
    const approveRes = await jobsRouter.request(`/${reviewJobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Looks good" }),
    });

    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json();
    expect(approveBody.data.status).toBe("GENERATING_PDF");
    expect(approveBody.data.approvedBy).toBe(approverUserId);

    // Verify DB state
    const [approvedRow] = await db
      .select({
        status: calibrationJob.status,
        approvedBy: calibrationJob.approvedBy,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, reviewJobId));
    expect(approvedRow?.status).toBe("GENERATING_PDF");
    expect(approvedRow?.approvedBy).toBe(approverUserId);

    // --- 2b: DRAFT job approve → 400 ---
    const draftJobId = await seedJob({
      jobId: "JOB-DRAFT-002",
      organizationId: "org-a",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      status: "DRAFT",
    });

    const draftApproveRes = await jobsRouter.request(`/${draftJobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(draftApproveRes.status).toBe(400);

    // DB: still DRAFT
    const [draftRow] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, draftJobId));
    expect(draftRow?.status).toBe("DRAFT");

    // --- 2c: APPROVED job approve → 400 ---
    const approvedJobId = await seedJob({
      jobId: "JOB-APPROVED-003",
      organizationId: "org-a",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      status: "APPROVED",
    });

    const alreadyApprovedRes = await jobsRouter.request(
      `/${approvedJobId}/approve`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      },
    );
    expect(alreadyApprovedRes.status).toBe(400);

    const [approvedJobRow] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, approvedJobId));
    expect(approvedJobRow?.status).toBe("APPROVED");
  });

  // =========================================================================
  // Approval advances the asset's calibration dates: last_calibration_date
  // moves to the job's performed_at (forward-only) and next_calibration_date
  // is re-derived from the CUSTOMER-owned interval — without this, the due
  // sweeps keep re-reminding for an instrument that was just calibrated.
  // =========================================================================
  it("approval advances asset last_calibration_date + derives next from the customer interval", async () => {
    const fixture = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });

    // Customer-owned interval (portal-set) + an older last-calibration date.
    await db
      .update(asset)
      .set({
        calibrationIntervalMonths: 12,
        lastCalibrationDate: new Date("2025-06-10T00:00:00.000Z"),
        nextCalibrationDate: new Date("2026-06-10T00:00:00.000Z"),
      })
      .where(eq(asset.id, fixture.assetId));

    const approverUserId = "user-a-approver";
    await db.insert(user).values({
      id: approverUserId,
      name: "Second Admin",
      email: `${approverUserId}@lab.test`,
    });
    await db.insert(member).values({
      id: `member-${approverUserId}`,
      organizationId: "org-a",
      userId: approverUserId,
      role: "admin",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const reviewJobId = await seedJob({
      jobId: "JOB-ADVANCE-001",
      organizationId: "org-a",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      technicianId: fixture.userId,
      status: "REVIEW",
      performedAt: new Date("2026-06-10T00:00:00.000Z"),
    });

    loginAs({ userId: approverUserId, organizationId: "org-a" });
    const approveRes = await jobsRouter.request(`/${reviewJobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Looks good" }),
    });
    expect(approveRes.status).toBe(200);

    const [assetRow] = await db
      .select({
        lastCalibrationDate: asset.lastCalibrationDate,
        nextCalibrationDate: asset.nextCalibrationDate,
      })
      .from(asset)
      .where(eq(asset.id, fixture.assetId));
    expect(assetRow?.lastCalibrationDate?.toISOString()).toBe(
      "2026-06-10T00:00:00.000Z",
    );
    // Derived: performed_at + 12 months (customer interval).
    expect(assetRow?.nextCalibrationDate?.toISOString()).toBe(
      "2027-06-10T00:00:00.000Z",
    );
  });

  // =========================================================================
  // REQ-RELIA-011: approving a job persists the AS-FOUND reliability verdict
  // (margem_conformidade_antes) derived from the frozen results. The as-found
  // margins [0.5, -0.1, 0.3] include an out-of-tolerance point → NON_CONFORMING.
  // This proves the wiring; the verdict math itself is unit-tested in
  // as-found-reliability-verdict.spec.ts (incl. the no-as-left-fallback guard).
  // =========================================================================
  it("REQ-RELIA-011: approval persists as_found_conformity + as_found_margins from results", async () => {
    const fixture = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });

    const approverUserId = "user-a-approver";
    await db.insert(user).values({
      id: approverUserId,
      name: "Second Admin",
      email: `${approverUserId}@lab.test`,
    });
    await db.insert(member).values({
      id: `member-${approverUserId}`,
      organizationId: "org-a",
      userId: approverUserId,
      role: "admin",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const reviewJobId = await seedJob({
      jobId: "JOB-RELIA-001",
      organizationId: "org-a",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      technicianId: fixture.userId,
      status: "REVIEW",
      results: { margem_conformidade_antes: [0.5, -0.1, 0.3] },
    });

    loginAs({ userId: approverUserId, organizationId: "org-a" });
    const res = await jobsRouter.request(`/${reviewJobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "ok" }),
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select({
        asFoundConformity: calibrationJob.asFoundConformity,
        asFoundMargins: calibrationJob.asFoundMargins,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, reviewJobId));
    expect(row?.asFoundConformity).toBe("NON_CONFORMING");
    expect(row?.asFoundMargins).toEqual([0.5, -0.1, 0.3]);
  });

  // =========================================================================
  // REQ-JOB-003: Reject requires REVIEW status
  // =========================================================================
  it("REQ-JOB-003: reject REVIEW job → 200 + REJECTED; reject DRAFT job → 400", async () => {
    const fixture = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });

    loginAs({ userId: fixture.userId, organizationId: "org-a" });

    // --- 3a: REVIEW job → 200 + REJECTED ---
    const reviewJobId = await seedJob({
      jobId: "JOB-REJ-REVIEW-001",
      organizationId: "org-a",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      status: "REVIEW",
    });

    const rejectRes = await jobsRouter.request(`/${reviewJobId}/reject`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Erros no procedimento" }),
    });

    expect(rejectRes.status).toBe(200);
    const rejectBody = await rejectRes.json();
    expect(rejectBody.data.status).toBe("REJECTED");

    // DB: persisted as REJECTED
    const [rejectedRow] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, reviewJobId));
    expect(rejectedRow?.status).toBe("REJECTED");

    // --- 3b: DRAFT job → 400 ---
    const draftJobId = await seedJob({
      jobId: "JOB-REJ-DRAFT-002",
      organizationId: "org-a",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      status: "DRAFT",
    });

    const draftRejectRes = await jobsRouter.request(`/${draftJobId}/reject`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Should be blocked" }),
    });
    expect(draftRejectRes.status).toBe(400);

    // DB: still DRAFT
    const [draftRow] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, draftJobId));
    expect(draftRow?.status).toBe("DRAFT");
  });

  // =========================================================================
  // REQ-JOB-004: Role separation of duties (calibration:approve absent for
  // technician, operator, member)
  // =========================================================================
  it("REQ-JOB-004: technician → 403 on approve; operator → 403; member → 403; DB job stays REVIEW", async () => {
    // Admin seeds org and objects; restricted-role users test the gate
    const admin = await seedJobFixture({
      orgId: "org-a",
      userId: "user-admin",
      tagSuffix: "a",
    });

    const reviewJobId = await seedJob({
      jobId: "JOB-RBAC-001",
      organizationId: "org-a",
      unitId: admin.unitId,
      customerId: admin.customerId,
      assetId: admin.assetId,
      serviceId: admin.serviceId,
      createdBy: admin.userId,
      status: "REVIEW",
    });

    // Seed 3 additional users with restricted roles in the same org
    const restrictedRoles = [
      { userId: "user-tech", role: "technician" },
      { userId: "user-op", role: "operator" },
      { userId: "user-mem", role: "member" },
    ] as const;

    for (const { userId, role } of restrictedRoles) {
      await db.insert(user).values({
        id: userId,
        name: `User ${userId}`,
        email: `${userId}@lab.test`,
      });
      await db.insert(member).values({
        id: `member-${userId}`,
        organizationId: "org-a",
        userId,
        role,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
    }

    for (const { userId } of restrictedRoles) {
      loginAs({ userId, organizationId: "org-a" });
      const res = await jobsRouter.request(`/${reviewJobId}/approve`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });
      expect(res.status, `Expected 403 for ${userId}`).toBe(403);
    }

    // DB: job must still be REVIEW (no role had permission to change it)
    const [row] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, reviewJobId));
    expect(row?.status).toBe("REVIEW");
  });

  // =========================================================================
  // REQ-JOB-005: Four-eyes by identity (ISO/IEC 17025 §6.2.4)
  // =========================================================================
  it("REQ-JOB-005: four-eyes — self-approve blocked when alternate admin exists; approved by distinct admin; solo-lab exempt", async () => {
    // -----------------------------------------------------------------------
    // Sub-test A: self-approval blocked (technicianId === approverId, alternate exists)
    // -----------------------------------------------------------------------
    const userA = "user-a-four";
    const userB = "user-b-four";

    const orgA = await seedJobFixture({
      orgId: "org-four",
      userId: userA,
      tagSuffix: "four",
    });

    // Add second admin (userB = alternate approver)
    await db.insert(user).values({
      id: userB,
      name: "Second Admin",
      email: `${userB}@lab.test`,
    });
    await db.insert(member).values({
      id: `member-${userB}`,
      organizationId: "org-four",
      userId: userB,
      role: "admin",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    // Job where technicianId = createdBy = userA
    const fourEyesJobId = await seedJob({
      jobId: "JOB-FOUR-001",
      organizationId: "org-four",
      unitId: orgA.unitId,
      customerId: orgA.customerId,
      assetId: orgA.assetId,
      serviceId: orgA.serviceId,
      createdBy: userA,
      technicianId: userA,
      status: "REVIEW",
    });

    // userA tries to self-approve → 403 SELF_APPROVAL_BLOCKED (alternate userB exists)
    loginAs({ userId: userA, organizationId: "org-four" });
    const selfApproveRes = await jobsRouter.request(
      `/${fourEyesJobId}/approve`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      },
    );
    expect(selfApproveRes.status).toBe(403);
    const selfApproveBody = await selfApproveRes.json();
    expect(selfApproveBody.code).toBe("SELF_APPROVAL_BLOCKED");

    // DB: still REVIEW
    const [blockedRow] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, fourEyesJobId));
    expect(blockedRow?.status).toBe("REVIEW");

    // -----------------------------------------------------------------------
    // Sub-test B: distinct admin (userB) approves the same job → 2xx
    // -----------------------------------------------------------------------
    loginAs({ userId: userB, organizationId: "org-four" });
    const distinctApproveRes = await jobsRouter.request(
      `/${fourEyesJobId}/approve`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Reviewed by alternate admin" }),
      },
    );
    expect(distinctApproveRes.status).toBe(200);
    const distinctApproveBody = await distinctApproveRes.json();
    expect(distinctApproveBody.data.status).toBe("GENERATING_PDF");
    expect(distinctApproveBody.data.approvedBy).toBe(userB);

    // -----------------------------------------------------------------------
    // Sub-test C: solo lab — only one admin in the org, self-approval allowed
    // -----------------------------------------------------------------------
    const soloUserId = "user-solo";
    const orgSolo = await seedJobFixture({
      orgId: "org-solo",
      userId: soloUserId,
      tagSuffix: "solo",
    });
    // orgSolo has ONLY soloUserId as the single admin/member

    const soloJobId = await seedJob({
      jobId: "JOB-SOLO-001",
      organizationId: "org-solo",
      unitId: orgSolo.unitId,
      customerId: orgSolo.customerId,
      assetId: orgSolo.assetId,
      serviceId: orgSolo.serviceId,
      createdBy: soloUserId,
      technicianId: soloUserId,
      status: "REVIEW",
    });

    loginAs({ userId: soloUserId, organizationId: "org-solo" });
    const soloApproveRes = await jobsRouter.request(`/${soloJobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    // Solo lab: no alternate approver found → exemption → 200
    expect(soloApproveRes.status).toBe(200);
    const soloBody = await soloApproveRes.json();
    expect(soloBody.data.status).toBe("GENERATING_PDF");
    expect(soloBody.data.approvedBy).toBe(soloUserId);
  });

  // =========================================================================
  // REQ-JOB-006: Approved job is immutable (ISO/IEC 17025 traceability)
  // =========================================================================
  it("REQ-JOB-006: DELETE an APPROVED job → 400 + DB row still present+APPROVED; PUT an APPROVED job → 400", async () => {
    const fixture = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });

    loginAs({ userId: fixture.userId, organizationId: "org-a" });

    // Seed a job already in APPROVED state (simulates post-PDF-generation state)
    const approvedJobId = await seedJob({
      jobId: "JOB-IMMUTABLE-001",
      organizationId: "org-a",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      status: "APPROVED",
    });

    // --- 6a: DELETE → 400 ---
    const deleteRes = await jobsRouter.request(`/${approvedJobId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Attempting to delete approved job" }),
    });
    expect(deleteRes.status).toBe(400);

    // DB: row must still exist and be APPROVED
    const [rowAfterDelete] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, approvedJobId));
    expect(rowAfterDelete).toBeDefined();
    expect(rowAfterDelete?.status).toBe("APPROVED");

    // --- 6b: PUT → 400 ---
    const putRes = await jobsRouter.request(`/${approvedJobId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ technicianId: null }),
    });
    expect(putRes.status).toBe(400);

    // DB: still APPROVED
    const [rowAfterPut] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, approvedJobId));
    expect(rowAfterPut?.status).toBe("APPROVED");
  });

  // =========================================================================
  // REQ-JOB-007: Tenant isolation on read
  // =========================================================================
  it("REQ-JOB-007: GET / returns only org A's jobs — exact count; cross-tenant GET /:id → not found", async () => {
    const orgA = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });
    const orgB = await seedJobFixture({
      orgId: "org-b",
      userId: "user-b",
      tagSuffix: "b",
    });

    // Seed 2 jobs for org A and 1 for org B
    await seedJob({
      jobId: "JOB-A-001",
      organizationId: "org-a",
      unitId: orgA.unitId,
      customerId: orgA.customerId,
      assetId: orgA.assetId,
      serviceId: orgA.serviceId,
      createdBy: orgA.userId,
      status: "DRAFT",
    });
    await seedJob({
      jobId: "JOB-A-002",
      organizationId: "org-a",
      unitId: orgA.unitId,
      customerId: orgA.customerId,
      assetId: orgA.assetId,
      serviceId: orgA.serviceId,
      createdBy: orgA.userId,
      status: "REVIEW",
    });
    const jobBDbId = await seedJob({
      jobId: "JOB-B-001",
      organizationId: "org-b",
      unitId: orgB.unitId,
      customerId: orgB.customerId,
      assetId: orgB.assetId,
      serviceId: orgB.serviceId,
      createdBy: orgB.userId,
      status: "DRAFT",
    });

    loginAs({ userId: orgA.userId, organizationId: "org-a" });

    // List: should return exactly 2 (org A's)
    const listRes = await jobsRouter.request("/", { headers: JSON_HEADERS });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.pagination.total).toBe(2);
    const jobIds = listBody.data.map((j: { jobId: string }) => j.jobId);
    expect(jobIds).toContain("JOB-A-001");
    expect(jobIds).toContain("JOB-A-002");
    expect(jobIds).not.toContain("JOB-B-001");

    // Cross-tenant GET /:id: org A cannot read org B's job
    const getRes = await jobsRouter.request(`/${jobBDbId}`, {
      headers: JSON_HEADERS,
    });
    // resolveJobRouteId scopes by org → null → 404
    expect(getRes.status).toBe(404);
  });

  // =========================================================================
  // REQ-JOB-008: Unauthenticated approve → 401
  // =========================================================================
  it("REQ-JOB-008: unauthenticated approve request → 401", async () => {
    logout();
    const res = await jobsRouter.request("/some-job-id/approve", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// #427 Phase 1 — accredited-scope (CMC) guard at approval.
//
// Proven properties:
//   REQ-CMC-010  enforce mode + U below CMC → 422 SCOPE_VIOLATION, job stays REVIEW
//   REQ-CMC-011  enforce mode + documented override → approved WITHOUT seal
//                (scope_override_justification frozen on the job)
//   REQ-CMC-012  warn mode + violation → approved, classification stamped,
//                no override recorded
//   REQ-CMC-013  enforce mode + passing U → approved, status PASS
// ---------------------------------------------------------------------------

/** MethodSnapshot with role-tagged per-point expanded uncertainty (mass). */
function scopeGuardMethodSnapshot() {
  return {
    methodId: 1,
    methodName: "Massa - Balanças",
    methodVersion: 1,
    dataFields: [
      {
        key: "pontos_indicacao",
        label: "Pontos de indicação",
        type: "table",
        columns: [
          { key: "carga_nominal", label: "Carga", type: "number", unit: "g" },
        ],
      },
    ],
    variableBindings: [],
    formulas: [
      {
        outputKey: "incerteza_expandida_apos",
        expression: "1",
        unit: "g",
        scope: { kind: "table_row", tableKey: "pontos_indicacao" },
        reporting: {
          role: "expanded_uncertainty",
          group: "calibration_result",
        },
      },
      {
        outputKey: "fator_k_apos",
        expression: "1",
        scope: { kind: "table_row", tableKey: "pontos_indicacao" },
        reporting: { role: "coverage_factor", group: "uncertainty_budget" },
      },
    ],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
    accreditedScope: true,
  } satisfies Record<string, unknown>;
}

async function seedScopeGuardWorld(params: {
  orgId: string;
  userId: string;
  tagSuffix: string;
  enforcementMode: "warn" | "enforce";
  reportedU: number;
}) {
  const fixture = await seedJobFixture({
    orgId: params.orgId,
    userId: params.userId,
    tagSuffix: params.tagSuffix,
  });

  // Accredited lab with the guard configured (CMC 0.01 g on 0–500 g).
  await db
    .update(organization)
    .set({
      accreditationActive: true,
      accreditationNumber: "1234",
      scopeEnforcementMode: params.enforcementMode,
    })
    .where(eq(organization.id, params.orgId));
  await db.insert(accreditedScopeLine).values({
    organizationId: params.orgId,
    unitId: fixture.unitId,
    quantityKind: "mass",
    rangeMin: 0,
    rangeMax: 500,
    rangeUnit: "g",
    cmcType: "fixed",
    cmcA: 0.01,
    cmcUnit: "g",
    updatedBy: params.userId,
  });

  const [job] = await db
    .insert(calibrationJob)
    .values({
      jobId: `JOB-${params.tagSuffix}`,
      organizationId: params.orgId,
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: params.userId, // solo lab: self-approval exempt
      status: "REVIEW",
      methodSnapshot: scopeGuardMethodSnapshot(),
      certificateName: `JOB-${params.tagSuffix}`,
      data: { pontos_indicacao: [{ carga_nominal: 100 }] },
      results: {
        incerteza_expandida_apos: [params.reportedU],
        fator_k_apos: [2],
      },
      performedAt: new Date("2026-07-01T12:00:00.000Z"),
    })
    .returning({ id: calibrationJob.id });
  if (!job) throw new Error("seedScopeGuardWorld: job insert failed");

  return { ...fixture, jobId: job.id };
}

describe("jobsRouter — accredited-scope (CMC) guard at approval (#427 Phase 1)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-CMC-010: enforce mode blocks U-below-CMC approval with 422 SCOPE_VIOLATION", async () => {
    const world = await seedScopeGuardWorld({
      orgId: "org-cmc-block",
      userId: "user-cmc-block",
      tagSuffix: "cmc-block",
      enforcementMode: "enforce",
      reportedU: 0.002, // below the 0.01 g CMC
    });

    loginAs({ userId: "user-cmc-block", organizationId: "org-cmc-block" });
    const res = await jobsRouter.request(`/${world.jobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("SCOPE_VIOLATION");
    expect(body.scopeCompliance.status).toBe("U_BELOW_CMC");

    const [row] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, world.jobId));
    expect(row?.status).toBe("REVIEW");
  });

  it("REQ-CMC-011: documented override approves WITHOUT the seal and freezes the justification", async () => {
    const world = await seedScopeGuardWorld({
      orgId: "org-cmc-override",
      userId: "user-cmc-override",
      tagSuffix: "cmc-override",
      enforcementMode: "enforce",
      reportedU: 0.002,
    });

    loginAs({
      userId: "user-cmc-override",
      organizationId: "org-cmc-override",
    });
    const res = await jobsRouter.request(`/${world.jobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        scopeOverrideJustification:
          "Cliente aceitou emissão sem selo; ponto fora da capacidade declarada.",
      }),
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select({
        status: calibrationJob.status,
        scopeComplianceStatus: calibrationJob.scopeComplianceStatus,
        scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, world.jobId));
    expect(row?.status).toBe("GENERATING_PDF");
    expect(row?.scopeComplianceStatus).toBe("U_BELOW_CMC");
    expect(row?.scopeOverrideJustification).toContain("sem selo");
  });

  it("REQ-CMC-012: warn mode approves the violation and stamps the classification without an override", async () => {
    const world = await seedScopeGuardWorld({
      orgId: "org-cmc-warn",
      userId: "user-cmc-warn",
      tagSuffix: "cmc-warn",
      enforcementMode: "warn",
      reportedU: 0.002,
    });

    loginAs({ userId: "user-cmc-warn", organizationId: "org-cmc-warn" });
    const res = await jobsRouter.request(`/${world.jobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      // A stray justification in warn mode must NOT downgrade the seal.
      body: JSON.stringify({ scopeOverrideJustification: "não se aplica" }),
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select({
        status: calibrationJob.status,
        scopeComplianceStatus: calibrationJob.scopeComplianceStatus,
        scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, world.jobId));
    expect(row?.status).toBe("GENERATING_PDF");
    expect(row?.scopeComplianceStatus).toBe("U_BELOW_CMC");
    expect(row?.scopeOverrideJustification).toBeNull();
  });

  it("REQ-CMC-013: enforce mode approves a passing U and stamps PASS", async () => {
    const world = await seedScopeGuardWorld({
      orgId: "org-cmc-pass",
      userId: "user-cmc-pass",
      tagSuffix: "cmc-pass",
      enforcementMode: "enforce",
      reportedU: 0.02, // above the 0.01 g CMC
    });

    loginAs({ userId: "user-cmc-pass", organizationId: "org-cmc-pass" });
    const res = await jobsRouter.request(`/${world.jobId}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select({
        scopeComplianceStatus: calibrationJob.scopeComplianceStatus,
        scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, world.jobId));
    expect(row?.scopeComplianceStatus).toBe("PASS");
    expect(row?.scopeOverrideJustification).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Status guards: cancel allow-list, compare-and-set transitions, concurrency.
// ---------------------------------------------------------------------------

/**
 * A real, executable compiled method (one scalar error formula) so that submit
 * and execute get past the official-execution gate and reach their status
 * write. Compiled with the same engine the route executes with.
 */
function executableMethodSnapshot() {
  const normalizedOptions = normalizeEngineOptions(METHOD_ENGINE_OPTIONS);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- same adapter cast as routes/methods.ts and routes/jobs.ts: math-engine exposes a narrower concrete type than method-definition's engine interface.
  const engine = createCalculationEngine(
    METHOD_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;
  const engineVersion = normalizedOptions.engineVersion;
  const optionsFingerprint = fingerprintJson(
    normalizedOptions,
    "engine-options",
  );
  const compiled = compileMethodDraft(
    {
      id: "erro_indicacao",
      version: 1,
      status: "draft",
      name: "Erro de indicação",
      inputs: [
        {
          kind: "scalar",
          key: "indication",
          label: "Indicação",
          unit: "g",
          required: true,
        },
        {
          kind: "scalar",
          key: "reference",
          label: "Referência",
          unit: "g",
          required: true,
        },
      ],
      formulas: [
        {
          key: "error",
          label: "Erro",
          expression: "indication - reference",
          outputUnit: "g",
          outputKind: "error",
          required: true,
        },
      ],
    },
    {
      engine,
      engineMetadata: {
        packageName: "@calibra-facil/math-engine",
        version: engineVersion,
        optionsFingerprint,
      },
    },
  );
  if (!compiled.ok) {
    throw new Error(
      `executableMethodSnapshot: ${JSON.stringify(compiled.diagnostics)}`,
    );
  }
  return {
    ...minimalMethodSnapshot(),
    compiledMethod: compiled.method,
    methodFingerprint: compiled.method.methodFingerprint,
    engineVersion,
    engineOptionsFingerprint: optionsFingerprint,
    normalizedMethodJson: compiled.method.normalizedMethodJson,
  };
}

async function statusOf(id: number) {
  const [row] = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, id));
  return row?.status;
}

async function auditActions(id: number) {
  const rows = await db
    .select({ action: jobAuditLog.action })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, id));
  return rows.map((row) => row.action);
}

/**
 * Forces the interleaving of a lost compare-and-set, deterministically: the
 * handler has already read the job (that read is its first query), and right
 * before it opens the transaction that carries its status write, another
 * actor moves the job to `status`. A real race can serialise either way
 * (reject-then-cancel is legitimately 200 + 200), so asserting on a live race
 * is flaky; this fixes the order instead.
 */
function changeStatusBeforeNextTransaction(id: number, status: JobStatus) {
  // `db` is a Proxy over the cached instance; spy on the instance itself.
  const instance = getDb();
  const originalTransaction = instance.transaction.bind(instance);
  vi.spyOn(instance, "transaction").mockImplementationOnce(
    async (callback, config) => {
      await db
        .update(calibrationJob)
        .set({ status })
        .where(eq(calibrationJob.id, id));
      return originalTransaction(callback, config);
    },
  );
}

describe("jobsRouter — status guards (cancel allow-list, compare-and-set)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedFixtureJob(
    status: JobStatus,
    jobId: string,
    methodSnapshot?: Parameters<typeof seedJob>[0]["methodSnapshot"],
  ) {
    const fixture = await seedJobFixture({
      orgId: "org-g",
      userId: "user-g",
      tagSuffix: "g",
    });
    loginAs({ userId: fixture.userId, organizationId: "org-g" });
    const id = await seedJob({
      jobId,
      organizationId: "org-g",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      status,
      methodSnapshot,
    });
    return { fixture, id };
  }

  function cancel(id: number) {
    return jobsRouter.request(`/${id}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Cancelamento de teste" }),
    });
  }

  it("REQ-JOBST-001 [HIGH RISK]: cancel a GENERATING_PDF job (approval in progress) → 400; DB stays GENERATING_PDF; no cancel audit", async () => {
    const { id } = await seedFixtureJob("GENERATING_PDF", "JOB-GEN-001");

    const res = await cancel(id);

    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe("GENERATING_PDF");
    expect(await auditActions(id)).not.toContain("cancel");
  });

  it("REQ-JOBST-002: cancel a SUPERSEDED job → 400; DB stays SUPERSEDED", async () => {
    const { id } = await seedFixtureJob("SUPERSEDED", "JOB-SUP-001");

    const res = await cancel(id);

    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe("SUPERSEDED");
  });

  it("REQ-JOBST-003: cancel an already CANCELED job → 400", async () => {
    const { id } = await seedFixtureJob("CANCELED", "JOB-CAN-001");

    expect((await cancel(id)).status).toBe(400);
    expect(await auditActions(id)).not.toContain("cancel");
  });

  it.each(["DRAFT", "IN_PROGRESS", "REVIEW", "REJECTED"] as const)(
    "REQ-JOBST-004: cancel a %s job is still allowed → 200 + CANCELED + cancel audit",
    async (status) => {
      const { id } = await seedFixtureJob(status, `JOB-OK-${status}`);

      const res = await cancel(id);

      expect(res.status).toBe(200);
      expect(await statusOf(id)).toBe("CANCELED");
      expect(await auditActions(id)).toContain("cancel");
    },
  );

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("REQ-JOBST-005 [HIGH RISK]: cancel loses to a transition that lands between its read and its write → 409; the other actor's status stands; no cancel audit row", async () => {
    const { id } = await seedFixtureJob("REVIEW", "JOB-CAS-CANCEL-001");
    // Someone rejects the job after cancel validated REVIEW.
    changeStatusBeforeNextTransaction(id, "REJECTED");

    const res = await cancel(id);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("JOB_STATUS_CONFLICT");
    expect(body.currentStatus).toBe("REJECTED");
    expect(await statusOf(id)).toBe("REJECTED");
    expect(await auditActions(id)).not.toContain("cancel");
  });

  it("REQ-DE-3: a lost status compare-and-set keeps its 409 + pt-BR error text and gains details alongside the legacy code/currentStatus", async () => {
    const { id } = await seedFixtureJob("REVIEW", "JOB-DE3-CAS-001");
    changeStatusBeforeNextTransaction(id, "REJECTED");

    const res = await cancel(id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        "O status do job mudou durante a operacao. Recarregue e tente novamente.",
      code: "JOB_STATUS_CONFLICT",
      currentStatus: "REJECTED",
      details: { currentStatus: "REJECTED" },
    });
  });

  it.each([
    [
      "GENERATING_PDF",
      "Nao e possivel cancelar um job com status GENERATING_PDF.",
    ],
    ["CANCELED", "Job ja foi cancelado"],
    [
      "APPROVED",
      "Nao e possivel cancelar um job aprovado. Jobs aprovados sao imutaveis para conformidade ISO 17025.",
    ],
  ] as const)(
    "REQ-DE-3: cancel a %s job keeps its 400 + error text and gains code job_not_cancelable",
    async (status, expectedError) => {
      const { id } = await seedFixtureJob(status, `JOB-DE3-${status}`);

      const res = await cancel(id);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: expectedError,
        code: "job_not_cancelable",
      });
    },
  );

  it("REQ-JOBST-005b [HIGH RISK]: reject loses to a cancel that lands between its read and its write → 409; job stays CANCELED; no reject audit row", async () => {
    const { id } = await seedFixtureJob("REVIEW", "JOB-CAS-REJECT-001");
    changeStatusBeforeNextTransaction(id, "CANCELED");

    const res = await jobsRouter.request(`/${id}/reject`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Erros no procedimento" }),
    });

    expect(res.status).toBe(409);
    expect(await statusOf(id)).toBe("CANCELED");
    expect(await auditActions(id)).not.toContain("reject");
    const [row] = await db
      .select({ rejectedBy: calibrationJob.rejectedBy })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    expect(row?.rejectedBy).toBeNull();
  });

  it("REQ-JOBST-008 [HIGH RISK]: submit loses to an approval that lands between its read and its write → 409; job stays GENERATING_PDF; submitted data not written; no submit audit row", async () => {
    const { id } = await seedFixtureJob(
      "IN_PROGRESS",
      "JOB-CAS-SUBMIT-001",
      executableMethodSnapshot(),
    );
    changeStatusBeforeNextTransaction(id, "GENERATING_PDF");

    const res = await jobsRouter.request(`/${id}/submit`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        calibrationLocation: { type: "lab", addressText: "Laboratório" },
        data: { indication: "10", reference: "9", marcador: "submit-perdido" },
      }),
    });

    expect(res.status).toBe(409);
    expect(await statusOf(id)).toBe("GENERATING_PDF");
    expect(await auditActions(id)).not.toContain("submit");
    const [row] = await db
      .select({ data: calibrationJob.data })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    expect(JSON.stringify(row?.data ?? null)).not.toContain("submit-perdido");
  });

  it("REQ-JOBST-009 [HIGH RISK]: execute (worksheet save) loses to a cancel that lands between its read and its write → 409; job stays CANCELED; data not written; no execute audit row", async () => {
    const { id } = await seedFixtureJob(
      "DRAFT",
      "JOB-CAS-EXEC-001",
      executableMethodSnapshot(),
    );
    changeStatusBeforeNextTransaction(id, "CANCELED");

    const res = await jobsRouter.request(`/${id}/execute`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        data: { indication: "10", reference: "9", marcador: "execute-perdido" },
      }),
    });

    expect(res.status).toBe(409);
    expect(await statusOf(id)).toBe("CANCELED");
    expect(await auditActions(id)).not.toContain("execute");
    const [row] = await db
      .select({ data: calibrationJob.data })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    expect(JSON.stringify(row?.data ?? null)).not.toContain("execute-perdido");
  });

  it("REQ-JOBST-010: control — with no interleaved change, execute saves (200 + IN_PROGRESS + execute audit row), so the 409s above come from the guard and not the payload", async () => {
    const { id } = await seedFixtureJob(
      "DRAFT",
      "JOB-CAS-CTRL-001",
      executableMethodSnapshot(),
    );

    const res = await jobsRouter.request(`/${id}/execute`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        data: { indication: "10", reference: "9", marcador: "execute-ok" },
      }),
    });

    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    expect(await auditActions(id)).toContain("execute");
  });

  it("REQ-JOBST-011: control — with no interleaved change, submit moves an IN_PROGRESS job to REVIEW with its submit audit row", async () => {
    const { id } = await seedFixtureJob(
      "IN_PROGRESS",
      "JOB-CAS-CTRL-002",
      executableMethodSnapshot(),
    );

    const res = await jobsRouter.request(`/${id}/submit`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        calibrationLocation: { type: "lab", addressText: "Laboratório" },
        data: { indication: "10", reference: "9", marcador: "submit-ok" },
      }),
    });

    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("REVIEW");
    expect(await auditActions(id)).toContain("submit");
  });

  it("REQ-JOBST-006 [HIGH RISK]: concurrent amend of one APPROVED job → exactly one amendment is created", async () => {
    const { id, fixture } = await seedFixtureJob("APPROVED", "JOB-AMEND-001");

    const amend = () =>
      jobsRouter.request(`/${id}/amend`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Correcao do valor de referencia" }),
      });
    const [first, second] = await Promise.all([amend(), amend()]);

    expect([first.status, second.status].toSorted()).toEqual([201, 400]);

    const amendments = await db
      .select({ id: calibrationJob.id, status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.supersedesId, id));
    expect(amendments).toHaveLength(1);
    expect(amendments[0]?.status).toBe("DRAFT");
    expect(await statusOf(id)).toBe("SUPERSEDED");
    const supersedeAudits = (await auditActions(id)).filter(
      (action) => action === "supersede",
    );
    expect(supersedeAudits).toHaveLength(1);
    expect(fixture.unitId).toBeGreaterThan(0);
  });

  it("REQ-JOBST-007: the database refuses a second job superseding the same original (partial unique index)", async () => {
    const { id, fixture } = await seedFixtureJob("APPROVED", "JOB-UNIQ-001");

    const insertAmendment = (jobId: string) =>
      db.insert(calibrationJob).values({
        jobId,
        organizationId: "org-g",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        assetId: fixture.assetId,
        serviceId: fixture.serviceId,
        createdBy: fixture.userId,
        status: "DRAFT",
        methodSnapshot: minimalMethodSnapshot(),
        supersedesId: id,
      });

    await insertAmendment("JOB-UNIQ-002");
    await expect(insertAmendment("JOB-UNIQ-003")).rejects.toThrow();
  });
});

describe("jobsRouter — reference standard validity at the performed date (REQ-CAL-004, Q12)", () => {
  // A standard is valid THROUGH the day its certificate names, judged on the
  // Sao Paulo day the calibration was performed: the day after it, the work is
  // refused; on the day itself (even at 23:30), accepted; and a standard that
  // has since expired is still accepted for work done while it was valid.
  beforeEach(async () => {
    await truncateAll();
  });

  // The standard's last valid day: three days ago, so both the day itself and
  // the day after are in the past (a performed date may not be in the future)
  // and inside the 7-day window that needs no backdate reason.
  const validThrough = addCalendarDays(labToday(), -3);
  const validThroughKey = calendarDateKey(validThrough);
  const lastEvening = new Date(`${validThroughKey}T23:30:00-03:00`);
  const nextMorning = new Date(
    `${calendarDateKey(addCalendarDays(validThrough, 1))}T00:10:00-03:00`,
  );

  async function seedJobWithStandard(status: "DRAFT" | "IN_PROGRESS") {
    const fixture = await seedJobFixture({
      orgId: "org-q12",
      userId: "user-q12",
      tagSuffix: "q12",
    });
    loginAs({ userId: fixture.userId, organizationId: "org-q12" });
    const id = await seedJob({
      jobId: `JOB-Q12-${status}`,
      organizationId: "org-q12",
      unitId: fixture.unitId,
      customerId: fixture.customerId,
      assetId: fixture.assetId,
      serviceId: fixture.serviceId,
      createdBy: fixture.userId,
      status,
      methodSnapshot: executableMethodSnapshot(),
    });
    const [standard] = await db
      .insert(referenceStandard)
      .values({
        organizationId: "org-q12",
        unitId: fixture.unitId,
        createdBy: fixture.userId,
        name: "Massa Padrao",
        kind: "generic_scalar",
        serialNumber: "SN-Q12",
        certificateNumber: "CERT-Q12",
        calibrationDate: new Date("2025-01-10T15:00:00.000Z"),
        nextCalibrationDate: validThrough,
        coverageFactor: 2,
        distribution: "normal",
        status: "ACTIVE",
        referenceValue: 1,
        uncertainty: 0.01,
      })
      .returning({ id: referenceStandard.id });
    return { id, standardId: standard?.id ?? 0 };
  }

  function submit(
    id: number,
    standardId: number,
    performedAt: Date,
    backdateReason?: string,
  ) {
    return jobsRouter.request(`/${id}/submit`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        calibrationLocation: { type: "lab", addressText: "Laboratório" },
        data: { indication: "10", reference: "9" },
        selectedStandardIds: [standardId],
        performedAt: performedAt.toISOString(),
        ...(backdateReason ? { backdateReason } : {}),
      }),
    });
  }

  /** A submit that names no standards and no date: it records "now". */
  function submitWithoutStandardsOrDate(id: number, backdateReason?: string) {
    return jobsRouter.request(`/${id}/submit`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        calibrationLocation: { type: "lab", addressText: "Laboratório" },
        data: { indication: "10", reference: "9" },
        ...(backdateReason ? { backdateReason } : {}),
      }),
    });
  }

  function execute(id: number, standardId: number, performedAt: Date) {
    return jobsRouter.request(`/${id}/execute`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        data: { indication: "10", reference: "9" },
        selectedStandardIds: [standardId],
        performedAt: performedAt.toISOString(),
      }),
    });
  }

  it("REQ-CAL-004 [HIGH RISK]: submit accepts the standard for work performed on its last valid day at 23:30 in Sao Paulo", async () => {
    const { id, standardId } = await seedJobWithStandard("IN_PROGRESS");

    // Three days back and the standard has expired since: valid at the
    // performed day, so accepted, with the justification A2 requires.
    const res = await submit(
      id,
      standardId,
      lastEvening,
      "Lancamento tardio do dia da execucao",
    );

    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("REVIEW");
    const [row] = await db
      .select({ standardsSnapshot: calibrationJob.standardsSnapshot })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    expect(row?.standardsSnapshot?.map((standard) => standard.id)).toEqual([
      standardId,
    ]);
  });

  it("REQ-CAL-004 [HIGH RISK] A1: the verifier's bypass is refused at submit (execute back-dated, then submit with no standards and no date)", async () => {
    const { id, standardId } = await seedJobWithStandard("DRAFT");

    // 1. A draft saved with a performed date 30 days back and the standard,
    //    which was still valid then: advisory check passes.
    const thirtyDaysBack = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect((await execute(id, standardId, thirtyDaysBack)).status).toBe(200);

    // 2. Submit names neither standards nor a date: the job is recorded as
    //    performed today, with a standard that expired three days ago.
    const res = await submitWithoutStandardsOrDate(id);

    // 3. Refused: the final snapshot is re-judged at the final performed day.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("certificado vencido");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    expect(await auditActions(id)).not.toContain("submit");
  });

  it("REQ-CAL-004 A1: a standard of the saved snapshot is re-judged at submit even when it is valid on the day it was saved", async () => {
    const { id, standardId } = await seedJobWithStandard("DRAFT");
    expect((await execute(id, standardId, lastEvening)).status).toBe(200);

    // Submit with no standards but dated back to the standard's last day (3
    // days): still valid then, so it needs the A2 reason, not a refusal.
    const without = await jobsRouter.request(`/${id}/submit`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        calibrationLocation: { type: "lab", addressText: "Laboratório" },
        data: { indication: "10", reference: "9" },
        performedAt: lastEvening.toISOString(),
      }),
    });
    expect(without.status).toBe(400);
    expect((await without.json()).error).toContain("justific");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
  });

  it("REQ-CAL-004 A2: a standard that expired after the performed date needs a written reason even within 7 days, and the audit row records the judgement", async () => {
    const { id, standardId } = await seedJobWithStandard("IN_PROGRESS");

    const refused = await submit(id, standardId, lastEvening);
    expect(refused.status).toBe(400);
    const message: string = (await refused.json()).error;
    expect(message).toContain("Massa Padrao");
    expect(message).toContain("venceu apos a data de execucao");
    expect(message).toContain("justific");
    expect(await statusOf(id)).toBe("IN_PROGRESS");

    const accepted = await submit(
      id,
      standardId,
      lastEvening,
      "Registro do dia da calibracao",
    );
    expect(accepted.status).toBe(200);

    const auditRows = await db
      .select({
        action: jobAuditLog.action,
        reason: jobAuditLog.reason,
        changes: jobAuditLog.changes,
      })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.jobId, id));
    const row = auditRows.find((entry) => entry.action === "submit");
    expect(row?.reason).toContain("Registro do dia da calibracao");
    expect(row?.reason).toContain("Massa Padrao");
    expect(row?.reason).toContain("julgados na data de execucao");
    expect(JSON.stringify(row?.changes)).toContain("standardsJudgedAt");
  });

  it("REQ-CAL-004 A2: a standard still valid today needs no reason within 7 days", async () => {
    const { id, standardId } = await seedJobWithStandard("IN_PROGRESS");
    await db
      .update(referenceStandard)
      .set({ nextCalibrationDate: addCalendarDays(labToday(), 90) })
      .where(eq(referenceStandard.id, standardId));

    const res = await submit(
      id,
      standardId,
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );

    expect(res.status).toBe(200);
  });

  it("REQ-CAL-004 [HIGH RISK]: submit refuses the standard for work performed at 00:10 the day after, and the job stays IN_PROGRESS", async () => {
    const { id, standardId } = await seedJobWithStandard("IN_PROGRESS");

    const res = await submit(id, standardId, nextMorning);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("certificado vencido");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    expect(await auditActions(id)).not.toContain("submit");
  });

  it("REQ-CAL-004: a worksheet save (execute) judges the standard by the same performed day", async () => {
    const { id, standardId } = await seedJobWithStandard("DRAFT");

    const refused = await execute(id, standardId, nextMorning);
    expect(refused.status).toBe(400);
    expect(await statusOf(id)).toBe("DRAFT");

    const accepted = await execute(id, standardId, lastEvening);
    expect(accepted.status).toBe(200);
    expect(await statusOf(id)).toBe("IN_PROGRESS");
  });

  it("REQ-CAL-004: a draft keeps judging the standard by the performed date it already saved, not by today", async () => {
    const { id, standardId } = await seedJobWithStandard("DRAFT");
    expect((await execute(id, standardId, lastEvening)).status).toBe(200);

    // An auto-save that carries no date: today the standard is long expired,
    // but the work was recorded on a day it was still valid.
    const res = await jobsRouter.request(`/${id}/execute`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        data: { indication: "10", reference: "9" },
        selectedStandardIds: [standardId],
      }),
    });

    expect(res.status).toBe(200);
  });
});
