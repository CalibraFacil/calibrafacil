/**
 * sync-change-seq.int.spec.ts: the commit-ordered desktop pull (protocol 3),
 * against real Postgres and the real sync middleware (only the Better Auth session
 * is faked). docs/architecture/sync-change-seq.md is the design.
 *
 *   REQ-CS-1  [HIGH RISK] the pull reads a server-side change log by position and only
 *             up to the oldest transaction still in flight: a row whose transaction
 *             commits after a later-written row was pulled is still pulled (RED on the
 *             old `updatedAt` cursor, which loses it: see the baseline test)
 *   REQ-CS-2  deletes, soft deletes and moves out of the desktop's unit scope are
 *             tombstones (`op = 'delete'`)
 *   REQ-CS-3  the bootstrap is paged: bounded pages, one cursor, nothing lost or repeated
 *   REQ-CS-4  protocol 1 and 2 desktops keep the `updatedAt` pull; a protocol 3 pull with
 *             a cursor of another protocol is told to bootstrap again
 *   REQ-CS-5  tenant-scoped log, retention purge, a cursor older than the purge horizon is
 *             told to bootstrap again
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  customer,
  organization,
  organizationUnit,
  service,
} from "@calibra-facil/db/schema";
import {
  SYNC_RESYNC_REQUIRED_CODE,
  syncBootstrapPageResponseSchema,
  syncPullResponseSchema,
  syncResyncRequiredResponseSchema,
} from "@calibra-facil/contracts";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedCustomer,
  seedOrg,
  seedService,
} from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";
import { getExecuteRows } from "../lib/db";
import { purgeSyncChangeLog } from "../lib/sync-change-log-purge";
import { syncRouter } from "./sync";

const JSON_HEADERS = { "content-type": "application/json" };

type Org = Awaited<ReturnType<typeof seedOrg>>;

function scopeHeaders(org: Org, unitId = org.unitId) {
  return { ...JSON_HEADERS, "x-active-unit-id": String(unitId) };
}

async function pull(
  org: Org,
  params: {
    cursor: string | null;
    limit?: number;
    unitId?: number;
    protocol?: number | null;
  },
) {
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const query = new URLSearchParams();
  if (params.protocol !== null) {
    query.set("protocolVersion", String(params.protocol ?? 3));
  }
  if (params.cursor !== null) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const response = await syncRouter.request(`/pull?${query.toString()}`, {
    headers: scopeHeaders(org, params.unitId),
  });
  return response;
}

async function pullOk(
  org: Org,
  params: Parameters<typeof pull>[1],
): Promise<z.infer<typeof syncPullResponseSchema>> {
  const response = await pull(org, params);
  expect(response.status).toBe(200);
  return syncPullResponseSchema.parse(await response.json());
}

/**
 * Waits until every log entry of the laboratory is below the in-flight horizon, i.e.
 * until the pull may serve it. The horizon is cluster-wide (the oldest transaction in
 * flight in ANY database): under the parallel integration workers an unrelated writer
 * can hold it back for a moment. That is the documented lag, never a loss.
 */
async function waitUntilServable(organizationId: string) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const rows = getExecuteRows<{ ready: boolean }>(
      // eslint-disable-next-line no-await-in-loop
      await db.execute(sql`
        SELECT coalesce(
          (SELECT xid FROM sync_change_log WHERE organization_id = ${organizationId}
           ORDER BY xid DESC LIMIT 1) < pg_snapshot_xmin(pg_current_snapshot()),
          true) AS ready`),
    );
    if (rows[0]?.ready) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the change log did not become servable");
}

async function pullSettled(
  org: Org,
  params: Parameters<typeof pull>[1],
): Promise<z.infer<typeof syncPullResponseSchema>> {
  await waitUntilServable(org.orgId);
  return pullOk(org, params);
}

