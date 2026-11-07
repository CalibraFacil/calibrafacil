import { z } from "zod";

import { ContaAzulAppCredentialsSchema } from "@calibra-facil/schemas";
import {
  CONTA_AZUL_API_BASE_URL,
  CONTA_AZUL_SYNC_DOMAINS,
  INTEGRATION_PROVIDER_CAPABILITY_FLAGS,
  INTEGRATION_RUN_MODES,
  INTEGRATION_SCHEDULE_FREQUENCIES,
  INTEGRATION_STATUSES,
  INTEGRATION_SYNC_ITEM_STATUSES,
  INTEGRATION_SYNC_STATUSES,
  INTEGRATION_SYNC_TARGETS,
  INTEGRATION_SYNC_TRIGGERS,
  normalizeIntegrationBaseUrl,
  type IntegrationObjectLinkTarget,
} from "@calibra-facil/shared";

import { nullableNumber, nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's ERP integrations (`/api/integrations/*`): the endpoint
 * definitions, the request schemas the server validates with and the response
 * contracts. Response schemas are wire schemas written from what
 * `apps/api/src/routes/integrations.ts` returns (see `jobs.ts` for the rules).
 * Integration ids and run ids are text (UUIDs), so no definition needs a
 * `params` schema.
 *
 * Not in the group (plain Hono routes, nothing in the frontends calls them
 * through the SDK):
 * - `GET /api/integrations/conta-azul/oauth/callback`: the browser lands here
 *   from Conta Azul's authorization page (the redirect URI), answers with a
 *   redirect, never JSON;
 * - `GET /api/integrations/:id/overview`, `/:id/runs`, `/:id/events`: the list
 *   already carries the overview, the last runs and the last events.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

const SYNC_TARGETS = INTEGRATION_SYNC_TARGETS;
const syncTargetSchema = z.enum(SYNC_TARGETS);

const OBJECT_LINK_TARGETS = [
  ...SYNC_TARGETS,
  "baixa",
  "budget",
  "category",
  "cost_center",
  "dre_category",
  "expense",
  "financial_account",
  "financial_transfer",
  "fiscal_document",
  "payable_installment",
  "product",
  "protocol",
  "receivable_installment",
  "remote_document",
  "sale",
  "seller",
  "service",
] as const satisfies readonly IntegrationObjectLinkTarget[];
const objectLinkTargetSchema = z.enum(OBJECT_LINK_TARGETS);

const integrationStatusSchema = z.enum(INTEGRATION_STATUSES);
const syncStatusSchema = z.enum(INTEGRATION_SYNC_STATUSES);
const syncTriggerSchema = z.enum(INTEGRATION_SYNC_TRIGGERS);
const runModeSchema = z.enum(INTEGRATION_RUN_MODES);
const scheduleFrequencySchema = z.enum(INTEGRATION_SCHEDULE_FREQUENCIES);
const syncItemStatusSchema = z.enum(INTEGRATION_SYNC_ITEM_STATUSES);

const contaAzulCatalogKeySchema = z.enum([
  "accounts",
  "balances",
  "categories",
  "cost-centers",
  "dre-categories",
  "product-categories",
  "product-cest",
  "product-ecommerce-brands",
  "product-ecommerce-categories",
  "product-ncm",
  "products",
  "product-units",
  "sellers",
  "services",
  "transfers",
]);
export type ContaAzulCatalogKey = z.infer<typeof contaAzulCatalogKeySchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const BaseUrlSchema = z
  .string()
  .trim()
  .url()
  .transform((value, ctx) => {
    try {
      return normalizeIntegrationBaseUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Base URL inválida",
      });
      return z.NEVER;
    }
  });

const MappingRuleSchema = z.object({
  id: z.string().trim().min(1),
  destinationField: z.string().trim().min(1),
  enabled: z.boolean(),
  valueMode: z.enum(["source", "constant"]),
  sourceField: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  constantValue: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  formatter: z.enum([
    "none",
    "string",
    "number",
    "boolean",
    "upper_case",
    "lower_case",
    "digits_only",
    "date_only",
    "iso_datetime",
    "currency_major",
  ]),
});

