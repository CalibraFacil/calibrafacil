/**
 * approval-effects-reconciler.int.spec.ts - roadmap 2 B2 [HIGH RISK].
 *
 * ISO/IEC 17025 7.10. The approval transaction writes the asset out-of-tolerance
 * event and the asset calibration-date advance and stages the notification
 * jobs; this file proves the two things that stay outside it, against the real
 * database and with the application work running as `calibra_app` (bound by the
 * `tenant_isolation` policies; the seeding and the assertions keep the owner):
 *
 *   REQ-B2-NOTIFY-1  the post-approval notification handlers (the technician
 *                    notification, the customer out-of-tolerance alert) deliver,
 *                    are idempotent per event, retry after a failure and ignore
 *                    another laboratory's event.
 *   REQ-B2-RECON-1   the nightly reconciler repairs a seeded gap (the missing
 *                    event, the un-advanced asset dates, the alert that never
 *                    left), per laboratory, with audit rows marked as reconciled.
 *   REQ-B2-RECON-2   it is idempotent: a second run finds nothing.
 *   REQ-B2-RECON-3   it leaves a job approved moments ago alone and never
 *                    repairs beyond its look-back window (it counts the gap).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createRoleDatabase } from "@calibra-facil/db/role-connection";
import {
  appQueueJob,
  asset,
  assetAuditLog,
  assetOotAuditLog,
  assetOotEvent,
} from "@calibra-facil/db/schema";

const appRole = vi.hoisted(() => {
  const state: { current: { db: object } | null } = { current: null };
  return state;
});

// `db` resolves to a `calibra_app` session while `asApp` runs; the specs' own
// seeding and assertions (outside it) keep the owner connection, and so does
// `systemDb` (the system path of the reconciler's candidate listing).
vi.mock("@calibra-facil/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calibra-facil/db")>();
  const db = new Proxy(actual.db, {
    get(_target, property) {
      return Reflect.get(appRole.current?.db ?? actual.db, property);
    },
  });
  return { ...actual, db };
});

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  notifyJobApproved: vi.fn(),
  notifyAssetOot: vi.fn(),
}));

vi.mock("./background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueue,
}));

vi.mock("@calibra-facil/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/notifications")>()),
  notifyJobApproved: mocks.notifyJobApproved,
  notifyAssetFoundOutOfTolerance: mocks.notifyAssetOot,
}));

import { db } from "@calibra-facil/db";
import { processBackgroundJob, type Env } from "@calibra-facil/jobs-core";
import { truncateAll } from "../../test/integration/db";
import { assertHarnessWorkerDb } from "../../test/integration/guard";
import {
  seedBillingLab,
  type BillingLab,
} from "../../test/integration/billing-fixtures";
import { insertJobs } from "../../test/integration/job-fixtures";
import { seedAssetOotEvent } from "../../test/integration/oot-fixtures";
import { reconcileApprovalEffects } from "./approval-effects-reconciler";

async function asApp<T>(run: () => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  assertHarnessWorkerDb(url);
  const app = createRoleDatabase(url, { role: "calibra_app", max: 4 });
  appRole.current = app;
  try {
    return await run();
  } finally {
    appRole.current = null;
    await app.close();
  }
}

/** The handlers read nothing from the env for these two messages. */
const ENV: Env = {
  CERTIFICATES_BUCKET: { get: async () => null, put: async () => undefined },
  MEDIA_BUCKET: { get: async () => null, put: async () => undefined },
  DATABASE_URL: "unused",
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** An approved job of the laboratory's asset, approved `ageMs` ago. */
async function seedApproved(
  lab: BillingLab,
  number: string,
  options: { nonConforming: boolean; ageMs: number },
): Promise<number> {
  const approvedAt = new Date(Date.now() - options.ageMs);
  const [row] = await insertJobs({
    jobId: number,
    organizationId: lab.orgId,
    unitId: lab.unitId,
    customerId: lab.customerId,
    assetId: lab.assetId,
    serviceId: lab.serviceId,
    createdBy: lab.userId,
    status: "APPROVED",
    approvedBy: lab.userId,
    approvedAt,
    performedAt: approvedAt,
    asFoundConformity: options.nonConforming ? "NON_CONFORMING" : "CONFORMING",
    methodSnapshot: {
      methodId: 1,
      methodName: "Test",
      methodVersion: 1,
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
    },
    certificateName: number,
  });
  if (!row) throw new Error("seedApproved: insert failed");
  return row.id;
}

async function eventsOf(lab: BillingLab) {
  return db
    .select({
      id: assetOotEvent.id,
      jobId: assetOotEvent.jobId,
      labOrganizationId: assetOotEvent.labOrganizationId,
      status: assetOotEvent.status,
    })
    .from(assetOotEvent)
    .where(eq(assetOotEvent.labOrganizationId, lab.orgId));
}

async function ootAudits() {
  return db
    .select({
      eventId: assetOotAuditLog.eventId,
      action: assetOotAuditLog.action,
      changes: assetOotAuditLog.changes,
      performedBy: assetOotAuditLog.performedBy,
    })
    .from(assetOotAuditLog)
    .orderBy(assetOotAuditLog.id);
}

async function assetState(assetId: number) {
  const [row] = await db
    .select({ last: asset.lastCalibrationDate })
    .from(asset)
    .where(eq(asset.id, assetId));
  const audits = await db
    .select({ changes: assetAuditLog.changes })
    .from(assetAuditLog)
    .where(eq(assetAuditLog.assetId, assetId));
  return {
    last: row?.last ?? null,
    sources: audits.map((audit) =>
      typeof audit.changes === "object" && audit.changes !== null
        ? Reflect.get(audit.changes, "source")
        : undefined,
    ),
  };
}

function stagedTypes(messages: readonly unknown[]): unknown[] {
  return messages.map((message) =>
    typeof message === "object" && message !== null
      ? Reflect.get(message, "type")
      : undefined,
  );
}

describe("post-approval notification handlers (REQ-B2-NOTIFY-1)", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    mocks.notifyJobApproved.mockResolvedValue(undefined);
    mocks.notifyAssetOot.mockResolvedValue(undefined);
  });

  it("delivers the technician notification for the approved job", async () => {
    await asApp(() =>
      processBackgroundJob(ENV, {
        type: "JOB_APPROVED_NOTIFICATION",
        jobId: 41,
        userId: "approver-1",
      }),
    );

    expect(mocks.notifyJobApproved).toHaveBeenCalledExactlyOnceWith(
      41,
      "approver-1",
    );
  });

  it("alerts the customer once per event and records the notify audit entry; a redelivery sends nothing", async () => {
    const lab = await seedBillingLab("lab-a");
    const jobId = await seedApproved(lab, "CAL-A-1", {
      nonConforming: true,
      ageMs: HOUR,
    });
    const { eventId } = await seedAssetOotEvent({
      jobId,
      assetId: lab.assetId,
      customerId: lab.customerId,
      labOrganizationId: lab.orgId,
      detectedAt: new Date(),
      actorUserId: lab.userId,
    });
    const message = {
      type: "ASSET_OOT_NOTIFICATION" as const,
      eventId,
      organizationId: lab.orgId,
      userId: lab.userId,
    };

    await asApp(() => processBackgroundJob(ENV, message));
    await asApp(() => processBackgroundJob(ENV, message));

    expect(mocks.notifyAssetOot).toHaveBeenCalledExactlyOnceWith(jobId);
    expect((await ootAudits()).map((audit) => audit.action)).toEqual([
      "create",
      "notify",
    ]);
  });

  it("a failed delivery throws (the queue retries) and writes no notify entry; the retry delivers", async () => {
    const lab = await seedBillingLab("lab-a");
    const jobId = await seedApproved(lab, "CAL-A-1", {
      nonConforming: true,
      ageMs: HOUR,
    });
    const { eventId } = await seedAssetOotEvent({
      jobId,
      assetId: lab.assetId,
      customerId: lab.customerId,
      labOrganizationId: lab.orgId,
      detectedAt: new Date(),
      actorUserId: lab.userId,
    });
    const message = {
      type: "ASSET_OOT_NOTIFICATION" as const,
      eventId,
      organizationId: lab.orgId,
      userId: lab.userId,
    };
    mocks.notifyAssetOot.mockRejectedValueOnce(new Error("smtp down"));

    await expect(
      asApp(() => processBackgroundJob(ENV, message)),
    ).rejects.toThrow("smtp down");
    expect((await ootAudits()).map((audit) => audit.action)).toEqual([
      "create",
    ]);

    await asApp(() => processBackgroundJob(ENV, message));
    expect((await ootAudits()).map((audit) => audit.action)).toEqual([
      "create",
      "notify",
    ]);
  });

  it("a message naming another laboratory's event notifies nobody", async () => {
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    const jobId = await seedApproved(a, "CAL-A-1", {
      nonConforming: true,
      ageMs: HOUR,
    });
    const { eventId } = await seedAssetOotEvent({
      jobId,
      assetId: a.assetId,
      customerId: a.customerId,
      labOrganizationId: a.orgId,
      detectedAt: new Date(),
      actorUserId: a.userId,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await asApp(() =>
      processBackgroundJob(ENV, {
        type: "ASSET_OOT_NOTIFICATION",
        eventId,
        organizationId: b.orgId,
        userId: b.userId,
      }),
    );

    expect(mocks.notifyAssetOot).not.toHaveBeenCalled();
    expect((await ootAudits()).map((audit) => audit.action)).toEqual([
      "create",
    ]);
    warn.mockRestore();
  });
});

