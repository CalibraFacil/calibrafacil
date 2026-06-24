import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { normalizeGenericFinancialErpConfig } from "@calibra-facil/shared";
import type { IntegrationSyncTarget } from "@calibra-facil/shared";
import {
  processScheduledIntegrationSyncs,
  type IntegrationSyncQueueMessage,
} from "./integrations";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import {
  futureIso,
  pastIso,
  seedScheduledIntegration,
  seedSyncRunWithStatus,
} from "../test/integration/seed-scheduled-syncs";

// Real-DB integration tier for the worker's processScheduledIntegrationSyncs
// handler — the cron that scans organization_integration, advances per-target
// schedules, and dispatches a sync run for each DUE target. The handler takes its
// world via an injected `env` (raw pg.Client keyed on DATABASE_URL) plus an
// INJECTABLE `options.dispatch` seam (integrations.ts:38, 922). We pass a vi.fn()
// spy as `dispatch` so we observe WHICH targets the scheduler chose WITHOUT
// running the full sync. State (integration config schedules, sync-run rows) lives
// in Postgres; we seed via drizzle and re-query the real rows after the run.
//
// No global fetch mock is needed here: with an injected dispatch the scheduler
// never calls processIntegrationSync (which is the only thing that would touch
// the network). The scheduler's own work is pure DB: read schedules, advance the
// due target's config, INSERT the sync-run row, then hand the message to dispatch.

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

/**
 * Re-read a target's persisted `nextScheduledRunAt` straight out of the
 * integration_connection.config JSONB. Normalizing through the same function the
 * handler uses keeps us reading the same shape the scheduler wrote.
 */
async function nextScheduledRunAt(
  integrationId: string,
  target: IntegrationSyncTarget,
): Promise<string | null> {
  const result = await db.execute(
    sql`SELECT config FROM integration_connection WHERE integration_id = ${integrationId}`,
  );
  const row = toRows(result)[0];
  const rawConfig = field(row, "config");
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error(`no config row for integration ${integrationId}`);
  }
  // The JSONB column round-trips as a plain object; normalize it to read the
  // per-target schedule with no `as`.
  const baseUrl = field(rawConfig, "baseUrl");
  const schedules = field(rawConfig, "schedules");
  const config = normalizeGenericFinancialErpConfig({
    baseUrl: typeof baseUrl === "string" ? baseUrl : "https://erp.example.test",
    schedules:
      schedules && typeof schedules === "object" ? schedules : undefined,
  });
  return config.schedules[target].nextScheduledRunAt;
}