const TargetMappingSchema = z.object({
  fields: z.array(MappingRuleSchema),
});

/** The field mappings a request may carry, per sync target. */
const MappingsInputSchema = z.object({
  catalog_item: TargetMappingSchema.optional(),
  contract: TargetMappingSchema.optional(),
  customer: TargetMappingSchema.optional(),
  supplier: TargetMappingSchema.optional(),
  transporter: TargetMappingSchema.optional(),
  service_order: TargetMappingSchema.optional(),
  billing_document: TargetMappingSchema.optional(),
  payable: TargetMappingSchema.optional(),
});

const IntegrationBodySchema = z.object({
  name: z.string().trim().min(3).max(80),
  baseUrl: BaseUrlSchema,
  authToken: z.string().trim().min(8),
  healthPath: z.string().trim().optional(),
  customerPath: z.string().trim().optional(),
  serviceOrderPath: z.string().trim().optional(),
  billingDocumentPath: z.string().trim().optional(),
  mappings: MappingsInputSchema.optional(),
});

const UpdateIntegrationBodySchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  baseUrl: BaseUrlSchema.optional(),
  authToken: z.string().trim().min(8).optional(),
  healthPath: z.string().trim().optional(),
  customerPath: z.string().trim().optional(),
  serviceOrderPath: z.string().trim().optional(),
  billingDocumentPath: z.string().trim().optional(),
  mappings: MappingsInputSchema.optional(),
});

const SyncRequestSchema = z.object({
  target: syncTargetSchema,
  limit: z.coerce.number().min(1).max(250).default(50),
  mappings: MappingsInputSchema.optional(),
});

const ToggleSchema = z.object({
  enabled: z.boolean(),
});

const ScheduleSchema = z.object({
  target: syncTargetSchema,
  mode: runModeSchema,
  frequency: scheduleFrequencySchema.optional(),
});

const OAuthStartBodySchema = z.object({
  returnTo: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) => value.startsWith("/") && !value.startsWith("//"),
      "returnTo inválido",
    )
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

const ContaAzulPollBodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

const SyncItemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

const ContaAzulMdfeLinkBodySchema = z.object({
  externalId: z.string().trim().min(1).max(160),
  fiscalDocumentAccessKeys: z
    .array(z.string().trim().min(1).max(80))
    .min(1)
    .max(50),
  mdfeIdentifier: z.string().trim().min(1).max(120),
  status: z
    .enum(["AUTORIZADO", "ENCERRADO", "CANCELADO"])
    .nullable()
    .optional(),
});

const ContaAzulExportModeSchema = z.enum([
  "budget_to_sale",
  "contract_generated",
  "receivable_event",
  "sale",
  "sale_and_receivable",
]);

const ContaAzulBudgetModeSchema = z.enum(["sales_search_link"]);

const ContaAzulFiscalModeSchema = z.enum(["consultation_only", "disabled"]);

const ContaAzulProtocolModeSchema = z.enum([
  "api_lookup_verified",
  "metadata_only",
]);

const ContaAzulSaleTriggerSchema = z.enum([
  "billing_document_issued",
  "certificate_approved",
  "manual",
  "quote_approved",
  "service_order_approved",
  "service_order_completed",
]);

const nullableId = z.string().trim().min(1).nullable().optional();

export type ContaAzulConfigInput = z.input<typeof ContaAzulConfigBodySchema>;

