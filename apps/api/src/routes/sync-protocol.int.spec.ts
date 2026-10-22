/**
 * sync-protocol.int.spec.ts: the typed, versioned desktop push protocol, against
 * real Postgres and the real sync middleware (only the better-auth session, the
 * queue and the notifications are faked).
 *
 *   REQ-SP-2  an event that fails its schema is refused for good (a permanent
 *             code, so the desktop dead-letters it), never a 500, never a retry loop
 *   REQ-SP-3  each event is applied in its own transaction with its audit rows
 *             and its idempotency record; a failure rolls back that event only
 *   REQ-SP-4  re-pushing an applied event returns the original result, applies nothing
 *   REQ-SP-5  a job execution made against a stale base is a conflict, not an overwrite
 *   REQ-SP-6  a minimum desktop version: older desktops are told to update (the
 *             queue is untouched) and the legacy calibration-record exemption ends
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  calibrationJob,
  jobAuditLog,
  organizationEventLog,
  syncAppliedEvent,
} from "@calibra-facil/db/schema";
import {
  classifyOutboxRejection,
  syncPushResponseSchema,
  syncUpdateRequiredResponseSchema,
} from "@calibra-facil/contracts";
import { DESKTOP_EXECUTION_PAYLOAD_VERSION } from "@calibra-facil/schemas";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import {
  auditActions,
  changeJobBeforeNextTransaction,
  jobRow,
} from "../../test/integration/job-cas";
import { failEventAuditInsert } from "../../test/integration/sync-faults";
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
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

const ORG = "org-sp";
const TECHNICIAN = "user-sp-tech";
const DATA = { indication: "10", reference: "9" };
const LOCATION = {
  type: "customer_site",
  addressText: "Rua de Teste, 123",
  recordedAt: "2026-03-20T15:00:00.000Z",
  recordedBy: TECHNICIAN,
};
const STAMP = { executionPayloadVersion: DESKTOP_EXECUTION_PAYLOAD_VERSION };

type Org = Awaited<ReturnType<typeof seedOrg>>;

async function seedWorld() {
  const org = await seedOrg({ orgId: ORG, userId: TECHNICIAN, role: "admin" });
  const { jobId, assetId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: TECHNICIAN,
  });
  await db
    .update(calibrationJob)
    .set({
      status: "IN_PROGRESS",
      methodSnapshot: executableMethodSnapshot(),
      technicianId: TECHNICIAN,
    })
    .where(eq(calibrationJob.id, jobId));
  const [instrument] = await db
    .select({ customerId: asset.customerId, assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(eq(asset.id, assetId));
  if (!instrument) throw new Error("seed: asset missing");
  return { org, jobId, ...instrument };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

type EventInput = {
  eventId: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
  baseUpdatedAt?: string | null;
};

function wireEvent(org: Org, input: EventInput): Record<string, unknown> {
  return {
    eventId: input.eventId,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    payload: input.payload,
    occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    actorUserId: TECHNICIAN,
    organizationId: ORG,
    unitId: org.unitId,
    idempotencyKey: `idem-${input.eventId}`,
    localVersion: 0,
    ...(input.baseUpdatedAt === undefined
      ? {}
      : { baseUpdatedAt: input.baseUpdatedAt }),
  };
}

function executionEvent(
  world: World,
  eventId: string,
  operation: "save_local_execution" | "submit_local_execution",
  extra: { payload?: Record<string, unknown>; baseUpdatedAt?: string | null },
): Record<string, unknown> {
  const submit = operation === "submit_local_execution";
  return wireEvent(world.org, {
    eventId,
    entityType: "calibration_job",
    entityId: "local-job-sp",
    operation,
    baseUpdatedAt: extra.baseUpdatedAt,
    payload: {
      remoteId: world.jobId,
      status: submit ? "REVIEW" : "IN_PROGRESS",
      data: { ...DATA, marcador: eventId },
      results: null,
      ...STAMP,
      calibrationLocationSnapshot: LOCATION,
      ...extra.payload,
    },
  });
}

function createAssetEvent(
  world: World,
  eventId: string,
  tag: string,
): Record<string, unknown> {
  return wireEvent(world.org, {
    eventId,
    entityType: "asset",
    entityId: `local-asset-${eventId}`,
    operation: "create_local_asset",
    payload: {
      customerId: world.customerId,
      assetTypeId: world.assetTypeId,
      name: "Balança de Bancada",
      serialNumber: `SN-${tag}`,
      tag,
      baseMeasurementUnit: "kg",
    },
  });
}

type PushOptions = {
  protocolVersion?: number;
  desktopVersion?: string;
};

async function rawPush(
  world: { org: Org },
  events: unknown[],
  options: PushOptions = {},
) {
  loginAs({ userId: TECHNICIAN, organizationId: ORG });
  return syncRouter.request("/push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-active-unit-id": String(world.org.unitId),
    },
    body: JSON.stringify({
      deviceId: "device-sp",
      clientBatchId: `batch-${Math.random().toString(36).slice(2)}`,
      baseCursor: null,
      ...options,
      events,
    }),
  });
}

async function push(
  world: { org: Org },
  events: unknown[],
  options: PushOptions = {},
) {
  const res = await rawPush(world, events, options);
  expect(res.status).toBe(200);
  return syncPushResponseSchema.parse(await res.json());
}

async function eventLogFor(eventId: string) {
  return db
    .select({
      id: organizationEventLog.id,
      action: organizationEventLog.action,
    })
    .from(organizationEventLog)
    .where(sql`${organizationEventLog.details}->>'eventId' = ${eventId}`);
}

async function claimsFor(eventId: string) {
  return db
    .select()
    .from(syncAppliedEvent)
    .where(eq(syncAppliedEvent.eventId, eventId));
}

async function assetsByTag(tag: string) {
  return db.select({ id: asset.id }).from(asset).where(eq(asset.tag, tag));
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("REQ-SP-2: an event that fails its schema is refused for good", () => {
  it("REQ-SP-2: a payload of the wrong kind is rejected with a permanent code (200, not 500); the events beside it still apply; nothing is written for it", async () => {
    const world = await seedWorld();

    const body = await push(world, [
      createAssetEvent(world, "evt-sp2-before", "SP2-BEFORE"),
      executionEvent(world, "evt-sp2-bad", "submit_local_execution", {
        payload: { data: "not-an-object" },
      }),
      createAssetEvent(world, "evt-sp2-after", "SP2-AFTER"),
    ]);

    expect(body.accepted.map((entry) => entry.eventId)).toEqual([
      "evt-sp2-before",
      "evt-sp2-after",
    ]);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]).toMatchObject({ eventId: "evt-sp2-bad" });
    expect(body.rejected[0]?.code).toBe("INVALID_SYNC_COMMAND");
    expect(classifyOutboxRejection(body.rejected[0]?.code ?? "")).toBe(
      "permanent",
    );
    expect(body.rejected[0]?.reason).toContain("payload.data");
    expect(body.rejected[0]?.reason).not.toContain("not-an-object");
    expect(await claimsFor("evt-sp2-bad")).toEqual([]);
    expect(await eventLogFor("evt-sp2-bad")).toEqual([]);
    expect((await jobRow(world.jobId)).status).toBe("IN_PROGRESS");
  });

  it("REQ-SP-2: an event that is not even an event is refused on its own, permanently, and does not fail the batch", async () => {
    const world = await seedWorld();

    const res = await rawPush(world, [
      { nonsense: true },
      createAssetEvent(world, "evt-sp2-good", "SP2-GOOD"),
      "plain string",
    ]);

    expect(res.status).toBe(200);
    const body = syncPushResponseSchema.parse(await res.json());
    expect(body.accepted.map((entry) => entry.eventId)).toEqual([
      "evt-sp2-good",
    ]);
    expect(body.rejected).toHaveLength(2);
    for (const rejection of body.rejected) {
      expect(classifyOutboxRejection(rejection.code)).toBe("permanent");
    }
    // Named by their position in the batch, not by an empty id.
    expect(body.rejected.map((rejection) => rejection.eventId)).toEqual([
      "batch-index:0",
      "batch-index:2",
    ]);
    expect(body.rejected[0]?.reason).toContain("Event 0 of the batch");
  });

  it("REQ-SP-2: an operation outside the protocol stays UNSUPPORTED_SYNC_OPERATION (permanent), and a known operation sent for another entity type is the same", async () => {
    const world = await seedWorld();

    const body = await push(world, [
      wireEvent(world.org, {
        eventId: "evt-sp2-unknown",
        entityType: "calibration_job",
        entityId: "local-x",
        operation: "approve_local_job_from_the_future",
        payload: {},
      }),
      wireEvent(world.org, {
        eventId: "evt-sp2-mismatch",
        entityType: "calibration_job",
        entityId: "local-y",
        operation: "update_local_asset",
        payload: {},
      }),
    ]);

    expect(body.accepted).toEqual([]);
    expect(body.rejected.map((entry) => entry.code)).toEqual([
      "UNSUPPORTED_SYNC_OPERATION",
      "UNSUPPORTED_SYNC_OPERATION",
    ]);
  });

  it("REQ-SP-2: a request header that is not a push request at all is a client error, not a server one", async () => {
    const world = await seedWorld();
    loginAs({ userId: TECHNICIAN, organizationId: ORG });
    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-active-unit-id": String(world.org.unitId),
      },
      body: JSON.stringify({ events: "nope" }),
    });
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("REQ-SP-3: one transaction per event", () => {
  it("REQ-SP-3 [HIGH RISK]: when the event's audit row fails to insert, its state change rolls back with it, its claim is released, and the events beside it are applied and reported on their own", async () => {
    const world = await seedWorld();
    const restore = await failEventAuditInsert("evt-sp3-fail");
    let body: Awaited<ReturnType<typeof push>>;
    try {
      body = await push(world, [
        createAssetEvent(world, "evt-sp3-ok-1", "SP3-OK-1"),
        createAssetEvent(world, "evt-sp3-fail", "SP3-FAIL"),
        createAssetEvent(world, "evt-sp3-ok-2", "SP3-OK-2"),
      ]);
    } finally {
      await restore();
    }

    expect(body.accepted.map((entry) => entry.eventId)).toEqual([
      "evt-sp3-ok-1",
      "evt-sp3-ok-2",
    ]);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        eventId: "evt-sp3-fail",
        code: "DESKTOP_SYNC_APPLY_FAILED",
      }),
    ]);
    // The failed event left nothing: no asset, no asset audit row, no claim.
    expect(await assetsByTag("SP3-FAIL")).toEqual([]);
    expect(await claimsFor("evt-sp3-fail")).toEqual([]);
    expect(await eventLogFor("evt-sp3-fail")).toEqual([]);
    // The neighbours are complete: state, domain audit row, sync audit row, claim.
    for (const [eventId, tag] of [
      ["evt-sp3-ok-1", "SP3-OK-1"],
      ["evt-sp3-ok-2", "SP3-OK-2"],
    ] as const) {
      const [created] = await assetsByTag(tag);
      expect(created, tag).toBeDefined();
      const audits = await db
        .select({ id: assetAuditLog.id })
        .from(assetAuditLog)
        .where(eq(assetAuditLog.assetId, created?.id ?? -1));
      expect(audits, tag).toHaveLength(1);
      expect(await eventLogFor(eventId)).toHaveLength(1);
      const claims = await claimsFor(eventId);
      expect(claims).toHaveLength(1);
      expect(claims[0]?.appliedAt).not.toBeNull();
    }
  });

  it("REQ-SP-3 [HIGH RISK]: a job execution whose sync audit row fails leaves the job exactly as it was (no state change, no job audit row)", async () => {
    const world = await seedWorld();
    const before = await jobRow(world.jobId);
    const restore = await failEventAuditInsert("evt-sp3-job");
    let body: Awaited<ReturnType<typeof push>>;
    try {
      body = await push(world, [
        executionEvent(world, "evt-sp3-job", "submit_local_execution", {}),
      ]);
    } finally {
      await restore();
    }

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({ code: "DESKTOP_SYNC_APPLY_FAILED" }),
    ]);
    expect(await jobRow(world.jobId)).toEqual(before);
    expect(await auditActions(world.jobId)).toEqual([]);
    expect(await claimsFor("evt-sp3-job")).toEqual([]);
  });

  it("REQ-SP-3: the failed event can be pushed again once the cause is gone, and then applies once", async () => {
    const world = await seedWorld();
    const restore = await failEventAuditInsert("evt-sp3-retry");
    try {
      await push(world, [
        createAssetEvent(world, "evt-sp3-retry", "SP3-RETRY"),
      ]);
    } finally {
      await restore();
    }

    const retried = await push(world, [
      createAssetEvent(world, "evt-sp3-retry", "SP3-RETRY"),
    ]);

    expect(retried.rejected).toEqual([]);
    expect(retried.accepted).toHaveLength(1);
    expect(await assetsByTag("SP3-RETRY")).toHaveLength(1);
  });

  it("REQ-SP-3: an event the cloud rejects writes nothing, not even the half of it that ran before the refusal", async () => {
    const world = await seedWorld();
    await db
      .update(calibrationJob)
      .set({ status: "CANCELED" })
      .where(eq(calibrationJob.id, world.jobId));

    const body = await push(world, [
      executionEvent(world, "evt-sp3-cancelled", "save_local_execution", {}),
    ]);

    expect(body.accepted).toEqual([]);
    expect(body.conflicts).toHaveLength(1);
    expect(await eventLogFor("evt-sp3-cancelled")).toEqual([]);
    expect(await claimsFor("evt-sp3-cancelled")).toEqual([]);
    expect(await auditActions(world.jobId)).toEqual([]);
  });
});

describe("REQ-SP-4: idempotency on (organization, event id)", () => {
  it("REQ-SP-4: re-pushing an applied execution returns the original result and applies nothing again", async () => {
    const world = await seedWorld();
    const event = executionEvent(
      world,
      "evt-sp4-job",
      "submit_local_execution",
      {},
    );

    const first = await push(world, [event]);
    const afterFirst = await jobRow(world.jobId);
    const second = await push(world, [event]);

    expect(first.accepted).toHaveLength(1);
    expect(second.rejected).toEqual([]);
    expect(second.accepted).toEqual(first.accepted);
    expect(await jobRow(world.jobId)).toEqual(afterFirst);
    expect(await auditActions(world.jobId)).toEqual(["submit"]);
    expect(await eventLogFor("evt-sp4-job")).toHaveLength(1);
    expect(await claimsFor("evt-sp4-job")).toHaveLength(1);
  });

  it("REQ-SP-4: the same event twice in one batch applies once", async () => {
    const world = await seedWorld();
    const event = createAssetEvent(world, "evt-sp4-twice", "SP4-TWICE");

    const body = await push(world, [event, event]);

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(2);
    expect(body.accepted[1]?.remoteEntityId).toBe(
      body.accepted[0]?.remoteEntityId,
    );
    expect(await assetsByTag("SP4-TWICE")).toHaveLength(1);
  });
});

describe("REQ-SP-5: a job execution made against a stale base is a conflict", () => {
  const BASE = "2026-03-01T10:00:00.000Z";
  const NEWER = "2026-03-02T10:00:00.000Z";

  async function setJobUpdatedAt(jobId: number, iso: string) {
    await db
      .update(calibrationJob)
      .set({ updatedAt: new Date(iso) })
      .where(eq(calibrationJob.id, jobId));
  }

  it.each(["save_local_execution", "submit_local_execution"] as const)(
    "REQ-SP-5 [HIGH RISK]: %s whose base is older than the cloud job's updatedAt is a concurrent_update conflict; the job, its audit trail and the idempotency record are untouched",
    async (operation) => {
      const world = await seedWorld();
      await setJobUpdatedAt(world.jobId, NEWER);
      const before = await jobRow(world.jobId);

      const body = await push(world, [
        executionEvent(world, "evt-sp5-stale", operation, {
          baseUpdatedAt: BASE,
        }),
      ]);

      expect(body.accepted).toEqual([]);
      expect(body.rejected).toEqual([]);
      expect(body.conflicts).toEqual([
        expect.objectContaining({
          eventId: "evt-sp5-stale",
          entityType: "calibration_job",
          conflictType: "concurrent_update",
          status: "open",
          remotePayload: expect.objectContaining({
            entity: "calibration_job",
            id: world.jobId,
            updatedAt: NEWER,
            baseUpdatedAt: BASE,
          }),
        }),
      ]);
      expect(await jobRow(world.jobId)).toEqual(before);
      expect(await auditActions(world.jobId)).toEqual([]);
      expect(await claimsFor("evt-sp5-stale")).toEqual([]);
      expect(await eventLogFor("evt-sp5-stale")).toEqual([]);
    },
  );

  it.each(["save_local_execution", "submit_local_execution"] as const)(
    "REQ-SP-5 [HIGH RISK]: %s whose base was current at the check but whose job a foreign content-only write changed (status kept) before the write is a concurrent_update conflict, never an overwrite",
    async (operation) => {
      const world = await seedWorld();
      await setJobUpdatedAt(world.jobId, BASE);
      const before = await jobRow(world.jobId);
      // After the check, before the write: someone else saves the worksheet.
      // The status stays IN_PROGRESS, so only the updatedAt moves.
      changeJobBeforeNextTransaction(world.jobId, {
        data: { foreign: "write" },
        updatedAt: new Date(NEWER),
      });

      const body = await push(world, [
        executionEvent(world, "evt-sp5-toctou", operation, {
          baseUpdatedAt: BASE,
        }),
      ]);

      expect(body.accepted).toEqual([]);
      expect(body.rejected).toEqual([]);
      expect(body.conflicts).toEqual([
        expect.objectContaining({
          eventId: "evt-sp5-toctou",
          conflictType: "concurrent_update",
          status: "open",
          remotePayload: expect.objectContaining({
            entity: "calibration_job",
            id: world.jobId,
            updatedAt: NEWER,
            baseUpdatedAt: BASE,
            status: "IN_PROGRESS",
            data: { foreign: "write" },
          }),
        }),
      ]);
      const after = await jobRow(world.jobId);
      expect(after.data).toEqual({ foreign: "write" });
      expect(after.status).toBe("IN_PROGRESS");
      expect({ ...after, data: undefined, updatedAt: undefined }).toEqual({
        ...before,
        data: undefined,
        updatedAt: undefined,
      });
      expect(await auditActions(world.jobId)).toEqual([]);
      expect(await claimsFor("evt-sp5-toctou")).toEqual([]);
      expect(await eventLogFor("evt-sp5-toctou")).toEqual([]);
    },
  );

  it("REQ-SP-5: a foreign write that changes the status in the same window is still the status_transition conflict, as before", async () => {
    const world = await seedWorld();
    await setJobUpdatedAt(world.jobId, BASE);
    changeJobBeforeNextTransaction(world.jobId, { status: "CANCELED" });

    const body = await push(world, [
      executionEvent(world, "evt-sp5-status-race", "save_local_execution", {
        baseUpdatedAt: BASE,
      }),
    ]);

    expect(body.accepted).toEqual([]);
    expect(body.conflicts).toEqual([
      expect.objectContaining({ conflictType: "status_transition" }),
    ]);
  });

  it("REQ-SP-5: the conflict shows the cloud's current execution so the desktop can compare", async () => {
    const world = await seedWorld();
    await db
      .update(calibrationJob)
      .set({ updatedAt: new Date(NEWER), data: { indication: "99" } })
      .where(eq(calibrationJob.id, world.jobId));

    const body = await push(world, [
      executionEvent(world, "evt-sp5-fields", "save_local_execution", {
        baseUpdatedAt: BASE,
      }),
    ]);

    expect(body.conflicts[0]?.remotePayload).toMatchObject({
      status: "IN_PROGRESS",
      data: { indication: "99" },
    });
  });

  it("REQ-SP-5: a base equal to the cloud job's updatedAt is current: applied", async () => {
    const world = await seedWorld();
    await setJobUpdatedAt(world.jobId, BASE);

    const body = await push(world, [
      executionEvent(world, "evt-sp5-fresh", "save_local_execution", {
        baseUpdatedAt: BASE,
      }),
    ]);

    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect((await jobRow(world.jobId)).data).toMatchObject({
      marcador: "evt-sp5-fresh",
    });
  });

  it("REQ-SP-5: no base (a build before the base was carried, or a job never pulled) cannot be checked and applies as before", async () => {
    const world = await seedWorld();
    await setJobUpdatedAt(world.jobId, NEWER);

    const absent = await push(world, [
      executionEvent(world, "evt-sp5-absent", "save_local_execution", {}),
    ]);
    const nulled = await push(world, [
      executionEvent(world, "evt-sp5-null", "save_local_execution", {
        baseUpdatedAt: null,
      }),
    ]);

    expect(absent.conflicts).toEqual([]);
    expect(absent.accepted).toHaveLength(1);
    expect(nulled.conflicts).toEqual([]);
    expect(nulled.accepted).toHaveLength(1);
  });

  it("REQ-SP-5 [HIGH RISK]: the desktop's own earlier writes do not make its later events stale: a save then a submit pushed together, both against the pulled base, both apply", async () => {
    const world = await seedWorld();
    await setJobUpdatedAt(world.jobId, BASE);

    const body = await push(world, [
      executionEvent(world, "evt-sp5-own-save", "save_local_execution", {
        baseUpdatedAt: BASE,
      }),
      executionEvent(world, "evt-sp5-own-submit", "submit_local_execution", {
        baseUpdatedAt: BASE,
      }),
    ]);

    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([]);
    expect(body.accepted.map((entry) => entry.eventId)).toEqual([
      "evt-sp5-own-save",
      "evt-sp5-own-submit",
    ]);
    expect((await jobRow(world.jobId)).status).toBe("REVIEW");
    expect(await auditActions(world.jobId)).toEqual(["execute", "submit"]);
  });

  it("REQ-SP-5: an accepted execution reports the job's new updatedAt, the base of the desktop's next edit", async () => {
    const world = await seedWorld();
    await setJobUpdatedAt(world.jobId, BASE);

    const body = await push(world, [
      executionEvent(world, "evt-sp5-anchor", "save_local_execution", {
        baseUpdatedAt: BASE,
      }),
    ]);

    const [row] = await db
      .select({ updatedAt: calibrationJob.updatedAt })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, world.jobId));
    expect(body.accepted[0]?.remoteEntity).toMatchObject({
      id: world.jobId,
      status: "IN_PROGRESS",
      updatedAt: row?.updatedAt.toISOString(),
    });
  });

  it("REQ-SP-5: a someone-else write between the desktop's two pushes is caught: the second batch built on the first's updatedAt conflicts once the cloud moved on", async () => {
    const world = await seedWorld();
    await setJobUpdatedAt(world.jobId, BASE);
    const first = await push(world, [
      executionEvent(world, "evt-sp5-first", "save_local_execution", {
        baseUpdatedAt: BASE,
      }),
    ]);
    const accepted = first.accepted[0]?.remoteEntity;
    const anchor =
      accepted && typeof accepted === "object" && "updatedAt" in accepted
        ? String(accepted.updatedAt)
        : null;
    expect(anchor).not.toBeNull();
    // Someone else saves the job after the desktop's accepted write.
    await setJobUpdatedAt(
      world.jobId,
      new Date(Date.parse(anchor ?? BASE) + 60 * 60 * 1000).toISOString(),
    );

    const second = await push(world, [
      executionEvent(world, "evt-sp5-second", "save_local_execution", {
        baseUpdatedAt: anchor,
      }),
    ]);

    expect(second.accepted).toEqual([]);
    expect(second.conflicts).toHaveLength(1);
  });
});

describe("REQ-SP-6: the minimum desktop version", () => {
  it("REQ-SP-6: with no minimum configured every desktop is accepted, versioned or not", async () => {
    const world = await seedWorld();

    const unversioned = await push(world, [
      createAssetEvent(world, "evt-sp6-none-1", "SP6-NONE-1"),
    ]);
    const old = await push(
      world,
      [createAssetEvent(world, "evt-sp6-none-2", "SP6-NONE-2")],
      { protocolVersion: 2, desktopVersion: "0.0.1" },
    );

    expect(unversioned.accepted).toHaveLength(1);
    expect(old.accepted).toHaveLength(1);
  });

  it("REQ-SP-6 [HIGH RISK]: with a minimum set, an older desktop is answered 426 with a typed update-required body; nothing is applied or claimed", async () => {
    vi.stubEnv("SYNC_MIN_DESKTOP_VERSION", "1.4.0");
    const world = await seedWorld();
    const before = await jobRow(world.jobId);

    const res = await rawPush(
      world,
      [
        createAssetEvent(world, "evt-sp6-old-asset", "SP6-OLD"),
        executionEvent(world, "evt-sp6-old-job", "submit_local_execution", {}),
      ],
      { protocolVersion: 2, desktopVersion: "1.3.9" },
    );

    expect(res.status).toBe(426);
    const body = syncUpdateRequiredResponseSchema.parse(await res.json());
    expect(body).toMatchObject({
      code: "DESKTOP_UPDATE_REQUIRED",
      minimumVersion: "1.4.0",
      desktopVersion: "1.3.9",
    });
    expect(body.message).toContain("1.4.0");
    expect(await assetsByTag("SP6-OLD")).toEqual([]);
    expect(await claimsFor("evt-sp6-old-asset")).toEqual([]);
    expect(await claimsFor("evt-sp6-old-job")).toEqual([]);
    expect(await jobRow(world.jobId)).toEqual(before);
  });

  it("REQ-SP-6: a desktop that states no version (a build before versioning) is older than any minimum", async () => {
    vi.stubEnv("SYNC_MIN_DESKTOP_VERSION", "1.4.0");
    const world = await seedWorld();

    const res = await rawPush(world, [
      createAssetEvent(world, "evt-sp6-unversioned", "SP6-UNV"),
    ]);

    expect(res.status).toBe(426);
    const body = syncUpdateRequiredResponseSchema.parse(await res.json());
    expect(body.desktopVersion).toBeNull();
    expect(await assetsByTag("SP6-UNV")).toEqual([]);
  });

  it("REQ-SP-6: a desktop at or above the minimum pushes normally", async () => {
    vi.stubEnv("SYNC_MIN_DESKTOP_VERSION", "1.4.0");
    const world = await seedWorld();

    const atMinimum = await push(
      world,
      [createAssetEvent(world, "evt-sp6-at", "SP6-AT")],
      { protocolVersion: 2, desktopVersion: "1.4.0" },
    );
    const above = await push(
      world,
      [createAssetEvent(world, "evt-sp6-above", "SP6-ABOVE")],
      { protocolVersion: 2, desktopVersion: "2.0.0" },
    );

    expect(atMinimum.accepted).toHaveLength(1);
    expect(above.accepted).toHaveLength(1);
  });

  it("REQ-SP-6 [HIGH RISK]: with a minimum set, an unstamped (legacy) submit from a desktop at the minimum is held to the calibration record rule: refused, job untouched", async () => {
    vi.stubEnv("SYNC_MIN_DESKTOP_VERSION", "1.4.0");
    const world = await seedWorld();

    const body = await push(
      world,
      [
        executionEvent(world, "evt-sp6-legacy", "submit_local_execution", {
          // What a build before the stamp wrote: no stamp, location null.
          payload: {
            executionPayloadVersion: undefined,
            calibrationLocationSnapshot: null,
          },
        }),
      ],
      { protocolVersion: 2, desktopVersion: "1.4.0" },
    );

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({ code: "CALIBRATION_RECORD_INCOMPLETE" }),
    ]);
    expect((await jobRow(world.jobId)).status).toBe("IN_PROGRESS");
  });

  it("REQ-SP-6: with no minimum the same unstamped submit is still applied under the exemption, and its audit row says so", async () => {
    const world = await seedWorld();

    const body = await push(world, [
      executionEvent(world, "evt-sp6-exempt", "submit_local_execution", {
        payload: {
          executionPayloadVersion: undefined,
          calibrationLocationSnapshot: null,
        },
      }),
    ]);

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    const [row] = await db
      .select({ changes: jobAuditLog.changes })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.jobId, world.jobId));
    expect(row?.changes?.calibrationRecordCheck).toBe("legacy_exempt");
  });

  it("REQ-SP-6: a stamped submit with its record is applied whatever the minimum", async () => {
    vi.stubEnv("SYNC_MIN_DESKTOP_VERSION", "1.4.0");
    const world = await seedWorld();

    const body = await push(
      world,
      [executionEvent(world, "evt-sp6-stamped", "submit_local_execution", {})],
      { protocolVersion: 2, desktopVersion: "1.4.0" },
    );

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect((await jobRow(world.jobId)).status).toBe("REVIEW");
  });
});