/** Every page until `hasMore` is false; the events of all pages and the last cursor. */
async function pullAll(
  org: Org,
  params: { cursor: string; limit?: number; unitId?: number },
) {
  await waitUntilServable(org.orgId);
  const events: z.infer<typeof syncPullResponseSchema>["events"] = [];
  const cursors: string[] = [];
  let cursor = params.cursor;
  for (let page = 0; page < 50; page += 1) {
    const body = await pullOk(org, { ...params, cursor });
    events.push(...body.events);
    if (body.cursor === null) throw new Error("a v3 pull always has a cursor");
    cursors.push(body.cursor);
    cursor = body.cursor;
    if (!body.hasMore) break;
  }
  return { events, cursor, cursors };
}

function only<T extends { entityType: string }>(
  events: T[],
  entityType: string,
) {
  return events.filter((event) => event.entityType === entityType);
}

function labels(
  events: Array<{
    entityType: string;
    entityId: string | number;
    operation: string;
  }>,
) {
  return events.map(
    (event) => `${event.entityType}:${event.entityId}:${event.operation}`,
  );
}

/** The cursor a desktop holds right after a bootstrap of an (almost) empty lab. */
async function bootstrapCursor(org: Org): Promise<string> {
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const response = await syncRouter.request("/bootstrap", {
    method: "POST",
    headers: scopeHeaders(org),
    body: JSON.stringify({ protocolVersion: 3 }),
  });
  expect(response.status).toBe(200);
  const page = syncBootstrapPageResponseSchema.parse(await response.json());
  return page.syncCursor;
}

/**
 * A transaction the test keeps open: `work` runs inside it, then it waits until
 * `commit()` (or `rollback()`) is called. Holds one pooled connection meanwhile.
 */
function holdTransaction(
  work: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<void>,
) {
  let release!: (outcome: "commit" | "rollback") => void;
  const gate = new Promise<"commit" | "rollback">((resolve) => {
    release = resolve;
  });
  let opened!: () => void;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const done = db
    .transaction(async (tx) => {
      await work(tx);
      opened();
      if ((await gate) === "rollback") throw new Error("test rollback");
    })
    .catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "test rollback") {
        throw error;
      }
    });
  const hold = {
    ready,
    async commit() {
      release("commit");
      await done;
    },
    async rollback() {
      release("rollback");
      await done;
    },
  };
  openHolds.push(hold);
  return hold;
}

/** Transactions a failing test left open: rolled back after each test so they cannot block the next. */
const openHolds: Array<{ rollback(): Promise<void> }> = [];

