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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobsRouter } from "./jobs";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  organization,
  assetType,
  asset,
  customer,
  service,
  member,
  user,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
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
  | "CANCELED";

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
      methodSnapshot: minimalMethodSnapshot(),
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
