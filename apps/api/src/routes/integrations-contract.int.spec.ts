/**
 * integrations-contract.int.spec.ts: the cloud half of the integrations
 * endpoint definitions (`packages/contracts/src/endpoints/integrations.ts`).
 * The client-facing endpoints that need no call to an ERP are called for real
 * (real handlers, real middleware, real Postgres) and their bodies are parsed
 * with the response schema of their definition. `mount` also checks each body
 * with that schema in the integration tier (`checkEndpointResponses`), so a
 * drift fails the request itself; the explicit parse names the path and status.
 *
 * Covered elsewhere: the Conta Azul application endpoints and the OAuth start
 * (`integrations-conta-azul-app.int.spec.ts`). Not covered here: `validate`,
 * the catalog reads, the polls, `link-mdfe` and `refresh` (they call the ERP;
 * their bodies are typed at compile time against the same schemas).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { integrationEndpoints } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  integrationConnection,
  integrationObjectLink,
  integrationSyncItem,
  integrationSyncRun,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  normalizeGenericFinancialErpConfig,
} from "@calibra-facil/shared";
import { integrationsRouter } from "./integrations";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { withStatusRepair } from "../../test/integration/state-fixtures";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const ENV = {
  INTEGRATIONS_MASTER_KEY: Buffer.alloc(32, 3).toString("base64"),
  API_URL: "https://lab.example.com",
  APP_URL: "https://lab.example.com",
};

/** Parses with the definition's response schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

function request(path: string, method = "GET", body?: unknown) {
  return integrationsRouter.request(
    path,
    {
      method,
      headers: JSON_HEADERS,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    ENV,
  );
}

async function seedIntegration(params: {
  organizationId: string;
  userId: string;
  id: string;
  provider: "generic_http" | "conta_azul";
}) {
  await withStatusRepair((tx) =>
    tx.insert(organizationIntegration).values({
      id: params.id,
      organizationId: params.organizationId,
      type: "financial_erp",
      provider: params.provider,
      name: params.provider === "conta_azul" ? "Conta Azul" : "ERP financeiro",
      status: "ACTIVE",
      createdBy: params.userId,
      updatedBy: params.userId,
    }),
  );
  await db.insert(integrationConnection).values({
    id: `conn-${params.id}`,
    integrationId: params.id,
    organizationId: params.organizationId,
    credentialType: params.provider === "conta_azul" ? "oauth2" : "bearer",
    config:
      params.provider === "conta_azul"
        ? normalizeContaAzulConnectionConfig({
            enabledTargets: { paymentStatusPolling: true },
          })
        : normalizeGenericFinancialErpConfig({
            baseUrl: "https://erp.example.com",
          }),
    encryptedSecret: "dummy-encrypted",
    secretIv: "dummy-iv",
    createdBy: params.userId,
    updatedBy: params.userId,
  });
}

describe("integration endpoint definitions (cloud)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("answer the generic ERP reads and writes with their contract", async () => {
    const org = await seedOrg({ orgId: "org-int-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    await seedIntegration({
      organizationId: org.orgId,
      userId: org.userId,
      id: "int-generic",
      provider: "generic_http",
    });
    await withStatusRepair((tx) =>
      tx.insert(integrationSyncRun).values({
        id: "run-1",
        integrationId: "int-generic",
        organizationId: org.orgId,
        trigger: "manual",
        target: "customer",
        status: "FAILED",
        processedCount: 1,
        errorCount: 1,
        summary: { requestedLimit: 50 },
      }),
    );
    await withStatusRepair((tx) =>
      tx.insert(integrationSyncItem).values({
        id: "item-1",
        runId: "run-1",
        integrationId: "int-generic",
        organizationId: org.orgId,
        target: "customer",
        localEntityId: "7",
        operation: "upsert",
        status: "FAILED",
        attemptCount: 1,
        lastErrorMessage: "Documento inválido",
      }),
    );

    const list = await parsedBody(
      await request("/"),
      integrationEndpoints.list.response,
    );
    expect(list.data.map((row) => row.id)).toEqual(["int-generic"]);
    expect(list.data[0]?.recentRuns.map((run) => run.id)).toEqual(["run-1"]);

    await parsedBody(
      await request("/", "POST", {
        name: "Outro ERP",
        baseUrl: "https://other.example.com",
        authToken: "a-valid-auth-token",
      }),
      integrationEndpoints.create.response,
      201,
    );
    await parsedBody(
      await request("/int-generic", "PUT", { name: "ERP renomeado" }),
      integrationEndpoints.update.response,
    );
    const toggled = await parsedBody(
      await request("/int-generic/toggle", "POST", { enabled: false }),
      integrationEndpoints.toggle.response,
    );
    expect(toggled.data.find((row) => row.id === "int-generic")?.status).toBe(
      "DISABLED",
    );
    await parsedBody(
      await request("/int-generic/toggle", "POST", { enabled: true }),
      integrationEndpoints.toggle.response,
    );
    await parsedBody(
      await request("/int-generic/schedule", "POST", {
        target: "customer",
        mode: "scheduled",
        frequency: "weekly",
      }),
      integrationEndpoints.schedule.response,
    );
    const preview = await parsedBody(
      await request("/int-generic/sync/preview", "POST", {
        target: "customer",
      }),
      integrationEndpoints.previewSync.response,
    );
    expect(preview.target).toBe("customer");

    const items = await parsedBody(
      await request("/int-generic/runs/run-1/items"),
      integrationEndpoints.listRunItems.response,
    );
    expect(items.summary).toEqual({
      returnedCount: 1,
      statusCounts: { FAILED: 1 },
    });
    expect((await request("/int-generic/runs/missing/items")).status).toBe(404);
  });

  it("answer the drift queue and the Conta Azul reads with their contract", async () => {
    const org = await seedOrg({ orgId: "org-int-contract-ca", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    await seedIntegration({
      organizationId: org.orgId,
      userId: org.userId,
      id: "int-ca",
      provider: "conta_azul",
    });
    await db.insert(integrationObjectLink).values({
      id: "link-1",
      integrationId: "int-ca",
      organizationId: org.orgId,
      target: "customer",
      localEntityId: "7",
      remoteEntityId: "remote-7",
      metadata: {
        drift: {
          status: "remote_missing",
          checkedAt: "2026-02-01T10:00:00.000Z",
          reason: "Registro removido",
        },
      },
    });

    const queue = await parsedBody(
      await request("/drift?target=customer"),
      integrationEndpoints.listDrift.response,
    );
    expect(queue.data.map((row) => row.linkId)).toEqual(["link-1"]);
    await parsedBody(
      await request("/drift/link-1/acknowledge", "POST", {
        reason: "Removido de propósito",
      }),
      integrationEndpoints.acknowledgeDrift.response,
    );
    expect(
      (
        await parsedBody(
          await request("/drift"),
          integrationEndpoints.listDrift.response,
        )
      ).data,
    ).toEqual([]);

    await parsedBody(
      await request("/int-ca/conta-azul/schedule"),
      integrationEndpoints.getContaAzulSchedule.response,
    );
    await parsedBody(
      await request("/int-ca/conta-azul/config", "PUT", {
        defaultFinancialAccountId: "account-1",
        enabledTargets: { sales: true },
      }),
      integrationEndpoints.updateContaAzulConfig.response,
    );
    await parsedBody(
      await request("/conta-azul/app"),
      integrationEndpoints.getContaAzulApp.response,
    );
    await parsedBody(
      await request("/int-ca/conta-azul/disconnect", "POST"),
      integrationEndpoints.disconnectContaAzul.response,
    );
  });

  it("refuse a catalog the definition does not list", async () => {
    const org = await seedOrg({ orgId: "org-int-contract-cat", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    await seedIntegration({
      organizationId: org.orgId,
      userId: org.userId,
      id: "int-ca",
      provider: "conta_azul",
    });

    expect(
      (await request("/int-ca/conta-azul/catalog/not-a-catalog")).status,
    ).toBe(400);
  });
});