/** Count sync-run rows the scheduler created for a given target. */
async function syncRunCount(
  integrationId: string,
  target: IntegrationSyncTarget,
): Promise<number> {
  const result = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM integration_sync_run
        WHERE integration_id = ${integrationId} AND target = ${target}`,
  );
  const n = field(toRows(result)[0], "n");
  return typeof n === "number" ? n : Number(n ?? 0);
}

/** Every (integrationId, target, organizationId) the dispatch spy was handed. */
function dispatchedKeys(
  spy: ReturnType<typeof vi.fn>,
): Array<{ integrationId: string; target: string; organizationId: string }> {
  return spy.mock.calls.map((call) => {
    const message: unknown = call[0];
    return {
      integrationId: String(field(message, "integrationId")),
      target: String(field(message, "target")),
      organizationId: String(field(message, "organizationId")),
    };
  });
}

const INTEGRATION_A = "int-A";
const INTEGRATION_B = "int-B";

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processScheduledIntegrationSyncs (worker real-DB integration)", () => {
  it("REQ-WSS-001 no double-dispatch: a target with an ACTIVE run is skipped while a genuinely-due target is dispatched", async () => {
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    // customer: DUE (scheduled + past) but already has a RUNNING run -> must be skipped.
    // service_order: DUE (scheduled + past), no active run -> must be dispatched.
    await seedScheduledIntegration({
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      schedules: [
        { target: "customer", mode: "scheduled", nextScheduledRunAt: pastIso() },
        {
          target: "service_order",
          mode: "scheduled",
          nextScheduledRunAt: pastIso(),
        },
      ],
    });
    // An in-flight RUNNING run for the customer target.
    await seedSyncRunWithStatus({
      runId: "active-customer-run",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "customer",
      status: "RUNNING",
    });

    const dispatch = vi.fn(async (_message: IntegrationSyncQueueMessage) => {});

    const result = await processScheduledIntegrationSyncs(makeTestEnv(), {
      dispatch,
    });

    const keys = dispatchedKeys(dispatch);
    const dispatchedTargets = keys.map((k) => k.target);

    // The genuinely-due target IS dispatched.
    expect(dispatchedTargets).toContain("service_order");
    // The active-run target is NOT dispatched (hasActiveTargetRun suppressed it).
    expect(dispatchedTargets).not.toContain("customer");
    expect(result.scheduledRuns).toBe(1);

    // And the suppression is real at the DB level: no NEW customer run was
    // created — only the pre-seeded RUNNING one survives.
    expect(await syncRunCount(INTEGRATION_A, "customer")).toBe(1);
    // Exactly one service_order run was created by the scheduler.
    expect(await syncRunCount(INTEGRATION_A, "service_order")).toBe(1);
  });

  it("REQ-WSS-002 schedule advance: a due target is dispatched exactly once and its next_scheduled_run_at advances", async () => {
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    await seedScheduledIntegration({
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      schedules: [
        {
          target: "customer",
          mode: "scheduled",
          frequency: "daily",
          nextScheduledRunAt: pastIso(),
        },
      ],
    });

    const before = await nextScheduledRunAt(INTEGRATION_A, "customer");
    expect(before).toBe(pastIso());

    const dispatch = vi.fn(async (_message: IntegrationSyncQueueMessage) => {});

    const result = await processScheduledIntegrationSyncs(makeTestEnv(), {
      dispatch,
    });

    // Dispatched exactly once, for the customer target.
    const keys = dispatchedKeys(dispatch);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.target).toBe("customer");
    expect(keys[0]?.integrationId).toBe(INTEGRATION_A);
    expect(result.scheduledRuns).toBe(1);

    // The persisted schedule advanced: next_scheduled_run_at moved off the past
    // value to a future-of-now (now+1 day) timestamp.
    const after = await nextScheduledRunAt(INTEGRATION_A, "customer");
    expect(after).not.toBe(before);
    expect(after).not.toBeNull();
    expect(new Date(String(after)).getTime()).toBeGreaterThan(Date.now());

    // Exactly one sync-run row was created for the advanced target.
    expect(await syncRunCount(INTEGRATION_A, "customer")).toBe(1);
  });

  it("REQ-WSS-003 per-tenant scan: each org's due target is dispatched under its OWN organizationId", async () => {
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });

    await seedScheduledIntegration({
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      schedules: [
        { target: "customer", mode: "scheduled", nextScheduledRunAt: pastIso() },
      ],
    });
    await seedScheduledIntegration({
      integrationId: INTEGRATION_B,
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      schedules: [
        {
          target: "billing_document",
          mode: "scheduled",
          nextScheduledRunAt: pastIso(),
        },
      ],
    });

    const dispatch = vi.fn(async (_message: IntegrationSyncQueueMessage) => {});
    await processScheduledIntegrationSyncs(makeTestEnv(), { dispatch });

    const keys = dispatchedKeys(dispatch);
    expect(keys).toHaveLength(2);

    // org-A's integration dispatched under org-A; never under org-B.
    const aKey = keys.find((k) => k.integrationId === INTEGRATION_A);
    const bKey = keys.find((k) => k.integrationId === INTEGRATION_B);
    expect(aKey?.organizationId).toBe(orgA.orgId);
    expect(aKey?.target).toBe("customer");
    expect(bKey?.organizationId).toBe(orgB.orgId);
    expect(bKey?.target).toBe("billing_document");

    // No message carries the wrong org for its integration.
    for (const key of keys) {
      const expectedOrg =
        key.integrationId === INTEGRATION_A ? orgA.orgId : orgB.orgId;
      expect(key.organizationId).toBe(expectedOrg);
    }

    // And each org's sync-run row is scoped to that org (no cross-tenant rows).
    const aRuns = await db.execute(
      sql`SELECT organization_id FROM integration_sync_run WHERE integration_id = ${INTEGRATION_A}`,
    );
    for (const row of toRows(aRuns)) {
      expect(String(field(row, "organization_id"))).toBe(orgA.orgId);
    }
    const bRuns = await db.execute(
      sql`SELECT organization_id FROM integration_sync_run WHERE integration_id = ${INTEGRATION_B}`,
    );
    for (const row of toRows(bRuns)) {
      expect(String(field(row, "organization_id"))).toBe(orgB.orgId);
    }
  });

  it("happy-path: a clean cron pass dispatches every due target, advances their schedules, and leaves active-run + not-due targets alone", async () => {
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    await seedScheduledIntegration({
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      schedules: [
        // DUE -> dispatched + advanced.
        { target: "customer", mode: "scheduled", nextScheduledRunAt: pastIso() },
        // DUE but ACTIVE run exists -> skipped, NOT advanced.
        {
          target: "service_order",
          mode: "scheduled",
          nextScheduledRunAt: pastIso(),
        },
        // scheduled but NOT yet due (future) -> skipped, NOT advanced.
        {
          target: "billing_document",
          mode: "scheduled",
          nextScheduledRunAt: futureIso(),
        },
      ],
    });
    await seedSyncRunWithStatus({
      runId: "active-so-run",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "service_order",
      status: "PENDING",
    });

    const soBefore = await nextScheduledRunAt(INTEGRATION_A, "service_order");
    const billingBefore = await nextScheduledRunAt(
      INTEGRATION_A,
      "billing_document",
    );

    const dispatch = vi.fn(async (_message: IntegrationSyncQueueMessage) => {});
    const result = await processScheduledIntegrationSyncs(makeTestEnv(), {
      dispatch,
    });

    // Only the genuinely-due customer target ran.
    const dispatchedTargets = dispatchedKeys(dispatch).map((k) => k.target);
    expect(dispatchedTargets).toEqual(["customer"]);
    expect(result.scheduledRuns).toBe(1);

    // customer schedule advanced into the future.
    const customerAfter = await nextScheduledRunAt(INTEGRATION_A, "customer");
    expect(customerAfter).not.toBe(pastIso());
    expect(new Date(String(customerAfter)).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // service_order (active run) and billing_document (not due) are UNCHANGED.
    expect(await nextScheduledRunAt(INTEGRATION_A, "service_order")).toBe(
      soBefore,
    );
    expect(await nextScheduledRunAt(INTEGRATION_A, "billing_document")).toBe(
      billingBefore,
    );

    // Exactly one new run (customer); the active service_order run count is
    // unchanged (1, the pre-seeded one) and billing has none.
    expect(await syncRunCount(INTEGRATION_A, "customer")).toBe(1);
    expect(await syncRunCount(INTEGRATION_A, "service_order")).toBe(1);
    expect(await syncRunCount(INTEGRATION_A, "billing_document")).toBe(0);
  });
});
