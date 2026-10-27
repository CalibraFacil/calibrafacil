/**
 * approval-sod-gates.int.spec.ts: roadmap 2 B5 [HIGH RISK].
 *
 * The approval gates that make the release a real second pair of eyes, run through
 * the real routes (cloud `POST /jobs/:id/approve`, public API `POST /v2/jobs/:id/approve`),
 * the real RBAC middleware and a real Postgres, as the application role `calibra_app`
 * (only the better-auth session, R2, the queue and the notifications are faked; the
 * CMC classification is neutral).
 *
 *   REQ-B5-1  separation of duties on the ACTUAL submitter (`submitted_by`): the person
 *             who submitted the job for review cannot approve it, even when another
 *             member is the assigned technician; the technician check stays.
 *   REQ-B5-2  the gates are mandatory for an accredited laboratory: an empty
 *             authorized-signatory roster refuses (fail closed, pt-BR message); the
 *             "no other approver exists" exemption of a solo lab does not apply. A
 *             non-accredited laboratory keeps its behaviour.
 *   REQ-B5-3  the reference standards are re-judged at approval, on the date the work
 *             was performed: expired then, deleted or recalled (out of tolerance)
 *             refuses the approval; a standard retired (INACTIVE) or sent for
 *             calibration after the measurement is a normal lifecycle step and does not.
 *   REQ-B5-5  deny paths end to end, including cross-laboratory access.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  authorizedSignatory,
  calibrationJob,
  jobAuditLog,
  jobStandard,
  member,
  organization,
  organizationApiKey,
  referenceStandard,
  user,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import {
  loginAs,
  loginPerRequestHeader,
} from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import {
  seedExtraMember,
  seedJobForOrg,
} from "../../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../../test/integration/executable-method";
import { insertJobs } from "../../../test/integration/job-fixtures";
import { createApiKeySecret } from "../../lib/api-keys";
import { jobsRouter } from "../../routes/jobs";
import { publicApiV2Router } from "../../routes/public-api-v2";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  uploadToR2: vi.fn(async () => undefined),
}));

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueue,
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
  notifyAssetFoundOutOfTolerance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage")>();
  return {
    ...actual,
    createR2Client: () => ({ send: vi.fn() }),
    uploadToR2: mocks.uploadToR2,
  };
});

// The CMC classification has its own specs; here it is neutral, so an accredited
// laboratory is not stopped by the scope guard and only the gates under test decide.
vi.mock("../../lib/scope-compliance", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/scope-compliance")>();
  return {
    ...actual,
    classifyJobScopeCompliance: vi.fn(async () => ({
      compliance: null,
      enforcementMode: "warn",
    })),
  };
});

const JSON_HEADERS = { "content-type": "application/json" };
const ORG = "org-sod";
const OTHER_ORG = "org-sod-other";
// The technician assigned to the job (a technician role: cannot approve).
const TECHNICIAN = "user-sod-technician";
// The admin who submitted the job for review while someone else is assigned.
const SUBMITTER = "user-sod-submitter";
const CHECKER = "user-sod-checker";
const DAY_MS = 24 * 60 * 60 * 1000;

type World = Awaited<ReturnType<typeof seedWorld>>;

async function seedWorld() {
  const org = await seedOrg({ orgId: ORG, userId: SUBMITTER, role: "admin" });
  await seedExtraMember({ orgId: ORG, userId: CHECKER, role: "admin" });
  await seedExtraMember({
    orgId: ORG,
    userId: TECHNICIAN,
    role: "technician",
    unitId: org.unitId,
    unitRole: "technician",
  });
  const { jobId, assetId, serviceId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: TECHNICIAN,
  });
  // The helper's own job is a DRAFT used as the template for customer/asset/service.
  const [template] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  if (!template) throw new Error("template job missing");
  return {
    org,
    customerId: template.customerId,
    assetId,
    serviceId,
    templateJobId: jobId,
  };
}

async function makeAccredited(accredited = true) {
  await db
    .update(organization)
    .set({ accreditationActive: accredited })
    .where(eq(organization.id, ORG));
}

async function addSignatory(
  userId: string,
  overrides: Partial<typeof authorizedSignatory.$inferInsert> = {},
) {
  await db.insert(authorizedSignatory).values({
    organizationId: ORG,
    userId,
    assetTypeId: null,
    status: "ACTIVE",
    authorizedBy: SUBMITTER,
    ...overrides,
  });
}

let sequence = 0;
async function seedReviewJob(
  world: World,
  overrides: Partial<typeof calibrationJob.$inferInsert> = {},
): Promise<number> {
  sequence += 1;
  const [row] = await insertJobs({
    jobId: `CAL-SOD-${sequence}`,
    organizationId: ORG,
    unitId: world.org.unitId,
    customerId: world.customerId,
    assetId: world.assetId,
    serviceId: world.serviceId,
    createdBy: TECHNICIAN,
    technicianId: TECHNICIAN,
    submittedBy: SUBMITTER,
    submittedAt: new Date("2026-06-10T12:00:00.000Z"),
    performedAt: new Date("2026-06-10T12:00:00.000Z"),
    status: "REVIEW",
    methodSnapshot: executableMethodSnapshot(),
    certificateName: "cert",
    ...overrides,
  });
  if (!row) throw new Error("seedReviewJob failed");
  return row.id;
}

async function readJob(id: number) {
  const [row] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, id));
  if (!row) throw new Error("job vanished");
  return row;
}

async function approveAuditRows(id: number) {
  const rows = await db
    .select({ action: jobAuditLog.action })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, id));
  return rows.filter((row) => row.action === "approve");
}

type Refusal = { status: number; code: string; error: string };
type Outcome = { approved: true } | ({ approved: false } & Refusal);

async function approveCloud(
  jobId: number,
  userId: string,
  organizationId = ORG,
): Promise<Outcome> {
  loginPerRequestHeader(organizationId);
  const res = await jobsRouter.request(`/${jobId}/approve`, {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-test-user-id": userId },
    body: JSON.stringify({}),
  });
  if (res.status === 200) return { approved: true };
  // The RBAC middleware answers a role refusal in plain text, the handler in JSON.
  const text = await res.text();
  let body: { code?: string; error?: string } = { error: text };
  try {
    body = JSON.parse(text);
  } catch {
    // keep the plain-text body
  }
  return {
    approved: false,
    status: res.status,
    code: body.code ?? "",
    error: body.error ?? "",
  };
}

async function seedKeyFor(userId: string, organizationId = ORG) {
  const secret = createApiKeySecret();
  await db.insert(organizationApiKey).values({
    id: `key-${userId}-${Math.random().toString(36).slice(2)}`,
    organizationId,
    name: `Key of ${userId}`,
    keyPrefix: secret.keyPrefix,
    keyHash: secret.keyHash,
    scopes: ["jobs:read", "jobs:write"],
    createdBy: userId,
  });
  return secret.key;
}

async function approvePublic(
  jobId: number,
  userId: string,
  organizationId = ORG,
): Promise<Outcome> {
  const rawKey = await seedKeyFor(userId, organizationId);
  const res = await publicApiV2Router.request(`/jobs/${jobId}/approve`, {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      "x-api-key": rawKey,
      "idempotency-key": `idem-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify({}),
  });
  if (res.status === 200) return { approved: true };
  const body: { error?: { code?: string; message?: string } } =
    await res.json();
  return {
    approved: false,
    status: res.status,
    code: body.error?.code ?? "",
    error: body.error?.message ?? "",
  };
}

async function seedStandard(
  world: World,
  overrides: Partial<typeof referenceStandard.$inferInsert> = {},
) {
  const [row] = await db
    .insert(referenceStandard)
    .values({
      organizationId: ORG,
      unitId: world.org.unitId,
      createdBy: SUBMITTER,
      name: "Massa Padrao",
      kind: "generic_scalar",
      serialNumber: `SN-STD-${Math.random().toString(36).slice(2)}`,
      certificateNumber: "CERT-SOD",
      calibrationDate: new Date("2026-01-10T15:00:00.000Z"),
      nextCalibrationDate: addCalendarDays(labToday(), 90),
      coverageFactor: 2,
      distribution: "normal",
      status: "ACTIVE",
      referenceValue: 1,
      uncertainty: 0.01,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("seedStandard failed");
  return row;
}

function snapshotOf(
  standard: typeof referenceStandard.$inferSelect,
): StandardSnapshot {
  return {
    id: standard.id,
    name: standard.name,
    certificateNumber: standard.certificateNumber,
    calibrationDate: standard.calibrationDate,
    nextCalibrationDate: standard.nextCalibrationDate,
    uncertainty: 0.01,
    uncertaintyUnit: "g",
    coverageFactor: 2,
    distribution: "normal",
    drift: null,
    certifiedValues: null,
  };
}

async function seedReviewJobWithStandard(
  world: World,
  standard: typeof referenceStandard.$inferSelect,
  overrides: Partial<typeof calibrationJob.$inferInsert> = {},
) {
  const jobId = await seedReviewJob(world, {
    standardsSnapshot: [snapshotOf(standard)],
    ...overrides,
  });
  await db.insert(jobStandard).values({
    organizationId: ORG,
    jobId,
    standardId: standard.id,
    usedAt: new Date(),
  });
  return jobId;
}

/** A refusal leaves the job exactly in REVIEW, with no release written. */
async function expectNotReleased(jobId: number) {
  expect(await readJob(jobId)).toMatchObject({
    status: "REVIEW",
    approvedBy: null,
    approvedAt: null,
    certificateUrl: null,
  });
  expect(await approveAuditRows(jobId)).toHaveLength(0);
  expect(mocks.uploadToR2).not.toHaveBeenCalled();
}

