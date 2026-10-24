import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  processIntegrationSync,
  processScheduledIntegrationSyncs,
  ScheduledIntegrationSyncError,
  type IntegrationSyncQueueMessage,
} from "@calibra-facil/jobs-core/integrations";
import { db, truncateAll } from "../test/integration/db";
import {
  asString,
  envAsApplicationRole,
  field,
  toRows,
} from "../test/integration/application-role";
import {
  seedCustomer,
  seedIntegration,
  seedOrg,
  seedSyncRun,
} from "../test/integration/seed";
import {
  pastIso,
  seedScheduledIntegration,
  seedSyncRunWithStatus,
} from "../test/integration/seed-scheduled-syncs";

/**
 * The generic_http ERP sync as `calibra_app` (P2-18j): every connection the
 * handlers open is a session of the application role, which the
 * `tenant_isolation` policies bind (migration 0123). The scheduler lists the
 * active integrations of every laboratory on the owner connection
 * (`DATABASE_OWNER_URL`, one statement) and everything else runs in a short
 * transaction that names the integration's laboratory; the remote HTTP call never
 * runs inside a transaction. If any statement ran without naming the laboratory
 * it would read nothing or be refused by WITH CHECK.
 *
 *   REQ-WRLS-INT-1  a sync as calibra_app pushes ONLY its own laboratory's customers and links them
 *   REQ-WRLS-INT-2  the other laboratory's run, customers and links are untouched
 *   REQ-WRLS-INT-3  no transaction is open while the remote ERP is being called
 *   REQ-WRLS-INT-4  a failing sync records FAILED + its event in its own laboratory
 *   REQ-WRLS-INT-5  the scheduler creates each due run in its own laboratory and skips a target with an active run
 *   REQ-WRLS-INT-6  one laboratory failing to schedule does not stop the others: its transaction rolls back, the
 *                   others are scheduled, and the sweep reports the failure at the end with what it did
 */

const INTEGRATION_A = "int-A";
const INTEGRATION_B = "int-B";

type RecordedCall = { url: string; body: unknown };

