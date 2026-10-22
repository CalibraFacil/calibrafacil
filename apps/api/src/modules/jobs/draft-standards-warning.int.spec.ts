/**
 * draft-standards-warning.int.spec.ts: a standard that went stale mid-job must
 * not make every autosave fail and lose the readings (roadmap P1-11).
 *
 * A draft save (`POST /jobs/:id/execute`, `POST /v2/jobs/:id/results`, the
 * desktop's `save_local_execution`) runs the one standards judgement. The save
 * accepts a standard that is ALREADY in the job's saved snapshot even when it
 * has since become inactive, deleted or expired, and answers a structured
 * warning; a standard the save ADDS is still refused; the submit stays the
 * hard gate. Every rule runs against a real Postgres and the real RBAC /
 * API-key / sync middleware, on each entry point it applies to.
 *
 *   REQ-P111-1  adding (or swapping in) an invalid standard is refused
 *   REQ-P111-2  re-sending an already-saved standard that went stale is accepted, with a warning
 *   REQ-P111-3  the submit still refuses any invalid standard
 *   REQ-P111-5  the public API answers the same `warnings`
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  jobAuditLog,
  referenceStandard,
  type JobStatus,
} from "@calibra-facil/db/schema";
import {
  addCalendarDays,
  calendarDateKey,
  labToday,
} from "@calibra-facil/shared";
import { loginAs } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { seedApiKey, seedOrg } from "../../../test/integration/seed";
import { seedJobForOrg } from "../../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../../test/integration/executable-method";
import { jobRow } from "../../../test/integration/job-cas";
import { jobsRouter } from "../../routes/jobs";
import { publicApiV2Router } from "../../routes/public-api-v2";
import { syncRouter } from "../../routes/sync";

vi.mock("../../lib/background-jobs", () => ({
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
const ORG = "org-p111";
const TECHNICIAN = "user-p111-tech";
const LOCATION = { type: "lab", addressText: "Laboratório" } as const;
const FIRST_READING = { indication: "10", reference: "9" };
const SECOND_READING = { indication: "11", reference: "9" };

async function seedWorld(status: JobStatus = "IN_PROGRESS") {
  const org = await seedOrg({ orgId: ORG, userId: TECHNICIAN, role: "admin" });
  const { jobId, assetId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: TECHNICIAN,
  });
  await db
    .update(calibrationJob)
    .set({
      status,
      methodSnapshot: executableMethodSnapshot(),
      technicianId: TECHNICIAN,
    })
    .where(eq(calibrationJob.id, jobId));
  const { rawKey } = await seedApiKey({
    organizationId: ORG,
    createdBy: TECHNICIAN,
    scopes: ["jobs:write"],
  });
  const [row] = await db
    .select({ assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(eq(asset.id, assetId));
  return { org, jobId, assetTypeId: row?.assetTypeId ?? 0, rawKey };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

let standardSequence = 0;
async function addStandard(
  world: World,
  options: { name?: string; validThrough?: Date; status?: string } = {},
) {
  standardSequence += 1;
  const [standard] = await db
    .insert(referenceStandard)
    .values({
      organizationId: ORG,
      unitId: world.org.unitId,
      createdBy: TECHNICIAN,
      name: options.name ?? `Massa Padrao ${standardSequence}`,
      kind: "generic_scalar",
      serialNumber: `SN-STD-P111-${standardSequence}`,
      certificateNumber: `CERT-P111-${standardSequence}`,
      calibrationDate: new Date("2025-01-10T15:00:00.000Z"),
      nextCalibrationDate:
        options.validThrough ?? addCalendarDays(labToday(), 90),
      coverageFactor: 2,
      distribution: "normal",
      status: options.status ?? "ACTIVE",
      referenceValue: 1,
      uncertainty: 0.01,
    })
    .returning({
      id: referenceStandard.id,
      name: referenceStandard.name,
    });
  if (!standard) throw new Error("addStandard failed");
  return standard;
}

type Standard = Awaited<ReturnType<typeof addStandard>>;

/** The ways a standard that was valid when picked stops being valid. */
const STALE = {
  inactive: {
    reason: "standard_inactive",
    apply: (standard: Standard) =>
      db
        .update(referenceStandard)
        .set({ status: "INACTIVE" })
        .where(eq(referenceStandard.id, standard.id)),
  },
  deleted: {
    reason: "standard_deleted",
    apply: (standard: Standard) =>
      db
        .update(referenceStandard)
        .set({ deletedAt: new Date() })
        .where(eq(referenceStandard.id, standard.id)),
  },
  expired: {
    reason: "standard_expired",
    apply: (standard: Standard) =>
      db
        .update(referenceStandard)
        .set({ nextCalibrationDate: addCalendarDays(labToday(), -3) })
        .where(eq(referenceStandard.id, standard.id)),
  },
} as const;

