import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { processIntegrationSync } from "./integrations";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import {
  seedCustomer,
  seedIntegration,
  seedOrg,
  seedSyncRun,
} from "../test/integration/seed";

// Real-DB integration tier for the worker's processIntegrationSync handler.
// processIntegrationSync(env, message) is a plain exported async fn (no CF/Vercel
// runtime); the "queue" is the app_queue_job / integration_sync_run Postgres
// table. We seed via drizzle, mock ONLY global fetch (the handler's single
// external boundary — callRemoteJson), and invoke the handler directly. The
// fetch mock records every outbound request and returns a remote id so the
// upsertLink + getExistingRemoteId reconciliation path exercises end-to-end.

type RecordedCall = { url: string; method: string; body: unknown };

function installFetchMock(): RecordedCall[] {
  const calls: RecordedCall[] = [];
  let remoteSeq = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const rawBody = typeof init?.body === "string" ? init.body : null;
      remoteSeq += 1;
      calls.push({
        url,
        method,
        body: rawBody ? JSON.parse(rawBody) : null,
      });
      return new Response(JSON.stringify({ id: `remote-${remoteSeq}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

// Drizzle's db.execute returns either a `{ rows }` shape (Neon-serverless) or a
// bare row array (postgres-js). Normalize to a plain unknown[] without any `as`
// assertion (banned by oxlint), then read fields through type-narrowing helpers.
function toRows(result: unknown): unknown[] {
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return Array.isArray(result) ? result : [];
}

function field(row: unknown, key: string): unknown {
  return row && typeof row === "object" && key in row
    ? Reflect.get(row, key)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

async function objectLinkRows() {
  const result = await db.execute(
    sql`SELECT integration_id, organization_id, target, local_entity_id, remote_entity_id
        FROM integration_object_link ORDER BY local_entity_id`,
  );
  return toRows(result).map((row) => {
    const remote = field(row, "remote_entity_id");
    return {
      integration_id: asString(field(row, "integration_id")),
      organization_id: asString(field(row, "organization_id")),
      target: asString(field(row, "target")),
      local_entity_id: asString(field(row, "local_entity_id")),
      remote_entity_id: typeof remote === "string" ? remote : null,
    };
  });
}

async function syncRunRow(runId: string) {
  const result = await db.execute(
    sql`SELECT status, processed_count, success_count, error_count
        FROM integration_sync_run WHERE id = ${runId}`,
  );
  const row = toRows(result)[0];
  return {
    status: asString(field(row, "status")),
    processed_count: field(row, "processed_count"),
    success_count: field(row, "success_count"),
    error_count: field(row, "error_count"),
  };
}

async function eventLogRows(integrationId: string) {
  const result = await db.execute(
    sql`SELECT event, level FROM integration_event_log
        WHERE integration_id = ${integrationId} ORDER BY created_at`,
  );
  return toRows(result).map((row) => ({
    event: asString(field(row, "event")),
    level: asString(field(row, "level")),
  }));
}

const INTEGRATION_A = "int-A";
const INTEGRATION_B = "int-B";

/**
 * Seed two fully isolated tenants (org-A, org-B), each with a generic_http
 * integration and its own customers. Returns the identifiers the assertions need.
 */
async function seedTwoTenants() {
  const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
  const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });

  await seedIntegration({
    integrationId: INTEGRATION_A,
    organizationId: orgA.orgId,
    createdBy: orgA.userId,
  });
  await seedIntegration({
    integrationId: INTEGRATION_B,
    organizationId: orgB.orgId,
    createdBy: orgB.userId,
  });

  const custA1 = await seedCustomer({
    labOrganizationId: orgA.orgId,
    name: "Alpha Cliente A1",
    taxId: "11111111000111",
  });
  const custA2 = await seedCustomer({
    labOrganizationId: orgA.orgId,
    name: "Alpha Cliente A2",
    taxId: "22222222000122",
  });
  const custB1 = await seedCustomer({
    labOrganizationId: orgB.orgId,
    name: "Beta Cliente B1",
    taxId: "99999999000199",
  });

  return { orgA, orgB, custA1, custA2, custB1 };
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("processIntegrationSync (worker real-DB integration)", () => {
  it("REQ-WORK-INT-001 cross-tenant isolation: only org-A entities are loaded, pushed, and linked", async () => {
    const { orgA, custA1, custA2, custB1 } = await seedTwoTenants();
    const calls = installFetchMock();

    const runId = "run-A-1";
    await seedSyncRun({
      runId,
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "customer",
    });

    await processIntegrationSync(makeTestEnv(), {
      type: "INTEGRATION_SYNC",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      runId,
      target: "customer",
      limit: 50,
      trigger: "manual",
    });

    // Exactly org-A's two customers were pushed (no more, no fewer).
    expect(calls).toHaveLength(2);
    const pushedExternalIds = calls
      .map((call) => {
        const body =
          call.body && typeof call.body === "object" ? call.body : {};
        return Object.fromEntries(Object.entries(body));
      })
      .map((body) => body.externalId);
    expect(new Set(pushedExternalIds)).toEqual(
      new Set([`customer:${custA1}`, `customer:${custA2}`]),
    );

    // org-B's customer NEVER appears in any outbound payload (no leak).
    expect(pushedExternalIds).not.toContain(`customer:${custB1}`);
    const serializedCalls = JSON.stringify(calls);
    expect(serializedCalls).toContain("Alpha Cliente A1");
    expect(serializedCalls).not.toContain("Beta Cliente B1");

    // Every object link belongs to org-A's integration; none reference org-B's entity.
    const links = await objectLinkRows();
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.integration_id).toBe(INTEGRATION_A);
      expect(link.organization_id).toBe(orgA.orgId);
    }
    const linkedLocalIds = links.map((link) => link.local_entity_id);
    expect(new Set(linkedLocalIds)).toEqual(
      new Set([`customer:${custA1}`, `customer:${custA2}`]),
    );
    expect(linkedLocalIds).not.toContain(`customer:${custB1}`);
    // No link row exists for org-B at all.
    expect(
      links.filter((link) => link.integration_id === INTEGRATION_B),
    ).toHaveLength(0);
  });

  it("REQ-WORK-INT-002 idempotency: a second identical sync upserts (one link per entity) and switches POST->PUT", async () => {
    const { orgA, custA1, custA2 } = await seedTwoTenants();

    // ---- First run: creates links via POST. ----
    const firstCalls = installFetchMock();
    const runId1 = "run-A-1";
    await seedSyncRun({
      runId: runId1,
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "customer",
    });
    await processIntegrationSync(makeTestEnv(), {
      type: "INTEGRATION_SYNC",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      runId: runId1,
      target: "customer",
      limit: 50,
      trigger: "manual",
    });

    expect(firstCalls).toHaveLength(2);
    expect(firstCalls.every((call) => call.method === "POST")).toBe(true);
    const linksAfterFirst = await objectLinkRows();
    expect(linksAfterFirst).toHaveLength(2);

    vi.unstubAllGlobals();

    // ---- Second identical run: must upsert (no duplicate links) and use PUT. ----
    const secondCalls = installFetchMock();
    const runId2 = "run-A-2";
    await seedSyncRun({
      runId: runId2,
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "customer",
    });
    await processIntegrationSync(makeTestEnv(), {
      type: "INTEGRATION_SYNC",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      runId: runId2,
      target: "customer",
      limit: 50,
      trigger: "manual",
    });

    // ON CONFLICT (integration_id, target, local_entity_id) -> still exactly one
    // link per entity, NOT four.
    const linksAfterSecond = await objectLinkRows();
    expect(linksAfterSecond).toHaveLength(2);
    expect(new Set(linksAfterSecond.map((link) => link.local_entity_id))).toEqual(
      new Set([`customer:${custA1}`, `customer:${custA2}`]),
    );

    // getExistingRemoteId found a remote id from run 1 -> the second run reconciles
    // with PUT, not a duplicate POST.
    expect(secondCalls).toHaveLength(2);
    expect(secondCalls.every((call) => call.method === "PUT")).toBe(true);
    // PUT targets the per-entity remote resource path (…/<remoteId>).
    for (const call of secondCalls) {
      expect(call.url).toMatch(/\/remote-\d+$/);
    }

    // Run-2 must itself be a CLEAN run. This is what proves the handler's UPSERT
    // (ON CONFLICT) path — not the schema's unique index — reconciled the
    // re-sync. If the ON CONFLICT key is broken, each per-record insert hits the
    // unique index and throws, the handler catches it per record, and run-1's
    // rows survive — so the link count stays 2 (the assertions above do NOT
    // catch it). These run-2 status assertions DO: error_count goes >0 and
    // success_count drops below 2 on an upsert regression.
    const run2 = await syncRunRow(runId2);
    expect(run2.status).toBe("COMPLETED");
    expect(Number(run2.success_count)).toBe(2);
    expect(Number(run2.error_count)).toBe(0);
  });

  it("happy-path: a clean sync writes a COMPLETED run + completion event log for org-A", async () => {
    const { orgA } = await seedTwoTenants();
    installFetchMock();

    const runId = "run-A-1";
    await seedSyncRun({
      runId,
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "customer",
    });

    await processIntegrationSync(makeTestEnv(), {
      type: "INTEGRATION_SYNC",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      runId,
      target: "customer",
      limit: 50,
      trigger: "manual",
    });

    const run = await syncRunRow(runId);
    expect(run?.status).toBe("COMPLETED");
    expect(Number(run?.processed_count)).toBe(2);
    expect(Number(run?.success_count)).toBe(2);
    expect(Number(run?.error_count)).toBe(0);

    const events = await eventLogRows(INTEGRATION_A);
    expect(events.some((event) => event.event === "sync.completed")).toBe(true);
  });
});
