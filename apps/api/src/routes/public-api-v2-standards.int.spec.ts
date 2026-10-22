/**
 * public-api-v2-standards.int.spec.ts: the public API's job submit records the
 * work as performed NOW, so every standard of the job's snapshot must be valid
 * today (REQ-CAL-004). A draft saved through the cloud with a past performed
 * date and a standard that was valid then must not slip an expired standard
 * into REVIEW through the integrator route.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  jobAuditLog,
  referenceStandard,
  service,
} from "@calibra-facil/db/schema";
import {
  addCalendarDays,
  calendarDateKey,
  labToday,
} from "@calibra-facil/shared";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedApiKey, seedCustomer, seedOrg } from "../../test/integration/seed";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import { jobsRouter } from "./jobs";
import { publicApiV2Router } from "./public-api-v2";

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

const JSON_HEADERS = { "content-type": "application/json" };

async function seedWorld(validThrough: Date) {
  const org = await seedOrg({ orgId: "org-papi", userId: "user-papi" });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    name: "Cliente",
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: "AT", slug: "at-papi", definition: [] })
    .returning({ id: assetType.id });
  const [instrument] = await db
    .insert(asset)
    .values({
      labOrganizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetTypeId: type?.id ?? 0,
      name: "Instrumento",
      serialNumber: "SN-PAPI",
      tag: "TAG-PAPI",
    })
    .returning({ id: asset.id });
  const [svc] = await db
    .insert(service)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Calibracao",
      isActive: true,
    })
    .returning({ id: service.id });
  const [job] = await db
    .insert(calibrationJob)
    .values({
      jobId: "CAL-PAPI-1",
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetId: instrument?.id ?? 0,
      serviceId: svc?.id ?? 0,
      createdBy: org.userId,
      status: "DRAFT",
      methodSnapshot: executableMethodSnapshot(),
      certificateName: "CAL-PAPI-1",
    })
    .returning({ id: calibrationJob.id });
  const [standard] = await db
    .insert(referenceStandard)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
      name: "Massa Padrao",
      kind: "generic_scalar",
      serialNumber: "SN-STD-PAPI",
      certificateNumber: "CERT-PAPI",
      calibrationDate: new Date("2025-01-10T15:00:00.000Z"),
      nextCalibrationDate: validThrough,
      coverageFactor: 2,
      distribution: "normal",
      status: "ACTIVE",
      referenceValue: 1,
      uncertainty: 0.01,
    })
    .returning({ id: referenceStandard.id });
  const { rawKey } = await seedApiKey({
    organizationId: org.orgId,
    createdBy: org.userId,
    scopes: ["jobs:write"],
  });
  return {
    org,
    jobId: job?.id ?? 0,
    standardId: standard?.id ?? 0,
    rawKey,
  };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

/** The cloud draft: a past performed date and the standard, valid on that day. */
async function saveCloudDraft(world: World, performedAt: Date) {
  loginAs({ userId: world.org.userId, organizationId: world.org.orgId });
  const res = await jobsRouter.request(`/${world.jobId}/execute`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      data: { indication: "10", reference: "9" },
      selectedStandardIds: [world.standardId],
      performedAt: performedAt.toISOString(),
    }),
  });
  expect(res.status).toBe(200);
}

function publicSubmit(world: World, key: string) {
  return publicApiV2Router.request(`/jobs/${world.jobId}/submit`, {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      "x-api-key": world.rawKey,
      "idempotency-key": key,
    },
    body: JSON.stringify({
      data: { indication: "10", reference: "9" },
      calibrationLocation: { type: "lab", addressText: "Laboratório" },
    }),
  });
}

async function jobState(jobId: number) {
  const [row] = await db
    .select({
      status: calibrationJob.status,
      performedAt: calibrationJob.performedAt,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  const audit = await db
    .select({ action: jobAuditLog.action })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, jobId));
  return { ...row, audit: audit.map((entry) => entry.action) };
}

