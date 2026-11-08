/**
 * integrations-dispatch.int.spec.ts: how the ERP integration routes decide what to run and what
 * to refuse, against a real Postgres and the real RBAC (only the session, the background queue
 * and the Conta Azul remote run are faked).
 *
 *   REQ-INTD-1  the list answers each integration with its provider's capabilities
 *   REQ-INTD-2  a sync run is dispatched by provider: Conta Azul starts its own run, a generic
 *               HTTP integration is queued as an INTEGRATION_SYNC row, and a Conta Azul run
 *               that cannot be dispatched is marked failed with the reason
 *   REQ-INTD-3  the items of a run come with their status counts
 *   REQ-INTD-4  targets only Conta Azul has (preview, schedule, retry of a legacy run) are
 *               refused for a generic HTTP integration
 *   REQ-INTD-5  the Conta Azul reads and polls need an ACTIVE connection (409), and the
 *               schedule state is Conta Azul's alone (404 otherwise)
 *   REQ-INTD-6  the Conta Azul config refuses modes the API does not support
 *   REQ-INTD-7  connecting fails as an actionable 503 when the stored application cannot be
 *               read (the laboratory's own "no application" answer is REQ-CAZAPP-006)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  appQueueJob,
  integrationConnection,
  integrationEventLog,
  integrationOAuthApp,
  integrationSyncItem,
  integrationSyncRun,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  normalizeGenericFinancialErpConfig,
} from "@calibra-facil/shared";
import { dispatchSyncRun, integrationsRouter } from "./integrations";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg, type SeededOrg } from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

const remote = vi.hoisted(() => ({ runIntegrationSync: vi.fn() }));

// The Conta Azul run talks to the remote API: it is the boundary of the sync.
vi.mock("../integrations/sync-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../integrations/sync-run")>()),
  runIntegrationSync: remote.runIntegrationSync,
}));

const ENV = { INTEGRATIONS_MASTER_KEY: Buffer.alloc(32).toString("base64") };
const JSON_HEADERS = { "content-type": "application/json" };

function call(path: string, method = "GET", body?: unknown) {
  return integrationsRouter.request(
    path,
    {
      method,
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    ENV,
  );
}

type Status = "ACTIVE" | "ACTION_REQUIRED" | "DISABLED";

async function seedIntegration(
  org: SeededOrg,
  provider: "generic_http" | "conta_azul",
  status: Status = "ACTIVE",
  withConnection = true,
) {
  const integrationId = `int-${org.orgId}-${provider}-${status}`;
  await withStatusRepair((tx) =>
    tx.insert(organizationIntegration).values({
      id: integrationId,
      organizationId: org.orgId,
      type: "financial_erp",
      provider,
      name: `ERP ${provider}`,
      status,
      createdBy: org.userId,
      updatedBy: org.userId,
    }),
  );
  if (withConnection) {
    await db.insert(integrationConnection).values({
      id: `conn-${integrationId}`,
      integrationId,
      organizationId: org.orgId,
      credentialType: provider === "conta_azul" ? "oauth2" : "bearer",
      config:
        provider === "conta_azul"
          ? normalizeContaAzulConnectionConfig({})
          : normalizeGenericFinancialErpConfig({
              baseUrl: "https://erp.example.com",
            }),
      encryptedSecret: "dummy-encrypted",
      secretIv: "dummy-iv",
      createdBy: org.userId,
      updatedBy: org.userId,
    });
  }
  return integrationId;
}

async function seedRun(
  org: SeededOrg,
  integrationId: string,
  id: string,
  target: (typeof integrationSyncRun.$inferInsert)["target"],
  status: (typeof integrationSyncRun.$inferInsert)["status"] = "COMPLETED",
) {
  await withStatusRepair((tx) =>
    tx.insert(integrationSyncRun).values({
      id,
      integrationId,
      organizationId: org.orgId,
      trigger: "manual",
      target,
      status,
      requestedLimit: 10,
    }),
  );
}

let org: SeededOrg;

beforeEach(async () => {
  await truncateAll();
  remote.runIntegrationSync.mockReset();
  remote.runIntegrationSync.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  org = await seedOrg({ orgId: "lab-a", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
});

describe("REQ-INTD-1: the list", () => {
  it("answers each integration with its provider's capabilities, configured or not", async () => {
    await seedIntegration(org, "conta_azul");
    await seedIntegration(org, "generic_http", "ACTION_REQUIRED", false);

    const res = await call("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    const byProvider = new Map<
      string,
      { overview: { readiness: { capabilities: Record<string, boolean> } } }
    >(body.data.map((row: { provider: string }) => [row.provider, row]));
    expect(
      byProvider.get("conta_azul")?.overview.readiness.capabilities,
    ).toMatchObject({
      canCreateReceivables: true,
      canReadReceivableStatus: true,
      canReadFiscalDocuments: true,
      canIssueFiscalDocuments: false,
      canUseWebhooks: false,
      requiresPolling: true,
    });
    expect(
      byProvider.get("generic_http")?.overview.readiness.capabilities,
    ).toMatchObject({
      canCreateCustomers: true,
      canCreateReceivables: true,
      canReadReceivableStatus: false,
      requiresPolling: false,
    });
  });
});

describe("REQ-INTD-2: dispatching a run", () => {
  const params = (
    integrationId: string,
    target: Parameters<typeof dispatchSyncRun>[0]["target"],
    runId: string,
  ) => ({
    env: ENV,
    integrationId,
    organizationId: org.orgId,
    runId,
    target,
    limit: 25,
    trigger: "manual" as const,
  });

  it.each(["billing_document", "catalog_item", "contract"] as const)(
    "starts the Conta Azul run for %s on its own path and queues nothing",
    async (target) => {
      // The in-process run is built on the worker's runtime configuration.
      const key = Buffer.alloc(32, 7).toString("base64");
      vi.stubEnv("R2_ACCESS_KEY_ID", "key");
      vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
      vi.stubEnv("R2_BUCKET_NAME", "documents");
      vi.stubEnv("R2_ENDPOINT", "http://s3:7070");
      vi.stubEnv("INTEGRATIONS_MASTER_KEY", key);
      vi.stubEnv("SIGNING_MASTER_KEY", key);
      const integrationId = await seedIntegration(org, "conta_azul");
      await seedRun(org, integrationId, "run-1", target, "PENDING");

      await expect(
        dispatchSyncRun(params(integrationId, target, "run-1")),
      ).resolves.toEqual({ queued: true, status: "PENDING" });

      // The run starts in process, after the answer.
      await vi.waitFor(() =>
        expect(remote.runIntegrationSync).toHaveBeenCalledWith(
          expect.objectContaining({
            integrationId,
            organizationId: org.orgId,
            runId: "run-1",
            target,
            limit: 25,
          }),
        ),
      );
      expect(await db.select().from(appQueueJob)).toEqual([]);
      vi.unstubAllEnvs();
    },
  );

  it("queues a generic HTTP run as an INTEGRATION_SYNC row of the database queue", async () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    try {
      const integrationId = await seedIntegration(org, "generic_http");
      await seedRun(org, integrationId, "run-1", "customer", "PENDING");

      await expect(
        dispatchSyncRun({
          ...params(integrationId, "customer", "run-1"),
          trigger: "retry",
        }),
      ).resolves.toEqual({ queued: true, status: "PENDING" });

      const rows = await db.select().from(appQueueJob);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("INTEGRATION_SYNC");
      expect(rows[0]?.payload).toEqual({
        type: "INTEGRATION_SYNC",
        integrationId,
        organizationId: org.orgId,
        runId: "run-1",
        target: "customer",
        limit: 25,
        trigger: "retry",
      });
      expect(remote.runIntegrationSync).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("marks a Conta Azul run failed, with the reason and the phase, when it cannot be dispatched", async () => {
    const integrationId = await seedIntegration(org, "conta_azul");
    await seedRun(org, integrationId, "run-1", "payable", "PENDING");

    // A limit the sync message refuses (not a number): the dispatch itself throws.
    await expect(
      dispatchSyncRun({
        ...params(integrationId, "payable", "run-1"),
        limit: Number.NaN,
        trigger: "scheduled",
      }),
    ).rejects.toThrow(/Refusing to start invalid Conta Azul sync/);

    const [run] = await db
      .select({
        status: integrationSyncRun.status,
        message: integrationSyncRun.errorSummary,
      })
      .from(integrationSyncRun)
      .where(eq(integrationSyncRun.id, "run-1"));
    expect(run?.status).toBe("FAILED");
    expect(run?.message).toMatch(/Refusing to start invalid Conta Azul sync/);
    const events = await db
      .select({ details: integrationEventLog.details })
      .from(integrationEventLog)
      .where(eq(integrationEventLog.organizationId, org.orgId));
    expect(JSON.stringify(events)).toContain("queue_send");
    expect(remote.runIntegrationSync).not.toHaveBeenCalled();
  });
});

describe("REQ-INTD-3: the items of a run", () => {
  it("lists the run's items with the count of each status, honoring the limit, and answers 404 for a missing integration", async () => {
    const integrationId = await seedIntegration(org, "conta_azul");
    await seedRun(org, integrationId, "run-1", "billing_document");
    for (const [id, status, error] of [
      ["item-1", "SUCCEEDED", null],
      ["item-2", "FAILED", "Cliente sem CPF/CNPJ válido"],
      ["item-3", "SUCCEEDED", null],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a few sequential inserts.
      await withStatusRepair((tx) =>
        tx.insert(integrationSyncItem).values({
          id,
          runId: "run-1",
          integrationId,
          organizationId: org.orgId,
          target: "billing_document",
          localEntityId: `bill-${id}`,
          operation: "upsert",
          status,
          attemptCount: 1,
          lastErrorCode: error ? "VALIDATION_ERROR" : null,
          lastErrorMessage: error,
        }),
      );
    }

    const res = await call(`/${integrationId}/runs/run-1/items?limit=2`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ runId: "run-1", target: "billing_document" });
    expect(body.data).toHaveLength(2);
    expect(body.summary.returnedCount).toBe(2);
    const statusCounts: Record<string, number> = body.summary.statusCounts;
    const counted = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(2);

    const all = await (await call(`/${integrationId}/runs/run-1/items`)).json();
    expect(all.summary.statusCounts).toEqual({ FAILED: 1, SUCCEEDED: 2 });
    expect(
      all.data.find((item: { id: string }) => item.id === "item-2"),
    ).toMatchObject({
      status: "FAILED",
      localEntityId: "bill-item-2",
      lastErrorCode: "VALIDATION_ERROR",
    });

    const missing = await call("/int-missing/runs/run-1/items");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Integração não encontrada",
      code: "integration_not_found",
    });
  });
});

describe("REQ-INTD-4: targets only Conta Azul has", () => {
  it("are refused for a generic HTTP integration: preview, schedule, and the retry of a legacy run", async () => {
    const integrationId = await seedIntegration(org, "generic_http");
    await seedRun(org, integrationId, "run-legacy", "supplier", "FAILED");

    const preview = await call(`/${integrationId}/sync/preview`, "POST", {
      target: "catalog_item",
      limit: 10,
    });
    const schedule = await call(`/${integrationId}/schedule`, "POST", {
      target: "payable",
      mode: "scheduled",
      frequency: "daily",
    });
    const retry = await call(`/${integrationId}/runs/run-legacy/retry`, "POST");

    for (const response of [preview, schedule, retry]) {
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "suportado apenas pelo provider Conta Azul",
      );
    }
    // Nothing was scheduled or started.
    expect(
      await db
        .select({ id: integrationSyncRun.id })
        .from(integrationSyncRun)
        .where(eq(integrationSyncRun.integrationId, integrationId)),
    ).toHaveLength(1);
  });
});

describe("REQ-INTD-5: the Conta Azul connection must be active", () => {
  it("blocks a manual poll while the connection needs action and the reference loading while it is disabled", async () => {
    const needsAction = await seedIntegration(
      org,
      "conta_azul",
      "ACTION_REQUIRED",
    );
    const disabled = await seedIntegration(org, "conta_azul", "DISABLED");

    const poll = await call(`/${needsAction}/conta-azul/poll`, "POST", {
      limit: 10,
    });
    const catalog = await call(`/${disabled}/conta-azul/catalog/accounts`);

    for (const response of [poll, catalog]) {
      expect(response.status).toBe(409);
      expect(await response.text()).toContain(
        "precisa estar ativa para esta operação",
      );
    }
  });

  it("answers the schedule state of an active Conta Azul integration, 404 for another provider and 409 when it is not active", async () => {
    const active = await seedIntegration(org, "conta_azul");
    const needsAction = await seedIntegration(
      org,
      "conta_azul",
      "ACTION_REQUIRED",
    );
    const generic = await seedIntegration(org, "generic_http");

    const ok = await call(`/${active}/conta-azul/schedule`);
    expect(ok.status).toBe(200);
    const state = await ok.json();
    for (const key of [
      "paymentStatusPolling",
      "payables",
      "fiscalDocuments",
      "protocols",
      "driftChecks",
    ]) {
      expect(typeof state[key].enabled, key).toBe("boolean");
      expect(typeof state[key].intervalMinutes, key).toBe("number");
    }

    expect((await call(`/${generic}/conta-azul/schedule`)).status).toBe(404);
    const inactive = await call(`/${needsAction}/conta-azul/schedule`);
    expect(inactive.status).toBe(409);
    expect(await inactive.text()).toContain(
      "precisa estar ativa para esta operação",
    );
  });
});

describe("REQ-INTD-6: the Conta Azul config", () => {
  it("refuses budget write and fiscal issuance modes the API does not support", async () => {
    const integrationId = await seedIntegration(org, "conta_azul");
    const before = await db
      .select({ config: integrationConnection.config })
      .from(integrationConnection)
      .where(eq(integrationConnection.integrationId, integrationId));

    const res = await call(`/${integrationId}/conta-azul/config`, "PUT", {
      budgetMode: "native_api_write_verified",
      fiscalMode: "issuance_supported",
    });

    expect(res.status).toBe(400);
    expect(
      await db
        .select({ config: integrationConnection.config })
        .from(integrationConnection)
        .where(eq(integrationConnection.integrationId, integrationId)),
    ).toEqual(before);
  });
});

describe("REQ-INTD-7: connecting without a readable application", () => {
  it("answers 503 conta_azul_oauth_unavailable, with the actionable message, when the stored secret cannot be decrypted", async () => {
    await db.insert(integrationOAuthApp).values({
      id: "app-lab-a",
      organizationId: org.orgId,
      provider: "conta_azul",
      clientId: "client-id",
      encryptedClientSecret: "dummy-encrypted",
      clientSecretIv: "dummy-iv",
      clientSecretLast4: "cret",
    });

    // The server has no INTEGRATIONS_MASTER_KEY: the stored secret cannot be opened.
    const res = await integrationsRouter.request(
      "/conta-azul/oauth/start",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ returnTo: "/dashboard/settings/integrations" }),
      },
      {},
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("conta_azul_oauth_unavailable");
    expect(body.error).toMatch(/INTEGRATIONS_MASTER_KEY/);
  });
});
