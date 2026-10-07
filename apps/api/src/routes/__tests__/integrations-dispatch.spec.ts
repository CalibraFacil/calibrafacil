import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { dispatchSyncRun, integrationsRouter } from "../integrations";
import type { AuthVariables } from "../../middleware/permission";
import type { IntegrationOverview } from "../../lib/integrations";
import {
  getProviderCapabilities,
  normalizeContaAzulConnectionConfig,
  type IntegrationTargetSyncSummary,
} from "@calibra-facil/shared";
import {
  buildContaAzulAuthorizationUrl,
  CONTA_AZUL_APP_MISSING_MESSAGE,
  ContaAzulAppMissingError,
} from "../../lib/conta-azul-oauth";
import { requireContaAzulOAuthConfig } from "../../lib/conta-azul-app";

const mocks = vi.hoisted(() => ({
  db: {
    query: {
      integrationSyncItem: {
        findMany: vi.fn(),
      },
      integrationSyncRun: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      integrationEventLog: {
        findMany: vi.fn(),
      },
    },
  },
  buildIntegrationOverview: vi.fn(),
  enqueueBackgroundJob: vi.fn(),
  failIntegrationSyncRun: vi.fn(),
  getContaAzulScheduleState: vi.fn(),
  getIntegrationRecord: vi.fn(),
  listOrganizationIntegrations: vi.fn(),
  listContaAzulCatalog: vi.fn(),
  passMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
  pollContaAzulBillingStatus: vi.fn(),
  previewIntegrationSync: vi.fn(),
  updateTargetScheduleConfig: vi.fn(),
}));

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueueBackgroundJob,
}));

vi.mock("../../lib/integrations", () => ({
  buildEmptyRemoteDocumentSummary: vi.fn(),
  buildGenericConnectionConfig: vi.fn(),
  buildInitialNextScheduledRunAt: vi.fn(),
  buildIntegrationOverview: mocks.buildIntegrationOverview,
  createSyncRun: vi.fn(),
  decryptIntegrationSecret: vi.fn(),
  encryptIntegrationSecret: vi.fn(),
  failIntegrationSyncRun: mocks.failIntegrationSyncRun,
  failSyncRunAsBlocked: vi.fn(),
  getContaAzulScheduleState: mocks.getContaAzulScheduleState,
  getIntegrationRecord: mocks.getIntegrationRecord,
  getRequestedLimitFromRun: vi.fn(),
  getTargetScheduleConfig: vi.fn(),
  hasActiveSyncRun: vi.fn(),
  linkContaAzulFiscalDocumentsToMdfe: vi.fn(),
  listContaAzulCatalog: mocks.listContaAzulCatalog,
  listOrganizationIntegrations: mocks.listOrganizationIntegrations,
  pollContaAzulBillingStatus: mocks.pollContaAzulBillingStatus,
  pollContaAzulFiscalDocuments: vi.fn(),
  pollContaAzulPayableStatus: vi.fn(),
  pollContaAzulProtocols: vi.fn(),
  pollContaAzulRemoteDrift: vi.fn(),
  previewIntegrationSync: mocks.previewIntegrationSync,
  updateTargetScheduleConfig: mocks.updateTargetScheduleConfig,
  validateContaAzulConnection: vi.fn(),
  validateGenericConnection: vi.fn(),
  writeIntegrationEvent: vi.fn(),
  writeOrganizationIntegrationEvent: vi.fn(),
}));

vi.mock("../../lib/conta-azul-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/conta-azul-oauth")>()),
  buildContaAzulAuthorizationUrl: vi.fn(),
  buildContaAzulRefreshFailurePolicy: vi.fn(),
  exchangeContaAzulAuthorizationCode: vi.fn(),
  parseContaAzulTokenBundle: vi.fn(),
  refreshContaAzulAccessToken: vi.fn(),
  serializeContaAzulTokenBundle: vi.fn(),
  verifyContaAzulOAuthState: vi.fn(),
}));

