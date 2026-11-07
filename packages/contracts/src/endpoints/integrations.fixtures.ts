import type {
  ContaAzulAppSaveResponse,
  ContaAzulAppSummary,
  ContaAzulCatalogResponse,
  ContaAzulPollResult,
  ContaAzulScheduleResponse,
  IntegrationDriftQueueResponse,
  IntegrationRunItemsResponse,
  IntegrationSummary,
  IntegrationsResponse,
  SyncPreviewResponse,
} from "./integrations";

/**
 * Contract-valid example payloads for the integrations endpoints, for tests in
 * any package. Every value mirrors what the handlers return today;
 * `integrations.test.ts` parses every builder against its response schema.
 */

const SYNC_TARGETS = [
  "catalog_item",
  "contract",
  "customer",
  "supplier",
  "transporter",
  "service_order",
  "billing_document",
  "payable",
] as const;

type GenericConfig = Extract<
  NonNullable<IntegrationSummary["connection"]["config"]>,
  { authType: "bearer" | "oauth2" }
>;

function schedules(): GenericConfig["schedules"] {
  const entry = {
    mode: "manual_only",
    frequency: "daily",
    nextScheduledRunAt: null,
    lastScheduledRunAt: null,
  } as const;
  return {
    catalog_item: entry,
    contract: entry,
    customer: entry,
    supplier: entry,
    transporter: entry,
    service_order: entry,
    billing_document: entry,
    payable: entry,
  };
}

function mappings(): GenericConfig["mappings"] {
  const entry = { fields: [] };
  return {
    catalog_item: entry,
    contract: entry,
    customer: entry,
    supplier: entry,
    transporter: entry,
    service_order: entry,
    billing_document: entry,
    payable: entry,
  };
}

const coverage = {
  target: "customer",
  localCount: 4,
  linkedCount: 3,
  unlinkedCount: 1,
} as const;

export function buildIntegrationSummary(
  overrides: Partial<IntegrationSummary> = {},
): IntegrationSummary {
  return {
    id: "integration-1",
    type: "financial_erp",
    provider: "generic_http",
    name: "ERP financeiro",
    status: "ACTIVE",
    lastValidatedAt: "2026-02-01T10:00:00.000Z",
    lastValidationError: null,
    createdAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-02-01T10:00:00.000Z",
    connection: {
      id: "connection-1",
      credentialType: "bearer",
      config: {
        baseUrl: "https://erp.example.test",
        healthPath: "/health",
        customerPath: "/customers",
        serviceOrderPath: "/service-orders",
        billingDocumentPath: "/billing-documents",
        authType: "bearer",
        schedules: schedules(),
        mappings: mappings(),
      },
    },
    recentRuns: [
      {
        id: "run-1",
        integrationId: "integration-1",
        organizationId: "org-1",
        trigger: "manual",
        target: "customer",
        status: "COMPLETED",
        initiatedBy: "user-1",
        processedCount: 3,
        successCount: 3,
        errorCount: 0,
        summary: { requestedLimit: 50 },
        errorSummary: null,
        startedAt: "2026-02-01T10:00:00.000Z",
        finishedAt: "2026-02-01T10:00:02.000Z",
        createdAt: "2026-02-01T10:00:00.000Z",
        updatedAt: "2026-02-01T10:00:02.000Z",
      },
    ],
    recentEvents: [
      {
        id: 1,
        integrationId: "integration-1",
        organizationId: "org-1",
        runId: "run-1",
        level: "info",
        event: "sync.requested",
        message: "Sincronização solicitada",
        details: { target: "customer", limit: 50 },
        createdAt: "2026-02-01T10:00:00.000Z",
      },
    ],
    overview: {
      readiness: {
        setupStatus: "READY",
        readinessStatus: "READY",
        capabilities: {
          canCreateCustomers: true,
          canCreateSuppliers: false,
          canCreateTransporters: false,
          canCreateCatalogItems: false,
          canCreateBudgets: false,
          canCreateSales: false,
          canCreateReceivables: false,
          canCreatePayables: false,
          canCreateContracts: false,
          canReadReceivableStatus: false,
          canReadInstallments: false,
          canReadPayableStatus: false,
          canReadFiscalDocuments: false,
          canIssueFiscalDocuments: false,
          canReadRemoteDocumentLinks: false,
          canSyncContracts: false,
          canUseWebhooks: false,
          requiresPolling: false,
          supportsCostCenters: false,
          supportsCategories: false,
          supportsRateio: false,
          supportsSellers: false,
          supportsBranchAddresses: false,
        },
        validationRequired: false,
        canSync: true,
        lastValidatedAt: "2026-02-01T10:00:00.000Z",
        lastValidationError: null,
        dependencyWarnings: [],
      },
      targets: SYNC_TARGETS.map((target) => ({
        target,
        lastRunAt: null,
        lastSuccessfulRunAt: null,
        lastStatus: null,
        lastTrigger: null,
        processedCount: 0,
        successCount: 0,
        errorCount: 0,
        blocked: false,
        warnings: [],
        coverage: { ...coverage, target },
        schedule: {
          target,
          mode: "manual_only",
          frequency: "daily",
          status: "manual_only",
          nextScheduledRunAt: null,
          lastScheduledRunAt: null,
        },
        lastRunDurationMs: null,
        consecutiveFailures: 0,
        lastBlockedAt: null,
        hasActiveRun: false,
      })),
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
        lastRunAt: "2026-02-01T10:00:00.000Z",
        lastSuccessfulRunAt: "2026-02-01T10:00:02.000Z",
        lastErrorAt: null,
        hasRecentFailures: false,
      },
    },
    ...overrides,
  };
}