describe("publicApiV2Router POST /jobs/:id/submit: standards are judged at the performed date (REQ-CAL-004)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-CAL-004 [HIGH RISK]: refuses a standard valid on the draft's past performed day but expired today; the job is unchanged and no submit audit row is written", async () => {
    // Valid through three days ago; the draft is dated to that last day.
    const validThrough = addCalendarDays(labToday(), -3);
    const world = await seedWorld(validThrough);
    await saveCloudDraft(
      world,
      new Date(`${calendarDateKey(validThrough)}T23:30:00-03:00`),
    );
    const before = await jobState(world.jobId);
    expect(before.status).toBe("IN_PROGRESS");

    const res = await publicSubmit(world, "submit-expired");

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("standard_expired");
    expect(body.error.message).toContain("Massa Padrao");
    const after = await jobState(world.jobId);
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.performedAt).toEqual(before.performedAt);
    expect(after.audit).not.toContain("submit");
  });

  it("REQ-CAL-004: accepts the submit when every standard of the snapshot is valid today", async () => {
    const world = await seedWorld(addCalendarDays(labToday(), 90));
    await saveCloudDraft(world, new Date(Date.now() - 24 * 60 * 60 * 1000));

    const res = await publicSubmit(world, "submit-valid");

    expect(res.status).toBe(200);
    const after = await jobState(world.jobId);
    expect(after.status).toBe("REVIEW");
    expect(after.audit).toContain("submit");
  });

  it("REQ-CAL-004: a job with no standards in its snapshot still submits", async () => {
    const world = await seedWorld(addCalendarDays(labToday(), 90));

    const res = await publicSubmit(world, "submit-no-standards");

    expect(res.status).toBe(200);
    expect((await jobState(world.jobId)).status).toBe("REVIEW");
  });
});

// REQ-SJ-2 / REQ-SJ-3: the same judgement refuses, on every path, a standard
// that is no longer ACTIVE or was soft-deleted after the draft named it, each
// with its own stable code. Before the one judgement the cloud submit and the
// public API submit read neither status nor deletedAt.
describe("a standard that is inactive or deleted after the draft was saved is refused at submit (REQ-SJ-2, REQ-SJ-3)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  function cloudSubmit(world: World) {
    loginAs({ userId: world.org.userId, organizationId: world.org.orgId });
    return jobsRouter.request(`/${world.jobId}/submit`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        data: { indication: "10", reference: "9" },
        calibrationLocation: { type: "lab", addressText: "Laboratório" },
      }),
    });
  }

  async function draftThen(
    change: { status: "INACTIVE" } | { deletedAt: Date },
  ) {
    const world = await seedWorld(addCalendarDays(labToday(), 90));
    await saveCloudDraft(world, new Date(Date.now() - 60 * 60 * 1000));
    await db
      .update(referenceStandard)
      .set(change)
      .where(eq(referenceStandard.id, world.standardId));
    return world;
  }

  it("REQ-SJ-2 [HIGH RISK]: the public API refuses an INACTIVE standard (422 standard_inactive); the job is unchanged", async () => {
    const world = await draftThen({ status: "INACTIVE" });

    const res = await publicSubmit(world, "submit-inactive");

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("standard_inactive");
    expect(body.error.message).toContain("Massa Padrao");
    const after = await jobState(world.jobId);
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.audit).not.toContain("submit");
  });

  it("REQ-SJ-2 [HIGH RISK]: the public API refuses a soft-deleted standard (422 standard_deleted)", async () => {
    const world = await draftThen({ deletedAt: new Date() });

    const res = await publicSubmit(world, "submit-deleted");

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("standard_deleted");
    expect((await jobState(world.jobId)).status).toBe("IN_PROGRESS");
  });

  it("REQ-SJ-2 [HIGH RISK]: the cloud submit refuses an INACTIVE standard of the saved snapshot (400 standard_inactive); the job is unchanged", async () => {
    const world = await draftThen({ status: "INACTIVE" });

    const res = await cloudSubmit(world);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("standard_inactive");
    expect(body.error).toContain("nao estao ativos");
    const after = await jobState(world.jobId);
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.audit).not.toContain("submit");
  });

  it("REQ-SJ-2 [HIGH RISK]: the cloud submit refuses a soft-deleted standard of the saved snapshot (400 standard_deleted)", async () => {
    const world = await draftThen({ deletedAt: new Date() });

    const res = await cloudSubmit(world);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("standard_deleted");
    expect((await jobState(world.jobId)).status).toBe("IN_PROGRESS");
  });

  it("REQ-SJ-3: the cloud submit keeps its stable code and 400 for an expired standard", async () => {
    const world = await seedWorld(addCalendarDays(labToday(), -3));
    await saveCloudDraft(
      world,
      new Date(
        `${calendarDateKey(addCalendarDays(labToday(), -3))}T15:00:00-03:00`,
      ),
    );

    const res = await cloudSubmit(world);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("standard_expired");
  });
});