vi.mock("../../lib/conta-azul-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/conta-azul-app")>()),
  requireContaAzulOAuthConfig: vi.fn(),
  resolveContaAzulOAuthConfig: vi.fn(),
}));

vi.mock("../../middleware/permission", () => ({
  requireLabProtected: [mocks.passMiddleware],
  requireOrgType: () => mocks.passMiddleware,
  requireRole: () => mocks.passMiddleware,
}));

vi.mock("@calibra-facil/db", () => ({
  db: mocks.db,
}));

vi.mock("@calibra-facil/db/schema", () => ({
  integrationConnection: {},
  integrationEventLog: {},
  integrationSyncItem: {},
  integrationSyncRun: {},
  organizationIntegration: {},
}));

const env = {
  INTEGRATIONS_MASTER_KEY: "test-master-key",
};

function createTestApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    c.set("member", {
      id: "member-1",
      role: "admin",
      organizationId: "org-1",
      organizationType: "LAB",
      userId: "user-1",
      activeUnitId: null,
      activeUnitName: null,
      accessibleUnitIds: [],
      accessibleUnits: [],
      selectedUnitScope: "all",
      canAccessAllUnits: true,
      unitRole: null,
    });
    c.set("session", {
      user: {
        id: "user-1",
        name: "Admin",
        email: "admin@example.test",
        emailVerified: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      session: {
        id: "session-1",
        userId: "user-1",
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        token: "session-token",
      },
    });

    await next();
  });
  app.route("/api/integrations", integrationsRouter);

  return app;
}

function emptyOverview(
  provider: "generic_http" | "conta_azul",
): IntegrationOverview {
  const targets: IntegrationTargetSyncSummary[] = [];

  return {
    readiness: {
      setupStatus: "CONFIGURED",
      readinessStatus: "READY",
      capabilities: getProviderCapabilities(provider),
      validationRequired: false,
      canSync: true,
      lastValidatedAt: null,
      lastValidationError: null,
      dependencyWarnings: [],
    },
    targets,
    remoteDocuments: {
      totalCount: 0,
      availableCount: 0,
      unavailableCount: 0,
      salePdfCount: 0,
      fiscalXmlCount: 0,
      otherCount: 0,
      lastSyncedAt: null,
    },
    syncSummary: {
      lastRunAt: null,
      lastSuccessfulRunAt: null,
      lastErrorAt: null,
      hasRecentFailures: false,
    },
  };
}

describe("integrations list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.query.integrationSyncRun.findMany.mockResolvedValue([]);
    mocks.db.query.integrationEventLog.findMany.mockResolvedValue([]);
  });

  it("includes provider capabilities in the readiness payload", async () => {
    mocks.listOrganizationIntegrations.mockResolvedValue([
      {
        id: "int-1",
        type: "financial_erp",
        provider: "conta_azul",
        name: "Conta Azul",
        status: "ACTIVE",
        organizationId: "org-1",
        lastValidatedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastValidationError: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        connection: {
          id: "connection-1",
          credentialType: "oauth2",
          config: normalizeContaAzulConnectionConfig({}),
        },
      },
    ]);
    mocks.buildIntegrationOverview.mockResolvedValue(
      emptyOverview("conta_azul"),
    );

    const res = await createTestApp().request("/api/integrations");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      data: [
        {
          overview: {
            readiness: {
              capabilities: {
                canCreateReceivables: true,
                canReadReceivableStatus: true,
                canReadFiscalDocuments: true,
                canIssueFiscalDocuments: false,
                canUseWebhooks: false,
                requiresPolling: true,
              },
            },
          },
        },
      ],
    });
  });

  it("adds capabilities for integrations that are not configured yet", async () => {
    mocks.listOrganizationIntegrations.mockResolvedValue([
      {
        id: "int-1",
        type: "financial_erp",
        provider: "generic_http",
        name: "ERP",
        status: "ACTION_REQUIRED",
        organizationId: "org-1",
        lastValidatedAt: null,
        lastValidationError: "Configuração pendente",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        connection: null,
      },
    ]);

    const res = await createTestApp().request("/api/integrations");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mocks.buildIntegrationOverview).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      data: [
        {
          overview: {
            readiness: {
              capabilities: {
                canCreateCustomers: true,
                canCreateReceivables: true,
                canReadReceivableStatus: false,
                requiresPolling: false,
              },
            },
          },
        },
      ],
    });
  });
});

