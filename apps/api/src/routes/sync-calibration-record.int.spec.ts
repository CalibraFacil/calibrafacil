/**
 * sync-calibration-record.int.spec.ts: the desktop sync apply holds a submit to
 * the same calibration record rule as every other submit (REQ-P112-3).
 *
 * A job is submitted for review only with a calibration location and, for every
 * phase block not performed, a written reason. The desktop used to be exempt
 * because its offline store did not collect them. Builds that enforce the rule
 * offline stamp `executionPayloadVersion` on each event, so the cloud checks
 * those; an event with no stamp comes from a build that predates the rule and
 * is applied as before, so the outbox a user upgrades with is not dead-lettered.
 *
 * Real Postgres and the real sync middleware (only the better-auth session, the
 * queue and the notifications are faked).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobAuditLog,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { DESKTOP_EXECUTION_PAYLOAD_VERSION } from "@calibra-facil/schemas";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import { jobRow } from "../../test/integration/job-cas";
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

const ORG = "org-p112";
const TECHNICIAN = "user-p112-tech";
const DATA = { indication: "10", reference: "9" };
const RECORDED = {
  recordedAt: "2026-03-20T15:00:00.000Z",
  recordedBy: TECHNICIAN,
};
const LOCATION = {
  type: "customer_site",
  addressText: "Rua de Teste, 123",
  ...RECORDED,
};

let sequence = 0;

async function seedWorld() {
  const org = await seedOrg({ orgId: ORG, userId: TECHNICIAN, role: "admin" });
  const { jobId } = await seedJobForOrg({
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
  return { org, jobId };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

/**
 * What the submit's audit row says about the calibration record check: the
 * marker an auditor filters on to list jobs whose location was never validated.
 */
async function recordCheckOfSubmit(world: World) {
  const rows = await db
    .select({ action: jobAuditLog.action, changes: jobAuditLog.changes })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, world.jobId));
  const submit = rows.find((row) => row.action === "submit");
  if (!submit) throw new Error("no submit audit row");
  return submit.changes?.calibrationRecordCheck;
}