describe("approval effects reconciler (REQ-B2-RECON-1..3)", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    mocks.enqueue.mockResolvedValue({ messageId: "test-noop" });
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("REQ-B2-RECON-1: repairs a seeded gap: the event with a reconciled audit entry, the asset dates, the customer alert", async () => {
    const lab = await seedBillingLab("lab-a");
    const jobId = await seedApproved(lab, "CAL-A-1", {
      nonConforming: true,
      ageMs: 2 * HOUR,
    });

    const result = await asApp(() => reconcileApprovalEffects());

    expect(result).toEqual({
      ootEventsCreated: 1,
      assetDatesAdvanced: 1,
      notificationsRestaged: 0,
      failures: 0,
      ootGapsOlderThanWindow: 0,
    });
    const events = await eventsOf(lab);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      jobId,
      labOrganizationId: lab.orgId,
      status: "OPEN",
    });
    const audits = await ootAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      eventId: events[0]?.id,
      action: "create",
      performedBy: lab.userId,
      changes: { reconciled: true, source: "approval-effects-reconciler" },
    });
    const state = await assetState(lab.assetId);
    expect(state.last).not.toBeNull();
    expect(state.sources).toEqual(["job_approval_reconciliation"]);
    // In-process dispatch (local mode): the customer alert goes out after the commit.
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith({
      type: "ASSET_OOT_NOTIFICATION",
      eventId: events[0]?.id,
      organizationId: lab.orgId,
      userId: lab.userId,
    });
  });

  it("REQ-B2-RECON-1: with the database queue the alert is a queue row, staged in the repair's own transaction", async () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    vi.stubEnv("DOCUMENT_WORKER_URL", "");
    const lab = await seedBillingLab("lab-a");
    await seedApproved(lab, "CAL-A-1", {
      nonConforming: true,
      ageMs: 2 * HOUR,
    });

    await asApp(() => reconcileApprovalEffects());

    const rows = await db.select().from(appQueueJob);
    expect(rows.map((row) => row.type)).toEqual(["ASSET_OOT_NOTIFICATION"]);
    expect(rows[0]?.payload).toMatchObject({
      organizationId: lab.orgId,
      userId: lab.userId,
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("REQ-B2-RECON-1: repairs every laboratory in its own, as calibra_app", async () => {
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    await seedApproved(a, "CAL-A-1", { nonConforming: true, ageMs: 2 * HOUR });
    await seedApproved(b, "CAL-B-1", { nonConforming: true, ageMs: 2 * HOUR });

    const result = await asApp(() => reconcileApprovalEffects());

    expect(result.ootEventsCreated).toBe(2);
    expect(result.assetDatesAdvanced).toBe(2);
    expect((await eventsOf(a)).map((event) => event.labOrganizationId)).toEqual(
      [a.orgId],
    );
    expect((await eventsOf(b)).map((event) => event.labOrganizationId)).toEqual(
      [b.orgId],
    );
    const alerts = mocks.enqueue.mock.calls.map(([message]) =>
      Reflect.get(message, "organizationId"),
    );
    expect(alerts.toSorted()).toEqual([a.orgId, b.orgId]);
  });

  it("REQ-B2-RECON-1: a conforming approval only gets its dates advanced; a later recorded date is never rewound", async () => {
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    await seedApproved(a, "CAL-A-1", { nonConforming: false, ageMs: 2 * HOUR });
    await seedApproved(b, "CAL-B-1", { nonConforming: false, ageMs: 2 * HOUR });
    await db
      .update(asset)
      .set({ lastCalibrationDate: new Date("2099-01-01T00:00:00.000Z") })
      .where(eq(asset.id, b.assetId));

    const result = await asApp(() => reconcileApprovalEffects());

    expect(result.ootEventsCreated).toBe(0);
    expect(result.assetDatesAdvanced).toBe(1);
    expect(await eventsOf(a)).toEqual([]);
    expect((await assetState(a.assetId)).sources).toEqual([
      "job_approval_reconciliation",
    ]);
    expect(await assetState(b.assetId)).toMatchObject({ sources: [] });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("REQ-B2-RECON-2: a second run finds nothing: no new event, audit entry, date change or alert", async () => {
    const lab = await seedBillingLab("lab-a");
    await seedApproved(lab, "CAL-A-1", {
      nonConforming: true,
      ageMs: 2 * HOUR,
    });
    await asApp(() => reconcileApprovalEffects());
    const before = {
      events: await eventsOf(lab),
      audits: await ootAudits(),
      asset: await assetState(lab.assetId),
      enqueued: mocks.enqueue.mock.calls.length,
    };

    // The alert of the first run was delivered: its notify entry exists, so the
    // alert is not restaged either.
    await db.insert(assetOotAuditLog).values({
      organizationId: lab.orgId,
      eventId: before.events[0]?.id ?? 0,
      action: "notify",
      performedBy: lab.userId,
    });
    const second = await asApp(() => reconcileApprovalEffects());

    expect(second).toEqual({
      ootEventsCreated: 0,
      assetDatesAdvanced: 0,
      notificationsRestaged: 0,
      failures: 0,
      ootGapsOlderThanWindow: 0,
    });
    expect(await eventsOf(lab)).toEqual(before.events);
    expect(await ootAudits()).toHaveLength(before.audits.length + 1);
    expect(await assetState(lab.assetId)).toEqual(before.asset);
    expect(mocks.enqueue.mock.calls).toHaveLength(before.enqueued);
  });

  it("REQ-B2-RECON-3: leaves a job approved moments ago alone, and counts (never repairs) a gap older than the window", async () => {
    const lab = await seedBillingLab("lab-a");
    await seedApproved(lab, "CAL-A-1", { nonConforming: true, ageMs: 60_000 });
    const old = await seedBillingLab("lab-old");
    await seedApproved(old, "CAL-OLD-1", {
      nonConforming: true,
      ageMs: 90 * DAY,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await asApp(() => reconcileApprovalEffects());

    expect(result).toEqual({
      ootEventsCreated: 0,
      assetDatesAdvanced: 0,
      notificationsRestaged: 0,
      failures: 0,
      ootGapsOlderThanWindow: 1,
    });
    expect(await eventsOf(lab)).toEqual([]);
    expect(await eventsOf(old)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("REQ-B2-RECON-1: re-stages the customer alert of an event whose alert never left, unless it is queued or was delivered", async () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    vi.stubEnv("DOCUMENT_WORKER_URL", "");
    const lab = await seedBillingLab("lab-a");
    const never = await seedApproved(lab, "CAL-A-1", {
      nonConforming: true,
      ageMs: 2 * HOUR,
    });
    const queued = await seedApproved(lab, "CAL-A-2", {
      nonConforming: true,
      ageMs: 2 * HOUR,
    });
    const delivered = await seedApproved(lab, "CAL-A-3", {
      nonConforming: true,
      ageMs: 2 * HOUR,
    });
    const seed = (jobId: number) =>
      seedAssetOotEvent({
        jobId,
        assetId: lab.assetId,
        customerId: lab.customerId,
        labOrganizationId: lab.orgId,
        detectedAt: new Date(Date.now() - 2 * HOUR),
        actorUserId: lab.userId,
      });
    const neverEvent = await seed(never);
    const queuedEvent = await seed(queued);
    const deliveredEvent = await seed(delivered);
    // Event rows are written "now": age them past the grace period.
    await db
      .update(assetOotEvent)
      .set({ createdAt: new Date(Date.now() - 2 * HOUR) });
    await db.insert(appQueueJob).values({
      type: "ASSET_OOT_NOTIFICATION",
      payload: {
        type: "ASSET_OOT_NOTIFICATION",
        eventId: queuedEvent.eventId,
        organizationId: lab.orgId,
        userId: lab.userId,
      },
    });
    await db.insert(assetOotAuditLog).values({
      organizationId: lab.orgId,
      eventId: deliveredEvent.eventId,
      action: "notify",
      performedBy: lab.userId,
    });

    const result = await asApp(() => reconcileApprovalEffects());

    expect(result.notificationsRestaged).toBe(1);
    expect(result.ootEventsCreated).toBe(0);
    const rows = await db
      .select()
      .from(appQueueJob)
      .where(eq(appQueueJob.type, "ASSET_OOT_NOTIFICATION"))
      .orderBy(appQueueJob.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.payload).toMatchObject({ eventId: neverEvent.eventId });
    expect(stagedTypes(rows.map((row) => row.payload))).toEqual([
      "ASSET_OOT_NOTIFICATION",
      "ASSET_OOT_NOTIFICATION",
    ]);
    // Idempotent: the restaged job is now live in the queue, so nothing is added.
    await asApp(() => reconcileApprovalEffects());
    expect(
      await db
        .select()
        .from(appQueueJob)
        .where(and(eq(appQueueJob.type, "ASSET_OOT_NOTIFICATION"))),
    ).toHaveLength(2);
  });
});
