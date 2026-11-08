import { CURRENT_DESKTOP_BUILD } from "../../../../test/integration/desktop-build";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { asset, calibrationJob } from "@calibra-facil/db/schema";
import { z } from "zod";
import { syncPushResponseSchema } from "@calibra-facil/contracts";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { seedJobForOrg } from "../../../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../../../test/integration/executable-method";
import { syncRouter } from "./";

// Real-DB integration tests of the `baseUpdatedAt` guard on the one desktop apply that
// still carries it, the job execution save/submit.
//
// The desktop emits `baseUpdatedAt` = the cloud job's `updatedAt` captured at PULL time.
// If the job's current `updatedAt` is STRICTLY after that base, the cloud advanced since
// the desktop pulled: the save is stale and MUST NOT overwrite it; the apply returns a
// reviewable `concurrent_update` conflict that carries the cloud job's diff fields.
//
//   REQ-REL-SYNC-201 [HIGH RISK] stale base: conflict returned (with the cloud's fields), job unchanged
//   REQ-REL-SYNC-202             equal/unchanged base: the save applies (no false conflict)
//   REQ-REL-SYNC-203             null/absent base (an older desktop): the save applies

vi.mock("../../../lib/background-jobs", () => ({
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

const BASE_AT = "2026-06-01T00:00:00.000Z";
// The cloud job advanced 1 day past the base the desktop saved against.
const SERVER_ADVANCED_AT = new Date("2026-06-02T00:00:00.000Z");

async function seedStartedJob(updatedAt: Date) {
  const org = await seedOrg({ orgId: "org-div", role: "admin" });
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
      data: { indication: "9.9", reference: "10", marcador: "nuvem" },
      updatedAt,
    })
    .where(eq(calibrationJob.id, jobId));
  return { org, jobId };
}

function saveEvent(
  org: { orgId: string; unitId: number; userId: string },
  jobId: number,
  eventId: string,
  baseUpdatedAt?: string,
) {
  return {
    eventId,
    entityType: "calibration_job",
    entityId: `local-${eventId}`,
    operation: "save_local_execution",
    payload: {
      remoteId: jobId,
      status: "IN_PROGRESS",
      data: { indication: "10", reference: "9", marcador: "desktop" },
      calibrationLocationSnapshot: { type: "lab", addressText: "Laboratório" },
    },
    occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    actorUserId: org.userId,
    organizationId: org.orgId,
    unitId: org.unitId,
    idempotencyKey: `idem-${eventId}`,
    localVersion: 0,
    ...(baseUpdatedAt === undefined ? {} : { baseUpdatedAt }),
  };
}

async function push(
  org: { orgId: string; unitId: number; userId: string },
  event: Record<string, unknown>,
) {
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
    body: JSON.stringify({
      deviceId: "device-div",
      clientBatchId: `batch-${Math.random().toString(36).slice(2)}`,
      baseCursor: null,
      ...CURRENT_DESKTOP_BUILD,
      events: [event],
    }),
  });
  expect(res.status).toBe(200);
  return syncPushResponseSchema.parse(await res.json());
}

async function jobRow(jobId: number) {
  const [row] = await db
    .select({ data: calibrationJob.data, updatedAt: calibrationJob.updatedAt })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  return row;
}

function markerOf(data: unknown) {
  return z.object({ marcador: z.string() }).parse(data).marcador;
}

describe("syncRouter /push: baseUpdatedAt divergence detection on job executions (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-REL-SYNC-201: a stale-base save returns a concurrent_update conflict with the cloud job's fields and leaves the job byte-unchanged", async () => {
    const { org, jobId } = await seedStartedJob(SERVER_ADVANCED_AT);
    const before = await jobRow(jobId);

    const body = await push(org, saveEvent(org, jobId, "evt-div-201", BASE_AT));

    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toHaveLength(0);
    expect(body.conflicts).toHaveLength(1);
    const conflict = body.conflicts[0];
    expect(conflict?.eventId).toBe("evt-div-201");
    expect(conflict?.entityType).toBe("calibration_job");
    expect(conflict?.conflictType).toBe("concurrent_update");
    expect(conflict?.status).toBe("open");
    const remote = z
      .object({
        entity: z.string(),
        id: z.number(),
        updatedAt: z.string(),
        baseUpdatedAt: z.string(),
        status: z.string(),
        data: z.object({ marcador: z.string() }),
      })
      .parse(conflict?.remotePayload);
    expect(remote.entity).toBe("calibration_job");
    expect(remote.id).toBe(jobId);
    expect(remote.updatedAt).toBe(SERVER_ADVANCED_AT.toISOString());
    expect(remote.baseUpdatedAt).toBe(BASE_AT);
    // The cloud's own values, so the conflicts screen shows them.
    expect(remote.status).toBe("IN_PROGRESS");
    expect(remote.data.marcador).toBe("nuvem");

    expect(await jobRow(jobId)).toEqual(before);
  });

  it("REQ-REL-SYNC-202: an equal-base save applies (no false conflict)", async () => {
    const { org, jobId } = await seedStartedJob(SERVER_ADVANCED_AT);

    const body = await push(
      org,
      saveEvent(org, jobId, "evt-div-202", SERVER_ADVANCED_AT.toISOString()),
    );

    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect(markerOf((await jobRow(jobId))?.data)).toBe("desktop");
  });

  it("REQ-REL-SYNC-203: an absent base (an older desktop) applies as before", async () => {
    const { org, jobId } = await seedStartedJob(SERVER_ADVANCED_AT);

    const body = await push(org, saveEvent(org, jobId, "evt-div-203"));

    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect(markerOf((await jobRow(jobId))?.data)).toBe("desktop");
  });
});
