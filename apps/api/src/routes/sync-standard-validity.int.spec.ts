/**
 * sync-standard-validity.int.spec.ts: real-Postgres proof that the desktop sync
 * apply judges a reference standard by the Sao Paulo day the work was PERFORMED,
 * not by the day it is synced (REQ-CAL-004, Q12).
 *
 * A standard is valid THROUGH the day its certificate names (D). The standard
 * below is valid through three days ago, so every event is synced (today) after
 * it expired; what matters is when the work was done.
 */

import { insertJobs } from "../../test/integration/job-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
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
import { seedCustomer, seedOrg } from "../../test/integration/seed";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import { syncRouter } from "./sync";

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

// The last valid day of the standard: three days ago (a stored calendar date).
const VALID_THROUGH = addCalendarDays(labToday(), -3);
const VALID_THROUGH_KEY = calendarDateKey(VALID_THROUGH);
const DAY_AFTER_KEY = calendarDateKey(addCalendarDays(VALID_THROUGH, 1));
const DAY_BEFORE_KEY = calendarDateKey(addCalendarDays(VALID_THROUGH, -1));

async function seedWorld(options: { validThrough?: Date } = {}) {
  const org = await seedOrg({
    orgId: "org-sv",
    userId: "user-sv",
    role: "admin",
  });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    name: "Cliente",
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: "AT", slug: "at-sv", definition: [] })
    .returning({ id: assetType.id });
  const [instrument] = await db
    .insert(asset)
    .values({
      labOrganizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetTypeId: type?.id ?? 0,
      name: "Instrumento",
      serialNumber: "SN-SV",
      tag: "TAG-SV",
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
  const [job] = await insertJobs({
    jobId: "CAL-SV-1",
    organizationId: org.orgId,
    unitId: org.unitId,
    customerId,
    assetId: instrument?.id ?? 0,
    serviceId: svc?.id ?? 0,
    createdBy: org.userId,
    status: "IN_PROGRESS",
    methodSnapshot: executableMethodSnapshot(),
    // The desktop apply needs the frozen asset snapshot a started job carries.
    assetSnapshot: {
      assetId: instrument?.id ?? 0,
      assetTypeId: type?.id ?? 0,
      assetTypeName: "AT",
      assetTypeSlug: "at-sv",
      baseMeasurementUnit: null,
      name: "Instrumento",
      tag: "TAG-SV",
      serialNumber: "SN-SV",
      manufacturer: null,
      model: null,
      specifications: null,
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    certificateName: "CAL-SV-1",
  });
  const [standard] = await db
    .insert(referenceStandard)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
      name: "Massa Padrao",
      kind: "generic_scalar",
      serialNumber: "SN-STD-SV",
      certificateNumber: "CERT-SV",
      calibrationDate: new Date("2025-01-10T15:00:00.000Z"),
      nextCalibrationDate: options.validThrough ?? VALID_THROUGH,
      coverageFactor: 2,
      distribution: "normal",
      status: "ACTIVE",
      referenceValue: 1,
      uncertainty: 0.01,
    })
    .returning({ id: referenceStandard.id });
  return {
    org,
    jobId: job?.id ?? 0,
    standardId: standard?.id ?? 0,
    validThrough: options.validThrough ?? VALID_THROUGH,
  };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

async function pushSubmit(
  world: World,
  options: {
    occurredAt: string;
    performedAt?: string;
    backdateReason?: string;
    eventId: string;
    /** List the standard twice in the snapshot, as a buggy client might. */
    duplicateStandard?: boolean;
  },
) {
  const standardEntry = {
    id: world.standardId,
    name: "Massa Padrao",
    certificateNumber: "CERT-SV",
    calibrationDate: "2025-01-10T00:00:00.000Z",
    nextCalibrationDate: `${calendarDateKey(world.validThrough)}T00:00:00.000Z`,
    uncertainty: 0.01,
    uncertaintyUnit: "g",
    coverageFactor: 2,
    distribution: "normal",
    drift: null,
    certifiedValues: null,
  };
  loginAs({ userId: world.org.userId, organizationId: world.org.orgId });
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(world.org.unitId) },
    body: JSON.stringify({
      deviceId: "device-sv-1",
      clientBatchId: `batch-${options.eventId}`,
      baseCursor: null,
      events: [
        {
          eventId: options.eventId,
          entityType: "calibration_job",
          entityId: "local-job-sv",
          operation: "submit_local_execution",
          payload: {
            remoteId: world.jobId,
            status: "REVIEW",
            data: { indication: "10", reference: "9" },
            ...(options.performedAt
              ? { performedAt: options.performedAt }
              : {}),
            ...(options.backdateReason
              ? { backdateReason: options.backdateReason }
              : {}),
            standardsSnapshot: options.duplicateStandard
              ? [standardEntry, standardEntry]
              : [standardEntry],
            calibrationLocationSnapshot: {
              type: "lab",
              addressText: "Laboratório",
            },
          },
          occurredAt: options.occurredAt,
          actorUserId: world.org.userId,
          organizationId: world.org.orgId,
          unitId: world.org.unitId,
          idempotencyKey: `idem-${options.eventId}`,
          localVersion: 0,
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
  const body: {
    accepted: Array<{ eventId: string }>;
    rejected: Array<{ eventId: string; code: string; reason: string }>;
  } = await res.json();
  return body;
}

async function statusOf(jobId: number) {
  const [row] = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  return row?.status;
}

describe("syncRouter — desktop execution judges a standard by the performed day (REQ-CAL-004, Q12)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-CAL-004 A3 [HIGH RISK]: an explicit performed date before the standard expired needs the written reason, even within 7 days", async () => {
    const world = await seedWorld();
    const performedAt = `${DAY_BEFORE_KEY}T15:00:00.000Z`;

    const refused = await pushSubmit(world, {
      eventId: "evt-before-no-reason",
      occurredAt: performedAt,
      performedAt,
    });
    expect(refused.accepted).toEqual([]);
    expect(refused.rejected).toEqual([
      expect.objectContaining({
        eventId: "evt-before-no-reason",
        code: "STANDARD_BACKDATE_REASON_REQUIRED",
      }),
    ]);
    expect(refused.rejected[0]?.reason).toContain("Massa Padrao");
    expect(await statusOf(world.jobId)).toBe("IN_PROGRESS");

    const accepted = await pushSubmit(world, {
      eventId: "evt-before-reason",
      occurredAt: performedAt,
      performedAt,
      backdateReason: "Lancamento tardio da calibracao",
    });
    expect(accepted.rejected).toEqual([]);
    expect(accepted.accepted.map((event) => event.eventId)).toEqual([
      "evt-before-reason",
    ]);
    expect(await statusOf(world.jobId)).toBe("REVIEW");
  });

  it("REQ-CAL-004 A3 [HIGH RISK]: an event performed on the last valid day at 23:30 in Sao Paulo is accepted with its reason", async () => {
    const world = await seedWorld();
    const performedAt = new Date(`${VALID_THROUGH_KEY}T23:30:00-03:00`);

    const body = await pushSubmit(world, {
      eventId: "evt-last-evening",
      occurredAt: performedAt.toISOString(),
      performedAt: performedAt.toISOString(),
      backdateReason: "Registro do dia da calibracao",
    });

    expect(body.rejected).toEqual([]);
    expect(await statusOf(world.jobId)).toBe("REVIEW");
  });

  it("REQ-CAL-004 [HIGH RISK]: an event performed after the standard expired (00:10 the next day) is refused STANDARD_EXPIRED, reason or not, and the job is untouched", async () => {
    const world = await seedWorld();
    const performedAt = new Date(`${DAY_AFTER_KEY}T00:10:00-03:00`);

    const body = await pushSubmit(world, {
      eventId: "evt-after",
      occurredAt: performedAt.toISOString(),
      performedAt: performedAt.toISOString(),
      backdateReason: "Tentativa com justificativa",
    });

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        eventId: "evt-after",
        code: "STANDARD_EXPIRED",
      }),
    ]);
    expect(await statusOf(world.jobId)).toBe("IN_PROGRESS");
  });

  it("REQ-CAL-004 A3 [HIGH RISK]: a legacy event without an explicit performed date is judged at SYNC time, as before: a standard that has expired since is refused although the event time was inside its validity", async () => {
    const world = await seedWorld();

    const body = await pushSubmit(world, {
      eventId: "evt-legacy-before",
      occurredAt: `${DAY_BEFORE_KEY}T15:00:00.000Z`,
    });

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({ code: "STANDARD_EXPIRED" }),
    ]);
    expect(await statusOf(world.jobId)).toBe("IN_PROGRESS");
  });

  it("REQ-CAL-004 A3: a legacy event on a standard that is still valid at sync time is accepted with no reason", async () => {
    const world = await seedWorld({
      validThrough: addCalendarDays(labToday(), 60),
    });

    const body = await pushSubmit(world, {
      eventId: "evt-legacy-valid",
      occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    expect(body.rejected).toEqual([]);
    expect(await statusOf(world.jobId)).toBe("REVIEW");
  });
});