type Outcome = {
  status: number;
  /** The refusal's stable code, when there is one. */
  code?: string;
  /** The `warnings` of an accepted save. */
  warnings?: unknown;
};

type EntryPoint = {
  name: "cloud route" | "public API";
  save(world: World, call: SaveCall): Promise<Outcome>;
  submit(world: World, standardIds?: number[]): Promise<Outcome>;
};

type SaveCall = { standardIds?: number[]; data?: Record<string, unknown> };

let sequence = 0;
function nextKey() {
  sequence += 1;
  return `p111-${sequence}`;
}

const cloud: EntryPoint = {
  name: "cloud route",
  async save(world, call) {
    loginAs({ userId: TECHNICIAN, organizationId: ORG });
    const res = await jobsRouter.request(`/${world.jobId}/execute`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        data: call.data ?? FIRST_READING,
        selectedStandardIds: call.standardIds,
      }),
    });
    const body: { code?: string; warnings?: unknown } = await res.json();
    return { status: res.status, code: body.code, warnings: body.warnings };
  },
  async submit(world, standardIds) {
    loginAs({ userId: TECHNICIAN, organizationId: ORG });
    const res = await jobsRouter.request(`/${world.jobId}/submit`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        data: FIRST_READING,
        selectedStandardIds: standardIds,
        calibrationLocation: LOCATION,
      }),
    });
    const body: { code?: string } = await res.json();
    return { status: res.status, code: body.code };
  },
};

const publicApi: EntryPoint = {
  name: "public API",
  async save(world, call) {
    const res = await publicApiV2Router.request(
      `/jobs/${world.jobId}/results`,
      {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "x-api-key": world.rawKey,
          "idempotency-key": nextKey(),
        },
        body: JSON.stringify({
          data: call.data ?? FIRST_READING,
          selectedStandardIds: call.standardIds,
        }),
      },
    );
    const body: { error?: { code?: string }; warnings?: unknown } =
      await res.json();
    return {
      status: res.status,
      code: body.error?.code,
      warnings: body.warnings,
    };
  },
  async submit(world, standardIds) {
    const res = await publicApiV2Router.request(`/jobs/${world.jobId}/submit`, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "x-api-key": world.rawKey,
        "idempotency-key": nextKey(),
      },
      body: JSON.stringify({
        data: FIRST_READING,
        selectedStandardIds: standardIds,
        calibrationLocation: LOCATION,
      }),
    });
    const body: { error?: { code?: string } } = await res.json();
    return { status: res.status, code: body.error?.code };
  },
};

function warningFor(
  reason: string,
  standards: Array<Pick<Standard, "id" | "name">>,
) {
  return {
    code: "standard_no_longer_valid",
    reason,
    standardIds: standards.map((standard) => standard.id),
    standardNames: standards.map((standard) => standard.name),
  };
}

async function auditCount(jobId: number) {
  const rows = await db
    .select({ id: jobAuditLog.id })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, jobId));
  return rows.length;
}

