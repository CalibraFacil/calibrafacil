/**
 * sync-lab-scope.int.spec.ts: desktop sync under row-level security (P2-18i).
 *
 * The push, the pull and both bootstraps resolve ONE laboratory from the device's
 * session and run every statement in a transaction that names it (the event's own
 * transaction for a push, `orgDb(lab).transaction` for the reads). Real Postgres,
 * real sync middleware (only the better-auth session, the queue and the
 * notifications are faked). Like the other sync specs this file runs as the owner
 * in the integration tier and is replayed as `calibra_app` by
 * `pnpm --filter @calibra-facil/api rls:shadow-report --files ...`; the change-log
 * triggers are also exercised here directly on a `calibra_app` connection.
 *
 *   REQ-18I-PUSH-1  a device of laboratory A cannot write into, execute on or read from
 *                   laboratory B by the ids a payload names; nothing is written anywhere
 *   REQ-18I-PUSH-2  an event naming another laboratory or another laboratory's unit is
 *                   refused before it is looked at
 *   REQ-18I-PUSH-3  the applied-events ledger and the local-to-cloud id mapping are per
 *                   laboratory
 *   REQ-18I-PUSH-4  an event that fails mid-apply leaves nothing: no claim, no write, no
 *                   audit row and no change-log entry
 *   REQ-18I-PULL-1  a pull (protocol 3, even with another laboratory's cursor, and the
 *                   deprecated one) and every bootstrap carry only the laboratory's rows
 *   REQ-18I-LOG-1   the change-log triggers append entries of the writing laboratory when
 *                   the writer is `calibra_app`; a write of another laboratory's row is
 *                   refused and logs nothing; the global asset-type catalog is not
 *                   writable by a laboratory session
 *   REQ-18I-ATT-1   an attachment of another laboratory's partition is neither signed
 *                   nor completed
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import { forOrg, setTransactionOrganization } from "@calibra-facil/db/for-org";
import {
  asset,
  assetAuditLog,
  assetType,
  calibrationJob,
  customer,
  jobAuditLog,
  organizationEventLog,
  service,
  syncAppliedEvent,
} from "@calibra-facil/db/schema";
import {
  syncBootstrapPageResponseSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from "@calibra-facil/contracts";
import { DESKTOP_EXECUTION_PAYLOAD_VERSION } from "@calibra-facil/schemas";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import { jobRow } from "../../test/integration/job-cas";
import { failEventAuditInsert } from "../../test/integration/sync-faults";
import { openAppRoleDb, sqlStateOf } from "../../test/integration/rls";
import { getExecuteRows } from "../lib/db";
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
  notifyNonConformanceCreated: vi.fn().mockResolvedValue(undefined),
  notifyServiceOrderCreated: vi.fn().mockResolvedValue(undefined),
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

const A = "org-ls-a";
const B = "org-ls-b";
const JSON_HEADERS = { "content-type": "application/json" };

type Lab = Awaited<ReturnType<typeof seedLab>>;

/** A laboratory with an admin, a customer, an instrument, a service and one IN_PROGRESS job. */
async function seedLab(orgId: string) {
  const org = await seedOrg({ orgId, userId: `tech-${orgId}`, role: "admin" });
  const seeded = await seedJobForOrg({
    orgId,
    unitId: org.unitId,
    createdBy: org.userId,
  });
  await db
    .update(calibrationJob)
    .set({
      status: "IN_PROGRESS",
      methodSnapshot: executableMethodSnapshot(),
      technicianId: org.userId,
    })
    .where(eq(calibrationJob.id, seeded.jobId));
  const [instrument] = await db
    .select({ customerId: asset.customerId, assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(eq(asset.id, seeded.assetId));
  if (!instrument) throw new Error("seedLab: asset missing");
  return { ...org, ...seeded, ...instrument };
}

async function seedWorld() {
  const a = await seedLab(A);
  const b = await seedLab(B);
  return { a, b };
}

let counter = 0;

type EventInput = {
  eventId?: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: Record<string, unknown>;
  organizationId?: string;
  unitId?: number;
};

function wireEvent(lab: Lab, input: EventInput): Record<string, unknown> {
  counter += 1;
  const eventId = input.eventId ?? `evt-ls-${counter}`;
  return {
    eventId,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    payload: input.payload,
    occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    actorUserId: lab.userId,
    organizationId: input.organizationId ?? lab.orgId,
    unitId: input.unitId ?? lab.unitId,
    idempotencyKey: `idem-${eventId}`,
    localVersion: 0,
  };
}

async function push(lab: Lab, events: Record<string, unknown>[]) {
  loginAs({ userId: lab.userId, organizationId: lab.orgId });
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(lab.unitId) },
    body: JSON.stringify({
      deviceId: `device-${lab.orgId}`,
      clientBatchId: `batch-${Math.random().toString(36).slice(2)}`,
      baseCursor: null,
      events,
    }),
  });
  expect(res.status).toBe(200);
  return syncPushResponseSchema.parse(await res.json());
}

