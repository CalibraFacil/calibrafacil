/**
 * sync-aggregate-version.int.spec.ts — real-Postgres proof of the server-side
 * expected version of desktop sync pushes (roadmap 2 E1).
 *
 *   REQ-E1-1  an event that names the aggregate's current version is applied and
 *             moves it forward by one (answered as `aggregateVersion`); one that
 *             names another version is a reviewable `stale_version` conflict and
 *             writes nothing; an event without an expectation (an older build) is
 *             applied as before; a replay of an applied event is acknowledged
 *             without moving the version.
 *   REQ-E1-2  inside one push, once an event of a record was not applied, the later
 *             events of the same record are not applied either
 *             (SYNC_PRECEDING_EVENT_NOT_APPLIED), while other records go through.
 *   REQ-E2-3  a push that says when it was sent is answered with the server time
 *             and the device clock's skew, and a skew beyond the tolerance is
 *             recorded in the audit row of the job change it carries (roadmap 2 E2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  jobAuditLog,
  syncAppliedEvent,
} from "@calibra-facil/db/schema";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";
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

async function startedJob(org: {
  orgId: string;
  unitId: number;
  userId: string;
}) {
  const { jobId, assetId } = await seedJobForOrg({
    orgId: org.orgId,
    unitId: org.unitId,
    createdBy: org.userId,
  });
  const [instrument] = await db
    .select({ assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(eq(asset.id, assetId));
  await db
    .update(calibrationJob)
    .set({
      status: "IN_PROGRESS",
      methodSnapshot: executableMethodSnapshot(),
      assetSnapshot: {
        assetId,
        assetTypeId: instrument?.assetTypeId ?? 0,
        assetTypeName: "Instrument",
        assetTypeSlug: "instrument",
        baseMeasurementUnit: null,
        name: "Asset",
        tag: "TAG",
        serialNumber: "SN",
        manufacturer: null,
        model: null,
        specifications: null,
        capturedAt: "2026-01-01T00:00:00.000Z",
      },
    })
    .where(eq(calibrationJob.id, jobId));
  return jobId;
}

/** A second started job of the same laboratory: a copy of the first under its own number. */
async function copyOfJob(jobId: number) {
  const [row] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  if (!row) throw new Error("copyOfJob: job not found");
  const { id: _id, verificationToken: _token, ...rest } = row;
  const [copy] = await db
    .insert(calibrationJob)
    .values({ ...rest, jobId: `${row.jobId}-2`, status: "DRAFT" })
    .returning({ id: calibrationJob.id });
  if (!copy) throw new Error("copyOfJob: insert failed");
  // A job is created as a DRAFT (the status trigger); then started like the first.
  await db
    .update(calibrationJob)
    .set({ status: row.status })
    .where(eq(calibrationJob.id, copy.id));
  return copy.id;
}

async function seedWorld() {
  const org = await seedOrg({ orgId: "org-a", userId: "user-a" });
  const firstJob = await startedJob(org);
  const secondJob = await copyOfJob(firstJob);
  return { org, firstJob, secondJob };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

type PushBody = {
  serverTime?: string;
  clockSkewMs?: number;
  accepted: Array<{ eventId: string; aggregateVersion?: number }>;
  rejected: Array<{ eventId: string; code: string; reason: string }>;
  conflicts: Array<{
    conflictType: string;
    localEventId?: string;
    remotePayload?: unknown;
  }>;
};

function saveEvent(
  world: World,
  options: {
    eventId: string;
    jobId: number;
    entityId: string;
    expectedVersion?: number | null;
  },
) {
  return {
    eventId: options.eventId,
    entityType: "calibration_job",
    entityId: options.entityId,
    operation: "save_local_execution",
    payload: {
      remoteId: options.jobId,
      status: "IN_PROGRESS",
      data: { indication: "10", reference: "9", marcador: options.eventId },
      calibrationLocationSnapshot: { type: "lab", addressText: "Laboratório" },
    },
    occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    actorUserId: world.org.userId,
    organizationId: world.org.orgId,
    unitId: world.org.unitId,
    idempotencyKey: `idem-${options.eventId}`,
    localVersion: 0,
    ...(options.expectedVersion === undefined
      ? {}
      : { expectedVersion: options.expectedVersion }),
  };
}

async function push(
  world: World,
  events: unknown[],
  batch: string,
  sentAt?: string,
) {
  loginAs({ userId: world.org.userId, organizationId: world.org.orgId });
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(world.org.unitId) },
    body: JSON.stringify({
      deviceId: "device-e1",
      clientBatchId: batch,
      baseCursor: null,
      ...(sentAt === undefined ? {} : { sentAt }),
      events,
    }),
  });
  expect(res.status).toBe(200);
  const body: PushBody = await res.json();
  return body;
}