describe.each([cloud, publicApi])(
  "a draft save with a standard that went stale [$name]",
  (entry) => {
    beforeEach(async () => {
      await truncateAll();
    });

    it.each(Object.entries(STALE))(
      "REQ-P111-2 [HIGH RISK]: a standard already in the saved snapshot that became %s is accepted with a warning; the readings are saved and the snapshot entry is kept",
      async (_name, stale) => {
        const world = await seedWorld();
        const standard = await addStandard(world);
        expect(
          await entry.save(world, { standardIds: [standard.id] }),
        ).toMatchObject({ status: 200 });
        const saved = await jobRow(world.jobId);
        await stale.apply(standard);

        const outcome = await entry.save(world, {
          standardIds: [standard.id],
          data: SECOND_READING,
        });

        expect(outcome.status).toBe(200);
        expect(outcome.warnings).toEqual([
          warningFor(stale.reason, [standard]),
        ]);
        const after = await jobRow(world.jobId);
        expect(after.data).toMatchObject({ indication: "11" });
        // The entry the technician picked is kept as frozen, not re-read from
        // the record that is no longer valid.
        expect(after.standardsSnapshot).toEqual(saved.standardsSnapshot);
        expect(after.status).toBe("IN_PROGRESS");
      },
    );

    it("REQ-P111-2: a save that names no standards leaves the saved snapshot alone and still succeeds", async () => {
      const world = await seedWorld();
      const standard = await addStandard(world);
      await entry.save(world, { standardIds: [standard.id] });
      await STALE.expired.apply(standard);

      const outcome = await entry.save(world, { data: SECOND_READING });

      expect(outcome.status).toBe(200);
      expect(outcome.warnings).toEqual([]);
      expect((await jobRow(world.jobId)).data).toMatchObject({
        indication: "11",
      });
    });

    it("REQ-P111-2: valid standards give an empty warning list", async () => {
      const world = await seedWorld();
      const standard = await addStandard(world);

      const outcome = await entry.save(world, { standardIds: [standard.id] });

      expect(outcome.status).toBe(200);
      expect(outcome.warnings).toEqual([]);
    });

    it("REQ-P111-2: each stale standard is reported with its reason", async () => {
      const world = await seedWorld();
      const first = await addStandard(world, { name: "Massa A" });
      const second = await addStandard(world, { name: "Massa B" });
      await entry.save(world, { standardIds: [first.id, second.id] });
      await STALE.inactive.apply(first);
      await STALE.expired.apply(second);

      const outcome = await entry.save(world, {
        standardIds: [first.id, second.id],
        data: SECOND_READING,
      });

      expect(outcome.status).toBe(200);
      expect(outcome.warnings).toEqual([
        warningFor("standard_inactive", [first]),
        warningFor("standard_expired", [second]),
      ]);
    });

    it.each(Object.entries(STALE))(
      "REQ-P111-1 [HIGH RISK]: a save that ADDS a standard that is %s is still refused with the existing code, even while a saved one is stale; nothing is written",
      async (_name, stale) => {
        const world = await seedWorld();
        const kept = await addStandard(world);
        await entry.save(world, { standardIds: [kept.id] });
        await STALE.expired.apply(kept);
        // The stale standard alone is accepted (REQ-P111-2) ...
        expect(
          await entry.save(world, { standardIds: [kept.id] }),
        ).toMatchObject({ status: 200 });
        const before = await jobRow(world.jobId);
        const auditBefore = await auditCount(world.jobId);
        // ... but a standard the save adds must be valid.
        const added = await addStandard(world);
        await stale.apply(added);

        const outcome = await entry.save(world, {
          standardIds: [kept.id, added.id],
          data: SECOND_READING,
        });

        expect(outcome.code).toBe(stale.reason);
        expect(outcome.status).toBeGreaterThanOrEqual(400);
        expect(await jobRow(world.jobId)).toEqual(before);
        expect(await auditCount(world.jobId)).toBe(auditBefore);
      },
    );

    it("REQ-P111-1 [HIGH RISK]: swapping the saved standard for an invalid one is refused", async () => {
      const world = await seedWorld();
      const saved = await addStandard(world);
      await entry.save(world, { standardIds: [saved.id] });
      await STALE.inactive.apply(saved);
      expect(
        await entry.save(world, { standardIds: [saved.id] }),
      ).toMatchObject({ status: 200 });
      const replacement = await addStandard(world, {
        validThrough: addCalendarDays(labToday(), -1),
      });

      const outcome = await entry.save(world, {
        standardIds: [replacement.id],
      });

      expect(outcome.code).toBe("standard_expired");
    });

    it("REQ-P111-1: swapping the stale standard for a valid one is accepted and clears the warning", async () => {
      const world = await seedWorld();
      const saved = await addStandard(world);
      await entry.save(world, { standardIds: [saved.id] });
      await STALE.expired.apply(saved);
      const replacement = await addStandard(world);

      const outcome = await entry.save(world, {
        standardIds: [replacement.id],
      });

      expect(outcome.status).toBe(200);
      expect(outcome.warnings).toEqual([]);
      expect(
        (await jobRow(world.jobId)).standardsSnapshot?.map((s) => s.id),
      ).toEqual([replacement.id]);
    });

    it.each(Object.entries(STALE))(
      "REQ-P111-3 [HIGH RISK]: the submit still refuses a saved standard that became %s, with or without naming it again; the job is unchanged",
      async (_name, stale) => {
        const world = await seedWorld();
        const standard = await addStandard(world);
        await entry.save(world, { standardIds: [standard.id] });
        await stale.apply(standard);
        // The draft keeps saving ...
        expect(
          await entry.save(world, {
            standardIds: [standard.id],
            data: SECOND_READING,
          }),
        ).toMatchObject({ status: 200 });
        const before = await jobRow(world.jobId);
        const auditBefore = await auditCount(world.jobId);

        // ... the submit does not.
        for (const named of [undefined, [standard.id]]) {
          const outcome = await entry.submit(world, named);
          expect(outcome.code).toBe(stale.reason);
          expect(outcome.status).toBeGreaterThanOrEqual(400);
        }

        expect(await jobRow(world.jobId)).toEqual(before);
        expect(await auditCount(world.jobId)).toBe(auditBefore);
      },
    );
  },
);

