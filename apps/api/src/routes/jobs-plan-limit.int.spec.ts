/**
 * jobs-plan-limit.int.spec.ts — Real-DB integration test for the certificate
 * plan-limit quota at the TOCTOU boundary in jobs.ts's `POST /` (issue #659 /
 * DOM-06).
 *
 * Before this fix, `jobs.ts` only ran `requirePlanLimit("certificates")` — a
 * fast, non-transactional pre-check — before creating the job in its OWN,
 * separate `db.transaction`. Two concurrent requests at the quota boundary
 * could both pass the pre-check (neither has committed yet) and both proceed
 * to insert, exceeding the monthly certificate quota.
 * `calibration-requests.ts`'s `POST /:id/convert` always paired that
 * pre-check with a `pg_advisory_xact_lock` + in-transaction re-read of
 * subscription + usage. This spec exercises the SAME robust pattern — now
 * extracted into `assertPlanLimitInTransaction` (apps/api/src/middleware/tier-guard.ts)
 * and reused by both routes — via two genuinely concurrent real-Postgres
 * transactions racing at the quota boundary through `jobs.ts`.
 *
 * No subscription row is seeded → the org defaults to the FREE plan
 * (certificates limit = 10/month, see packages/shared/src/plans.ts).
 *
 * Proven property (oracle):
 *   REQ-DOM-QTA-001  [HIGH RISK] Two concurrent POST / requests at the
 *     certificate-quota boundary (usage = limit - 1) resolve to EXACTLY one
 *     201 and one 402 — never two 201s — and the DB-verified certificate
 *     count for the organization this month never exceeds the plan limit.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobsRouter } from "./jobs";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  customer,
  organization,
  service,
} from "@calibra-facil/db/schema";
import { and, eq, gte, count } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// ---------------------------------------------------------------------------
// Mock background jobs and notifications — side-effects, not under test here.
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

const JSON_HEADERS = { "content-type": "application/json" };
const FREE_PLAN_CERTIFICATE_LIMIT = 10;

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

/** Seed an active service linked to a published method. Returns service.id. */
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

/** Seed a pre-existing calibration_job row counted toward this month's usage. */
async function seedUsageJob(params: {
  jobId: string;
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
}): Promise<void> {
  await db.insert(calibrationJob).values({
    jobId: params.jobId,
    organizationId: params.organizationId,
    unitId: params.unitId,
    customerId: params.customerId,
    assetId: params.assetId,
    serviceId: params.serviceId,
    createdBy: params.createdBy,
    status: "DRAFT",
    methodSnapshot: minimalMethodSnapshot(),
    certificateName: params.jobId,
    createdAt: new Date(),
  });
}

async function countCertificatesThisMonth(
  organizationId: string,
): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [result] = await db
    .select({ count: count() })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.organizationId, organizationId),
        gte(calibrationJob.createdAt, startOfMonth),
      ),
    );
  return result?.count ?? 0;
}

// ---------------------------------------------------------------------------

describe("jobsRouter — POST / certificate plan-limit quota (REQ-DOM-QTA-001)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it(
    "REQ-DOM-QTA-001: two concurrent POST / at the quota boundary resolve to exactly one 201 + one 402; DB count never exceeds the plan limit",
    async () => {
      const org = await seedOrg({
        orgId: "org-quota",
        userId: "user-quota",
        role: "admin",
      });

      const customerId = await seedCustomer({
        labOrgId: org.orgId,
        clientOrgId: `client-${org.orgId}`,
      });

      const assetTypeId = await seedAssetType("at-quota");

      const assetOneId = await seedAsset({
        unitId: org.unitId,
        customerId,
        assetTypeId,
        tag: "TAG-QUOTA-1",
      });
      const assetTwoId = await seedAsset({
        unitId: org.unitId,
        customerId,
        assetTypeId,
        tag: "TAG-QUOTA-2",
      });

      const methodId = await seedPublishedMethod({
        organizationId: org.orgId,
        assetTypeId,
        createdBy: org.userId,
      });

      const serviceId = await seedService({
        organizationId: org.orgId,
        unitId: org.unitId,
        methodId,
      });

      // Seed usage = limit - 1 (9 of 10 for FREE) so exactly one slot remains —
      // the boundary where a TOCTOU race is exploitable.
      const preExistingUsage = FREE_PLAN_CERTIFICATE_LIMIT - 1;
      await Promise.all(
        Array.from({ length: preExistingUsage }, (_, i) =>
          seedUsageJob({
            jobId: `SEED-QUOTA-${i}`,
            organizationId: org.orgId,
            unitId: org.unitId,
            customerId,
            assetId: assetOneId,
            serviceId,
            createdBy: org.userId,
          }),
        ),
      );

      expect(await countCertificatesThisMonth(org.orgId)).toBe(
        preExistingUsage,
      );

      loginAs({ userId: org.userId, organizationId: org.orgId });

      // Fire two concurrent creates for the SAME org against the ONE
      // remaining slot, using two different assets so nothing besides the
      // quota check itself could distinguish/serialize them.
      const [resA, resB] = await Promise.all([
        jobsRouter.request("/", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ assetId: assetOneId, serviceId }),
        }),
        jobsRouter.request("/", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ assetId: assetTwoId, serviceId }),
        }),
      ]);

      const statuses = [resA.status, resB.status].toSorted();

      // Exactly one request must win the last slot (201) and the other must
      // be rejected by the in-transaction re-check (402) — never both 201
      // (quota exceeded, the pre-fix bug) and never both 402 (would mean the
      // lock starved a legitimate create).
      expect(statuses).toEqual([201, 402]);

      const rejected = resA.status === 402 ? resA : resB;
      const rejectedBody = await rejected.text();
      expect(rejectedBody).toContain("certificados");

      // DB-verified: the organization's certificate count this month never
      // exceeds the FREE plan limit, regardless of which request won the race.
      const finalUsage = await countCertificatesThisMonth(org.orgId);
      expect(finalUsage).toBe(FREE_PLAN_CERTIFICATE_LIMIT);
    },
    30_000,
  );
});