async function versionsOf(world: World, entityId: string) {
  const rows = await db
    .select({
      eventId: syncAppliedEvent.eventId,
      version: syncAppliedEvent.aggregateVersion,
    })
    .from(syncAppliedEvent)
    .where(
      and(
        eq(syncAppliedEvent.organizationId, world.org.orgId),
        eq(syncAppliedEvent.entityId, entityId),
      ),
    );
  return rows
    .map((row) => [row.eventId, row.version] as const)
    .toSorted((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
}

async function readingsMarker(jobId: number) {
  const [row] = await db
    .select({ data: calibrationJob.data })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  const data = row?.data;
  return data !== null && typeof data === "object"
    ? Reflect.get(data, "marcador")
    : undefined;
}

describe("desktop sync expected version (roadmap 2 E1)", () => {
  let world: World;

  beforeEach(async () => {
    await truncateAll();
    world = await seedWorld();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("REQ-E1-1: the current version applies and moves the aggregate forward; the next event chains on it", async () => {
    const first = await push(
      world,
      [
        saveEvent(world, {
          eventId: "e-1",
          jobId: world.firstJob,
          entityId: "L1",
          expectedVersion: 0,
        }),
      ],
      "b-1",
    );
    expect(first.rejected).toEqual([]);
    expect(first.conflicts).toEqual([]);
    expect(first.accepted).toMatchObject([
      { eventId: "e-1", aggregateVersion: 1 },
    ]);

    const second = await push(
      world,
      [
        saveEvent(world, {
          eventId: "e-2",
          jobId: world.firstJob,
          entityId: "L1",
          expectedVersion: 1,
        }),
      ],
      "b-2",
    );
    expect(second.accepted).toMatchObject([
      { eventId: "e-2", aggregateVersion: 2 },
    ]);
    expect(await versionsOf(world, "L1")).toEqual([
      ["e-1", 1],
      ["e-2", 2],
    ]);
    expect(await readingsMarker(world.firstJob)).toBe("e-2");
  });

  it("REQ-E1-1 [HIGH RISK]: a stale expected version is a stale_version conflict and writes nothing", async () => {
    await push(
      world,
      [
        saveEvent(world, {
          eventId: "e-1",
          jobId: world.firstJob,
          entityId: "L1",
          expectedVersion: 0,
        }),
      ],
      "b-1",
    );

    // A second device that pulled the record before e-1 still expects version 0.
    const stale = await push(
      world,
      [
        saveEvent(world, {
          eventId: "e-other-device",
          jobId: world.firstJob,
          entityId: "L1",
          expectedVersion: 0,
        }),
      ],
      "b-2",
    );

    expect(stale.accepted).toEqual([]);
    expect(stale.conflicts).toHaveLength(1);
    expect(stale.conflicts[0]).toMatchObject({
      conflictType: "stale_version",
      remotePayload: { aggregateVersion: 1, expectedVersion: 0 },
    });
    expect(await readingsMarker(world.firstJob)).toBe("e-1");
    expect(await versionsOf(world, "L1")).toEqual([["e-1", 1]]);
  });

  it("REQ-E1-1: an event without an expectation (an older desktop build) is applied as before and still counts", async () => {
    const legacy = await push(
      world,
      [
        saveEvent(world, {
          eventId: "e-legacy",
          jobId: world.firstJob,
          entityId: "L1",
        }),
      ],
      "b-1",
    );
    expect(legacy.accepted).toMatchObject([
      { eventId: "e-legacy", aggregateVersion: 1 },
    ]);

    const nullExpectation = await push(
      world,
      [
        saveEvent(world, {
          eventId: "e-null",
          jobId: world.firstJob,
          entityId: "L1",
          expectedVersion: null,
        }),
      ],
      "b-2",
    );
    expect(nullExpectation.accepted).toMatchObject([
      { eventId: "e-null", aggregateVersion: 2 },
    ]);
  });

  it("REQ-E1-1: a replay of an applied event is acknowledged without moving the version", async () => {
    const event = saveEvent(world, {
      eventId: "e-1",
      jobId: world.firstJob,
      entityId: "L1",
      expectedVersion: 0,
    });
    await push(world, [event], "b-1");

    const replay = await push(world, [event], "b-1-retry");

    expect(replay.rejected).toEqual([]);
    expect(replay.conflicts).toEqual([]);
    expect(replay.accepted).toMatchObject([
      { eventId: "e-1", aggregateVersion: 1 },
    ]);
    expect(await versionsOf(world, "L1")).toEqual([["e-1", 1]]);
  });

  it("REQ-E1-2: inside one push, the later events of a record wait for its refused one; other records go through", async () => {
    await push(
      world,
      [
        saveEvent(world, {
          eventId: "e-1",
          jobId: world.firstJob,
          entityId: "L1",
          expectedVersion: 0,
        }),
      ],
      "b-1",
    );

    const batch = await push(
      world,
      [
        // stale: refused as a conflict
        saveEvent(world, {
          eventId: "e-stale",
          jobId: world.firstJob,
          entityId: "L1",
          expectedVersion: 0,
        }),
        // made on top of e-stale: not applied either, although its version would match
        saveEvent(world, {
          eventId: "e-after",
          jobId: world.firstJob,
          entityId: "L1",
          expectedVersion: 1,
        }),
        // another record: unaffected
        saveEvent(world, {
          eventId: "e-other",
          jobId: world.secondJob,
          entityId: "L2",
          expectedVersion: 0,
        }),
      ],
      "b-2",
    );

    expect(batch.conflicts.map((conflict) => conflict.conflictType)).toEqual([
      "stale_version",
    ]);
    expect(batch.rejected).toEqual([
      {
        eventId: "e-after",
        code: "SYNC_PRECEDING_EVENT_NOT_APPLIED",
        reason: expect.stringContaining("e-stale"),
      },
    ]);
    expect(batch.accepted).toMatchObject([
      { eventId: "e-other", aggregateVersion: 1 },
    ]);
    expect(await readingsMarker(world.firstJob)).toBe("e-1");
    expect(await readingsMarker(world.secondJob)).toBe("e-other");
  });
});

describe("device clock skew on push (roadmap 2 E2)", () => {
  let world: World;

  beforeEach(async () => {
    await truncateAll();
    world = await seedWorld();
  });

  async function lastAuditChanges(jobId: number) {
    const rows = await db
      .select({ changes: jobAuditLog.changes })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.jobId, jobId))
      .orderBy(jobAuditLog.id);
    const changes = rows.at(-1)?.changes;
    return changes !== null && typeof changes === "object" ? changes : {};
  }

  it("REQ-E2-3: a device ten minutes ahead is answered with the skew and recorded in the job audit row", async () => {
    const ahead = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const body = await push(
      world,
      [
        saveEvent(world, {
          eventId: "skew-1",
          jobId: world.firstJob,
          entityId: "L1",
        }),
      ],
      "b-skew-1",
      ahead,
    );

    expect(body.accepted).toHaveLength(1);
    expect(typeof body.serverTime).toBe("string");
    expect(body.clockSkewMs).toBeGreaterThan(9 * 60 * 1000);
    expect(body.clockSkewMs).toBeLessThan(11 * 60 * 1000);
    const changes = await lastAuditChanges(world.firstJob);
    expect(Reflect.get(changes, "source")).toBe("desktop_sync");
    const recorded = Reflect.get(changes, "deviceClockSkewMs");
    expect(typeof recorded).toBe("number");
    expect(Math.abs(Number(recorded) - 10 * 60 * 1000)).toBeLessThan(60_000);
  });

  it("REQ-E2-3: a clock within the tolerance, or a push without sentAt, records no skew", async () => {
    const onTime = await push(
      world,
      [
        saveEvent(world, {
          eventId: "skew-2",
          jobId: world.firstJob,
          entityId: "L1",
        }),
      ],
      "b-skew-2",
      new Date().toISOString(),
    );
    expect(Math.abs(onTime.clockSkewMs ?? 0)).toBeLessThan(60_000);
    expect(
      Reflect.has(await lastAuditChanges(world.firstJob), "deviceClockSkewMs"),
    ).toBe(false);

    const legacy = await push(
      world,
      [
        saveEvent(world, {
          eventId: "skew-3",
          jobId: world.secondJob,
          entityId: "L2",
        }),
      ],
      "b-skew-3",
    );
    expect(legacy.clockSkewMs).toBeUndefined();
    expect(
      Reflect.has(await lastAuditChanges(world.secondJob), "deviceClockSkewMs"),
    ).toBe(false);
  });
});
