/**
 * calibration-requests.int.spec.ts — Real-DB + real-RBAC integration tests for
 * the calibration request workflow (approve → convert → calibration_job).
 *
 * ONLY the better-auth session and notification side-effects are mocked (see
 * test/integration/setup.ts for the session mock). requireLabAuth →
 * requireOrganization → withLabPermission and buildUnitScopeCondition run for
 * real against the seeded Postgres. The plan-limit check runs for real against
 * the seeded DB (no subscription row → FREE plan → 10 certs/month → convert
 * of 1 item passes).
 *
 * Proven properties (oracle):
 *   REQ-CREQ-001  [HIGH RISK] Tenant isolation: org A cannot approve/convert/GET
 *                 org B's request → 404; org B's request unchanged; GET / returns
 *                 only org A's requests with definite count.
 *   REQ-CREQ-002  [HIGH RISK] State machine: approve PENDING → 200 + APPROVED +
 *                 approvedBy (DB-verified); approve APPROVED/CONVERTED/REJECTED → 400;
 *                 reject CONVERTED → 400; reject already-REJECTED → 400.
 *   REQ-CREQ-003  [HIGH RISK] Convert state + immutability: convert APPROVED →
 *                 2xx + CONVERTED + calibration_job created (DB-verified); convert
 *                 PENDING → 400; re-convert CONVERTED → 400.
 *   REQ-CREQ-004  [HIGH RISK] RBAC dual-gate: approve as member → 403; convert as
 *                 member → 403; convert as technician (has both perms) on APPROVED → 2xx.
 *   REQ-CREQ-005  Unauthenticated approve/convert → 401.
 *
 * ESCALATIONS:
 *   1. IDENTITY-SEPARATION: The route enforces role-based RBAC only; NO
 *      four-eyes-by-identity (unlike jobs.ts). The submitter can approve and convert
 *      their own request. ISO §6.2.4 / §7.2 impartiality — flagged for human review.
 *   2. REQ-CREQ-004 OPERATOR GATE: The mini-spec states "convert as OPERATOR → 403
 *      (has request:convert but NOT calibration:create)". This premise is INCORRECT per
 *      packages/auth/src/access.ts (line 359): the operator role DOES have
 *      calibration:["create", "read", "assign_technician", "execute", "submit"].
 *      No role in the current RBAC has request:convert without also having
 *      calibration:create — the AND-gate cannot be isolated with existing roles.
 *      The test below proves the member → 403 path (lacks BOTH) and the
 *      technician → 2xx path (has BOTH). The "operator as 403" subtest described
 *      in the spec is unfounded against the actual access.ts and was NOT asserted.
 *   3. CONCURRENT-CAS (409): The optimistic-concurrency check (CAS) exists in
 *      the route but is not exercised here — hard to reproduce deterministically
 *      in a serial test suite without racing two concurrent transactions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { calibrationRequestsRouter } from "./calibration-requests";
import { db } from "@calibra-facil/db";
import {
  calibrationRequest,
  calibrationRequestItem,
  calibrationJob,
  organization,
  customer,
  assetType,
  asset,
  service,
  calibrationMethod,
  user,
  member,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// ---------------------------------------------------------------------------
// Mock notification side-effects — no email/SMS during workflow tests.
// ---------------------------------------------------------------------------

vi.mock("@calibra-facil/notifications", () => ({
  notifyCalibrationRequestApproved: vi.fn().mockResolvedValue(undefined),
  notifyCalibrationRequestConverted: vi.fn().mockResolvedValue(undefined),
  notifyCalibrationRequestRejected: vi.fn().mockResolvedValue(undefined),
  notifyCalibrationRequestUnderReview: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyVisitScheduled: vi.fn().mockResolvedValue(undefined),
  notifyVisitConfirmed: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so this file is fully self-contained.
// ---------------------------------------------------------------------------

type CalibrationRequestStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CONVERTED";

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
 * Returns customer.id.
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
      assetTypeId: params.assetTypeId,
      name: "Test Instrument",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/**
 * Seed a PUBLISHED calibration method with a minimal compiled artifact that
 * satisfies validatePublishedMethodCompiledArtifact in apps/api/src/lib/jobs.ts.
 * Returns method.id.
 *
 * Requires:
 *  - compiledMethod.methodFingerprint === methodFingerprint (string)
 *  - compiledMethod.normalizedMethodJson (string)
 *  - compiledMethod.engine.version === methodEngine.version
 *  - compiledMethod.engine.optionsFingerprint === methodEngine.optionsFingerprint
 *  - publicationEvidence (truthy)
 */