describe("the warning is part of the saved job's audit trail (REQ-P111-2)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-P111-2: the audit row of a save with a stale standard names it", async () => {
    const world = await seedWorld();
    const standard = await addStandard(world);
    await cloud.save(world, { standardIds: [standard.id] });
    await STALE.inactive.apply(standard);
    await cloud.save(world, { standardIds: [standard.id] });

    const rows = await db
      .select({ changes: jobAuditLog.changes })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.jobId, world.jobId));
    expect(rows.map((row) => row.changes)).toContainEqual(
      expect.objectContaining({
        standardsWarnings: [warningFor("standard_inactive", [standard])],
      }),
    );
  });
});

// The desktop applies a draft through the same command: it must not refuse in
// the cloud what the desktop's own store accepted under the same rule.
describe("desktop sync apply of a draft save (REQ-P111-1, REQ-P111-2, REQ-P111-3)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  function frozenEntry(standard: Standard, validThrough: Date) {
    return {
      id: standard.id,
      name: standard.name,
      certificateNumber: `CERT-${standard.id}`,
      calibrationDate: "2025-01-10T00:00:00.000Z",
      nextCalibrationDate: `${calendarDateKey(validThrough)}T00:00:00.000Z`,
      uncertainty: 0.01,
      uncertaintyUnit: "g",
      coverageFactor: 2,
      distribution: "normal",
      drift: null,
      certifiedValues: null,
    };
  }

  async function push(
    world: World,
    operation: "save_local_execution" | "submit_local_execution",
    standards: Array<ReturnType<typeof frozenEntry>>,
  ) {
    const submit = operation === "submit_local_execution";
    const eventId = nextKey();
    loginAs({ userId: TECHNICIAN, organizationId: ORG });
    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(world.org.unitId),
      },
      body: JSON.stringify({
        deviceId: "device-p111",
        clientBatchId: `batch-${eventId}`,
        baseCursor: null,
        events: [
          {
            eventId,
            entityType: "calibration_job",
            entityId: "local-job-p111",
            operation,
            payload: {
              remoteId: world.jobId,
              status: submit ? "REVIEW" : "IN_PROGRESS",
              data: SECOND_READING,
              results: null,
              standardsSnapshot: standards,
              ...(submit ? { calibrationLocationSnapshot: LOCATION } : {}),
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
      rejected: Array<{ code: string }>;
    } = await res.json();
    return {
      accepted: body.accepted.length === 1,
      code: body.rejected[0]?.code,
    };
  }

  it("REQ-P111-2 [HIGH RISK]: a desktop draft that carries a standard of the cloud's saved snapshot that went stale is applied", async () => {
    const world = await seedWorld();
    const standard = await addStandard(world);
    const validThrough = addCalendarDays(labToday(), 90);
    await cloud.save(world, { standardIds: [standard.id] });
    await STALE.expired.apply(standard);

    const outcome = await push(world, "save_local_execution", [
      frozenEntry(standard, validThrough),
    ]);

    expect(outcome).toEqual({ accepted: true, code: undefined });
    expect((await jobRow(world.jobId)).data).toMatchObject({
      indication: "11",
    });
  });

  it("REQ-P111-1 [HIGH RISK]: a desktop draft that adds an expired standard is refused, even while it carries a stale one that is accepted; the job is unchanged", async () => {
    const world = await seedWorld();
    const kept = await addStandard(world);
    const validThrough = addCalendarDays(labToday(), 90);
    await cloud.save(world, { standardIds: [kept.id] });
    await STALE.expired.apply(kept);
    expect(
      await push(world, "save_local_execution", [
        frozenEntry(kept, validThrough),
      ]),
    ).toMatchObject({ accepted: true });
    const added = await addStandard(world);
    await STALE.expired.apply(added);
    const before = await jobRow(world.jobId);

    const outcome = await push(world, "save_local_execution", [
      frozenEntry(kept, validThrough),
      frozenEntry(added, validThrough),
    ]);

    expect(outcome).toEqual({ accepted: false, code: "STANDARD_EXPIRED" });
    expect(await jobRow(world.jobId)).toEqual(before);
  });

  it("REQ-P111-3 [HIGH RISK]: a desktop submit with a stale standard of the saved snapshot is still refused", async () => {
    const world = await seedWorld();
    const standard = await addStandard(world);
    await cloud.save(world, { standardIds: [standard.id] });
    await STALE.expired.apply(standard);
    expect(
      await push(world, "save_local_execution", [
        frozenEntry(standard, addCalendarDays(labToday(), 90)),
      ]),
    ).toMatchObject({ accepted: true });
    const before = await jobRow(world.jobId);

    const outcome = await push(world, "submit_local_execution", [
      frozenEntry(standard, addCalendarDays(labToday(), 90)),
    ]);

    expect(outcome).toEqual({ accepted: false, code: "STANDARD_EXPIRED" });
    expect(await jobRow(world.jobId)).toEqual(before);
  });
});
