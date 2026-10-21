/**
 * sync-status-cas.int.spec.ts — real-Postgres proof that the desktop sync apply
 * of an offline execution (save_local_execution / submit_local_execution) writes
 * calibration_job as a compare-and-set that carries the caller's organization
 * and commits together with its audit row.
 *
 *   REQ-CAS-1  the UPDATE matches on the validated status AND organization_id;
 *              zero rows → the same precise outcome the pre-check gives
 *              (the status_transition conflict for INVALID_STATUS_TRANSITION,
 *              or a REMOTE_ENTITY_NOT_FOUND rejection once the job left the
 *              organization),
 *              never a silent success
 *   REQ-CAS-2  the UPDATE and its job_audit_log insert share one transaction
 *   REQ-CAS-4  the happy path is unchanged
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { asset, calibrationJob } from "@calibra-facil/db/schema";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import {
  auditActions,
  changeJobBeforeNextTransaction,
  failJobAuditInserts,
  jobRow,
  withoutVolatile,
} from "../../test/integration/job-cas";
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

async function seedWorld() {
  const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
  const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });
  const { jobId, assetId } = await seedJobForOrg({
    orgId: orgA.orgId,
    unitId: orgA.unitId,
    createdBy: orgA.userId,
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
      // The desktop apply needs the frozen asset snapshot a started job carries.
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
  return { orgA, orgB, jobId };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

type PushBody = {
  accepted: Array<{ eventId: string }>;
  rejected: Array<{ eventId: string; code: string; reason: string }>;
  conflicts: Array<{ conflictType: string; remotePayload?: unknown }>;
};

async function push(
  actor: { userId: string; orgId: string; unitId: number },
  jobId: number,
  operation: "save_local_execution" | "submit_local_execution",
  eventId: string,
) {
  loginAs({ userId: actor.userId, organizationId: actor.orgId });
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(actor.unitId) },
    body: JSON.stringify({
      deviceId: "device-cas-1",
      clientBatchId: `batch-${eventId}`,
      baseCursor: null,
      events: [
        {
          eventId,
          entityType: "calibration_job",
          entityId: "local-job-cas",
          operation,
          payload: {
            remoteId: jobId,
            status:
              operation === "submit_local_execution" ? "REVIEW" : "IN_PROGRESS",
            data: { indication: "10", reference: "9", marcador: eventId },
            calibrationLocationSnapshot: {
              type: "lab",
              addressText: "Laboratório",
            },
          },
          occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          actorUserId: actor.userId,
          organizationId: actor.orgId,
          unitId: actor.unitId,
          idempotencyKey: `idem-${eventId}`,
          localVersion: 0,
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
  const body: PushBody = await res.json();
  return body;
}

describe("syncRouter — desktop execution apply is a compare-and-set, org-scoped, audited in-transaction", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const OPERATIONS = [
    { operation: "save_local_execution", to: "IN_PROGRESS", action: "execute" },
    { operation: "submit_local_execution", to: "REVIEW", action: "submit" },
  ] as const;

  describe.each(OPERATIONS)("$operation", ({ operation, to, action }) => {
    function pushAs(world: World, eventId: string) {
      return push(world.orgA, world.jobId, operation, eventId);
    }

    it(`REQ-CAS-4: control — with no interleaved change the event is accepted (${to}) with exactly one ${action} audit row`, async () => {
      const world = await seedWorld();

      const body = await pushAs(world, "evt-cas-ok");

      expect(body.rejected).toEqual([]);
      expect(body.accepted.map((event) => event.eventId)).toEqual([
        "evt-cas-ok",
      ]);
      expect((await jobRow(world.jobId)).status).toBe(to);
      expect(await auditActions(world.jobId)).toEqual([action]);
    });

    it("REQ-CAS-1 [HIGH RISK]: a job cancelled between the read and the write → reported as a status_transition conflict (INVALID_STATUS_TRANSITION), not accepted; the job stays CANCELED; nothing else written; no audit row", async () => {
      const world = await seedWorld();
      const before = await jobRow(world.jobId);
      changeJobBeforeNextTransaction(world.jobId, { status: "CANCELED" });

      const body = await pushAs(world, "evt-cas-race");

      // A conflicting event is neither accepted nor rejected: it is reported
      // as an open status_transition conflict (the same shape the pre-check
      // gives), so the desktop keeps it and shows it.
      expect(body.accepted).toEqual([]);
      expect(body.rejected).toEqual([]);
      expect(body.conflicts).toEqual([
        expect.objectContaining({
          conflictType: "status_transition",
          remotePayload: expect.objectContaining({
            id: world.jobId,
            status: "CANCELED",
          }),
        }),
      ]);
      const after = await jobRow(world.jobId);
      expect(after.status).toBe("CANCELED");
      expect(withoutVolatile(after)).toEqual(withoutVolatile(before));
      expect(await auditActions(world.jobId)).toEqual([]);
    });

    it("REQ-CAS-1 [HIGH RISK]: the write is also scoped by organization — a job that left the caller's organization between the read and the write is not touched → rejected REMOTE_ENTITY_NOT_FOUND; no audit row", async () => {
      const world = await seedWorld();
      const before = await jobRow(world.jobId);
      changeJobBeforeNextTransaction(world.jobId, {
        organizationId: world.orgB.orgId,
      });

      const body = await pushAs(world, "evt-cas-org-race");

      expect(body.accepted).toEqual([]);
      expect(body.rejected).toEqual([
        expect.objectContaining({
          eventId: "evt-cas-org-race",
          code: "REMOTE_ENTITY_NOT_FOUND",
        }),
      ]);
      const after = await jobRow(world.jobId);
      expect(withoutVolatile(after)).toEqual({
        ...withoutVolatile(before),
        organizationId: world.orgB.orgId,
      });
      expect(after.status).toBe("IN_PROGRESS");
      expect(await auditActions(world.jobId)).toEqual([]);
    });

    it("REQ-CAS-1 [HIGH RISK]: another organization's event naming this job id → rejected REMOTE_ENTITY_NOT_FOUND; nothing changes; no audit row", async () => {
      const world = await seedWorld();
      const before = await jobRow(world.jobId);

      const body = await push(
        world.orgB,
        world.jobId,
        operation,
        "evt-cas-xorg",
      );

      expect(body.accepted).toEqual([]);
      expect(body.rejected).toEqual([
        expect.objectContaining({ code: "REMOTE_ENTITY_NOT_FOUND" }),
      ]);
      expect(await jobRow(world.jobId)).toEqual(before);
      expect(await auditActions(world.jobId)).toEqual([]);
    });

    it("REQ-CAS-2 [HIGH RISK]: when the audit insert fails the status/data write rolls back with it", async () => {
      const world = await seedWorld();
      const before = await jobRow(world.jobId);
      const restore = await failJobAuditInserts();
      let body: PushBody;
      try {
        body = await pushAs(world, "evt-cas-audit-fail");
      } finally {
        await restore();
      }

      expect(body.accepted).toEqual([]);
      expect(body.rejected).toEqual([
        expect.objectContaining({ code: "DESKTOP_SYNC_APPLY_FAILED" }),
      ]);
      expect(await jobRow(world.jobId)).toEqual(before);
      expect(await auditActions(world.jobId)).toEqual([]);
    });
  });
});