const ContaAzulConfigBodySchema = z.object({
  budgetMode: ContaAzulBudgetModeSchema.optional(),
  defaultFinancialAccountId: nullableId,
  defaultCategoryId: nullableId,
  defaultCostCenterId: nullableId,
  defaultDreCategoryId: nullableId,
  defaultExpenseCategoryId: nullableId,
  defaultPaymentMethodId: nullableId,
  defaultProductCategoryId: nullableId,
  defaultSellerId: nullableId,
  defaultServiceCategoryId: nullableId,
  defaultUnitOfMeasureId: nullableId,
  defaultFiscalTaxonomy: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional(),
  fiscalMode: ContaAzulFiscalModeSchema.optional(),
  protocolMode: ContaAzulProtocolModeSchema.optional(),
  saleTrigger: ContaAzulSaleTriggerSchema.optional(),
  exportMode: ContaAzulExportModeSchema.optional(),
  enabledTargets: z
    .object({
      baixas: z.boolean().optional(),
      balances: z.boolean().optional(),
      billingDocuments: z.boolean().optional(),
      budgets: z.boolean().optional(),
      categories: z.boolean().optional(),
      contracts: z.boolean().optional(),
      costCenters: z.boolean().optional(),
      customers: z.boolean().optional(),
      dreCategories: z.boolean().optional(),
      driftChecks: z.boolean().optional(),
      expenses: z.boolean().optional(),
      financialAccounts: z.boolean().optional(),
      fiscalDocuments: z.boolean().optional(),
      inventoryTaxonomy: z.boolean().optional(),
      payables: z.boolean().optional(),
      paymentStatusPolling: z.boolean().optional(),
      products: z.boolean().optional(),
      protocols: z.boolean().optional(),
      receivables: z.boolean().optional(),
      remoteDocuments: z.boolean().optional(),
      sales: z.boolean().optional(),
      sellers: z.boolean().optional(),
      services: z.boolean().optional(),
      suppliers: z.boolean().optional(),
      transfers: z.boolean().optional(),
      transporters: z.boolean().optional(),
    })
    .optional(),
});

const DriftQuerySchema = z.object({
  /** Only drift of this link target; a value that is not one is ignored. */
  target: z.string().optional(),
});