describe("dispatchSyncRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues Conta Azul sync with the native provider marker", async () => {
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        provider: "conta_azul",
      },
    });
    mocks.enqueueBackgroundJob.mockResolvedValue({
      messageId: "queued-conta-azul-1",
    });

    await expect(
      dispatchSyncRun({
        env,
        integrationId: "int-1",
        organizationId: "org-1",
        runId: "run-1",
        target: "billing_document",
        limit: 50,
        trigger: "manual",
      }),
    ).resolves.toEqual({
      queued: true,
      status: "PENDING",
    });

    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(
      {
        type: "INTEGRATION_SYNC",
        provider: "conta_azul",
        integrationId: "int-1",
        organizationId: "org-1",
        runId: "run-1",
        target: "billing_document",
        limit: 50,
        trigger: "manual",
      },
      {
        idempotencyKey: "conta-azul-sync-run-1",
      },
    );
  });

  it.each(["catalog_item", "contract"] as const)(
    "queues Conta Azul %s sync through the native queue path",
    async (target) => {
      mocks.getIntegrationRecord.mockResolvedValue({
        integration: {
          provider: "conta_azul",
        },
      });
      mocks.enqueueBackgroundJob.mockResolvedValue({
        messageId: `queued-${target}`,
      });

      await expect(
        dispatchSyncRun({
          env,
          integrationId: "int-1",
          organizationId: "org-1",
          runId: `run-${target}`,
          target,
          limit: 20,
          trigger: "manual",
        }),
      ).resolves.toEqual({
        queued: true,
        status: "PENDING",
      });

      expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(
        {
          type: "INTEGRATION_SYNC",
          provider: "conta_azul",
          integrationId: "int-1",
          organizationId: "org-1",
          runId: `run-${target}`,
          target,
          limit: 20,
          trigger: "manual",
        },
        {
          idempotencyKey: `conta-azul-sync-run-${target}`,
        },
      );
    },
  );

  it("keeps generic HTTP sync on the existing background queue path", async () => {
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        provider: "generic_http",
      },
    });
    mocks.enqueueBackgroundJob.mockResolvedValue({
      messageId: "queued-1",
    });

    await expect(
      dispatchSyncRun({
        env,
        integrationId: "int-1",
        organizationId: "org-1",
        runId: "run-1",
        target: "customer",
        limit: 25,
        trigger: "retry",
      }),
    ).resolves.toEqual({
      queued: true,
      status: "PENDING",
    });

    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith({
      type: "INTEGRATION_SYNC",
      integrationId: "int-1",
      organizationId: "org-1",
      runId: "run-1",
      target: "customer",
      limit: 25,
      trigger: "retry",
    });
  });

  it("marks Conta Azul run failed when native queue dispatch fails", async () => {
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        provider: "conta_azul",
      },
    });
    mocks.enqueueBackgroundJob.mockRejectedValue(new Error("queue down"));

    await expect(
      dispatchSyncRun({
        env,
        integrationId: "int-1",
        organizationId: "org-1",
        runId: "run-1",
        target: "payable",
        limit: 10,
        trigger: "scheduled",
      }),
    ).rejects.toThrow("queue down");

    expect(mocks.failIntegrationSyncRun).toHaveBeenCalledWith({
      integrationId: "int-1",
      organizationId: "org-1",
      runId: "run-1",
      target: "payable",
      message: "queue down",
      details: {
        phase: "queue_send",
        trigger: "scheduled",
      },
    });
  });
});