async function newClientOrg(id: string) {
  await db.insert(organization).values({
    id,
    name: id,
    slug: id,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  return id;
}

async function logRows(organizationId: string) {
  const result = await db.execute(
    sql`SELECT entity_type, entity_id, op, unit_id, organization_id
        FROM sync_change_log WHERE organization_id = ${organizationId} ORDER BY seq`,
  );
  return getExecuteRows<{
    entity_type: string;
    entity_id: number | string;
    op: string;
    unit_id: number | null;
    organization_id: string;
  }>(result);
}

const ORG = "org-cs-a";
const OTHER = "org-cs-b";

describe("sync change sequence (protocol 3)", () => {
  afterEach(async () => {
    await Promise.all(openHolds.splice(0).map((hold) => hold.rollback()));
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // REQ-CS-1
  // -------------------------------------------------------------------------

  it("REQ-CS-1: a row whose transaction commits AFTER a later-written row was pulled is still pulled", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const start = await bootstrapCursor(org);

    // Transaction A writes first (the lower sequence number) and stays open ...
    const clientA = await newClientOrg("client-late-a");
    const clientB = await newClientOrg("client-late-b");
    const slow = holdTransaction(async (tx) => {
      await tx.insert(customer).values({
        name: "Escrito antes, confirmado depois",
        authOrganizationId: clientA,
        labOrganizationId: org.orgId,
      });
    });
    await slow.ready;

    // ... transaction B writes later and commits first.
    const [fast] = await db
      .insert(customer)
      .values({
        name: "Escrito depois, confirmado antes",
        authOrganizationId: clientB,
        labOrganizationId: org.orgId,
      })
      .returning({ id: customer.id });
    if (!fast) throw new Error("seed failed");

    // The desktop pulls while A is in flight. It must not be handed B either:
    // handing out B would move the cursor past A's (lower) sequence number.
    const during = await pullOk(org, { cursor: start });
    expect(labels(during.events)).toEqual([]);

    await slow.commit();

    const after = await pullAll(org, { cursor: during.cursor ?? start });
    const names = after.events.map((event) => {
      const payload = z.object({ name: z.string() }).parse(event.payload);
      return payload.name;
    });
    expect(names.toSorted()).toEqual([
      "Escrito antes, confirmado depois",
      "Escrito depois, confirmado antes",
    ]);

    // Nothing is repeated once the log is drained.
    const drained = await pullSettled(org, { cursor: after.cursor });
    expect(drained.events).toEqual([]);
  });

  it("REQ-CS-1: the same scenario on the old updatedAt cursor LOSES the late-committing row (the hazard this replaces)", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const clientA = await newClientOrg("client-old-a");
    const clientB = await newClientOrg("client-old-b");

    const slow = holdTransaction(async (tx) => {
      await tx.insert(customer).values({
        name: "Tardio",
        authOrganizationId: clientA,
        labOrganizationId: org.orgId,
      });
    });
    await slow.ready;
    // updatedAt is the transaction's start time: make B strictly later.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.insert(customer).values({
      name: "Cedo",
      authOrganizationId: clientB,
      labOrganizationId: org.orgId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const first = await syncRouter.request(
      "/pull?cursor=1970-01-01T00%3A00%3A00.000Z",
      { headers: scopeHeaders(org) },
    );
    const firstBody = syncPullResponseSchema.parse(await first.json());
    expect(firstBody.events.map((event) => event.entityType)).toEqual([
      "customer",
    ]);

    await slow.commit();
    const second = await syncRouter.request(
      `/pull?cursor=${encodeURIComponent(firstBody.cursor ?? "")}`,
      { headers: scopeHeaders(org) },
    );
    const secondBody = syncPullResponseSchema.parse(await second.json());
    // The row of transaction A never arrives: this is what the change log fixes.
    expect(secondBody.events).toEqual([]);
  });

  it("REQ-CS-1: a transaction that rolls back leaves nothing in the log and does not hold later commits back", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const start = await bootstrapCursor(org);
    const clientA = await newClientOrg("client-rb-a");
    const clientB = await newClientOrg("client-rb-b");

    const doomed = holdTransaction(async (tx) => {
      await tx.insert(customer).values({
        name: "Desfeito",
        authOrganizationId: clientA,
        labOrganizationId: org.orgId,
      });
    });
    await doomed.ready;
    await db.insert(customer).values({
      name: "Mantido",
      authOrganizationId: clientB,
      labOrganizationId: org.orgId,
    });
    expect(labels((await pullOk(org, { cursor: start })).events)).toEqual([]);

    await doomed.rollback();
    const after = await pullAll(org, { cursor: start });
    expect(
      after.events.map(
        (event) => z.object({ name: z.string() }).parse(event.payload).name,
      ),
    ).toEqual(["Mantido"]);
    expect((await logRows(org.orgId)).length).toBe(1);
  });

  it("REQ-CS-1: pages are bounded, the cursor strictly advances and no row is lost or repeated across a page boundary", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const start = await bootstrapCursor(org);
    const ids: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(
        await seedCustomer({
          labOrganizationId: org.orgId,
          name: `Cliente ${index}`,
        }),
      );
    }

    await waitUntilServable(org.orgId);
    const pages: Array<z.infer<typeof syncPullResponseSchema>> = [];
    let cursor = start;
    for (let page = 0; page < 10; page += 1) {
      const body = await pullOk(org, { cursor, limit: 2 });
      pages.push(body);
      expect(body.events.length).toBeLessThanOrEqual(2);
      if (body.cursor === null) throw new Error("cursor expected");
      cursor = body.cursor;
      if (!body.hasMore) break;
    }
    expect(pages.length).toBe(3);
    expect(pages.slice(0, 2).every((page) => page.hasMore)).toBe(true);
    const pulled = pages.flatMap((page) =>
      page.events.map((event) => Number(event.entityId)),
    );
    expect(pulled.toSorted((a, b) => a - b)).toEqual(ids);
    const cursors = pages.map((page) => page.cursor);
    expect(new Set(cursors).size).toBe(cursors.length);
  });

  it("REQ-CS-1: several changes to one row between two pulls arrive as one event with the current state", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const start = await bootstrapCursor(org);
    const id = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Primeiro nome",
    });
    await db
      .update(customer)
      .set({ name: "Segundo nome" })
      .where(eq(customer.id, id));
    await db
      .update(customer)
      .set({ name: "Nome final" })
      .where(eq(customer.id, id));

    const body = await pullSettled(org, { cursor: start });
    expect(labels(body.events)).toEqual([`customer:${id}:upsert`]);
    expect(
      z.object({ name: z.string() }).parse(body.events[0]?.payload).name,
    ).toBe("Nome final");
  });

  // -------------------------------------------------------------------------
  // REQ-CS-2
  // -------------------------------------------------------------------------

  it("REQ-CS-2: a hard-deleted row (a service) is a delete tombstone", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const serviceId = await seedService({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Calibração de teste",
    });
    const start = await bootstrapCursor(org);
    await db.delete(service).where(eq(service.id, serviceId));

    const body = await pullSettled(org, { cursor: start });
    expect(labels(body.events)).toEqual([`service:${serviceId}:delete`]);
    expect(body.events[0]?.resumeCursor).toMatch(/^v3\|\d+\|\d+$/);
  });

  it("REQ-CS-2: a soft-deleted asset is a delete tombstone carrying its deletedAt", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const { assetId } = await seedJobForOrg({
      orgId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    const start = await bootstrapCursor(org);
    const deletedAt = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
    await db.update(asset).set({ deletedAt }).where(eq(asset.id, assetId));

    const body = await pullSettled(org, { cursor: start });
    // A cursor can sit a little below the rows seeded before it (it is conservative while
    // another transaction is in flight): look at the asset's own events.
    expect(labels(only(body.events, "asset"))).toEqual([
      `asset:${assetId}:delete`,
    ]);
    expect(
      z.object({ deletedAt: z.string() }).parse(body.events[0]?.payload)
        .deletedAt,
    ).toBe(deletedAt.toISOString());
  });

  it("REQ-CS-2: a job moved to another unit is a delete for the desktop of the old unit and an upsert for the new one", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const [second] = await db
      .insert(organizationUnit)
      .values({
        organizationId: org.orgId,
        name: "Filial",
        slug: "filial",
        status: "ACTIVE",
        isDefault: false,
        createdBy: org.userId,
      })
      .returning({ id: organizationUnit.id });
    if (!second) throw new Error("unit seed failed");
    const { jobId } = await seedJobForOrg({
      orgId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    const startMatriz = await bootstrapCursor(org);
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const startFilialResponse = await syncRouter.request("/bootstrap", {
      method: "POST",
      headers: scopeHeaders(org, second.id),
      body: JSON.stringify({ protocolVersion: 3 }),
    });
    const startFilial = syncBootstrapPageResponseSchema.parse(
      await startFilialResponse.json(),
    ).syncCursor;

    await db
      .update(calibrationJob)
      .set({ unitId: second.id })
      .where(eq(calibrationJob.id, jobId));

    const matriz = await pullSettled(org, { cursor: startMatriz });
    expect(labels(only(matriz.events, "calibration_job"))).toEqual([
      `calibration_job:${jobId}:delete`,
    ]);

    const filial = await pullSettled(org, {
      cursor: startFilial,
      unitId: second.id,
    });
    expect(labels(only(filial.events, "calibration_job"))).toEqual([
      `calibration_job:${jobId}:upsert`,
    ]);
  });

  it("REQ-CS-2: reassigning a job to another technician is NOT a tombstone (the pull scope is the unit, not the technician)", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const { jobId } = await seedJobForOrg({
      orgId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    const start = await bootstrapCursor(org);
    await db
      .update(calibrationJob)
      .set({ technicianId: org.userId })
      .where(eq(calibrationJob.id, jobId));

    const body = await pullSettled(org, { cursor: start });
    expect(labels(only(body.events, "calibration_job"))).toEqual([
      `calibration_job:${jobId}:upsert`,
    ]);
  });

  it("REQ-CS-2: a delete of another laboratory's row never reaches this desktop", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const other = await seedOrg({
      orgId: OTHER,
      userId: "user-cs-b",
      role: "admin",
    });
    const foreign = await seedService({
      organizationId: other.orgId,
      unitId: other.unitId,
      name: "Do outro laboratório",
    });
    const start = await bootstrapCursor(org);
    await db.delete(service).where(eq(service.id, foreign));

    const body = await pullSettled(org, { cursor: start });
    expect(body.events).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // REQ-CS-3
  // -------------------------------------------------------------------------

  async function bootstrapPage(org: Org, token: string | null, limit: number) {
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const response = await syncRouter.request("/bootstrap", {
      method: "POST",
      headers: scopeHeaders(org),
      body: JSON.stringify({ protocolVersion: 3, pageToken: token, limit }),
    });
    return response;
  }

  function rowCountOf(page: z.infer<typeof syncBootstrapPageResponseSchema>) {
    return (
      page.publishedMethods.length +
      page.assetTypes.length +
      page.customers.length +
      page.assets.length +
      page.services.length +
      page.standards.length +
      (page.massCompositionProfiles?.length ?? 0) +
      page.environmentalLimits.length +
      page.jobs.length +
      page.serviceOrders.length
    );
  }

  it("REQ-CS-3: the bootstrap is cut into bounded pages that together carry every row exactly once, under one cursor", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const customerIds: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      customerIds.push(
        await seedCustomer({ labOrganizationId: org.orgId, name: `C${index}` }),
      );
    }
    const { jobId, assetId, serviceId } = await seedJobForOrg({
      orgId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });

    const pages: Array<z.infer<typeof syncBootstrapPageResponseSchema>> = [];
    let token: string | null = null;
    for (let index = 0; index < 20; index += 1) {
      const response = await bootstrapPage(org, token, 3);
      expect(response.status).toBe(200);
      const page = syncBootstrapPageResponseSchema.parse(await response.json());
      pages.push(page);
      expect(rowCountOf(page)).toBe(page.page.rowCount);
      expect(page.page.rowCount).toBeLessThanOrEqual(3);
      token = page.page.nextToken;
      if (token === null) break;
    }
    expect(token).toBeNull();
    expect(pages.length).toBeGreaterThan(2);
    expect(new Set(pages.map((page) => page.syncCursor)).size).toBe(1);

    const ids = (pick: (page: (typeof pages)[number]) => unknown[]) =>
      pages
        .flatMap(pick)
        .map((row) => z.object({ id: z.number() }).parse(row).id)
        .toSorted((a, b) => a - b);
    const jobCustomer = (
      await db.select({ id: calibrationJob.customerId }).from(calibrationJob)
    )[0]?.id;
    expect(ids((page) => page.customers)).toEqual(
      [
        ...customerIds,
        ...(jobCustomer === undefined ? [] : [jobCustomer]),
      ].toSorted((a, b) => a - b),
    );
    expect(ids((page) => page.jobs)).toEqual([jobId]);
    expect(ids((page) => page.assets)).toEqual([assetId]);
    expect(ids((page) => page.services)).toEqual([serviceId]);
  });

  it("REQ-CS-3: a row written while the bootstrap is in progress is not lost: the pull from its cursor brings it", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    for (let index = 0; index < 4; index += 1) {
      await seedCustomer({ labOrganizationId: org.orgId, name: `C${index}` });
    }
    const first = syncBootstrapPageResponseSchema.parse(
      await (await bootstrapPage(org, null, 2)).json(),
    );
    expect(first.page.nextToken).not.toBeNull();

    // A row of an entity the bootstrap has already walked past.
    const [type] = await db
      .insert(assetType)
      .values({ name: "Novo tipo", slug: "novo-tipo-cs", definition: [] })
      .returning({ id: assetType.id });
    if (!type) throw new Error("seed failed");

    let token = first.page.nextToken;
    for (let index = 0; index < 20 && token !== null; index += 1) {
      const page = syncBootstrapPageResponseSchema.parse(
        await (await bootstrapPage(org, token, 2)).json(),
      );
      token = page.page.nextToken;
    }
    const after = await pullAll(org, { cursor: first.syncCursor });
    expect(labels(after.events)).toContain(`asset_type:${type.id}:upsert`);
  });

  it("REQ-CS-3: the pages of one laboratory never carry another laboratory's rows", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const other = await seedOrg({
      orgId: OTHER,
      userId: "user-cs-b",
      role: "admin",
    });
    await seedCustomer({ labOrganizationId: org.orgId, name: "Meu" });
    const foreign = await seedCustomer({
      labOrganizationId: other.orgId,
      name: "Alheio",
    });
    const page = syncBootstrapPageResponseSchema.parse(
      await (await bootstrapPage(org, null, 50)).json(),
    );
    const customerIds = page.customers.map(
      (row) => z.object({ id: z.number() }).parse(row).id,
    );
    expect(customerIds).not.toContain(foreign);
    expect(customerIds.length).toBe(1);
  });

  it("REQ-CS-3: a page token that is not ours is refused, not guessed", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const response = await bootstrapPage(org, "not-a-token", 10);
    expect(response.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // REQ-CS-4
  // -------------------------------------------------------------------------

  it("REQ-CS-4: a pull without a protocol (desktops of protocol 1 and 2) keeps the updatedAt cursor and is marked deprecated", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const id = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Legado",
    });
    const response = await pull(org, {
      cursor: "1970-01-01T00:00:00.000Z",
      protocol: null,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    const body = syncPullResponseSchema.parse(await response.json());
    expect(labels(body.events)).toContain(`customer:${id}:upsert`);
    expect(body.cursor).not.toMatch(/^v3\|/);
  });

  it("REQ-CS-4: a protocol 3 pull with an updatedAt cursor, or with none, is told to bootstrap again (typed)", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const legacy = await pull(org, { cursor: "2026-01-01T00:00:00.000Z" });
    expect(legacy.status).toBe(409);
    const legacyBody = syncResyncRequiredResponseSchema.parse(
      await legacy.json(),
    );
    expect(legacyBody.code).toBe(SYNC_RESYNC_REQUIRED_CODE);
    expect(legacyBody.reason).toBe("cursor_format");

    const none = await pull(org, { cursor: null });
    expect(none.status).toBe(409);
    expect(
      syncResyncRequiredResponseSchema.parse(await none.json()).reason,
    ).toBe("no_cursor");
  });

  // -------------------------------------------------------------------------
  // REQ-CS-5
  // -------------------------------------------------------------------------

  it("REQ-CS-4: a bootstrap without a body (protocol 1 and 2) is the one unpaginated response, marked deprecated", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const id = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Legado",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const response = await syncRouter.request("/bootstrap", {
      method: "POST",
      headers: scopeHeaders(org),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    const raw: unknown = await response.json();
    expect(
      Object.keys(z.record(z.string(), z.unknown()).parse(raw)),
    ).not.toContain("page");
    const body = z
      .object({
        customers: z.array(z.object({ id: z.number() })),
        syncCursor: z.string().nullable(),
      })
      .parse(raw);
    expect(body.customers.map((row) => row.id)).toEqual([id]);
    // The legacy cursor stays an ISO timestamp: an old desktop can read it.
    expect(Number.isNaN(Date.parse(body.syncCursor ?? ""))).toBe(false);
  });

  it("REQ-CS-4: a push stating protocol 3 is accepted, a protocol newer than the cloud speaks is refused as before", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const push = (protocolVersion: number) =>
      syncRouter.request("/push", {
        method: "POST",
        headers: scopeHeaders(org),
        body: JSON.stringify({
          deviceId: "device-cs",
          clientBatchId: "batch-cs",
          baseCursor: null,
          protocolVersion,
          events: [],
        }),
      });
    expect((await push(3)).status).toBe(200);
    expect((await push(2)).status).toBe(200);
    expect((await push(4)).status).toBe(400);
  });

  it("REQ-CS-5: every log entry carries its laboratory and a pull reads only its own", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const other = await seedOrg({
      orgId: OTHER,
      userId: "user-cs-b",
      role: "admin",
    });
    const start = await bootstrapCursor(org);
    await seedCustomer({ labOrganizationId: org.orgId, name: "A" });
    await seedCustomer({ labOrganizationId: other.orgId, name: "B" });

    const mine = await logRows(org.orgId);
    expect(mine.length).toBe(1);
    expect(mine[0]?.organization_id).toBe(org.orgId);
    expect(mine[0]?.entity_type).toBe("customer");
    expect(mine[0]?.op).toBe("upsert");

    const body = await pullAll(org, { cursor: start });
    expect(body.events.length).toBe(1);
  });

  it("REQ-CS-5: the purge removes entries past the retention, keeps the recent ones and a pull still serves the cursors after the horizon", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const old = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Antigo",
    });
    await db.execute(
      sql`UPDATE sync_change_log SET changed_at = now() - interval '100 days' WHERE entity_id = ${old}`,
    );
    const recent = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Recente",
    });

    const result = await purgeSyncChangeLog({ retentionDays: 90 });
    expect(result.purged).toBe(1);

    const rows = await logRows(org.orgId);
    expect(rows.map((row) => Number(row.entity_id))).toEqual([recent]);
  });

  it("REQ-CS-5: a desktop whose cursor is older than the purge horizon is told to bootstrap again; one at or after it is served", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const staleCursor = await bootstrapCursor(org);
    const old = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Antigo",
    });
    await db.execute(
      sql`UPDATE sync_change_log SET changed_at = now() - interval '100 days' WHERE entity_id = ${old}`,
    );
    await seedCustomer({ labOrganizationId: org.orgId, name: "Recente" });
    await purgeSyncChangeLog({ retentionDays: 90 });

    const stale = await pull(org, { cursor: staleCursor });
    expect(stale.status).toBe(409);
    expect(
      syncResyncRequiredResponseSchema.parse(await stale.json()).reason,
    ).toBe("cursor_purged");

    // A desktop that bootstraps now holds a cursor after the horizon.
    await waitUntilServable(org.orgId);
    const fresh = await bootstrapCursor(org);
    const body = await pullSettled(org, { cursor: fresh });
    expect(body.events).toEqual([]);
  });

  it("REQ-CS-5: a purge with nothing old removes nothing and leaves every cursor valid", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    const cursor = await bootstrapCursor(org);
    await seedCustomer({ labOrganizationId: org.orgId, name: "Hoje" });
    expect((await purgeSyncChangeLog({ retentionDays: 90 })).purged).toBe(0);
    const body = await pullSettled(org, { cursor });
    expect(body.events.length).toBe(1);
  });

  it("REQ-CS-5: the log table is tenant data of its laboratory (organization_id NOT NULL, removed with the laboratory)", async () => {
    const org = await seedOrg({ orgId: ORG, role: "admin" });
    await seedCustomer({ labOrganizationId: org.orgId, name: "A" });
    const columns = getExecuteRows<{ is_nullable: string }>(
      await db.execute(
        sql`SELECT is_nullable FROM information_schema.columns
            WHERE table_name = 'sync_change_log' AND column_name = 'organization_id'`,
      ),
    );
    expect(columns[0]?.is_nullable).toBe("NO");
  });
});