const AcknowledgeDriftBodySchema = z.object({
  reason: z
    .string()
    .min(1)
    .max(500)
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "Motivo é obrigatório"),
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

const dependencyWarningSchema = z.object({
  code: z.enum([
    "CATALOG_NOT_ENABLED",
    "CUSTOMERS_NOT_SYNCED",
    "SUPPLIERS_NOT_SYNCED",
    "SERVICE_ORDERS_NOT_SYNCED",
    "VALIDATION_REQUIRED",
    "REMOTE_CONFIG_MISSING",
    "INTEGRATION_DISABLED",
  ]),
  target: syncTargetSchema,
  severity: z.enum(["warning", "error"]),
  message: z.string(),
});

const targetCoverageSchema = z.object({
  target: syncTargetSchema,
  localCount: z.number(),
  linkedCount: z.number(),
  unlinkedCount: z.number(),
});

const targetScheduleSummarySchema = z.object({
  target: syncTargetSchema,
  mode: runModeSchema,
  frequency: scheduleFrequencySchema,
  status: z.enum([
    "disabled",
    "manual_only",
    "scheduled",
    "due",
    "running",
    "blocked",
    "failing",
  ]),
  nextScheduledRunAt: nullableString,
  lastScheduledRunAt: nullableString,
});

const targetSyncSummarySchema = z.object({
  target: syncTargetSchema,
  lastRunAt: nullableString,
  lastSuccessfulRunAt: nullableString,
  lastStatus: syncStatusSchema.nullable(),
  lastTrigger: syncTriggerSchema.nullable(),
  processedCount: z.number(),
  successCount: z.number(),
  errorCount: z.number(),
  blocked: z.boolean(),
  warnings: z.array(dependencyWarningSchema),
  coverage: targetCoverageSchema,
  schedule: targetScheduleSummarySchema,
  lastRunDurationMs: nullableNumber,
  consecutiveFailures: z.number(),
  lastBlockedAt: nullableString,
  hasActiveRun: z.boolean(),
});

const remoteDocumentSummarySchema = z.object({
  totalCount: z.number(),
  availableCount: z.number(),
  unavailableCount: z.number(),
  salePdfCount: z.number(),
  fiscalXmlCount: z.number(),
  otherCount: z.number(),
  lastSyncedAt: nullableString,
});

const readinessSummarySchema = z.object({
  setupStatus: z.enum([
    "NOT_CONFIGURED",
    "CONFIGURED",
    "READY",
    "ACTION_REQUIRED",
  ]),
  readinessStatus: z.enum(["NOT_READY", "READY", "DEGRADED"]),
  capabilities: z.record(
    z.enum(INTEGRATION_PROVIDER_CAPABILITY_FLAGS),
    z.boolean(),
  ),
  validationRequired: z.boolean(),
  canSync: z.boolean(),
  lastValidatedAt: nullableString,
  lastValidationError: nullableString,
  dependencyWarnings: z.array(dependencyWarningSchema),
});

const overviewSchema = z.object({
  readiness: readinessSummarySchema,
  targets: z.array(targetSyncSummarySchema),
  remoteDocuments: remoteDocumentSummarySchema,
  syncSummary: z.object({
    lastRunAt: nullableString,
    lastSuccessfulRunAt: nullableString,
    lastErrorAt: nullableString,
    hasRecentFailures: z.boolean(),
  }),
});

const targetScheduleConfigSchema = z.object({
  mode: runModeSchema,
  frequency: scheduleFrequencySchema,
  nextScheduledRunAt: nullableString,
  lastScheduledRunAt: nullableString,
});

const schedulesConfigSchema = z.record(
  syncTargetSchema,
  targetScheduleConfigSchema,
);

const mappingRuleResponseSchema = z.object({
  id: z.string(),
  destinationField: z.string(),
  enabled: z.boolean(),
  valueMode: z.enum(["source", "constant"]),
  sourceField: nullableString,
  constantValue: nullableString,
  formatter: z.enum([
    "none",
    "string",
    "number",
    "boolean",
    "upper_case",
    "lower_case",
    "digits_only",
    "date_only",
    "iso_datetime",
    "currency_major",
  ]),
});

const mappingsConfigSchema = z.record(
  syncTargetSchema,
  z.object({ fields: z.array(mappingRuleResponseSchema) }),
);

const genericConnectionConfigSchema = z.object({
  baseUrl: z.string(),
  healthPath: z.string(),
  customerPath: z.string(),
  serviceOrderPath: z.string(),
  billingDocumentPath: z.string(),
  authType: z.enum(["bearer", "oauth2"]),
  schedules: schedulesConfigSchema,
  mappings: mappingsConfigSchema,
});

const contaAzulConnectionConfigSchema = z.object({
  provider: z.literal("conta_azul"),
  baseUrl: z.literal(CONTA_AZUL_API_BASE_URL),
  accountId: nullableString,
  connectedCompanyName: nullableString,
  scopes: z.array(z.string()),
  accessTokenExpiresAt: nullableString,
  defaultFinancialAccountId: nullableString,
  defaultCategoryId: nullableString,
  defaultCostCenterId: nullableString,
  defaultDreCategoryId: nullableString,
  defaultExpenseCategoryId: nullableString,
  defaultPaymentMethodId: nullableString,
  defaultProductCategoryId: nullableString,
  defaultSellerId: nullableString,
  defaultServiceCategoryId: nullableString,
  defaultUnitOfMeasureId: nullableString,
  budgetMode: ContaAzulBudgetModeSchema,
  fiscalMode: ContaAzulFiscalModeSchema,
  defaultFiscalTaxonomy: z.record(z.string(), z.unknown()).nullable(),
  protocolMode: ContaAzulProtocolModeSchema,
  saleTrigger: ContaAzulSaleTriggerSchema,
  exportMode: ContaAzulExportModeSchema,
  enabledTargets: z.record(z.enum(CONTA_AZUL_SYNC_DOMAINS), z.boolean()),
  polling: z.object({
    receivablesLastRemoteUpdatedAt: nullableString,
    payablesLastRemoteUpdatedAt: nullableString,
    invoicesLastRemoteUpdatedAt: nullableString,
    protocolsLastRemoteUpdatedAt: nullableString,
    driftLastCheckedAt: nullableString,
  }),
  schedules: schedulesConfigSchema,
  mappings: mappingsConfigSchema,
});

/** The connection settings of an integration: a generic HTTP ERP or Conta Azul. */
const connectionConfigSchema = z.union([
  contaAzulConnectionConfigSchema,
  genericConnectionConfigSchema,
]);
export type IntegrationConnectionConfig = z.infer<
  typeof connectionConfigSchema
>;

const syncRunSchema = z.object({
  id: z.string(),
  integrationId: z.string(),
  organizationId: z.string(),
  trigger: syncTriggerSchema,
  target: syncTargetSchema,
  status: syncStatusSchema,
  initiatedBy: nullableString,
  processedCount: z.number(),
  successCount: z.number(),
  errorCount: z.number(),
  summary: z.record(z.string(), z.unknown()).nullable(),
  errorSummary: nullableString,
  startedAt: nullableString,
  finishedAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IntegrationRun = z.infer<typeof syncRunSchema>;

const eventSchema = z.object({
  id: z.number(),
  integrationId: z.string(),
  organizationId: z.string(),
  runId: nullableString,
  level: z.enum(["info", "warning", "error"]),
  event: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

const integrationSummarySchema = z.object({
  id: z.string(),
  type: z.literal("financial_erp"),
  provider: z.enum(["generic_http", "conta_azul"]),
  name: z.string(),
  status: integrationStatusSchema,
  lastValidatedAt: nullableString,
  lastValidationError: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
  connection: z.object({
    id: nullableString,
    credentialType: z.enum(["bearer", "oauth2"]),
    config: connectionConfigSchema.nullable(),
  }),
  recentRuns: z.array(syncRunSchema),
  recentEvents: z.array(eventSchema),
  overview: overviewSchema,
});
export type IntegrationSummary = z.infer<typeof integrationSummarySchema>;

/** The integrations of the laboratory: the answer of `list` and of every write that changes one. */
const integrationsResponseSchema = z.object({
  data: z.array(integrationSummarySchema),
});
export type IntegrationsResponse = z.infer<typeof integrationsResponseSchema>;

/** The Conta Azul application a laboratory connects through. */
const contaAzulAppSummarySchema = z.object({
  source: z.enum(["organization", "server"]).nullable(),
  clientId: nullableString,
  clientSecretLast4: nullableString,
  redirectUri: z.string(),
  updatedAt: nullableString,
});
export type ContaAzulAppSummary = z.infer<typeof contaAzulAppSummarySchema>;

const contaAzulAppSaveResponseSchema = z.object({
  app: contaAzulAppSummarySchema,
  check: z.enum(["accepted", "unverified"]),
});
export type ContaAzulAppSaveResponse = z.infer<
  typeof contaAzulAppSaveResponseSchema
>;

const oauthStartResponseSchema = z.object({
  authorizationUrl: z.string(),
  expiresInSeconds: z.number(),
});
export type ContaAzulOAuthStartResponse = z.infer<
  typeof oauthStartResponseSchema
>;

const successResponseSchema = z.object({ success: z.boolean() });

const refreshResponseSchema = z.object({
  success: z.boolean(),
  accessTokenExpiresAt: nullableString,
});

const catalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: nullableString,
  active: z.boolean().nullable(),
  /** `type`, `status`, `bankCode`, `amount`, ... as Conta Azul reports them. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type ContaAzulCatalogItem = z.infer<typeof catalogItemSchema>;

const catalogResponseSchema = z.object({
  domain: z.string(),
  items: z.array(catalogItemSchema),
  nextCursor: nullableString,
});
export type ContaAzulCatalogResponse = z.infer<typeof catalogResponseSchema>;

const pollCursorSchema = z.object({
  cursorType: z.string(),
  lastRemoteUpdatedAt: nullableString,
  lastSuccessfulPollAt: nullableString,
  nextPage: nullableNumber,
  state: z.record(z.string(), z.unknown()).nullable(),
});

const pollResultSchema = z.object({
  processedCount: z.number(),
  updatedCount: z.number(),
  cursor: pollCursorSchema,
  warnings: z.array(z.string()),
});
export type ContaAzulPollResult = z.infer<typeof pollResultSchema>;

const remoteEntityRefSchema = z.object({
  remoteEntityId: nullableString,
  remoteDisplayId: nullableString.optional(),
  remoteEntityType: nullableString.optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const scheduleRowSchema = z.object({
  enabled: z.boolean(),
  lastSuccessAt: nullableString,
  lastErrorAt: nullableString,
  lastErrorMessage: nullableString,
  nextDueAt: nullableString,
  intervalMinutes: z.number(),
});
export type ContaAzulScheduleRow = z.infer<typeof scheduleRowSchema>;

const scheduleResponseSchema = z.object({
  paymentStatusPolling: scheduleRowSchema,
  payables: scheduleRowSchema,
  fiscalDocuments: scheduleRowSchema,
  protocols: scheduleRowSchema,
  driftChecks: scheduleRowSchema,
});
export type ContaAzulScheduleResponse = z.infer<typeof scheduleResponseSchema>;

const previewSampleSchema = z.object({
  externalId: z.string(),
  label: z.string(),
  subtitle: nullableString,
  mappedPayload: z.record(z.string(), z.unknown()),
  issues: z.array(z.string()),
});

const syncPreviewResponseSchema = z.object({
  target: syncTargetSchema,
  requestedLimit: z.number(),
  blocked: z.boolean(),
  warnings: z.array(dependencyWarningSchema),
  coverage: targetCoverageSchema,
  previewCount: z.number(),
  sampleRecords: z.array(previewSampleSchema),
});
export type SyncPreviewResponse = z.infer<typeof syncPreviewResponseSchema>;

const syncStartedResponseSchema = z.object({
  success: z.boolean(),
  queued: z.boolean(),
  runId: z.string(),
  status: syncStatusSchema,
  warnings: z.array(dependencyWarningSchema),
});

const retryStartedResponseSchema = z.object({
  success: z.boolean(),
  queued: z.boolean(),
  runId: z.string(),
  status: syncStatusSchema,
});

const syncItemSchema = z.object({
  id: z.string(),
  runId: z.string(),
  integrationId: z.string(),
  organizationId: z.string(),
  target: objectLinkTargetSchema,
  localEntityId: z.string(),
  remoteEntityId: nullableString,
  operation: z.enum([
    "create",
    "update",
    "upsert",
    "poll",
    "reconcile",
    "link",
    "validate",
    "delete",
  ]),
  status: syncItemStatusSchema,
  attemptCount: z.number(),
  lastErrorCode: nullableString,
  lastErrorMessage: nullableString,
  requestFingerprint: nullableString,
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const runItemsResponseSchema = z.object({
  runId: z.string(),
  target: syncTargetSchema,
  data: z.array(syncItemSchema),
  summary: z.object({
    returnedCount: z.number(),
    statusCounts: z.record(z.string(), z.number()),
  }),
});
export type IntegrationRunItemsResponse = z.infer<
  typeof runItemsResponseSchema
>;

const driftRowSchema = z.object({
  linkId: z.string(),
  integrationId: z.string(),
  providerLabel: z.string(),
  target: objectLinkTargetSchema,
  targetLabel: z.string(),
  localEntityId: z.string(),
  remoteEntityId: nullableString,
  remoteDisplayId: nullableString,
  driftStatus: z.literal("REMOTE_MISSING"),
  driftCheckedAt: nullableString,
  driftReason: nullableString,
  lastSyncedAt: nullableString,
});
export type IntegrationDriftRow = z.infer<typeof driftRowSchema>;

const driftQueueResponseSchema = z.object({ data: z.array(driftRowSchema) });
export type IntegrationDriftQueueResponse = z.infer<
  typeof driftQueueResponseSchema
>;

const acknowledgeDriftResponseSchema = z.object({
  data: z.object({ ok: z.boolean() }),
});

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const cloudOnly = {
  policy: "cloud-only",
  desktopLabel: "Integrações",
} as const;

export const integrationEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/integrations",
    response: integrationsResponseSchema,
    failure: "Falha ao carregar integrações",
    ...cloudOnly,
  }),
  create: endpoint({
    method: "post",
    path: "/api/integrations",
    body: IntegrationBodySchema,
    response: integrationsResponseSchema,
    status: 201,
    failure: "Falha ao criar integração",
    ...cloudOnly,
  }),
  update: endpoint({
    method: "put",
    path: "/api/integrations/:id",
    body: UpdateIntegrationBodySchema,
    response: integrationsResponseSchema,
    failure: "Falha ao salvar mapeamento",
    ...cloudOnly,
  }),
  validate: endpoint({
    method: "post",
    path: "/api/integrations/:id/validate",
    response: successResponseSchema,
    failure: "Falha ao validar conexão",
    ...cloudOnly,
  }),
  toggle: endpoint({
    method: "post",
    path: "/api/integrations/:id/toggle",
    body: ToggleSchema,
    response: integrationsResponseSchema,
    failure: "Falha ao atualizar status",
    ...cloudOnly,
  }),
  previewSync: endpoint({
    method: "post",
    path: "/api/integrations/:id/sync/preview",
    body: SyncRequestSchema,
    response: syncPreviewResponseSchema,
    failure: "Falha ao montar prévia",
    ...cloudOnly,
  }),
  sync: endpoint({
    method: "post",
    path: "/api/integrations/:id/sync",
    body: SyncRequestSchema,
    response: syncStartedResponseSchema,
    failure: "Falha ao iniciar sync",
    ...cloudOnly,
  }),
  schedule: endpoint({
    method: "post",
    path: "/api/integrations/:id/schedule",
    body: ScheduleSchema,
    response: integrationsResponseSchema,
    failure: "Falha ao atualizar agenda",
    ...cloudOnly,
  }),
  listRunItems: endpoint({
    method: "get",
    path: "/api/integrations/:id/runs/:runId/items",
    query: SyncItemsQuerySchema,
    response: runItemsResponseSchema,
    failure: "Falha ao carregar itens da execução",
    ...cloudOnly,
  }),
  retryRun: endpoint({
    method: "post",
    path: "/api/integrations/:id/runs/:runId/retry",
    response: retryStartedResponseSchema,
    failure: "Falha ao reprocessar sync",
    ...cloudOnly,
  }),
  listDrift: endpoint({
    method: "get",
    path: "/api/integrations/drift",
    query: DriftQuerySchema,
    response: driftQueueResponseSchema,
    failure: "Falha ao carregar fila de drift",
    ...cloudOnly,
  }),
  acknowledgeDrift: endpoint({
    method: "post",
    path: "/api/integrations/drift/:linkId/acknowledge",
    body: AcknowledgeDriftBodySchema,
    response: acknowledgeDriftResponseSchema,
    failure: "Falha ao marcar drift como resolvido",
    ...cloudOnly,
  }),

  // Conta Azul
  startContaAzulOAuth: endpoint({
    method: "post",
    path: "/api/integrations/conta-azul/oauth/start",
    body: OAuthStartBodySchema,
    response: oauthStartResponseSchema,
    failure: "Falha ao iniciar OAuth da Conta Azul",
    ...cloudOnly,
  }),
  getContaAzulApp: endpoint({
    method: "get",
    path: "/api/integrations/conta-azul/app",
    response: contaAzulAppSummarySchema,
    failure: "Falha ao carregar o aplicativo Conta Azul",
    ...cloudOnly,
  }),
  saveContaAzulApp: endpoint({
    method: "put",
    path: "/api/integrations/conta-azul/app",
    body: ContaAzulAppCredentialsSchema,
    response: contaAzulAppSaveResponseSchema,
    failure: "Falha ao salvar o aplicativo Conta Azul",
    ...cloudOnly,
  }),
  removeContaAzulApp: endpoint({
    method: "delete",
    path: "/api/integrations/conta-azul/app",
    response: contaAzulAppSummarySchema,
    failure: "Falha ao remover o aplicativo Conta Azul",
    ...cloudOnly,
  }),
  updateContaAzulConfig: endpoint({
    method: "put",
    path: "/api/integrations/:id/conta-azul/config",
    body: ContaAzulConfigBodySchema,
    response: integrationsResponseSchema,
    failure: "Falha ao salvar configuração da Conta Azul",
    ...cloudOnly,
  }),
  listContaAzulCatalog: endpoint({
    method: "get",
    path: "/api/integrations/:id/conta-azul/catalog/:catalog",
    params: z.object({ id: z.string(), catalog: contaAzulCatalogKeySchema }),
    response: catalogResponseSchema,
    failure: "Falha ao carregar catálogo da Conta Azul",
    ...cloudOnly,
  }),
  pollContaAzul: endpoint({
    method: "post",
    path: "/api/integrations/:id/conta-azul/poll",
    body: ContaAzulPollBodySchema,
    response: pollResultSchema,
    failure: "Falha ao consultar pagamentos da Conta Azul",
    ...cloudOnly,
  }),
  pollContaAzulFiscal: endpoint({
    method: "post",
    path: "/api/integrations/:id/conta-azul/poll-fiscal",
    body: ContaAzulPollBodySchema,
    response: pollResultSchema,
    failure: "Falha ao consultar documentos fiscais da Conta Azul",
    ...cloudOnly,
  }),
  linkContaAzulInvoicesToMdfe: endpoint({
    method: "post",
    path: "/api/integrations/:id/conta-azul/link-mdfe",
    body: ContaAzulMdfeLinkBodySchema,
    response: remoteEntityRefSchema,
    failure: "Falha ao vincular MDF-e na Conta Azul",
    ...cloudOnly,
  }),
  pollContaAzulPayables: endpoint({
    method: "post",
    path: "/api/integrations/:id/conta-azul/poll-payables",
    body: ContaAzulPollBodySchema,
    response: pollResultSchema,
    failure: "Falha ao consultar contas a pagar da Conta Azul",
    ...cloudOnly,
  }),
  pollContaAzulProtocols: endpoint({
    method: "post",
    path: "/api/integrations/:id/conta-azul/poll-protocols",
    body: ContaAzulPollBodySchema,
    response: pollResultSchema,
    failure: "Falha ao consultar protocolos da Conta Azul",
    ...cloudOnly,
  }),
  pollContaAzulDrift: endpoint({
    method: "post",
    path: "/api/integrations/:id/conta-azul/poll-drift",
    body: ContaAzulPollBodySchema,
    response: pollResultSchema,
    failure: "Falha ao verificar drift da Conta Azul",
    ...cloudOnly,
  }),
  getContaAzulSchedule: endpoint({
    method: "get",
    path: "/api/integrations/:id/conta-azul/schedule",
    response: scheduleResponseSchema,
    failure: "Falha ao carregar agenda da Conta Azul",
    ...cloudOnly,
  }),
  refreshContaAzul: endpoint({
    method: "post",
    path: "/api/integrations/:id/conta-azul/refresh",
    response: refreshResponseSchema,
    failure: "Falha ao renovar token da Conta Azul",
    ...cloudOnly,
  }),
  disconnectContaAzul: endpoint({
    method: "post",
    path: "/api/integrations/:id/conta-azul/disconnect",
    response: successResponseSchema,
    failure: "Falha ao desconectar Conta Azul",
    ...cloudOnly,
  }),
} as const satisfies EndpointGroup;