describe("syncRouter — a standard listed twice is snapshotted once (REQ-SJ-1)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-SJ-1: a snapshot naming the same standard twice is stored with one entry", async () => {
    const world = await seedWorld({
      validThrough: addCalendarDays(labToday(), 60),
    });
    const performedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const body = await pushSubmit(world, {
      eventId: "evt-duplicate",
      occurredAt: performedAt,
      performedAt,
      duplicateStandard: true,
    });

    expect(body.rejected).toEqual([]);
    const [row] = await db
      .select({ standardsSnapshot: calibrationJob.standardsSnapshot })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, world.jobId));
    expect(row?.standardsSnapshot?.map((standard) => standard.id)).toEqual([
      world.standardId,
    ]);
  });
});

// REQ-SJ-2 / REQ-SJ-3: the desktop sync apply refuses, through the one
// judgement, what the cloud refuses, mapped to the rejection codes the desktop
// already handles.
describe("syncRouter — the one standards judgement's refusals keep their sync codes (REQ-SJ-2, REQ-SJ-3)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function pushValidSubmit(world: World, eventId: string) {
    const performedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    return pushSubmit(world, { eventId, occurredAt: performedAt, performedAt });
  }

  it("REQ-SJ-3 [HIGH RISK]: an INACTIVE standard is rejected STANDARD_NOT_ACTIVE and the job is untouched", async () => {
    const world = await seedWorld({
      validThrough: addCalendarDays(labToday(), 60),
    });
    await db
      .update(referenceStandard)
      .set({ status: "INACTIVE" })
      .where(eq(referenceStandard.id, world.standardId));

    const body = await pushValidSubmit(world, "evt-inactive");

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        eventId: "evt-inactive",
        code: "STANDARD_NOT_ACTIVE",
      }),
    ]);
    expect(await statusOf(world.jobId)).toBe("IN_PROGRESS");
  });

  it("REQ-SJ-3 [HIGH RISK]: a soft-deleted standard is rejected STANDARD_SCOPE_MISMATCH (as before) and the job is untouched", async () => {
    const world = await seedWorld({
      validThrough: addCalendarDays(labToday(), 60),
    });
    await db
      .update(referenceStandard)
      .set({ deletedAt: new Date() })
      .where(eq(referenceStandard.id, world.standardId));

    const body = await pushValidSubmit(world, "evt-deleted");

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        eventId: "evt-deleted",
        code: "STANDARD_SCOPE_MISMATCH",
      }),
    ]);
    expect(await statusOf(world.jobId)).toBe("IN_PROGRESS");
  });

  it("REQ-SJ-3 [HIGH RISK]: another organization's standard is rejected STANDARD_SCOPE_MISMATCH and its name is not disclosed", async () => {
    const world = await seedWorld({
      validThrough: addCalendarDays(labToday(), 60),
    });
    const intruder = await seedOrg({
      orgId: "org-sv-2",
      userId: "user-sv-2",
      role: "admin",
    });
    await db
      .update(referenceStandard)
      .set({ organizationId: intruder.orgId, unitId: intruder.unitId })
      .where(eq(referenceStandard.id, world.standardId));

    const body = await pushValidSubmit(world, "evt-foreign");

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        eventId: "evt-foreign",
        code: "STANDARD_SCOPE_MISMATCH",
      }),
    ]);
    expect(body.rejected[0]?.reason).not.toContain("Massa Padrao");
    expect(await statusOf(world.jobId)).toBe("IN_PROGRESS");
  });
});