describe("integrations run items route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.query.integrationSyncRun.findFirst.mockResolvedValue({
      id: "run-1",
      target: "billing_document",
    });
    mocks.db.query.integrationSyncItem.findMany.mockResolvedValue([
      {
        id: "item-1",
        runId: "run-1",
        target: "billing_document",
        localEntityId: "bill-1",
        remoteEntityId: "remote-1",
        operation: "upsert",
        status: "SUCCEEDED",
        attemptCount: 1,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "item-2",
        runId: "run-1",
        target: "billing_document",
        localEntityId: "bill-2",
        remoteEntityId: null,
        operation: "upsert",
        status: "FAILED",
        attemptCount: 2,
        lastErrorCode: "VALIDATION_ERROR",
        lastErrorMessage: "Cliente sem CPF/CNPJ válido",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
  });

  it("returns per-record sync items with status counts", async () => {
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        id: "int-1",
        provider: "conta_azul",
      },
    });

    const response = await createTestApp().request(
      "/api/integrations/int-1/runs/run-1/items?limit=2",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runId: "run-1",
      target: "billing_document",
      data: [
        {
          id: "item-1",
          status: "SUCCEEDED",
          localEntityId: "bill-1",
          remoteEntityId: "remote-1",
        },
        {
          id: "item-2",
          status: "FAILED",
          localEntityId: "bill-2",
          lastErrorCode: "VALIDATION_ERROR",
        },
      ],
      summary: {
        returnedCount: 2,
        statusCounts: {
          FAILED: 1,
          SUCCEEDED: 1,
        },
      },
    });
    expect(mocks.db.query.integrationSyncItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 2,
      }),
    );
  });

  it("does not expose run items when the integration is missing", async () => {
    mocks.getIntegrationRecord.mockResolvedValue(null);

    const response = await createTestApp().request(
      "/api/integrations/int-missing/runs/run-1/items",
      {},
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Integração não encontrada",
    });
    expect(mocks.db.query.integrationSyncItem.findMany).not.toHaveBeenCalled();
  });
});