function installFetchMock(
  onCall: () => Promise<void> = async () => undefined,
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  let remoteSeq = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      await onCall();
      remoteSeq += 1;
      calls.push({
        url: typeof input === "string" ? input : String(input),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return new Response(JSON.stringify({ id: `remote-${remoteSeq}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

async function runStatus(runId: string): Promise<string> {
  const rows = toRows(
    await db.execute(
      sql`SELECT status FROM integration_sync_run WHERE id = ${runId}`,
    ),
  );
  return asString(field(rows[0], "status"));
}

async function links(integrationId: string): Promise<string[]> {
  return toRows(
    await db.execute(
      sql`SELECT local_entity_id FROM integration_object_link
          WHERE integration_id = ${integrationId} ORDER BY local_entity_id`,
    ),
  ).map((row) => asString(field(row, "local_entity_id")));
}

async function events(integrationId: string) {
  return toRows(
    await db.execute(
      sql`SELECT event, organization_id FROM integration_event_log
          WHERE integration_id = ${integrationId} ORDER BY created_at`,
    ),
  ).map((row) => ({
    event: asString(field(row, "event")),
    organizationId: asString(field(row, "organization_id")),
  }));
}

async function seedTwoLabs() {
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
  const customerA = await seedCustomer({
    labOrganizationId: orgA.orgId,
    name: "Alpha Cliente",
    taxId: "11111111000111",
  });
  const customerB = await seedCustomer({
    labOrganizationId: orgB.orgId,
    name: "Beta Cliente",
    taxId: "99999999000199",
  });
  return { orgA, orgB, customerA, customerB };
}

function messageFor(
  organizationId: string,
  integrationId: string,
  runId: string,
): IntegrationSyncQueueMessage {
  return {
    type: "INTEGRATION_SYNC",
    integrationId,
    organizationId,
    runId,
    target: "customer",
    limit: 50,
    trigger: "manual",
  };
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generic_http integration sync as calibra_app (P2-18j)", () => {
  it("REQ-WRLS-INT-1 REQ-WRLS-INT-2 [HIGH RISK] pushes only its own laboratory's customers; the other laboratory is untouched", async () => {
    const { orgA, orgB, customerA, customerB } = await seedTwoLabs();
    await seedSyncRun({
      runId: "run-A",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "customer",
    });
    await seedSyncRun({
      runId: "run-B",
      integrationId: INTEGRATION_B,
      organizationId: orgB.orgId,
      target: "customer",
    });
    const calls = installFetchMock();

    await processIntegrationSync(
      envAsApplicationRole(),
      messageFor(orgA.orgId, INTEGRATION_A, "run-A"),
    );

    expect(await runStatus("run-A")).toBe("COMPLETED");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls)).toContain("Alpha Cliente");
    expect(JSON.stringify(calls)).not.toContain("Beta Cliente");
    expect(await links(INTEGRATION_A)).toEqual([`customer:${customerA}`]);
    expect((await events(INTEGRATION_A)).map((e) => e.event)).toEqual([
      "sync.completed",
    ]);

    // Laboratory B: its run is still pending, nothing linked, nothing logged.
    expect(await runStatus("run-B")).toBe("PENDING");
    expect(await links(INTEGRATION_B)).toEqual([]);
    expect(await events(INTEGRATION_B)).toEqual([]);
    expect(customerB).toBeGreaterThan(0);
  });

  it("REQ-WRLS-INT-3 no transaction is open while the remote ERP is called", async () => {
    const { orgA } = await seedTwoLabs();
    await seedSyncRun({
      runId: "run-A",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "customer",
    });
    const openTransactions: number[] = [];
    installFetchMock(async () => {
      const rows = toRows(
        await db.execute(
          sql`SELECT count(*)::int AS open FROM pg_stat_activity
              WHERE datname = current_database()
                AND pid <> pg_backend_pid()
                AND state LIKE 'idle in transaction%'`,
        ),
      );
      openTransactions.push(Number(field(rows[0], "open")));
    });

    await processIntegrationSync(
      envAsApplicationRole(),
      messageFor(orgA.orgId, INTEGRATION_A, "run-A"),
    );

    expect(openTransactions).toHaveLength(1);
    expect(openTransactions).toEqual([0]);
  });

  it("REQ-WRLS-INT-4 a sync of an unknown integration fails: the run and its event are recorded in the laboratory", async () => {
    const { orgA, orgB } = await seedTwoLabs();
    await seedSyncRun({
      runId: "run-A",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "customer",
    });
    installFetchMock();

    // Laboratory B's integration id with laboratory A's message: fetchRuntime
    // names the laboratory too, so it finds nothing.
    await expect(
      processIntegrationSync(
        envAsApplicationRole(),
        messageFor(orgA.orgId, INTEGRATION_B, "run-A"),
      ),
    ).rejects.toThrow("Integração não encontrada");

    expect(await runStatus("run-A")).toBe("FAILED");
    expect(await events(INTEGRATION_B)).toEqual([
      { event: "sync.failed", organizationId: orgA.orgId },
    ]);
    expect(await links(INTEGRATION_B)).toEqual([]);
    expect(orgB.orgId).toBe("org-B");
  });

  it("REQ-WRLS-INT-5 the scheduler creates each due run in its own laboratory and skips a target with an active run", async () => {
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });
    await seedScheduledIntegration({
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      schedules: [
        {
          target: "customer",
          mode: "scheduled",
          nextScheduledRunAt: pastIso(),
        },
        {
          target: "service_order",
          mode: "scheduled",
          nextScheduledRunAt: pastIso(),
        },
      ],
    });
    await seedScheduledIntegration({
      integrationId: INTEGRATION_B,
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      schedules: [
        {
          target: "customer",
          mode: "scheduled",
          nextScheduledRunAt: pastIso(),
        },
      ],
    });
    // Laboratory A's service_order target is already running.
    await seedSyncRunWithStatus({
      runId: "run-A-active",
      integrationId: INTEGRATION_A,
      organizationId: orgA.orgId,
      target: "service_order",
      status: "RUNNING",
    });
    const dispatched: IntegrationSyncQueueMessage[] = [];

    const result = await processScheduledIntegrationSyncs(
      envAsApplicationRole(),
      {
        dispatch: async (message) => {
          dispatched.push(message);
        },
      },
    );

    expect(result.scheduledRuns).toBe(2);
    expect(
      dispatched
        .map((m) => `${m.organizationId}:${m.integrationId}:${m.target}`)
        .sort(),
    ).toEqual(["org-A:int-A:customer", "org-B:int-B:customer"]);

    const runs = toRows(
      await db.execute(
        sql`SELECT id, organization_id, integration_id, target, status
            FROM integration_sync_run ORDER BY organization_id, target`,
      ),
    ).map((row) => ({
      org: asString(field(row, "organization_id")),
      integration: asString(field(row, "integration_id")),
      target: asString(field(row, "target")),
      status: asString(field(row, "status")),
    }));
    expect(runs).toEqual([
      {
        org: "org-A",
        integration: "int-A",
        target: "customer",
        status: "PENDING",
      },
      {
        org: "org-A",
        integration: "int-A",
        target: "service_order",
        status: "RUNNING",
      },
      {
        org: "org-B",
        integration: "int-B",
        target: "customer",
        status: "PENDING",
      },
    ]);
  });

  it("REQ-WRLS-INT-6 [HIGH RISK] a laboratory whose run cannot be created does not stop the others, and the sweep reports it", async () => {
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });
    for (const [integrationId, org] of [
      [INTEGRATION_A, orgA],
      [INTEGRATION_B, orgB],
    ] as const) {
      await seedScheduledIntegration({
        integrationId,
        organizationId: org.orgId,
        createdBy: org.userId,
        schedules: [
          {
            target: "customer",
            mode: "scheduled",
            nextScheduledRunAt: pastIso(),
          },
        ],
      });
    }
    // Laboratory A's run row is refused by the database (a trigger of this test).
    await db.execute(sql`
      CREATE FUNCTION test_refuse_org_a_run() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test: laboratory A cannot create a run'; END $$`);
    await db.execute(sql`
      CREATE TRIGGER test_refuse_org_a_run BEFORE INSERT ON integration_sync_run
      FOR EACH ROW WHEN (NEW.organization_id = 'org-A') EXECUTE FUNCTION test_refuse_org_a_run()`);
    const configOf = async (integrationId: string) =>
      JSON.stringify(
        field(
          toRows(
            await db.execute(
              sql`SELECT config FROM integration_connection WHERE integration_id = ${integrationId}`,
            ),
          )[0],
          "config",
        ),
      );
    const configBefore = await configOf(INTEGRATION_A);
    const dispatched: IntegrationSyncQueueMessage[] = [];
    try {
      const failure = await processScheduledIntegrationSyncs(
        envAsApplicationRole(),
        {
          dispatch: async (message) => {
            dispatched.push(message);
          },
        },
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(ScheduledIntegrationSyncError);
      if (!(failure instanceof ScheduledIntegrationSyncError)) {
        throw new Error("the sweep did not report the failure");
      }
      expect(failure.failures.map((entry) => entry.organizationId)).toEqual([
        "org-A",
      ]);
      expect(failure.result.scheduledRuns).toBe(2);
    } finally {
      await db.execute(
        sql`DROP TRIGGER test_refuse_org_a_run ON integration_sync_run`,
      );
      await db.execute(sql`DROP FUNCTION test_refuse_org_a_run()`);
    }

    // Laboratory B was scheduled and dispatched; laboratory A has no run.
    expect(dispatched.map((message) => message.organizationId)).toEqual([
      "org-B",
    ]);
    const runs = toRows(
      await db.execute(
        sql`SELECT organization_id FROM integration_sync_run ORDER BY organization_id`,
      ),
    ).map((row) => asString(field(row, "organization_id")));
    expect(runs).toEqual(["org-B"]);
    // A's schedule advance rolled back with its failed run: its config is as seeded.
    expect(await configOf(INTEGRATION_A)).toBe(configBefore);
  });
});