function createAssetEvent(
  lab: Lab,
  eventId: string,
  tag: string,
  localId = `local-asset-${eventId}`,
) {
  return wireEvent(lab, {
    eventId,
    entityType: "asset",
    entityId: localId,
    operation: "create_local_asset",
    payload: {
      customerId: lab.customerId,
      assetTypeId: lab.assetTypeId,
      name: "Balança de Bancada",
      serialNumber: `SN-${tag}`,
      tag,
      baseMeasurementUnit: "kg",
    },
  });
}

const EXECUTION_STAMP = {
  executionPayloadVersion: DESKTOP_EXECUTION_PAYLOAD_VERSION,
};

async function countRows(
  table:
    | "calibration_job"
    | "asset"
    | "non_conformance"
    | "service_order"
    | "customer",
  orgColumn: string,
  orgId: string,
) {
  const rows = getExecuteRows<{ n: number }>(
    await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(orgColumn)} = ${orgId}`,
    ),
  );
  return rows[0]?.n ?? 0;
}

/** What a foreign device could have touched in laboratory `lab`: every count and the rows themselves. */
async function snapshotOf(lab: Lab) {
  const [instrument] = await db
    .select()
    .from(asset)
    .where(eq(asset.id, lab.assetId));
  return {
    job: await jobRow(lab.jobId),
    instrument,
    jobs: await countRows("calibration_job", "organization_id", lab.orgId),
    assets: await countRows("asset", "lab_organization_id", lab.orgId),
    ncs: await countRows("non_conformance", "organization_id", lab.orgId),
    orders: await countRows("service_order", "organization_id", lab.orgId),
    customers: await countRows("customer", "lab_organization_id", lab.orgId),
    jobAudits: (
      await db
        .select({ id: jobAuditLog.id })
        .from(jobAuditLog)
        .where(eq(jobAuditLog.organizationId, lab.orgId))
    ).length,
    eventLog: (
      await db
        .select({ id: organizationEventLog.id })
        .from(organizationEventLog)
        .where(eq(organizationEventLog.organizationId, lab.orgId))
    ).length,
    claims: (
      await db
        .select({ id: syncAppliedEvent.id })
        .from(syncAppliedEvent)
        .where(eq(syncAppliedEvent.organizationId, lab.orgId))
    ).length,
  };
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("REQ-18I-PUSH: a device pushes only into its own laboratory", () => {
  it("REQ-18I-PUSH-1 [HIGH RISK]: ids of laboratory B in the payloads of laboratory A's device write, execute and create nothing, anywhere", async () => {
    const { a, b } = await seedWorld();
    const bBefore = await snapshotOf(b);
    const aBefore = await snapshotOf(a);

    const events = [
      // B's instrument by its cloud id.
      wireEvent(a, {
        eventId: "evt-ls-update-asset",
        entityType: "asset",
        entityId: "local-asset-x",
        operation: "update_local_asset",
        payload: { remoteId: b.assetId, name: "Invadido" },
      }),
      // B's customer in a new instrument.
      createAssetEventFor(a, b, "evt-ls-create-asset", "LS-FOREIGN"),
      // B's job executed and submitted.
      wireEvent(a, {
        eventId: "evt-ls-exec",
        entityType: "calibration_job",
        entityId: "local-job-x",
        operation: "save_local_execution",
        payload: {
          remoteId: b.jobId,
          status: "IN_PROGRESS",
          data: { indication: "10", reference: "9" },
          results: null,
          ...EXECUTION_STAMP,
        },
      }),
      wireEvent(a, {
        eventId: "evt-ls-submit",
        entityType: "calibration_job",
        entityId: "local-job-y",
        operation: "submit_local_execution",
        payload: {
          remoteId: b.jobId,
          status: "REVIEW",
          data: { indication: "10", reference: "9" },
          results: null,
          ...EXECUTION_STAMP,
        },
      }),
      // A job draft over B's instrument and service.
      wireEvent(a, {
        eventId: "evt-ls-draft",
        entityType: "calibration_job",
        entityId: "local-job-z",
        operation: "create_local_job_draft",
        payload: { assetId: b.assetId, serviceId: b.serviceId },
      }),
      // A non-conformance about B's job.
      wireEvent(a, {
        eventId: "evt-ls-nc",
        entityType: "non_conformance",
        entityId: "local-nc-x",
        operation: "create_local_non_conformance",
        payload: {
          type: "work",
          description: "Desvio no procedimento de calibracao",
          detectedAt: new Date().toISOString(),
          jobId: b.jobId,
        },
      }),
      // A service-order intake over B's instrument and customer.
      wireEvent(a, {
        eventId: "evt-ls-intake",
        entityType: "service_order",
        entityId: "local-so-x",
        operation: "create_local_service_order_intake",
        payload: {
          customerId: b.customerId,
          assetId: b.assetId,
          claimedDefect: "Nao liga",
          intakeCondition: "Riscos na carcaca",
        },
      }),
    ];

    const body = await push(a, events);

    expect(body.accepted).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.rejected.map((entry) => entry.eventId).toSorted()).toEqual(
      events.map((event) => String(event.eventId)).toSorted(),
    );
    const codeOf = (eventId: string) =>
      body.rejected.find((entry) => entry.eventId === eventId)?.code;
    expect(codeOf("evt-ls-update-asset")).toBe("DOMAIN_VALIDATION_FAILED");
    expect(codeOf("evt-ls-create-asset")).toBe("DOMAIN_VALIDATION_FAILED");
    expect(codeOf("evt-ls-nc")).toBe("DOMAIN_VALIDATION_FAILED");
    expect(codeOf("evt-ls-intake")).toBe("DOMAIN_VALIDATION_FAILED");

    // Nothing of laboratory B moved, and laboratory A gained no row either.
    expect(await snapshotOf(b)).toEqual(bBefore);
    expect(await snapshotOf(a)).toEqual(aBefore);
  });

  it("REQ-18I-PUSH-2: an event naming laboratory B, or one of its units, is refused before it is looked at", async () => {
    const { a, b } = await seedWorld();
    const before = await snapshotOf(b);

    const body = await push(a, [
      createAssetEventAs(a, "evt-ls-org", "LS-ORG", {
        organizationId: b.orgId,
      }),
      createAssetEventAs(a, "evt-ls-unit", "LS-UNIT", { unitId: b.unitId }),
    ]);

    expect(body.accepted).toEqual([]);
    expect(
      Object.fromEntries(body.rejected.map((e) => [e.eventId, e.code])),
    ).toEqual({
      "evt-ls-org": "ORGANIZATION_SCOPE_MISMATCH",
      "evt-ls-unit": "UNIT_SCOPE_MISMATCH",
    });
    expect(await snapshotOf(b)).toEqual(before);
    expect(await snapshotOf(a)).toMatchObject({ claims: 0, assets: 1 });
  });

  it("REQ-18I-PUSH-3 [HIGH RISK]: the same event id from two laboratories applies in both (one claim each), and a replay answers from its own laboratory's ledger", async () => {
    const { a, b } = await seedWorld();

    const first = await push(a, [
      createAssetEvent(a, "evt-ls-shared", "LS-SHARED-A"),
    ]);
    const second = await push(b, [
      createAssetEvent(b, "evt-ls-shared", "LS-SHARED-B"),
    ]);
    expect(first.accepted.map((entry) => entry.eventId)).toEqual([
      "evt-ls-shared",
    ]);
    expect(second.accepted.map((entry) => entry.eventId)).toEqual([
      "evt-ls-shared",
    ]);

    const claims = await db
      .select({
        organizationId: syncAppliedEvent.organizationId,
        appliedAt: syncAppliedEvent.appliedAt,
      })
      .from(syncAppliedEvent)
      .where(eq(syncAppliedEvent.eventId, "evt-ls-shared"));
    expect(claims.map((claim) => claim.organizationId).toSorted()).toEqual([
      A,
      B,
    ]);
    for (const claim of claims) expect(claim.appliedAt).not.toBeNull();

    // A's replay applies nothing again; B's instrument is not A's and vice versa.
    const replay = await push(a, [
      createAssetEvent(a, "evt-ls-shared", "LS-SHARED-A"),
    ]);
    expect(replay.accepted).toHaveLength(1);
    const tags = await db
      .select({ tag: asset.tag, org: asset.labOrganizationId })
      .from(asset)
      .where(sql`${asset.tag} like 'LS-SHARED-%'`);
    expect(tags.toSorted((x, y) => x.tag.localeCompare(y.tag))).toEqual([
      { tag: "LS-SHARED-A", org: A },
      { tag: "LS-SHARED-B", org: B },
    ]);
  });

  it("REQ-18I-PUSH-3: a local id mapped by laboratory B means nothing to laboratory A's device", async () => {
    const { a, b } = await seedWorld();
    // B's device creates the instrument under its local id...
    const created = await push(b, [
      createAssetEvent(b, "evt-ls-map-b", "LS-MAP", "local-asset-shared"),
    ]);
    const remoteId = created.accepted[0]?.remoteEntityId;
    expect(typeof remoteId).toBe("number");
    const [before] = await db
      .select()
      .from(asset)
      .where(eq(asset.tag, "LS-MAP"));

    // ...and A's device updates "the same" local id: A has no mapping for it.
    const body = await push(a, [
      wireEvent(a, {
        eventId: "evt-ls-map-a",
        entityType: "asset",
        entityId: "local-asset-shared",
        operation: "update_local_asset",
        payload: { name: "Renomeado por A" },
      }),
    ]);

    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        eventId: "evt-ls-map-a",
        code: "DOMAIN_VALIDATION_FAILED",
      }),
    ]);
    const [after] = await db
      .select()
      .from(asset)
      .where(eq(asset.tag, "LS-MAP"));
    expect(after).toEqual(before);
  });

  it("REQ-18I-PUSH-4 [HIGH RISK]: an event that fails mid-apply leaves no claim, no instrument, no audit row and no change-log entry; the one beside it commits whole", async () => {
    const { a } = await seedWorld();
    const logBefore = await changeLogEntries(A, "asset");
    const restore = await failEventAuditInsert("evt-ls-fail");
    let body: Awaited<ReturnType<typeof push>>;
    try {
      body = await push(a, [
        createAssetEvent(a, "evt-ls-ok", "LS-OK"),
        createAssetEvent(a, "evt-ls-fail", "LS-FAIL"),
      ]);
    } finally {
      await restore();
    }

    expect(body.accepted.map((entry) => entry.eventId)).toEqual(["evt-ls-ok"]);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        eventId: "evt-ls-fail",
        code: "DESKTOP_SYNC_APPLY_FAILED",
      }),
    ]);

    // The failed event: nothing.
    expect(
      await db.select().from(asset).where(eq(asset.tag, "LS-FAIL")),
    ).toEqual([]);
    expect(
      await db
        .select({ id: syncAppliedEvent.id })
        .from(syncAppliedEvent)
        .where(eq(syncAppliedEvent.eventId, "evt-ls-fail")),
    ).toEqual([]);
    expect(
      await db
        .select({ id: assetAuditLog.id })
        .from(assetAuditLog)
        .where(sql`${assetAuditLog.changes}::text like '%LS-FAIL%'`),
    ).toEqual([]);
    // Its trigger-written change-log entry rolled back with it; the neighbour's is there.
    const logAfter = await changeLogEntries(A, "asset");
    const [ok] = await db
      .select({ id: asset.id })
      .from(asset)
      .where(eq(asset.tag, "LS-OK"));
    expect(logAfter.map((entry) => entry.entity_id).toSorted()).toEqual(
      [...logBefore.map((entry) => entry.entity_id), ok?.id ?? -1].toSorted(),
    );
  });
});

function createAssetEventFor(
  lab: Lab,
  other: Lab,
  eventId: string,
  tag: string,
) {
  return wireEvent(lab, {
    eventId,
    entityType: "asset",
    entityId: `local-asset-${eventId}`,
    operation: "create_local_asset",
    payload: {
      customerId: other.customerId,
      assetTypeId: other.assetTypeId,
      name: "Instrumento do vizinho",
      serialNumber: `SN-${tag}`,
      tag,
      baseMeasurementUnit: "kg",
    },
  });
}

function createAssetEventAs(
  lab: Lab,
  eventId: string,
  tag: string,
  override: { organizationId?: string; unitId?: number },
) {
  return wireEvent(lab, {
    eventId,
    entityType: "asset",
    entityId: `local-asset-${eventId}`,
    operation: "create_local_asset",
    payload: {
      customerId: lab.customerId,
      assetTypeId: lab.assetTypeId,
      name: "Balança de Bancada",
      serialNumber: `SN-${tag}`,
      tag,
      baseMeasurementUnit: "kg",
    },
    ...override,
  });
}

type LogEntry = {
  entity_type: string;
  entity_id: number;
  op: string;
  organization_id: string;
};

async function changeLogEntries(
  organizationId: string,
  entityType?: string,
): Promise<LogEntry[]> {
  const rows = getExecuteRows<LogEntry>(
    await db.execute(
      entityType === undefined
        ? sql`select entity_type, entity_id, op, organization_id from sync_change_log
              where organization_id = ${organizationId} order by seq`
        : sql`select entity_type, entity_id, op, organization_id from sync_change_log
              where organization_id = ${organizationId} and entity_type = ${entityType} order by seq`,
    ),
  );
  return rows.map((row) => ({ ...row, entity_id: Number(row.entity_id) }));
}

// ---------------------------------------------------------------------------
// Pull and bootstrap
// ---------------------------------------------------------------------------

type Pull = z.infer<typeof syncPullResponseSchema>;

async function waitUntilServable() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const rows = getExecuteRows<{ ready: boolean }>(
      await db.execute(sql`
        SELECT coalesce(
          (SELECT max(xid) FROM sync_change_log) < pg_snapshot_xmin(pg_current_snapshot()),
          true) AS ready`),
    );
    if (rows[0]?.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the change log did not become servable");
}

async function pullAll(
  lab: Lab,
  cursor: string,
  protocol: number | null = 3,
): Promise<{ events: Pull["events"]; cursor: string }> {
  await waitUntilServable();
  loginAs({ userId: lab.userId, organizationId: lab.orgId });
  const events: Pull["events"] = [];
  let next = cursor;
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ cursor: next, limit: "2" });
    if (protocol !== null) query.set("protocolVersion", String(protocol));
    const response = await syncRouter.request(`/pull?${query.toString()}`, {
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(lab.unitId) },
    });
    expect(response.status).toBe(200);
    const body = syncPullResponseSchema.parse(await response.json());
    events.push(...body.events);
    if (body.cursor === null) throw new Error("a pull always has a cursor");
    next = body.cursor;
    if (!body.hasMore) break;
  }
  return { events, cursor: next };
}

async function bootstrapPages(lab: Lab, limit: number) {
  loginAs({ userId: lab.userId, organizationId: lab.orgId });
  const pages: z.infer<typeof syncBootstrapPageResponseSchema>[] = [];
  let pageToken: string | null | undefined;
  for (let page = 0; page < 100; page += 1) {
    const response = await syncRouter.request("/bootstrap", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(lab.unitId) },
      body: JSON.stringify({
        protocolVersion: 3,
        limit,
        ...(pageToken ? { pageToken } : {}),
      }),
    });
    expect(response.status).toBe(200);
    const body = syncBootstrapPageResponseSchema.parse(await response.json());
    pages.push(body);
    if (!body.page.nextToken) break;
    pageToken = body.page.nextToken;
  }
  return pages;
}

function idsOf(rows: unknown[]): number[] {
  return rows.map((row) => z.object({ id: z.number() }).parse(row).id);
}

describe("REQ-18I-PULL: a device reads only its own laboratory", () => {
  it("REQ-18I-PULL-1 [HIGH RISK]: a protocol 3 pull carries only the laboratory's rows and tombstones, even with a cursor taken from the other laboratory", async () => {
    const { a, b } = await seedWorld();
    await waitUntilServable();
    const aStart = (await bootstrapPages(a, 500)).at(-1)?.syncCursor;
    const bStart = (await bootstrapPages(b, 500)).at(-1)?.syncCursor;
    if (!aStart || !bStart) throw new Error("no bootstrap cursor");

    const aCustomer = await seedCustomer({
      labOrganizationId: A,
      name: "Cliente A",
    });
    const bCustomer = await seedCustomer({
      labOrganizationId: B,
      name: "Cliente B",
    });
    const bGone = await seedCustomer({
      labOrganizationId: B,
      name: "Cliente B removido",
    });
    await db.delete(customer).where(eq(customer.id, bGone));

    const own = await pullAll(a, aStart);
    const customers = own.events.filter((e) => e.entityType === "customer");
    expect(customers.map((e) => e.entityId)).toEqual([aCustomer]);
    expect(
      own.events.some(
        (e) =>
          [bCustomer, bGone].includes(e.entityId) &&
          e.entityType === "customer",
      ),
    ).toBe(false);

    // B's cursor now names B's scope (roadmap 2 E2), so A pulling with it is
    // told to bootstrap again...
    loginAs({ userId: a.userId, organizationId: a.orgId });
    const refused = await syncRouter.request(
      `/pull?protocolVersion=3&cursor=${encodeURIComponent(bStart)}`,
      { headers: { "x-active-unit-id": String(a.unitId) } },
    );
    expect(refused.status).toBe(409);
    // ...and without the scope part (an older cursor) it is a position in the
    // shared transaction order, not a key to B's rows.
    const bPosition = bStart.split("|").slice(0, 3).join("|");
    const withForeignCursor = await pullAll(a, bPosition);
    const foreign = withForeignCursor.events.filter(
      (e) => e.entityType === "customer",
    );
    expect(foreign.map((e) => e.entityId)).toEqual([aCustomer]);
    expect(JSON.stringify(withForeignCursor.events)).not.toContain("Cliente B");

    // The deprecated updatedAt pull is scoped the same way.
    const legacy = await pullAll(a, new Date(0).toISOString(), null);
    const legacyCustomers = legacy.events.filter(
      (e) => e.entityType === "customer",
    );
    expect(legacyCustomers.map((e) => e.entityId)).toContain(aCustomer);
    expect(legacyCustomers.map((e) => e.entityId)).not.toContain(bCustomer);
    expect(JSON.stringify(legacy.events)).not.toContain("Cliente B");
  });

  it("REQ-18I-PULL-1 [HIGH RISK]: no bootstrap page, paged or legacy, contains a row of the other laboratory", async () => {
    const { a, b } = await seedWorld();
    const extra = await seedCustomer({
      labOrganizationId: B,
      name: "Cliente B extra",
    });
    await seedCustomer({ labOrganizationId: A, name: "Cliente A extra" });

    const pages = await bootstrapPages(a, 1);
    expect(pages.length).toBeGreaterThan(3);
    const customers = pages.flatMap((page) => idsOf(page.customers));
    const assets = pages.flatMap((page) => idsOf(page.assets));
    const jobs = pages.flatMap((page) => idsOf(page.jobs));
    const services = pages.flatMap((page) => idsOf(page.services));
    expect(customers).toContain(a.customerId);
    expect(assets).toEqual([a.assetId]);
    expect(jobs).toEqual([a.jobId]);
    expect(services).toEqual([a.serviceId]);
    expect(customers).not.toContain(b.customerId);
    expect(customers).not.toContain(extra);
    expect(JSON.stringify(pages)).not.toContain("Cliente B");
    // Every row names its laboratory; the global asset-type catalog (a slug) is the
    // only place laboratory B's seed may show.
    expect(JSON.stringify(pages)).not.toContain(`"organizationId":"${B}"`);

    // The one unpaginated response of protocols 1 and 2.
    loginAs({ userId: a.userId, organizationId: a.orgId });
    const response = await syncRouter.request("/bootstrap", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(a.unitId) },
    });
    expect(response.status).toBe(200);
    const legacy = z
      .object({
        customers: z.array(z.object({ id: z.number() })),
        assets: z.array(z.object({ id: z.number() })),
        jobs: z.array(z.object({ id: z.number() })),
        services: z.array(z.object({ id: z.number() })),
      })
      .parse(await response.json());
    expect(idsOf(legacy.assets)).toEqual([a.assetId]);
    expect(idsOf(legacy.jobs)).toEqual([a.jobId]);
    expect(idsOf(legacy.services)).toEqual([a.serviceId]);
    expect(idsOf(legacy.customers)).not.toContain(b.customerId);
    expect(idsOf(legacy.customers)).not.toContain(extra);
  });
});

// ---------------------------------------------------------------------------
// Change-log triggers as calibra_app
// ---------------------------------------------------------------------------

describe("REQ-18I-LOG: the change-log triggers under calibra_app", () => {
  it("REQ-18I-LOG-1 [HIGH RISK]: writes of laboratory A's session append entries of laboratory A (upsert, tombstone), and nothing lands in laboratory B's log", async () => {
    const { a, b } = await seedWorld();
    const app = openAppRoleDb();
    const o = forOrg(app.db, A);
    const aBefore = await changeLogEntries(A);
    const bBefore = await changeLogEntries(B);

    const created = await o.transaction(async (tx) => {
      await tx
        .update(asset)
        .set({ name: "Renomeado" })
        .where(eq(asset.id, a.assetId));
      await tx
        .update(service)
        .set({ name: "Serviço renomeado" })
        .where(eq(service.id, a.serviceId));
      const [inserted] = await tx
        .insert(customer)
        .values({
          name: "Cliente novo",
          authOrganizationId: await clientOrganizationFor(),
          labOrganizationId: A,
        })
        .returning({ id: customer.id });
      return inserted?.id ?? -1;
    });
    await o.transaction(async (tx) => {
      await tx.delete(customer).where(eq(customer.id, created));
    });

    const entries = (await changeLogEntries(A)).slice(aBefore.length);
    const shape = entries.map(
      (entry) => `${entry.entity_type}:${entry.entity_id}:${entry.op}`,
    );
    expect(shape).toEqual([
      `asset:${a.assetId}:upsert`,
      `service:${a.serviceId}:upsert`,
      `customer:${created}:upsert`,
      `customer:${created}:delete`,
    ]);
    for (const entry of entries) expect(entry.organization_id).toBe(A);
    expect(await changeLogEntries(B)).toEqual(bBefore);

    // And the rows are what the trigger said: B's instrument is untouched.
    const [bAsset] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, b.assetId));
    expect(bAsset?.name).toBe("Asset");
  });

  it("REQ-18I-LOG-1: laboratory A's session cannot write laboratory B's row, and no entry is logged for the attempt", async () => {
    const { a, b } = await seedWorld();
    const app = openAppRoleDb();
    const aBefore = await changeLogEntries(A);
    const bBefore = await changeLogEntries(B);

    // The row is invisible: the update touches nothing.
    const touched = await app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, A);
      return tx
        .update(asset)
        .set({ name: "Invadido" })
        .where(eq(asset.id, b.assetId))
        .returning({ id: asset.id });
    });
    expect(touched).toEqual([]);

    // A new row of B written in A's session is refused by WITH CHECK.
    const intruder = app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, A);
      await tx.insert(customer).values({
        name: "Intruso",
        authOrganizationId: await clientOrganizationFor(),
        labOrganizationId: B,
      });
    });
    expect(await sqlStateOf(intruder)).toBe("42501");

    expect(await changeLogEntries(A)).toEqual(aBefore);
    expect(await changeLogEntries(B)).toEqual(bBefore);
    expect(a.orgId).toBe(A);
  });

  it("REQ-18I-LOG-1: the global asset-type catalog is not writable by a laboratory session (its trigger would write every laboratory's log)", async () => {
    await seedWorld();
    const app = openAppRoleDb();
    const attempt = app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, A);
      await tx
        .insert(assetType)
        .values({ name: "Intruso", slug: "intruso-ls", definition: [] });
    });
    expect(await sqlStateOf(attempt)).toBe("42501");
    expect(
      await db
        .select({ id: assetType.id })
        .from(assetType)
        .where(eq(assetType.slug, "intruso-ls")),
    ).toEqual([]);
  });
});

let clientCounter = 0;

/** A CLIENT organization the owner seeds for a customer the app-role session inserts. */
async function clientOrganizationFor(): Promise<string> {
  clientCounter += 1;
  const id = `client-ls-${clientCounter}-${Math.random().toString(36).slice(2, 7)}`;
  await db.execute(
    sql`insert into organization (id, name, slug, type, status, created_at)
        values (${id}, ${`Client ${id}`}, ${id}, 'CLIENT', 'ACTIVE', now())`,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

describe("REQ-18I-ATT: attachments stay in the laboratory's partition", () => {
  const R2_ENV = {
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "sync-attachments",
  };

  const uploadRequest = (lab: Lab) => ({
    deviceId: `device-${lab.orgId}`,
    eventId: "evt-ls-att",
    entityType: "asset",
    entityId: "local-asset-att",
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 4096,
    contentHash: "a".repeat(64),
  });

  async function initUpload(lab: Lab) {
    loginAs({ userId: lab.userId, organizationId: lab.orgId });
    const response = await syncRouter.request(
      "/attachments/init-upload",
      {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(lab.unitId) },
        body: JSON.stringify(uploadRequest(lab)),
      },
      R2_ENV,
    );
    return response;
  }

  it("REQ-18I-ATT-1: B's attachment id is refused by A's device for download and for completion; A's own works", async () => {
    const { a, b } = await seedWorld();
    const upload = await initUpload(b);
    expect(upload.status).toBe(200);
    const bUpload = z
      .object({ attachmentId: z.string(), objectKey: z.string() })
      .parse(await upload.json());
    expect(bUpload.objectKey.startsWith(`org/${B}/`)).toBe(true);

    loginAs({ userId: a.userId, organizationId: a.orgId });
    const headers = { ...JSON_HEADERS, "x-active-unit-id": String(a.unitId) };
    const download = await syncRouter.request(
      `/attachments/${bUpload.attachmentId}/download`,
      { headers },
      R2_ENV,
    );
    expect(download.status).toBe(400);

    const complete = await syncRouter.request(
      "/attachments/complete-upload",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...uploadRequest(a),
          attachmentId: bUpload.attachmentId,
          objectKey: bUpload.objectKey,
        }),
      },
      R2_ENV,
    );
    expect(complete.status).toBe(400);

    const own = await initUpload(a);
    expect(own.status).toBe(200);
    const aUpload = z
      .object({ attachmentId: z.string() })
      .parse(await own.json());
    const ownDownload = await syncRouter.request(
      `/attachments/${aUpload.attachmentId}/download`,
      { headers },
      R2_ENV,
    );
    expect(ownDownload.status).toBe(200);
  });
});