/** What the push answered for the one event it carried. */
async function pushSubmit(world: World, payload: Record<string, unknown>) {
  sequence += 1;
  const eventId = `evt-p112-${sequence}`;
  loginAs({ userId: TECHNICIAN, organizationId: ORG });
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-active-unit-id": String(world.org.unitId),
    },
    body: JSON.stringify({
      deviceId: "device-p112",
      clientBatchId: `batch-${eventId}`,
      baseCursor: null,
      events: [
        {
          eventId,
          entityType: "calibration_job",
          entityId: "local-job-p112",
          operation: "submit_local_execution",
          payload: {
            remoteId: world.jobId,
            status: "REVIEW" satisfies JobStatus,
            data: DATA,
            results: null,
            ...payload,
          },
          occurredAt: new Date().toISOString(),
          actorUserId: TECHNICIAN,
          organizationId: ORG,
          unitId: world.org.unitId,
          idempotencyKey: `idem-${eventId}`,
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

const STAMP = { executionPayloadVersion: DESKTOP_EXECUTION_PAYLOAD_VERSION };

describe("desktop sync submit: the calibration record rule (REQ-P112-3)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-P112-3 [HIGH RISK]: a submit from a build that enforces the rule, with no location key, is rejected; the job is untouched", async () => {
    const world = await seedWorld();
    const before = await jobRow(world.jobId);

    const body = await pushSubmit(world, { ...STAMP });

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        code: "CALIBRATION_RECORD_INCOMPLETE",
        reason: "Local da calibração é obrigatório",
      }),
    ]);
    const after = await jobRow(world.jobId);
    expect(after.status).toBe("IN_PROGRESS");
    expect({ ...after, updatedAt: undefined }).toEqual({
      ...before,
      updatedAt: undefined,
    });
  });

  it("REQ-P112-3 [HIGH RISK]: a stamped submit whose location is explicitly null or blank is rejected", async () => {
    const world = await seedWorld();

    const nullLocation = await pushSubmit(world, {
      ...STAMP,
      calibrationLocationSnapshot: null,
    });
    expect(nullLocation.rejected).toEqual([
      expect.objectContaining({
        code: "CALIBRATION_RECORD_INCOMPLETE",
        reason: "Local da calibração é obrigatório",
      }),
    ]);

    const blankLocation = await pushSubmit(world, {
      ...STAMP,
      calibrationLocationSnapshot: { ...LOCATION, addressText: "   " },
    });
    expect(blankLocation.rejected).toEqual([
      expect.objectContaining({
        code: "CALIBRATION_RECORD_INCOMPLETE",
        reason: "Endereço/local da calibração é obrigatório",
      }),
    ]);
    expect((await jobRow(world.jobId)).status).toBe("IN_PROGRESS");
  });

  it("REQ-P112-3 [HIGH RISK]: a stamped submit with a phase block not performed and no reason is rejected", async () => {
    const world = await seedWorld();

    const body = await pushSubmit(world, {
      ...STAMP,
      calibrationLocationSnapshot: LOCATION,
      calibrationPhaseSnapshot: {
        blocks: { ensaio_b: { mode: "not_performed" } },
        ...RECORDED,
      },
    });

    expect(body.rejected).toEqual([
      expect.objectContaining({
        code: "CALIBRATION_RECORD_INCOMPLETE",
        reason: "Informe o motivo para não executar o bloco ensaio_b",
      }),
    ]);
    expect((await jobRow(world.jobId)).status).toBe("IN_PROGRESS");
  });

  it("REQ-P112-3: control: a stamped submit with the location and a justified phase block is applied and freezes both", async () => {
    const world = await seedWorld();

    const body = await pushSubmit(world, {
      ...STAMP,
      calibrationLocationSnapshot: LOCATION,
      calibrationPhaseSnapshot: {
        blocks: {
          ensaio_b: { mode: "not_performed", reason: "Sem acesso ao ponto" },
        },
        ...RECORDED,
      },
    });

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    const after = await jobRow(world.jobId);
    expect(after.status).toBe("REVIEW");
    expect(after.calibrationLocationSnapshot).toMatchObject({
      type: "customer_site",
      addressText: "Rua de Teste, 123",
    });
    expect(after.calibrationPhaseSnapshot).toMatchObject({
      blocks: {
        ensaio_b: { mode: "not_performed", reason: "Sem acesso ao ponto" },
      },
    });
    expect(await recordCheckOfSubmit(world)).toBe("enforced");
  });

  it("REQ-P112-3: a stamped submit with no location key on a cloud job that already holds one is applied and keeps it", async () => {
    const world = await seedWorld();
    await db
      .update(calibrationJob)
      .set({ calibrationLocationSnapshot: LOCATION })
      .where(eq(calibrationJob.id, world.jobId));

    const body = await pushSubmit(world, { ...STAMP });

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    const after = await jobRow(world.jobId);
    expect(after.status).toBe("REVIEW");
    expect(after.calibrationLocationSnapshot).toEqual(LOCATION);
    expect(await recordCheckOfSubmit(world)).toBe("enforced");
  });

  it("REQ-P112-3 [HIGH RISK]: a legacy event (no payload version, no location key at all) is still applied, not dead-lettered", async () => {
    const world = await seedWorld();

    const body = await pushSubmit(world, {});

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect((await jobRow(world.jobId)).status).toBe("REVIEW");
    // Applied without the check, and the audit row says so.
    expect(await recordCheckOfSubmit(world)).toBe("legacy_exempt");
  });

  it("REQ-P112-3 [HIGH RISK]: a legacy event that carries an explicit null location is still applied too", async () => {
    // The builds before this one always wrote the key, null when the technician
    // had recorded nothing, so a null key is no sign of a build that enforced.
    const world = await seedWorld();

    const body = await pushSubmit(world, {
      calibrationLocationSnapshot: null,
      calibrationPhaseSnapshot: null,
    });

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect((await jobRow(world.jobId)).status).toBe("REVIEW");
    expect(await recordCheckOfSubmit(world)).toBe("legacy_exempt");
  });
});