describe("approval separation of duties and mandatory gates (roadmap 2 B5)", () => {
  let world: World;

  beforeEach(async () => {
    await truncateAll();
    mocks.uploadToR2.mockClear();
    mocks.enqueue.mockReset();
    mocks.enqueue.mockResolvedValue({ messageId: "test-noop" });
    world = await seedWorld();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("REQ-B5-1: the actual submitter cannot approve", () => {
    it("REQ-B5-1 [HIGH RISK]: an admin who submitted the job for the assigned technician is refused 403 SELF_APPROVAL_BLOCKED while another admin exists", async () => {
      const jobId = await seedReviewJob(world);

      const outcome = await approveCloud(jobId, SUBMITTER);

      expect(outcome).toMatchObject({
        approved: false,
        status: 403,
        code: "SELF_APPROVAL_BLOCKED",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-1 [HIGH RISK]: the same refusal through the public API (a key acts for its creator, the submitter)", async () => {
      const jobId = await seedReviewJob(world);

      const outcome = await approvePublic(jobId, SUBMITTER);

      expect(outcome).toMatchObject({
        approved: false,
        status: 403,
        code: "self_approval_blocked",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-1: a different admin approves the same job and is the recorded approver", async () => {
      const jobId = await seedReviewJob(world);

      await expect(approveCloud(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });

      const job = await readJob(jobId);
      expect(job.status).toBe("GENERATING_PDF");
      expect(job.approvedBy).toBe(CHECKER);
      // The submitter on record is untouched by the approval.
      expect(job.submittedBy).toBe(SUBMITTER);
    });

    it("REQ-B5-1: the assigned technician and the creator checks stay (an admin technician is still refused)", async () => {
      const asTechnician = await seedReviewJob(world, {
        technicianId: SUBMITTER,
        submittedBy: CHECKER,
      });
      const asCreator = await seedReviewJob(world, {
        createdBy: SUBMITTER,
        submittedBy: CHECKER,
      });

      await expect(
        approveCloud(asTechnician, SUBMITTER),
      ).resolves.toMatchObject({
        approved: false,
        status: 403,
        code: "SELF_APPROVAL_BLOCKED",
      });
      await expect(approveCloud(asCreator, SUBMITTER)).resolves.toMatchObject({
        approved: false,
        status: 403,
        code: "SELF_APPROVAL_BLOCKED",
      });
      await expectNotReleased(asTechnician);
      await expectNotReleased(asCreator);
    });

    it("REQ-B5-1 [HIGH RISK]: end to end, the submit route records the submitter and that person cannot then approve", async () => {
      // A job in progress, assigned to the technician; the ADMIN submits it.
      const [row] = await insertJobs({
        jobId: "CAL-SOD-E2E",
        organizationId: ORG,
        unitId: world.org.unitId,
        customerId: world.customerId,
        assetId: world.assetId,
        serviceId: world.serviceId,
        createdBy: TECHNICIAN,
        technicianId: TECHNICIAN,
        status: "IN_PROGRESS",
        methodSnapshot: executableMethodSnapshot(),
        certificateName: "cert",
      });
      if (!row) throw new Error("job missing");
      expect(row.submittedBy).toBeNull();

      loginAs({ userId: SUBMITTER, organizationId: ORG });
      const submit = await jobsRouter.request(`/${row.id}/submit`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          data: { indication: "10", reference: "9" },
          calibrationLocation: { type: "lab", addressText: "Laboratório" },
        }),
      });
      expect(submit.status).toBe(200);
      const submitted = await readJob(row.id);
      expect(submitted).toMatchObject({
        status: "REVIEW",
        submittedBy: SUBMITTER,
        technicianId: TECHNICIAN,
      });
      expect(submitted.submittedAt).toBeInstanceOf(Date);

      await expect(approveCloud(row.id, SUBMITTER)).resolves.toMatchObject({
        approved: false,
        status: 403,
        code: "SELF_APPROVAL_BLOCKED",
      });
      await expect(approveCloud(row.id, CHECKER)).resolves.toEqual({
        approved: true,
      });
    });

    it("REQ-B5-1: a non-accredited solo laboratory keeps its exemption (no other approver exists)", async () => {
      await db.delete(member).where(eq(member.userId, CHECKER));
      const jobId = await seedReviewJob(world);

      await expect(approveCloud(jobId, SUBMITTER)).resolves.toEqual({
        approved: true,
      });
      expect((await readJob(jobId)).approvedBy).toBe(SUBMITTER);
    });

    it("REQ-B5-1: a legacy job with no recorded submitter falls back to the technician and creator checks", async () => {
      const jobId = await seedReviewJob(world, {
        submittedBy: null,
        submittedAt: null,
      });

      await expect(approveCloud(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });
    });
  });

  describe("REQ-B5-2: the gates are mandatory for an accredited laboratory", () => {
    it("REQ-B5-2 [HIGH RISK]: an empty signatory roster refuses the approval (403, pt-BR message), the job stays in REVIEW", async () => {
      await makeAccredited();
      const jobId = await seedReviewJob(world);

      const outcome = await approveCloud(jobId, CHECKER);

      expect(outcome).toMatchObject({
        approved: false,
        status: 403,
        code: "APPROVAL_ROSTER_EMPTY",
      });
      if (outcome.approved) throw new Error("unreachable");
      expect(outcome.error).toContain("signatários autorizados");
      await expectNotReleased(jobId);
    });

    it("REQ-B5-2 [HIGH RISK]: the public API refuses an empty roster too", async () => {
      await makeAccredited();
      const jobId = await seedReviewJob(world);

      await expect(approvePublic(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        status: 403,
        code: "approval_requires_signatory",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-2 [HIGH RISK]: a roster whose only records are expired-out (soft-deleted or inactive) is empty: still refused", async () => {
      await makeAccredited();
      await addSignatory(CHECKER, { deletedAt: new Date() });
      await addSignatory(SUBMITTER, { status: "SUSPENDED" });
      const jobId = await seedReviewJob(world);

      await expect(approveCloud(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        status: 403,
        code: "APPROVAL_ROSTER_EMPTY",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-2: a maintained roster that names the approver releases the job", async () => {
      await makeAccredited();
      await addSignatory(CHECKER);
      const jobId = await seedReviewJob(world);

      await expect(approveCloud(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });
    });

    it("REQ-B5-2: a roster that does not name the approver still refuses with APPROVER_NOT_AUTHORIZED_SIGNATORY", async () => {
      await makeAccredited();
      await addSignatory(SUBMITTER);
      const jobId = await seedReviewJob(world, { submittedBy: TECHNICIAN });

      await expect(approveCloud(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        status: 403,
        code: "APPROVER_NOT_AUTHORIZED_SIGNATORY",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-2: a non-accredited laboratory with no roster keeps releasing (behaviour unchanged)", async () => {
      await makeAccredited(false);
      const jobId = await seedReviewJob(world);

      await expect(approveCloud(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });
    });

    it("REQ-B5-2 [HIGH RISK]: an accredited laboratory has no solo exemption: with nobody else able to approve, the submitter is still refused", async () => {
      await makeAccredited();
      await db.delete(member).where(eq(member.userId, CHECKER));
      await addSignatory(SUBMITTER);
      const jobId = await seedReviewJob(world);

      await expect(approveCloud(jobId, SUBMITTER)).resolves.toMatchObject({
        approved: false,
        status: 403,
        code: "SELF_APPROVAL_BLOCKED",
      });
      await expectNotReleased(jobId);
    });
  });

  describe("REQ-B5-3: the standards are re-judged at approval", () => {
    it("REQ-B5-3: a valid standard releases the job", async () => {
      const standard = await seedStandard(world);
      const jobId = await seedReviewJobWithStandard(world, standard);

      await expect(approveCloud(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });
    });

    it("REQ-B5-3 [HIGH RISK]: a standard that was out of its calibration validity on the performed date is refused (standard_expired)", async () => {
      const performedAt = new Date(Date.now() - 30 * DAY_MS);
      const standard = await seedStandard(world, {
        nextCalibrationDate: addCalendarDays(labToday(), -40),
      });
      const jobId = await seedReviewJobWithStandard(world, standard, {
        performedAt,
      });

      const outcome = await approveCloud(jobId, CHECKER);

      expect(outcome).toMatchObject({
        approved: false,
        status: 400,
        code: "standard_expired",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-3 [HIGH RISK]: the same refusal through the public API", async () => {
      const standard = await seedStandard(world, {
        nextCalibrationDate: addCalendarDays(labToday(), -40),
      });
      const jobId = await seedReviewJobWithStandard(world, standard, {
        performedAt: new Date(Date.now() - 30 * DAY_MS),
      });

      await expect(approvePublic(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        code: "standard_expired",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-3: judged on the performed date, not today: valid then, expired since, still releases", async () => {
      const standard = await seedStandard(world, {
        nextCalibrationDate: addCalendarDays(labToday(), -5),
      });
      const jobId = await seedReviewJobWithStandard(world, standard, {
        performedAt: new Date(Date.now() - 20 * DAY_MS),
      });

      await expect(approveCloud(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });
    });

    it("REQ-B5-3 [HIGH RISK]: a standard recalled (flagged out of tolerance) after the submit refuses the approval", async () => {
      const standard = await seedStandard(world);
      const jobId = await seedReviewJobWithStandard(world, standard);
      await db
        .update(referenceStandard)
        .set({ status: "OUT_OF_TOLERANCE" })
        .where(eq(referenceStandard.id, standard.id));

      await expect(approveCloud(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        status: 400,
        code: "standard_inactive",
      });
      await expectNotReleased(jobId);
    });

    it.each(["SENT_FOR_CALIBRATION", "INACTIVE"] as const)(
      "REQ-B5-3 [HIGH RISK]: a standard valid on the performed date and then %s (a normal lifecycle step) does not block the release",
      async (status) => {
        const standard = await seedStandard(world);
        const jobId = await seedReviewJobWithStandard(world, standard);
        await db
          .update(referenceStandard)
          .set({ status })
          .where(eq(referenceStandard.id, standard.id));

        await expect(approveCloud(jobId, CHECKER)).resolves.toEqual({
          approved: true,
        });
        expect((await readJob(jobId)).status).toBe("GENERATING_PDF");
      },
    );

    it("REQ-B5-3: the lifecycle statuses do not excuse a standard that was expired on the performed date", async () => {
      const standard = await seedStandard(world, {
        status: "SENT_FOR_CALIBRATION",
        nextCalibrationDate: addCalendarDays(labToday(), -40),
      });
      const jobId = await seedReviewJobWithStandard(world, standard, {
        performedAt: new Date(Date.now() - 30 * DAY_MS),
      });

      await expect(approveCloud(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        code: "standard_expired",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-3: a deleted standard is refused whatever its status", async () => {
      const standard = await seedStandard(world, {
        status: "INACTIVE",
        deletedAt: new Date(),
      });
      const jobId = await seedReviewJobWithStandard(world, standard);

      await expect(approveCloud(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        code: "standard_deleted",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-3: a standard deleted since the submit refuses the approval", async () => {
      const standard = await seedStandard(world);
      const jobId = await seedReviewJobWithStandard(world, standard);
      await db
        .update(referenceStandard)
        .set({ deletedAt: new Date() })
        .where(eq(referenceStandard.id, standard.id));

      await expect(approveCloud(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        code: "standard_deleted",
      });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-3: one bad standard among good ones refuses the whole approval", async () => {
      const good = await seedStandard(world);
      const bad = await seedStandard(world, { status: "OUT_OF_TOLERANCE" });
      const jobId = await seedReviewJob(world, {
        standardsSnapshot: [snapshotOf(good), snapshotOf(bad)],
      });

      await expect(approveCloud(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
        code: "standard_inactive",
      });
      await expectNotReleased(jobId);
    });
  });

  describe("REQ-B5-5: cross-laboratory deny paths", () => {
    it("REQ-B5-5 [HIGH RISK]: an admin of another laboratory cannot approve this laboratory's job (404, job untouched)", async () => {
      const other = await seedOrg({
        orgId: OTHER_ORG,
        userId: "user-sod-other-admin",
        role: "admin",
      });
      await seedExtraMember({
        orgId: OTHER_ORG,
        userId: "user-sod-other-second",
        role: "admin",
      });
      const jobId = await seedReviewJob(world);

      const viaRoute = await approveCloud(
        jobId,
        "user-sod-other-second",
        other.orgId,
      );
      const viaKey = await approvePublic(
        jobId,
        "user-sod-other-second",
        other.orgId,
      );

      expect(viaRoute).toMatchObject({ approved: false, status: 404 });
      expect(viaKey).toMatchObject({ approved: false, status: 404 });
      await expectNotReleased(jobId);
    });

    it("REQ-B5-5 [HIGH RISK]: a job that names another laboratory's standard is refused (standard_not_found), the foreign standard is not disclosed", async () => {
      const other = await seedOrg({
        orgId: OTHER_ORG,
        userId: "user-sod-other-admin",
        role: "admin",
      });
      const [foreign] = await db
        .insert(referenceStandard)
        .values({
          organizationId: OTHER_ORG,
          unitId: other.unitId,
          createdBy: other.userId,
          name: "Padrao Do Outro Laboratorio",
          kind: "generic_scalar",
          serialNumber: "SN-OTHER",
          certificateNumber: "CERT-OTHER",
          calibrationDate: new Date("2026-01-10T15:00:00.000Z"),
          nextCalibrationDate: addCalendarDays(labToday(), 90),
          coverageFactor: 2,
          distribution: "normal",
          status: "ACTIVE",
          referenceValue: 1,
          uncertainty: 0.01,
        })
        .returning();
      if (!foreign) throw new Error("foreign standard missing");
      const jobId = await seedReviewJob(world, {
        standardsSnapshot: [snapshotOf(foreign)],
      });

      const outcome = await approveCloud(jobId, CHECKER);

      expect(outcome).toMatchObject({
        approved: false,
        status: 400,
        code: "standard_not_found",
      });
      if (outcome.approved) throw new Error("unreachable");
      expect(outcome.error).not.toContain("Padrao Do Outro Laboratorio");
      await expectNotReleased(jobId);
    });

    it("REQ-B5-5: a technician cannot approve at all (role gate), whoever submitted", async () => {
      const jobId = await seedReviewJob(world);

      await expect(approveCloud(jobId, TECHNICIAN)).resolves.toMatchObject({
        approved: false,
        status: 403,
      });
      await expectNotReleased(jobId);
    });
  });

  it("REQ-B5-1: the submitter column survives a user lookup join (schema sanity: references user)", async () => {
    const jobId = await seedReviewJob(world);
    const [row] = await db
      .select({ name: user.name })
      .from(calibrationJob)
      .innerJoin(user, eq(calibrationJob.submittedBy, user.id))
      .where(
        and(
          eq(calibrationJob.id, jobId),
          eq(calibrationJob.organizationId, ORG),
        ),
      );
    expect(row?.name).toBe(`User ${SUBMITTER}`);
  });
});