async function seedPublishedMethod(params: {
  organizationId: string;
  assetTypeId: number;
  createdBy: string;
}): Promise<number> {
  const fingerprint = "test-fp-0000000000000001";
  const engineVersion = "0.3.0";
  const optionsFingerprint = "test-opts-fp-00000001";

  const [row] = await db
    .insert(calibrationMethod)
    .values({
      organizationId: params.organizationId,
      assetTypeId: params.assetTypeId,
      name: `Test Method ${params.organizationId}`,
      version: 1,
      status: "PUBLISHED",
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
      methodFingerprint: fingerprint,
      compiledMethod: {
        methodFingerprint: fingerprint,
        normalizedMethodJson: "{}",
        engine: {
          version: engineVersion,
          optionsFingerprint,
        },
      },
      methodEngine: {
        version: engineVersion,
        optionsFingerprint,
      },
      publicationEvidence: { publishedAt: "2026-01-01T00:00:00.000Z" },
      createdBy: params.createdBy,
    })
    .returning({ id: calibrationMethod.id });
  if (!row) throw new Error("seedPublishedMethod: insert failed");
  return row.id;
}

/**
 * Seed an active service linked to a published method.
 * Returns service.id.
 */
async function seedService(params: {
  organizationId: string;
  unitId: number;
  methodId: number;
}): Promise<number> {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: `Service ${params.organizationId}-${params.unitId}`,
      methodId: params.methodId,
      isActive: true,
    })
    .returning({ id: service.id });
  if (!row) throw new Error("seedService: insert failed");
  return row.id;
}

/**
 * Seed a calibration_request + one request item.
 * Returns { requestId, itemId }.
 */
async function seedRequest(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  authOrganizationId: string;
  assetId: number;
  submittedBy: string;
  status?: CalibrationRequestStatus;
}): Promise<{ requestId: number; itemId: number }> {
  const status = params.status ?? "PENDING";

  const [reqRow] = await db
    .insert(calibrationRequest)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      authOrganizationId: params.authOrganizationId,
      status,
      deliveryMethod: "dropoff",
      submittedBy: params.submittedBy,
      submittedAt: new Date("2026-01-15T10:00:00.000Z"),
    })
    .returning({ id: calibrationRequest.id });
  if (!reqRow) throw new Error("seedRequest: request insert failed");

  const [itemRow] = await db
    .insert(calibrationRequestItem)
    .values({
      requestId: reqRow.id,
      assetId: params.assetId,
      convertedJobId: null,
    })
    .returning({ id: calibrationRequestItem.id });
  if (!itemRow) throw new Error("seedRequest: item insert failed");

  return { requestId: reqRow.id, itemId: itemRow.id };
}

/**
 * Full fixture for one org: LAB org + client org + customer + assetType +
 * asset + published method + service + member.
 */