describe("integration sync target validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        id: "int-1",
        provider: "generic_http",
        status: "ACTIVE",
      },
      connection: {
        config: {},
      },
    });
  });

  it("rejects Conta Azul-only sync targets for generic HTTP integrations", async () => {
    const response = await createTestApp().request(
      "/api/integrations/int-1/sync/preview",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          target: "catalog_item",
          limit: 10,
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain(
      "suportado apenas pelo provider Conta Azul",
    );
    expect(mocks.previewIntegrationSync).not.toHaveBeenCalled();
  });

  it("rejects Conta Azul-only schedule targets for generic HTTP integrations", async () => {
    const response = await createTestApp().request(
      "/api/integrations/int-1/schedule",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          target: "payable",
          mode: "scheduled",
          frequency: "daily",
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain(
      "suportado apenas pelo provider Conta Azul",
    );
    expect(mocks.updateTargetScheduleConfig).not.toHaveBeenCalled();
  });

  it("rejects retrying legacy Conta Azul-only targets on generic HTTP integrations", async () => {
    mocks.db.query.integrationSyncRun.findFirst.mockResolvedValue({
      id: "run-legacy",
      integrationId: "int-1",
      organizationId: "org-1",
      status: "FAILED",
      target: "supplier",
      requestedLimit: 10,
    });

    const response = await createTestApp().request(
      "/api/integrations/int-1/runs/run-legacy/retry",
      {
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain(
      "suportado apenas pelo provider Conta Azul",
    );
    expect(mocks.previewIntegrationSync).not.toHaveBeenCalled();
  });
});

describe("Conta Azul active connection guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        id: "int-1",
        provider: "conta_azul",
        status: "ACTION_REQUIRED",
      },
      connection: {
        config: {},
      },
    });
  });

  it("blocks manual Conta Azul polling while the connection needs action", async () => {
    const response = await createTestApp().request(
      "/api/integrations/int-1/conta-azul/poll",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 10 }),
      },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toContain(
      "precisa estar ativa para esta operação",
    );
    expect(mocks.pollContaAzulBillingStatus).not.toHaveBeenCalled();
  });

  it("blocks Conta Azul reference loading while the connection is disabled", async () => {
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        id: "int-1",
        provider: "conta_azul",
        status: "DISABLED",
      },
      connection: {
        config: {},
      },
    });

    const response = await createTestApp().request(
      "/api/integrations/int-1/conta-azul/catalog/accounts",
      {},
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toContain(
      "precisa estar ativa para esta operação",
    );
    expect(mocks.listContaAzulCatalog).not.toHaveBeenCalled();
  });

  it("returns Conta Azul schedule state for the caller organization", async () => {
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        id: "int-1",
        provider: "conta_azul",
        status: "ACTIVE",
      },
      connection: {
        config: {},
      },
    });
    mocks.getContaAzulScheduleState.mockResolvedValue({
      paymentStatusPolling: {
        enabled: true,
        intervalMinutes: 30,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastSuccessAt: "2026-05-26T12:00:00.000Z",
        nextDueAt: "2026-05-26T12:30:00.000Z",
      },
    });

    const response = await createTestApp().request(
      "/api/integrations/int-1/conta-azul/schedule",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      paymentStatusPolling: {
        enabled: true,
      },
    });
    expect(mocks.getContaAzulScheduleState).toHaveBeenCalledWith({
      integrationId: "int-1",
      organizationId: "org-1",
    });
  });

  it("returns 404 for schedule state on a non-Conta Azul integration", async () => {
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        id: "int-1",
        provider: "generic_http",
        status: "ACTIVE",
      },
      connection: {
        config: {},
      },
    });

    const response = await createTestApp().request(
      "/api/integrations/int-1/conta-azul/schedule",
      {},
      env,
    );

    expect(response.status).toBe(404);
    expect(mocks.getContaAzulScheduleState).not.toHaveBeenCalled();
  });

  it("returns 409 for schedule state on a non-active Conta Azul integration", async () => {
    mocks.getIntegrationRecord.mockResolvedValue({
      integration: {
        id: "int-1",
        provider: "conta_azul",
        status: "ACTION_REQUIRED",
      },
      connection: {
        config: {},
      },
    });

    const response = await createTestApp().request(
      "/api/integrations/int-1/conta-azul/schedule",
      {},
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toContain(
      "precisa estar ativa para esta operação",
    );
    expect(mocks.getContaAzulScheduleState).not.toHaveBeenCalled();
  });
});

describe("Conta Azul config route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unsupported budget write and fiscal issuance modes at the API boundary", async () => {
    const response = await createTestApp().request(
      "/api/integrations/int-1/conta-azul/config",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          budgetMode: "native_api_write_verified",
          fiscalMode: "issuance_supported",
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(mocks.getIntegrationRecord).not.toHaveBeenCalled();
  });
});

describe("Conta Azul OAuth start route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const startOAuth = () =>
    createTestApp().request(
      "/api/integrations/conta-azul/oauth/start",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          returnTo: "/dashboard/settings/integrations",
        }),
      },
      env,
    );

  it("asks for the laboratory's Conta Azul application when it has none", async () => {
    vi.mocked(requireContaAzulOAuthConfig).mockRejectedValue(
      new ContaAzulAppMissingError(),
    );

    const response = await startOAuth();

    await expect(response.json()).resolves.toEqual({
      error: CONTA_AZUL_APP_MISSING_MESSAGE,
      code: "conta_azul_app_missing",
    });
    expect(response.status).toBe(409);
    expect(buildContaAzulAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("surfaces other OAuth configuration failures as an actionable JSON error", async () => {
    vi.mocked(requireContaAzulOAuthConfig).mockRejectedValue(
      new Error("INTEGRATIONS_MASTER_KEY não configurada"),
    );

    const response = await startOAuth();

    await expect(response.json()).resolves.toEqual({
      error: "INTEGRATIONS_MASTER_KEY não configurada",
    });
    expect(response.status).toBe(503);
    expect(buildContaAzulAuthorizationUrl).not.toHaveBeenCalled();
  });
});