export function buildIntegrationsResponse(
  data: IntegrationSummary[] = [buildIntegrationSummary()],
): IntegrationsResponse {
  return { data };
}

export function buildContaAzulAppSummary(
  overrides: Partial<ContaAzulAppSummary> = {},
): ContaAzulAppSummary {
  return {
    source: "organization",
    clientId: "client-id",
    clientSecretLast4: "1234",
    redirectUri:
      "https://api.example.test/api/integrations/conta-azul/oauth/callback",
    updatedAt: "2026-02-01T10:00:00.000Z",
    ...overrides,
  };
}

export function buildContaAzulAppSaveResponse(): ContaAzulAppSaveResponse {
  return { app: buildContaAzulAppSummary(), check: "accepted" };
}

export function buildContaAzulCatalogResponse(
  overrides: Partial<ContaAzulCatalogResponse> = {},
): ContaAzulCatalogResponse {
  return {
    domain: "accounts",
    items: [
      {
        id: "account-1",
        name: "Conta corrente",
        code: null,
        active: true,
        metadata: { type: "CONTA_CORRENTE", status: "ATIVO" },
      },
    ],
    nextCursor: null,
    ...overrides,
  };
}

export function buildContaAzulPollResult(): ContaAzulPollResult {
  return {
    processedCount: 2,
    updatedCount: 1,
    cursor: {
      cursorType: "receivables",
      lastRemoteUpdatedAt: "2026-02-01T10:00:00.000Z",
      lastSuccessfulPollAt: "2026-02-01T10:05:00.000Z",
      nextPage: null,
      state: null,
    },
    warnings: [],
  };
}

export function buildContaAzulScheduleResponse(): ContaAzulScheduleResponse {
  const row = {
    enabled: true,
    lastSuccessAt: "2026-02-01T10:00:00.000Z",
    lastErrorAt: null,
    lastErrorMessage: null,
    nextDueAt: "2026-02-01T11:00:00.000Z",
    intervalMinutes: 60,
  };
  return {
    paymentStatusPolling: row,
    payables: row,
    fiscalDocuments: row,
    protocols: row,
    driftChecks: row,
  };
}

export function buildSyncPreviewResponse(): SyncPreviewResponse {
  return {
    target: "customer",
    requestedLimit: 50,
    blocked: false,
    warnings: [],
    coverage,
    previewCount: 1,
    sampleRecords: [
      {
        externalId: "7",
        label: "Metalúrgica Alfa Ltda",
        subtitle: null,
        mappedPayload: { name: "Metalúrgica Alfa Ltda" },
        issues: [],
      },
    ],
  };
}

export function buildIntegrationRunItemsResponse(): IntegrationRunItemsResponse {
  return {
    runId: "run-1",
    target: "customer",
    data: [
      {
        id: "item-1",
        runId: "run-1",
        integrationId: "integration-1",
        organizationId: "org-1",
        target: "customer",
        localEntityId: "7",
        remoteEntityId: null,
        operation: "upsert",
        status: "FAILED",
        attemptCount: 1,
        lastErrorCode: "http_422",
        lastErrorMessage: "Documento inválido",
        requestFingerprint: null,
        metadata: null,
        createdAt: "2026-02-01T10:00:00.000Z",
        updatedAt: "2026-02-01T10:00:01.000Z",
      },
    ],
    summary: { returnedCount: 1, statusCounts: { FAILED: 1 } },
  };
}

export function buildIntegrationDriftQueueResponse(): IntegrationDriftQueueResponse {
  return {
    data: [
      {
        linkId: "link-1",
        integrationId: "integration-1",
        providerLabel: "Conta Azul",
        target: "customer",
        targetLabel: "Cliente",
        localEntityId: "7",
        remoteEntityId: "remote-7",
        remoteDisplayId: null,
        driftStatus: "REMOTE_MISSING",
        driftCheckedAt: "2026-02-01T10:00:00.000Z",
        driftReason: "Registro removido na Conta Azul",
        lastSyncedAt: "2026-01-30T10:00:00.000Z",
      },
    ],
  };
}