async function seedRequestFixture(params: {
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

  const clientOrgId = `client-${params.orgId}`;
  const customerId = await seedCustomer({
    labOrgId: params.orgId,
    clientOrgId,
  });

  const tagSuffix = params.tagSuffix ?? params.orgId;
  const assetTypeId = await seedAssetType(`at-${tagSuffix}`);
  const assetId = await seedAsset({
    unitId: org.unitId,
    customerId,
    assetTypeId,
    tag: `TAG-${tagSuffix}`,
  });

  const methodId = await seedPublishedMethod({
    organizationId: params.orgId,
    assetTypeId,
    createdBy: params.userId,
  });

  const serviceId = await seedService({
    organizationId: params.orgId,
    unitId: org.unitId,
    methodId,
  });

  return {
    ...org,
    clientOrgId,
    customerId,
    assetTypeId,
    assetId,
    methodId,
    serviceId,
  };
}

// ---------------------------------------------------------------------------

describe("calibrationRequestsRouter — request → job workflow", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-CREQ-001 [HIGH RISK] Tenant isolation
  // =========================================================================
  it(
    "REQ-CREQ-001: org A cannot approve/convert/GET org B's request → 404; DB unchanged; GET / returns only org A's with exact count",
    async () => {
      const orgA = await seedRequestFixture({
        orgId: "org-a",
        userId: "user-a",
        tagSuffix: "a",
      });
      const orgB = await seedRequestFixture({
        orgId: "org-b",
        userId: "user-b",
        tagSuffix: "b",
      });

      // Seed 1 PENDING request in org A (so the list returns exactly 1)
      const { requestId: reqAId } = await seedRequest({
        organizationId: "org-a",
        unitId: orgA.unitId,
        customerId: orgA.customerId,
        authOrganizationId: orgA.clientOrgId,
        assetId: orgA.assetId,
        submittedBy: "user-a",
        status: "PENDING",
      });

      // Seed 1 PENDING request in org B (target for cross-tenant attacks)
      const { requestId: reqBId } = await seedRequest({
        organizationId: "org-b",
        unitId: orgB.unitId,
        customerId: orgB.customerId,
        authOrganizationId: orgB.clientOrgId,
        assetId: orgB.assetId,
        submittedBy: "user-b",
        status: "PENDING",
      });

      loginAs({ userId: "user-a", organizationId: "org-a" });

      // 1a: GET /:id cross-tenant → 404 (org scope excludes org B's record)
      const getRes = await calibrationRequestsRouter.request(`/${reqBId}`, {
        headers: JSON_HEADERS,
      });
      expect(getRes.status).toBe(404);

      // 1b: approve org B's request as org A → 404 (scope check in transaction)
      const approveRes = await calibrationRequestsRouter.request(
        `/${reqBId}/approve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(approveRes.status).toBe(404);

      // 1c: DB: org B's request must still be PENDING
      const [bRow] = await db
        .select({ status: calibrationRequest.status })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, reqBId));
      expect(bRow?.status).toBe("PENDING");

      // 1d: GET / returns only org A's requests — exact count = 1
      const listRes = await calibrationRequestsRouter.request("/", {
        headers: JSON_HEADERS,
      });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.pagination.total).toBe(1);
      expect(listBody.data[0].id).toBe(reqAId);

      // 1e: attempt cross-tenant convert (item 9999 cannot exist in org B's scope)
      const convertRes = await calibrationRequestsRouter.request(
        `/${reqBId}/convert`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            items: [{ itemId: 9999, serviceId: orgA.serviceId }],
          }),
        },
      );
      // Route resolves by org scope → request not found → 404
      expect(convertRes.status).toBe(404);

      // DB: no calibration_job was created for org B
      const jobs = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(eq(calibrationJob.organizationId, "org-b"));
      expect(jobs).toHaveLength(0);
    },
  );

  // =========================================================================
  // REQ-CREQ-002 [HIGH RISK] State machine — approve and reject guards
  // =========================================================================
  it(
    "REQ-CREQ-002: approve PENDING → 200 + APPROVED + approvedBy DB-verified; approve APPROVED/CONVERTED/REJECTED → 400; reject CONVERTED → 400; reject already-REJECTED → 400",
    async () => {
      const fixture = await seedRequestFixture({
        orgId: "org-a",
        userId: "user-a",
        tagSuffix: "a",
      });

      loginAs({ userId: "user-a", organizationId: "org-a" });

      // 2a: PENDING → 200 + APPROVED + approvedBy set
      const { requestId: pendingId } = await seedRequest({
        organizationId: "org-a",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        authOrganizationId: fixture.clientOrgId,
        assetId: fixture.assetId,
        submittedBy: "user-a",
        status: "PENDING",
      });

      const approveRes = await calibrationRequestsRouter.request(
        `/${pendingId}/approve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(approveRes.status).toBe(200);
      const approveBody = await approveRes.json();
      expect(approveBody.success).toBe(true);

      // DB: persisted as APPROVED with approvedBy
      const [approvedDbRow] = await db
        .select({
          status: calibrationRequest.status,
          approvedBy: calibrationRequest.approvedBy,
        })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, pendingId));
      expect(approvedDbRow?.status).toBe("APPROVED");
      expect(approvedDbRow?.approvedBy).toBe("user-a");

      // 2b: approve an already-APPROVED request → 400
      const { requestId: alreadyApprovedId } = await seedRequest({
        organizationId: "org-a",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        authOrganizationId: fixture.clientOrgId,
        assetId: fixture.assetId,
        submittedBy: "user-a",
        status: "APPROVED",
      });
      const approveApprovedRes = await calibrationRequestsRouter.request(
        `/${alreadyApprovedId}/approve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(approveApprovedRes.status).toBe(400);
      // DB unchanged
      const [stillApproved] = await db
        .select({ status: calibrationRequest.status })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, alreadyApprovedId));
      expect(stillApproved?.status).toBe("APPROVED");

      // 2c: approve a CONVERTED request → 400
      const { requestId: convertedId } = await seedRequest({
        organizationId: "org-a",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        authOrganizationId: fixture.clientOrgId,
        assetId: fixture.assetId,
        submittedBy: "user-a",
        status: "CONVERTED",
      });
      const approveConvertedRes = await calibrationRequestsRouter.request(
        `/${convertedId}/approve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(approveConvertedRes.status).toBe(400);

      // 2d: approve a REJECTED request → 400
      const { requestId: rejectedId } = await seedRequest({
        organizationId: "org-a",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        authOrganizationId: fixture.clientOrgId,
        assetId: fixture.assetId,
        submittedBy: "user-a",
        status: "REJECTED",
      });
      const approveRejectedRes = await calibrationRequestsRouter.request(
        `/${rejectedId}/approve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(approveRejectedRes.status).toBe(400);

      // 2e: reject a CONVERTED request → 400 with message "convertidas"
      const { requestId: convertedId2 } = await seedRequest({
        organizationId: "org-a",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        authOrganizationId: fixture.clientOrgId,
        assetId: fixture.assetId,
        submittedBy: "user-a",
        status: "CONVERTED",
      });
      const rejectConvertedRes = await calibrationRequestsRouter.request(
        `/${convertedId2}/reject`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ reason: "Should be blocked" }),
        },
      );
      expect(rejectConvertedRes.status).toBe(400);
      const rejectConvertedBody = await rejectConvertedRes.json();
      expect(rejectConvertedBody.error).toMatch(/convertidas/i);

      // 2f: reject an already-REJECTED request → 400 with message "rejeitada"
      const { requestId: rejectedId2 } = await seedRequest({
        organizationId: "org-a",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        authOrganizationId: fixture.clientOrgId,
        assetId: fixture.assetId,
        submittedBy: "user-a",
        status: "REJECTED",
      });
      const rejectRejectedRes = await calibrationRequestsRouter.request(
        `/${rejectedId2}/reject`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ reason: "Duplicate rejection attempt" }),
        },
      );
      expect(rejectRejectedRes.status).toBe(400);
      const rejectRejectedBody = await rejectRejectedRes.json();
      expect(rejectRejectedBody.error).toMatch(/rejeitada/i);
    },
  );

  // =========================================================================
  // REQ-CREQ-003 [HIGH RISK] Convert state + immutability
  // =========================================================================
  it(
    "REQ-CREQ-003: convert APPROVED → 2xx + CONVERTED + calibration_job in DB; convert PENDING → 400; re-convert CONVERTED → 400",
    async () => {
      const fixture = await seedRequestFixture({
        orgId: "org-a",
        userId: "user-a",
        tagSuffix: "a",
      });

      loginAs({ userId: "user-a", organizationId: "org-a" });

      // 3a: convert an APPROVED request → 2xx + calibration_job created
      const { requestId: approvedId, itemId: approvedItemId } =
        await seedRequest({
          organizationId: "org-a",
          unitId: fixture.unitId,
          customerId: fixture.customerId,
          authOrganizationId: fixture.clientOrgId,
          assetId: fixture.assetId,
          submittedBy: "user-a",
          status: "APPROVED",
        });

      const convertRes = await calibrationRequestsRouter.request(
        `/${approvedId}/convert`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            items: [
              {
                itemId: approvedItemId,
                serviceId: fixture.serviceId,
                technicianId: null,
              },
            ],
          }),
        },
      );
      expect(convertRes.status).toBe(200);
      const convertBody = await convertRes.json();
      expect(convertBody.success).toBe(true);
      expect(convertBody.jobs).toHaveLength(1);

      // DB: request is now CONVERTED with convertedBy set
      const [convertedDbRow] = await db
        .select({
          status: calibrationRequest.status,
          convertedBy: calibrationRequest.convertedBy,
        })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, approvedId));
      expect(convertedDbRow?.status).toBe("CONVERTED");
      expect(convertedDbRow?.convertedBy).toBe("user-a");

      // DB: a calibration_job row was created for org-a
      const createdJobs = await db
        .select({ id: calibrationJob.id, orgId: calibrationJob.organizationId })
        .from(calibrationJob)
        .where(eq(calibrationJob.organizationId, "org-a"));
      expect(createdJobs).toHaveLength(1);

      // DB: the request item now has convertedJobId set (not null)
      const [itemRow] = await db
        .select({ convertedJobId: calibrationRequestItem.convertedJobId })
        .from(calibrationRequestItem)
        .where(eq(calibrationRequestItem.id, approvedItemId));
      expect(itemRow?.convertedJobId).not.toBeNull();

      // 3b: convert a PENDING request → 400 "aprovadas"
      const { requestId: pendingId, itemId: pendingItemId } = await seedRequest({
        organizationId: "org-a",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        authOrganizationId: fixture.clientOrgId,
        assetId: fixture.assetId,
        submittedBy: "user-a",
        status: "PENDING",
      });

      const convertPendingRes = await calibrationRequestsRouter.request(
        `/${pendingId}/convert`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            items: [{ itemId: pendingItemId, serviceId: fixture.serviceId }],
          }),
        },
      );
      expect(convertPendingRes.status).toBe(400);
      const convertPendingBody = await convertPendingRes.json();
      expect(convertPendingBody.error).toMatch(/aprovadas/i);

      // DB: pending request still PENDING, no additional jobs
      const [pendingRow] = await db
        .select({ status: calibrationRequest.status })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, pendingId));
      expect(pendingRow?.status).toBe("PENDING");

      const jobsAfterPendingAttempt = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(eq(calibrationJob.organizationId, "org-a"));
      expect(jobsAfterPendingAttempt).toHaveLength(1); // still only the one from 3a

      // 3c: re-convert the already-CONVERTED request → 400
      // approvedId is now CONVERTED (status !== "APPROVED") so the guard fires
      const reConvertRes = await calibrationRequestsRouter.request(
        `/${approvedId}/convert`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            items: [
              {
                itemId: approvedItemId,
                serviceId: fixture.serviceId,
                technicianId: null,
              },
            ],
          }),
        },
      );
      expect(reConvertRes.status).toBe(400);
      const reConvertBody = await reConvertRes.json();
      expect(reConvertBody.error).toMatch(/aprovadas/i);

      // DB: no extra jobs created
      const jobsAfterReConvert = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(eq(calibrationJob.organizationId, "org-a"));
      expect(jobsAfterReConvert).toHaveLength(1);
    },
  );

  // =========================================================================
  // REQ-CREQ-004 [HIGH RISK] RBAC dual-gate
  // =========================================================================
  it(
    "REQ-CREQ-004: member → 403 on approve (lacks request:update); member → 403 on convert (lacks request:convert + calibration:create); technician (has both) on APPROVED request → 2xx convert",
    async () => {
      // Admin seeds the org fixture (LAB org with published method + service)
      const fixture = await seedRequestFixture({
        orgId: "org-a",
        userId: "user-admin",
        tagSuffix: "a",
      });

      // Seed a MEMBER user (has only request:read — no update, no convert)
      await db.insert(user).values({
        id: "user-member",
        name: "Member User",
        email: "user-member@lab.test",
      });
      await db.insert(member).values({
        id: "member-user-member",
        organizationId: "org-a",
        userId: "user-member",
        role: "member",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      // Seed a TECHNICIAN user (has calibration:create + request:convert — both legs)
      await db.insert(user).values({
        id: "user-tech",
        name: "Technician User",
        email: "user-tech@lab.test",
      });
      await db.insert(member).values({
        id: "member-user-tech",
        organizationId: "org-a",
        userId: "user-tech",
        role: "technician",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      // A PENDING request for the approve-gate test
      const { requestId: pendingId } = await seedRequest({
        organizationId: "org-a",
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        authOrganizationId: fixture.clientOrgId,
        assetId: fixture.assetId,
        submittedBy: "user-admin",
        status: "PENDING",
      });

      // An APPROVED request for the convert-gate test
      const { requestId: approvedId, itemId: approvedItemId } =
        await seedRequest({
          organizationId: "org-a",
          unitId: fixture.unitId,
          customerId: fixture.customerId,
          authOrganizationId: fixture.clientOrgId,
          assetId: fixture.assetId,
          submittedBy: "user-admin",
          status: "APPROVED",
        });

      // 4a: member → 403 on approve (lacks request:update)
      loginAs({ userId: "user-member", organizationId: "org-a" });
      const memberApproveRes = await calibrationRequestsRouter.request(
        `/${pendingId}/approve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(memberApproveRes.status).toBe(403);

      // DB: pending request untouched
      const [pendingRowAfterMember] = await db
        .select({ status: calibrationRequest.status })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, pendingId));
      expect(pendingRowAfterMember?.status).toBe("PENDING");

      // 4b: member → 403 on convert (lacks request:convert + calibration:create)
      const memberConvertRes = await calibrationRequestsRouter.request(
        `/${approvedId}/convert`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            items: [{ itemId: approvedItemId, serviceId: fixture.serviceId }],
          }),
        },
      );
      expect(memberConvertRes.status).toBe(403);

      // DB: approved request untouched; no job created
      const [approvedRowAfterMember] = await db
        .select({ status: calibrationRequest.status })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, approvedId));
      expect(approvedRowAfterMember?.status).toBe("APPROVED");
      const jobsAfterMember = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(eq(calibrationJob.organizationId, "org-a"));
      expect(jobsAfterMember).toHaveLength(0);

      // 4c: technician (has calibration:create + request:convert — both legs) → 2xx
      loginAs({ userId: "user-tech", organizationId: "org-a" });
      const techConvertRes = await calibrationRequestsRouter.request(
        `/${approvedId}/convert`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            items: [
              {
                itemId: approvedItemId,
                serviceId: fixture.serviceId,
                technicianId: null,
              },
            ],
          }),
        },
      );
      expect(techConvertRes.status).toBe(200);
      const techConvertBody = await techConvertRes.json();
      expect(techConvertBody.success).toBe(true);
      expect(techConvertBody.jobs).toHaveLength(1);

      // DB: a calibration_job row was created
      const jobsAfterTech = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(eq(calibrationJob.organizationId, "org-a"));
      expect(jobsAfterTech).toHaveLength(1);
    },
  );

  // =========================================================================
  // REQ-CREQ-005 Unauthenticated → 401
  // =========================================================================
  it(
    "REQ-CREQ-005: unauthenticated approve → 401; unauthenticated convert → 401",
    async () => {
      logout();

      const approveRes = await calibrationRequestsRouter.request(
        "/999/approve",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(approveRes.status).toBe(401);

      const convertRes = await calibrationRequestsRouter.request(
        "/999/convert",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            items: [{ itemId: 1, serviceId: 1 }],
          }),
        },
      );
      expect(convertRes.status).toBe(401);
    },
  );
});
