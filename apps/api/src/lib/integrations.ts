import { createHash } from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  asset,
  billingDocument,
  calibrationJob,
  commercialAgreement,
  commercialAgreementServiceTerm,
  customer,
  integrationConnection,
  integrationEventLog,
  integrationObjectLink,
  integrationSyncCursor,
  integrationSyncItem,
  integrationSyncRun,
  financialAuditLog,
  material,
  organizationEventLog,
  organizationIntegration,
  organizationUnit,
  paymentReceipt,
  receivableInstallment,
  service,
  serviceOrder,
  serviceOrderExecution,
  serviceOrderExecutionItem,
} from "@calibra-facil/db/schema";
import { decryptPassword, encryptPassword } from "@calibra-facil/signing";
import { requireContaAzulOAuthConfig } from "./conta-azul-app";
import { recomputeCertificateReleasesForBillingDocument } from "./certificate-release-reconciliation";
import {
  applyIntegrationMappings,
  DEFAULT_INTEGRATION_SCHEDULE_FREQUENCY,
  getProviderCapabilities,
  normalizeContaAzulConnectionConfig,
  type ContaAzulConnectionConfig,
  type ContaAzulReferenceItem,
  type IntegrationSyncBackgroundJobMessage,
  type IntegrationMappedPreviewSample,
  type IntegrationMdfeLinkPayload,
  type IntegrationMappingsConfig,
  type IntegrationMappingValidationIssue,
  type IntegrationPayablePayload,
  type IntegrationRemoteDocumentSummary,
  type FinancialErpConnectionConfig,
  type IntegrationObjectLinkTarget,
  formatIntegrationCustomerAddress,
  normalizeFinancialErpConnectionConfig,
  normalizeGenericFinancialErpConfig,
  validateIntegrationMappings,
  type ContaAzulReferenceDomain,
  type GenericFinancialErpConnectionConfig,
  type IntegrationDependencyWarning,
  type IntegrationBillingDocumentPayload,
  type IntegrationBudgetPayload,
  type IntegrationCatalogItemPayload,
  type IntegrationContractPayload,
  type IntegrationCustomerPayload,
  type IntegrationSalePayload,
  type IntegrationReadinessSummary,
  type IntegrationReadinessStatus,
  type IntegrationRunMode,
  type IntegrationScheduleFrequency,
  type IntegrationScheduleStatus,
  type IntegrationServiceOrderPayload,
  type IntegrationSupplierPayload,
  type IntegrationSyncCursor,
  type IntegrationSetupStatus,
  type IntegrationSyncStatus,
  type IntegrationSyncTarget,
  type IntegrationTargetScheduleSummary,
  type IntegrationTargetCoverageSummary,
  type IntegrationTargetSyncSummary,
  type IntegrationSyncTrigger,
  type IntegrationTransporterPayload,
  type RemoteStatusPollResult,
} from "@calibra-facil/shared";
import { and, count, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import {
  ContaAzulClient,
  type ContaAzulReceivableSearchResponse,
} from "./conta-azul-client";
import { createFinancialErpAdapter } from "./financial-erp-adapters";
import {
  buildContaAzulRefreshFailurePolicy,
  parseContaAzulTokenBundle,
  refreshContaAzulAccessToken,
  serializeContaAzulTokenBundle,
} from "./conta-azul-oauth";
import {
  buildContaAzulReceivableInstallmentLinkMetadata,
  buildContaAzulReceivableEventLinkMetadata,
  buildContaAzulPaymentReceiptSummary,
  extractReceivableItems,
  extractReceivableTotalItems,
  matchContaAzulInstallmentToBillingDocument,
} from "./conta-azul-reconciliation";
import { mapContaAzulInstallmentStatus } from "./conta-azul-mappers";
import { loadBillingDocumentPayloadsForIntegration } from "./finance";

export interface IntegrationsEnv {
  API_URL?: string;
  APP_URL?: string;
  INTEGRATIONS_MASTER_KEY?: string;
  CONTA_AZUL_CLIENT_ID?: string;
  CONTA_AZUL_CLIENT_SECRET?: string;
  CONTA_AZUL_OAUTH_REDIRECT_URI?: string;
}

export interface IntegrationRunExecutionResult {
  status: IntegrationSyncStatus;
  processedCount: number;
  successCount: number;
  errorCount: number;
  errorSummary: string | null;
}

export type GenericConnectionRecord = {
  integration: typeof organizationIntegration.$inferSelect;
  connection: Omit<typeof integrationConnection.$inferSelect, "config"> & {
    config: FinancialErpConnectionConfig;
  };
};

type IntegrationSyncPayload =
  | IntegrationCatalogItemPayload
  | IntegrationContractPayload
  | IntegrationCustomerPayload
  | IntegrationSupplierPayload
  | IntegrationTransporterPayload
  | IntegrationPayablePayload
  | IntegrationServiceOrderPayload
  | IntegrationBillingDocumentPayload;

export interface IntegrationOverview {
  readiness: IntegrationReadinessSummary;
  targets: IntegrationTargetSyncSummary[];
  remoteDocuments: IntegrationRemoteDocumentSummary;
  syncSummary: {
    lastRunAt: string | null;
    lastSuccessfulRunAt: string | null;
    lastErrorAt: string | null;
    hasRecentFailures: boolean;
  };
}

class ContaAzulReconnectRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContaAzulReconnectRequiredError";
  }
}

function isContaAzulReconnectRequiredError(
  error: unknown,
): error is ContaAzulReconnectRequiredError {
  return error instanceof ContaAzulReconnectRequiredError;
}

export const INTEGRATION_TARGETS = [
  "customer",
  "service_order",
  "billing_document",
] as const satisfies readonly IntegrationSyncTarget[];

const CONTA_AZUL_SCHEDULED_SYNC_TARGETS = [
  "catalog_item",
  "contract",
  "customer",
  "supplier",
  "transporter",
  "service_order",
  "billing_document",
  "payable",
] as const satisfies readonly IntegrationSyncTarget[];

export const DEFAULT_INTEGRATION_SYNC_LIMIT = 50;
export const DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS = 30 * 60 * 1000;
export const DEFAULT_CONTA_AZUL_FISCAL_POLLING_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_CONTA_AZUL_PROTOCOL_POLLING_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_CONTA_AZUL_DRIFT_POLLING_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_CONTA_AZUL_PRODUCT_STOCK_POLLING_INTERVAL_MS =
  4 * 60 * 60 * 1000;
const CONTA_AZUL_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const CONTA_AZUL_RECEIVABLES_CURSOR_TYPE = "conta_azul_receivables";
const CONTA_AZUL_PAYABLES_CURSOR_TYPE = "conta_azul_payables";
const CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE = "conta_azul_fiscal_documents";
const CONTA_AZUL_PROTOCOLS_CURSOR_TYPE = "conta_azul_protocols";
const CONTA_AZUL_DRIFT_CURSOR_TYPE = "conta_azul_remote_drift";
const CONTA_AZUL_PRODUCT_STOCK_CURSOR_TYPE = "conta_azul_product_stock";

export type ContaAzulScheduledPollKind =
  | "paymentStatusPolling"
  | "payables"
  | "fiscalDocuments"
  | "protocols"
  | "driftChecks"
  | "productStock";

type ContaAzulPollDefinition = {
  kind: ContaAzulScheduledPollKind;
  cursorType: string;
  target: IntegrationSyncTarget;
  intervalMs: number;
  disabledMessage: string;
  failedMessage: string;
  completedEvent: string;
};

const CONTA_AZUL_POLL_DEFINITIONS = [
  {
    kind: "paymentStatusPolling",
    cursorType: CONTA_AZUL_RECEIVABLES_CURSOR_TYPE,
    target: "billing_document",
    intervalMs: DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS,
    disabledMessage: "Polling de pagamentos da Conta Azul está desativado",
    failedMessage: "Falha no polling de pagamentos da Conta Azul",
    completedEvent: "integration.conta_azul.payment_poll.completed",
  },
  {
    kind: "payables",
    cursorType: CONTA_AZUL_PAYABLES_CURSOR_TYPE,
    target: "payable",
    intervalMs: DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS,
    disabledMessage: "Polling de contas a pagar da Conta Azul está desativado",
    failedMessage: "Falha no polling de contas a pagar da Conta Azul",
    completedEvent: "integration.conta_azul.payable_poll.completed",
  },
  {
    kind: "fiscalDocuments",
    cursorType: CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE,
    target: "billing_document",
    intervalMs: DEFAULT_CONTA_AZUL_FISCAL_POLLING_INTERVAL_MS,
    disabledMessage: "Sincronização fiscal da Conta Azul está desativada",
    failedMessage: "Falha no polling fiscal da Conta Azul",
    completedEvent: "integration.conta_azul.fiscal_poll.completed",
  },
  {
    kind: "protocols",
    cursorType: CONTA_AZUL_PROTOCOLS_CURSOR_TYPE,
    target: "service_order",
    intervalMs: DEFAULT_CONTA_AZUL_PROTOCOL_POLLING_INTERVAL_MS,
    disabledMessage: "Polling de protocolos da Conta Azul está desativado",
    failedMessage: "Falha no polling de protocolos da Conta Azul",
    completedEvent: "integration.conta_azul.protocol_poll.completed",
  },
  {
    kind: "driftChecks",
    cursorType: CONTA_AZUL_DRIFT_CURSOR_TYPE,
    target: "billing_document",
    intervalMs: DEFAULT_CONTA_AZUL_DRIFT_POLLING_INTERVAL_MS,
    disabledMessage: "Verificação de drift da Conta Azul está desativada",
    failedMessage: "Falha na verificação de drift da Conta Azul",
    completedEvent: "integration.conta_azul.drift_poll.completed",
  },
  {
    kind: "productStock",
    cursorType: CONTA_AZUL_PRODUCT_STOCK_CURSOR_TYPE,
    target: "catalog_item",
    intervalMs: DEFAULT_CONTA_AZUL_PRODUCT_STOCK_POLLING_INTERVAL_MS,
    disabledMessage: "Sincronização de produtos da Conta Azul está desativada",
    failedMessage: "Falha no polling de estoque de produtos da Conta Azul",
    completedEvent: "integration.conta_azul.product_stock_poll.completed",
  },
] as const satisfies readonly ContaAzulPollDefinition[];

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

export function createIntegrationPayloadFingerprint(
  payload: IntegrationSyncPayload,
) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function getMasterKey(env: IntegrationsEnv) {
  if (!env.INTEGRATIONS_MASTER_KEY) {
    throw new Error("INTEGRATIONS_MASTER_KEY não configurada");
  }

  return env.INTEGRATIONS_MASTER_KEY;
}

export function encryptIntegrationSecret(secret: string, env: IntegrationsEnv) {
  const { encryptedPassword, iv } = encryptPassword(secret, getMasterKey(env));
  return { encryptedSecret: encryptedPassword, secretIv: iv };
}

export function decryptIntegrationSecret(
  encryptedSecret: string,
  secretIv: string,
  env: IntegrationsEnv,
) {
  return decryptPassword(encryptedSecret, secretIv, getMasterKey(env));
}

export function buildGenericConnectionConfig(input: {
  baseUrl: string;
  healthPath?: string;
  customerPath?: string;
  serviceOrderPath?: string;
  billingDocumentPath?: string;
  schedules?: GenericFinancialErpConnectionConfig["schedules"];
  mappings?: Partial<IntegrationMappingsConfig>;
}) {
  return normalizeGenericFinancialErpConfig(input);
}

function toIsoDate(value?: Date | null) {
  return value?.toISOString?.() ?? null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calculateNextScheduledRunAt(
  frequency: IntegrationScheduleFrequency,
  from: Date,
) {
  const next = new Date(from);
  next.setMilliseconds(0);

  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

export function getTargetScheduleConfig(
  config: Pick<FinancialErpConnectionConfig, "schedules">,
  target: IntegrationSyncTarget,
) {
  return config.schedules[target];
}

export function updateTargetScheduleConfig(params: {
  config: FinancialErpConnectionConfig;
  target: IntegrationSyncTarget;
  mode?: IntegrationRunMode;
  frequency?: IntegrationScheduleFrequency;
  nextScheduledRunAt?: string | null;
  lastScheduledRunAt?: string | null;
}) {
  const provider =
    "provider" in params.config ? params.config.provider : "generic_http";
  return normalizeFinancialErpConnectionConfig(provider, {
    ...params.config,
    schedules: {
      ...params.config.schedules,
      [params.target]: {
        ...params.config.schedules[params.target],
        mode: params.mode ?? params.config.schedules[params.target].mode,
        frequency:
          params.frequency ?? params.config.schedules[params.target].frequency,
        nextScheduledRunAt:
          params.nextScheduledRunAt === undefined
            ? params.config.schedules[params.target].nextScheduledRunAt
            : params.nextScheduledRunAt,
        lastScheduledRunAt:
          params.lastScheduledRunAt === undefined
            ? params.config.schedules[params.target].lastScheduledRunAt
            : params.lastScheduledRunAt,
      },
    },
  });
}

function buildAuthHeaders(secret: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

async function callRemoteJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") ?? "";

  let data: unknown = null;
  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => null);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function extractRemoteId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const record = toRecord(data);
  if (typeof record.remoteId === "string" && record.remoteId.trim()) {
    return record.remoteId;
  }
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id;
  }
  if (typeof record.id === "number") {
    return String(record.id);
  }

  return null;
}

export async function validateGenericConnection(
  config: GenericFinancialErpConnectionConfig,
  secret: string,
) {
  return createFinancialErpAdapter({
    provider: "generic_http",
    integrationId: "validation",
    organizationId: "validation",
    config,
    secret,
  }).validateConnection();
}

export async function listOrganizationIntegrations(organizationId: string) {
  return db.query.organizationIntegration.findMany({
    where: eq(organizationIntegration.organizationId, organizationId),
    with: {
      connection: true,
    },
    orderBy: [desc(organizationIntegration.createdAt)],
  });
}

export async function getIntegrationRecord(
  organizationId: string,
  integrationId: string,
): Promise<GenericConnectionRecord | null> {
  const integration = await db.query.organizationIntegration.findFirst({
    where: and(
      eq(organizationIntegration.id, integrationId),
      eq(organizationIntegration.organizationId, organizationId),
    ),
    with: {
      connection: true,
    },
  });

  if (!integration?.connection) {
    return null;
  }

  return {
    integration,
    connection: {
      ...integration.connection,
      config: normalizeFinancialErpConnectionConfig(
        integration.provider,
        integration.connection.config,
      ),
    },
  };
}

export async function writeIntegrationEvent(params: {
  integrationId: string;
  organizationId: string;
  runId?: string | null;
  level: "info" | "warning" | "error";
  event: string;
  message: string;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(integrationEventLog).values({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    runId: params.runId ?? null,
    level: params.level,
    event: params.event,
    message: params.message,
    details: params.details ?? null,
  });
}

export async function markContaAzulReconnectRequired(params: {
  integrationId: string;
  organizationId: string;
  message: string;
  details?: Record<string, unknown> | null;
}) {
  await db
    .update(organizationIntegration)
    .set({
      status: "ACTION_REQUIRED",
      lastValidationError: params.message,
      updatedAt: new Date(),
    })
    .where(eq(organizationIntegration.id, params.integrationId));

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: "error",
    event: "integration.conta_azul.reconnect_required",
    message: params.message,
    details: {
      provider: "conta_azul",
      ...params.details,
    },
  });
}

export async function writeOrganizationIntegrationEvent(params: {
  organizationId: string;
  actorUserId: string;
  actorMemberId?: string | null;
  action: string;
  entityId: string;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(organizationEventLog).values({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    actorMemberId: params.actorMemberId ?? null,
    action: params.action,
    entityType: "integration",
    entityId: params.entityId,
    details: params.details ?? null,
  });
}

async function loadCustomerPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationCustomerPayload[]> {
  const rows = await db
    .select({
      id: customer.id,
      name: customer.name,
      taxId: customer.taxId,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    })
    .from(customer)
    .where(eq(customer.labOrganizationId, organizationId))
    .limit(limit)
    .orderBy(desc(customer.updatedAt));

  return rows.map((row) => mapCustomerRowToPayload(row, organizationId));
}

function mapCustomerRowToPayload(
  row: {
    id: number;
    name: string;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    address: (typeof customer.$inferSelect)["address"];
    createdAt: Date | null;
    updatedAt: Date | null;
  },
  organizationId: string,
): IntegrationCustomerPayload {
  return {
    externalId: `customer:${row.id}`,
    organizationId,
    name: row.name,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    address: formatIntegrationCustomerAddress(row.address),
    addressParts: row.address,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  };
}

async function loadCustomerPayloadByExternalId(
  organizationId: string,
  externalId: string,
): Promise<IntegrationCustomerPayload | null> {
  const match = externalId.match(/^customer:(\d+)$/);
  if (!match?.[1]) return null;

  const customerId = Number(match[1]);
  if (!Number.isInteger(customerId) || customerId <= 0) return null;

  const [row] = await db
    .select({
      id: customer.id,
      name: customer.name,
      taxId: customer.taxId,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    })
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.labOrganizationId, organizationId),
      ),
    )
    .limit(1);

  return row ? mapCustomerRowToPayload(row, organizationId) : null;
}

function normalizeDocumentDigits(value: string | null | undefined) {
  return value?.replace(/\D+/g, "") ?? "";
}

function buildPessoaExternalId(params: {
  role: "supplier" | "transporter";
  sourceId: number;
  document: string | null;
}) {
  const documentDigits = normalizeDocumentDigits(params.document);
  return documentDigits.length > 0
    ? `${params.role}:document:${documentDigits}`
    : `${params.role}:service_order:${params.sourceId}`;
}

function dedupePessoaPayloads<
  TPayload extends IntegrationSupplierPayload | IntegrationTransporterPayload,
>(payloads: TPayload[], limit: number) {
  const deduped = new Map<string, TPayload>();

  for (const payload of payloads) {
    if (!deduped.has(payload.externalId)) {
      deduped.set(payload.externalId, payload);
    }
    if (deduped.size >= limit) {
      break;
    }
  }

  return [...deduped.values()];
}

async function loadSupplierPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationSupplierPayload[]> {
  const rows = await db
    .select({
      id: serviceOrder.id,
      name: serviceOrder.thirdPartyName,
      taxId: serviceOrder.thirdPartyDocument,
      phone: serviceOrder.thirdPartyPhone,
      createdAt: serviceOrder.createdAt,
      updatedAt: serviceOrder.updatedAt,
    })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.organizationId, organizationId),
        isNotNull(serviceOrder.thirdPartyName),
      ),
    )
    .orderBy(desc(serviceOrder.updatedAt));

  return dedupePessoaPayloads(
    rows
      .filter((row) => row.name?.trim())
      .map((row) => ({
        externalId: buildPessoaExternalId({
          role: "supplier",
          sourceId: row.id,
          document: row.taxId,
        }),
        organizationId,
        pessoaRole: "supplier",
        name: row.name?.trim() ?? "",
        taxId: row.taxId,
        email: null,
        phone: row.phone,
        address: null,
        createdAt: row.createdAt?.toISOString?.() ?? null,
        updatedAt: row.updatedAt?.toISOString?.() ?? null,
      })),
    limit,
  );
}

async function loadTransporterPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationTransporterPayload[]> {
  const rows = await db
    .select({
      id: serviceOrder.id,
      name: serviceOrder.carrierName,
      taxId: serviceOrder.carrierDocument,
      createdAt: serviceOrder.createdAt,
      updatedAt: serviceOrder.updatedAt,
    })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.organizationId, organizationId),
        isNotNull(serviceOrder.carrierName),
      ),
    )
    .orderBy(desc(serviceOrder.updatedAt));

  return dedupePessoaPayloads(
    rows
      .filter((row) => row.name?.trim())
      .map((row) => ({
        externalId: buildPessoaExternalId({
          role: "transporter",
          sourceId: row.id,
          document: row.taxId,
        }),
        organizationId,
        pessoaRole: "transporter",
        name: row.name?.trim() ?? "",
        taxId: row.taxId,
        email: null,
        phone: null,
        address: null,
        createdAt: row.createdAt?.toISOString?.() ?? null,
        updatedAt: row.updatedAt?.toISOString?.() ?? null,
      })),
    limit,
  );
}

export async function failIntegrationSyncRun(params: {
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  message: string;
  details?: Record<string, unknown> | null;
}) {
  await db
    .update(integrationSyncRun)
    .set({
      status: "FAILED",
      errorSummary: params.message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(integrationSyncRun.id, params.runId));

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    runId: params.runId,
    level: "error",
    event: "sync.failed",
    message: params.message,
    details: {
      target: params.target,
      ...params.details,
    },
  });
}

async function loadServiceOrderPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationServiceOrderPayload[]> {
  const rows = await db
    .select({
      id: calibrationJob.id,
      unitId: calibrationJob.unitId,
      unitName: organizationUnit.name,
      jobId: calibrationJob.jobId,
      status: calibrationJob.status,
      customerId: customer.id,
      customerName: customer.name,
      serviceId: service.id,
      assetName: asset.name,
      assetTag: asset.tag,
      serviceName: service.name,
      servicePrice: service.price,
      serviceCurrency: service.currency,
      performedAt: calibrationJob.performedAt,
      approvedAt: calibrationJob.approvedAt,
      updatedAt: calibrationJob.updatedAt,
    })
    .from(calibrationJob)
    .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
    .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
    .leftJoin(service, eq(calibrationJob.serviceId, service.id))
    .leftJoin(organizationUnit, eq(calibrationJob.unitId, organizationUnit.id))
    .where(
      and(
        eq(calibrationJob.organizationId, organizationId),
        inArray(calibrationJob.status, [
          "DRAFT",
          "IN_PROGRESS",
          "REVIEW",
          "APPROVED",
          "SUPERSEDED",
        ]),
      ),
    )
    .limit(limit)
    .orderBy(desc(calibrationJob.updatedAt));

  return rows.map((row) => ({
    externalId: `service_order:${row.id}`,
    organizationId,
    unitId: row.unitId,
    unitName: row.unitName ?? null,
    jobId: row.jobId,
    status: row.status,
    customerExternalId: row.customerId ? `customer:${row.customerId}` : null,
    customerName: row.customerName ?? null,
    serviceExternalId: row.serviceId ? `service:${row.serviceId}` : null,
    assetName: row.assetName ?? null,
    assetTag: row.assetTag ?? null,
    serviceName: row.serviceName ?? null,
    servicePriceCents: row.servicePrice ?? null,
    currency: row.serviceCurrency ?? null,
    performedAt: row.performedAt?.toISOString?.() ?? null,
    approvedAt: row.approvedAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }));
}

async function loadBillingDocumentPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationBillingDocumentPayload[]> {
  return loadBillingDocumentPayloadsForIntegration(organizationId, limit);
}

async function loadPayablePayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationPayablePayload[]> {
  const rows = await db
    .select({
      serviceOrderId: serviceOrder.id,
      serviceOrderNumber: serviceOrder.serviceOrderNumber,
      supplierDocument: serviceOrder.thirdPartyDocument,
      itemId: serviceOrderExecutionItem.id,
      description: serviceOrderExecutionItem.description,
      quantity: serviceOrderExecutionItem.quantity,
      unitCostCents: serviceOrderExecutionItem.unitCostCents,
      finishedAt: serviceOrderExecution.finishedAt,
      updatedAt: serviceOrder.updatedAt,
    })
    .from(serviceOrderExecutionItem)
    .innerJoin(
      serviceOrderExecution,
      eq(serviceOrderExecutionItem.executionId, serviceOrderExecution.id),
    )
    .innerJoin(
      serviceOrder,
      eq(serviceOrderExecution.serviceOrderId, serviceOrder.id),
    )
    .where(
      and(
        eq(serviceOrder.organizationId, organizationId),
        isNotNull(serviceOrder.thirdPartyName),
        isNotNull(serviceOrderExecution.finishedAt),
        gt(serviceOrderExecutionItem.unitCostCents, 0),
      ),
    )
    .limit(limit)
    .orderBy(desc(serviceOrderExecution.finishedAt));

  return rows
    .map((row) => {
      const amountCents = Math.round(
        Number(row.quantity ?? 1) * Number(row.unitCostCents ?? 0),
      );
      const payableDate = row.finishedAt ?? row.updatedAt;

      return {
        externalId: `payable:service_order_execution_item:${row.itemId}`,
        organizationId,
        supplierExternalId: buildPessoaExternalId({
          role: "supplier",
          sourceId: row.serviceOrderId,
          document: row.supplierDocument,
        }),
        documentNumber: row.serviceOrderNumber,
        issueDate: payableDate.toISOString(),
        dueDate: payableDate.toISOString(),
        competenceDate: payableDate.toISOString(),
        amountCents,
        currency: "BRL",
        categoryId: null,
        costCenterId: null,
        notes: `Custo terceirizado da OS ${row.serviceOrderNumber}: ${row.description}`,
      } satisfies IntegrationPayablePayload;
    })
    .filter((payload) => payload.amountCents > 0);
}

export async function loadCatalogItemPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationCatalogItemPayload[]> {
  const serviceRows = await db
    .select({
      id: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      currency: service.currency,
      isActive: service.isActive,
      updatedAt: service.updatedAt,
    })
    .from(service)
    .where(eq(service.organizationId, organizationId))
    .orderBy(desc(service.updatedAt))
    .limit(limit);

  // Materials (peças/materiais consumed on service orders) are the product
  // half of the Conta Azul catalog: /v1/servicos for services, /v1/produtos
  // for materials. externalId "material:{id}" keeps the object-link namespace
  // disjoint from "service:{id}".
  const materialRows = await db
    .select({
      id: material.id,
      name: material.name,
      description: material.description,
      sku: material.sku,
      unitPriceCents: material.unitPriceCents,
      isActive: material.isActive,
      updatedAt: material.updatedAt,
    })
    .from(material)
    .where(eq(material.organizationId, organizationId))
    .orderBy(desc(material.updatedAt))
    .limit(limit);

  const entries: Array<{
    updatedAt: Date;
    payload: IntegrationCatalogItemPayload;
  }> = [
    ...serviceRows.map((row) => ({
      updatedAt: row.updatedAt,
      payload: {
        externalId: `service:${row.id}`,
        organizationId,
        kind: "service" as const,
        code: `SVC-${row.id}`,
        name: row.name,
        description: row.description,
        priceCents: row.price,
        currency: row.currency,
        unitOfMeasureId: null,
        categoryId: null,
        fiscalMetadata: null,
        active: row.isActive,
      },
    })),
    ...materialRows.map((row) => ({
      updatedAt: row.updatedAt,
      payload: {
        externalId: `material:${row.id}`,
        organizationId,
        kind: "product" as const,
        code: row.sku ?? `MAT-${row.id}`,
        name: row.name,
        description: row.description,
        priceCents: row.unitPriceCents,
        currency: "BRL",
        unitOfMeasureId: null,
        categoryId: null,
        fiscalMetadata: null,
        active: row.isActive,
      },
    })),
  ];

  entries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return entries.slice(0, limit).map((entry) => entry.payload);
}

/**
 * Restrict catalog payloads to the kinds the Conta Azul connection actually
 * enabled: `enabledTargets.services` gates service items (/v1/servicos) and
 * `enabledTargets.products` gates product items (/v1/produtos, i.e. the
 * materials catalog). Applied before run/preview so a service-only setup
 * never creates surprise products (or noisy failed sync items) in the ERP.
 */
export function filterContaAzulCatalogPayloadsByEnabledKinds(
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>,
  payloads: IntegrationCatalogItemPayload[],
): IntegrationCatalogItemPayload[] {
  return payloads.filter((payload) =>
    payload.kind === "service"
      ? config.enabledTargets.services
      : config.enabledTargets.products,
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function loadContractPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationContractPayload[]> {
  const agreements = await db
    .select({
      id: commercialAgreement.id,
      customerId: commercialAgreement.customerId,
      agreementCode: commercialAgreement.agreementCode,
      title: commercialAgreement.title,
      currency: commercialAgreement.currency,
      effectiveFrom: commercialAgreement.effectiveFrom,
      effectiveTo: commercialAgreement.effectiveTo,
      defaultPaymentTermDays: commercialAgreement.defaultPaymentTermDays,
      notes: commercialAgreement.notes,
    })
    .from(commercialAgreement)
    .where(
      and(
        eq(commercialAgreement.organizationId, organizationId),
        eq(commercialAgreement.status, "ACTIVE"),
      ),
    )
    .orderBy(desc(commercialAgreement.updatedAt))
    .limit(limit);

  const payloads: IntegrationContractPayload[] = [];
  for (const agreement of agreements) {
    const terms = await db
      .select({
        id: commercialAgreementServiceTerm.id,
        serviceId: commercialAgreementServiceTerm.serviceId,
        priceCents: commercialAgreementServiceTerm.priceCents,
        currency: commercialAgreementServiceTerm.currency,
        isActive: commercialAgreementServiceTerm.isActive,
        serviceName: service.name,
      })
      .from(commercialAgreementServiceTerm)
      .innerJoin(
        service,
        eq(commercialAgreementServiceTerm.serviceId, service.id),
      )
      .where(
        and(
          eq(commercialAgreementServiceTerm.agreementId, agreement.id),
          eq(commercialAgreementServiceTerm.isActive, true),
          gt(commercialAgreementServiceTerm.priceCents, 0),
        ),
      );

    const totalCents = terms.reduce(
      (sum, term) => sum + Math.max(0, term.priceCents),
      0,
    );
    if (terms.length === 0 || totalCents <= 0) {
      continue;
    }

    const firstDueDate = addDays(
      agreement.effectiveFrom,
      agreement.defaultPaymentTermDays,
    )
      .toISOString()
      .slice(0, 10);

    payloads.push({
      externalId: `contract:${agreement.id}`,
      organizationId,
      customerExternalId: `customer:${agreement.customerId}`,
      contractNumber: agreement.agreementCode,
      recurrence: "monthly",
      issueDate: agreement.effectiveFrom.toISOString(),
      startsAt: agreement.effectiveFrom.toISOString(),
      endsAt: agreement.effectiveTo?.toISOString() ?? null,
      sellerExternalId: null,
      totalCents,
      currency: agreement.currency,
      categoryId: null,
      costCenterId: null,
      notes: [agreement.title, agreement.notes].filter(Boolean).join("\n"),
      items: terms.map((term) => ({
        lineId: `contract:${agreement.id}:term:${term.id}`,
        catalogItemExternalId: `service:${term.serviceId}`,
        description: term.serviceName,
        quantity: 1,
        unitPriceCents: term.priceCents,
        totalCents: term.priceCents,
      })),
      paymentTerms: {
        paymentMethodId: null,
        financialAccountId: null,
        paymentConditionLabel: "Recorrente mensal",
        dueDate: firstDueDate,
        dueDay: Number(firstDueDate.slice(8, 10)),
        firstDueDate,
        installments: [],
      },
    });
  }

  return payloads;
}

async function loadTargetPayloads(
  organizationId: string,
  target: IntegrationSyncTarget,
  limit: number,
) {
  switch (target) {
    case "catalog_item":
      return loadCatalogItemPayloads(organizationId, limit);
    case "contract":
      return loadContractPayloads(organizationId, limit);
    case "customer":
      return loadCustomerPayloads(organizationId, limit);
    case "supplier":
      return loadSupplierPayloads(organizationId, limit);
    case "transporter":
      return loadTransporterPayloads(organizationId, limit);
    case "service_order":
      return loadServiceOrderPayloads(organizationId, limit);
    case "billing_document":
      return loadBillingDocumentPayloads(organizationId, limit);
    case "payable":
      return loadPayablePayloads(organizationId, limit);
  }
}

async function countLocalTargetRecords(
  organizationId: string,
  target: IntegrationSyncTarget,
) {
  switch (target) {
    case "catalog_item": {
      const [row] = await db
        .select({ total: count() })
        .from(service)
        .where(eq(service.organizationId, organizationId));
      return Number(row?.total ?? 0);
    }
    case "contract": {
      const [row] = await db
        .select({ total: count() })
        .from(commercialAgreement)
        .where(
          and(
            eq(commercialAgreement.organizationId, organizationId),
            eq(commercialAgreement.status, "ACTIVE"),
          ),
        );
      return Number(row?.total ?? 0);
    }
    case "customer": {
      const [row] = await db
        .select({ total: count() })
        .from(customer)
        .where(eq(customer.labOrganizationId, organizationId));
      return Number(row?.total ?? 0);
    }
    case "supplier": {
      const rows = await db
        .select({
          id: serviceOrder.id,
          name: serviceOrder.thirdPartyName,
          taxId: serviceOrder.thirdPartyDocument,
        })
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.organizationId, organizationId),
            isNotNull(serviceOrder.thirdPartyName),
          ),
        );
      return new Set(
        rows
          .filter((row) => row.name?.trim())
          .map((row) =>
            buildPessoaExternalId({
              role: "supplier",
              sourceId: row.id,
              document: row.taxId,
            }),
          ),
      ).size;
    }
    case "transporter": {
      const rows = await db
        .select({
          id: serviceOrder.id,
          name: serviceOrder.carrierName,
          taxId: serviceOrder.carrierDocument,
        })
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.organizationId, organizationId),
            isNotNull(serviceOrder.carrierName),
          ),
        );
      return new Set(
        rows
          .filter((row) => row.name?.trim())
          .map((row) =>
            buildPessoaExternalId({
              role: "transporter",
              sourceId: row.id,
              document: row.taxId,
            }),
          ),
      ).size;
    }
    case "service_order": {
      const [row] = await db
        .select({ total: count() })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.organizationId, organizationId),
            inArray(calibrationJob.status, [
              "DRAFT",
              "IN_PROGRESS",
              "REVIEW",
              "APPROVED",
              "SUPERSEDED",
            ]),
          ),
        );
      return Number(row?.total ?? 0);
    }
    case "billing_document": {
      const payloads = await loadBillingDocumentPayloadsForIntegration(
        organizationId,
        500,
      );
      return payloads.length;
    }
    case "payable": {
      const [row] = await db
        .select({ total: count() })
        .from(serviceOrderExecutionItem)
        .innerJoin(
          serviceOrderExecution,
          eq(serviceOrderExecutionItem.executionId, serviceOrderExecution.id),
        )
        .innerJoin(
          serviceOrder,
          eq(serviceOrderExecution.serviceOrderId, serviceOrder.id),
        )
        .where(
          and(
            eq(serviceOrder.organizationId, organizationId),
            isNotNull(serviceOrder.thirdPartyName),
            isNotNull(serviceOrderExecution.finishedAt),
            gt(serviceOrderExecutionItem.unitCostCents, 0),
          ),
        );
      return Number(row?.total ?? 0);
    }
  }
}

async function countLinkedTargetRecords(
  integrationId: string,
  target: IntegrationSyncTarget,
) {
  const [row] = await db
    .select({ total: count() })
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.integrationId, integrationId),
        eq(integrationObjectLink.target, target),
      ),
    );

  return Number(row?.total ?? 0);
}

function hasRemoteValidation(record: GenericConnectionRecord) {
  return Boolean(
    record.integration.lastValidatedAt &&
    !record.integration.lastValidationError,
  );
}

function isContaAzulCommercialCatalogEnabled(
  config: ContaAzulConnectionConfig,
) {
  return config.enabledTargets.services || config.enabledTargets.products;
}

function isContaAzulCommercialExportEnabled(config: ContaAzulConnectionConfig) {
  return (
    config.enabledTargets.sales ||
    (config.exportMode === "budget_to_sale" && config.enabledTargets.budgets)
  );
}

export function buildDependencyWarnings(params: {
  target: IntegrationSyncTarget;
  provider: (typeof organizationIntegration.$inferSelect)["provider"];
  config: FinancialErpConnectionConfig;
  integrationStatus: (typeof organizationIntegration.$inferSelect)["status"];
  validated: boolean;
  coverageByTarget: Record<
    IntegrationSyncTarget,
    IntegrationTargetCoverageSummary
  >;
}) {
  const warnings: IntegrationDependencyWarning[] = [];

  if (params.integrationStatus !== "ACTIVE") {
    warnings.push({
      code: "INTEGRATION_DISABLED",
      target: params.target,
      severity: "error",
      message: "Ative a integração antes de sincronizar este alvo.",
    });
  }

  if (!params.validated) {
    warnings.push({
      code: "VALIDATION_REQUIRED",
      target: params.target,
      severity: "error",
      message: "Valide a conexão antes de executar sincronizações.",
    });
  }

  if (
    params.provider === "conta_azul" &&
    (params.target === "catalog_item" ||
      params.target === "contract" ||
      params.target === "supplier" ||
      params.target === "transporter") &&
    !isContaAzulTargetEnabled(
      normalizeContaAzulConnectionConfig(params.config),
      params.target,
    )
  ) {
    warnings.push({
      code: "REMOTE_CONFIG_MISSING",
      target: params.target,
      severity: "error",
      message:
        params.target === "catalog_item"
          ? "Habilite catálogo de serviços ou produtos da Conta Azul antes de sincronizar catálogo."
          : params.target === "contract"
            ? "Habilite contratos da Conta Azul antes de sincronizar contratos recorrentes."
            : params.target === "supplier"
              ? "Habilite fornecedores da Conta Azul antes de sincronizar terceiros."
              : "Habilite transportadoras da Conta Azul antes de sincronizar transportadoras.",
    });
  }

  if (
    (params.target === "catalog_item" || params.target === "contract") &&
    params.provider === "generic_http"
  ) {
    warnings.push({
      code: "REMOTE_CONFIG_MISSING",
      target: params.target,
      severity: "error",
      message:
        "Este alvo é suportado pelo provider nativo Conta Azul; o conector HTTP genérico permanece separado.",
    });
  }

  if (params.target === "contract" && params.provider === "conta_azul") {
    const config = normalizeContaAzulConnectionConfig(params.config);
    const customerCoverage = params.coverageByTarget.customer;
    const catalogCoverage = params.coverageByTarget.catalog_item;

    if (customerCoverage.localCount > customerCoverage.linkedCount) {
      warnings.push({
        code: "CUSTOMERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem clientes locais sem vínculo remoto. Sincronize clientes antes dos contratos.",
      });
    }

    if (catalogCoverage.localCount > catalogCoverage.linkedCount) {
      warnings.push({
        code: "CATALOG_NOT_ENABLED",
        target: params.target,
        severity: "warning",
        message:
          "Existem itens de catálogo sem vínculo remoto. Sincronize ou vincule produtos/serviços antes dos contratos.",
      });
    }

    if (!config.defaultFinancialAccountId) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Selecione uma conta financeira padrão da Conta Azul antes de exportar contratos.",
      });
    }
  }

  if (params.target === "service_order") {
    const customerCoverage = params.coverageByTarget.customer;

    if (customerCoverage.localCount > customerCoverage.linkedCount) {
      warnings.push({
        code: "CUSTOMERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem clientes locais sem vínculo remoto. Sincronize clientes antes das ordens de serviço.",
      });
    }

    if (params.provider === "conta_azul") {
      const config = normalizeContaAzulConnectionConfig(params.config);
      const serviceOrderSyncEnabled =
        isContaAzulCommercialExportEnabled(config);

      if (!serviceOrderSyncEnabled) {
        warnings.push({
          code: "REMOTE_CONFIG_MISSING",
          target: params.target,
          severity: "error",
          message:
            "Habilite vendas ou orçamentos na Conta Azul antes de sincronizar ordens de serviço.",
        });
      }

      if (
        serviceOrderSyncEnabled &&
        !isContaAzulCommercialCatalogEnabled(config)
      ) {
        warnings.push({
          code: "CATALOG_NOT_ENABLED",
          target: params.target,
          severity: "warning",
          message:
            "Habilite catálogo de serviços ou produtos para resolver os itens comerciais exigidos pelas vendas/orçamentos da Conta Azul.",
        });
      }
    }
  }

  if (
    params.target === "billing_document" &&
    params.provider === "generic_http"
  ) {
    const customerCoverage = params.coverageByTarget.customer;
    const serviceOrderCoverage = params.coverageByTarget.service_order;

    if (customerCoverage.localCount > customerCoverage.linkedCount) {
      warnings.push({
        code: "CUSTOMERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem clientes locais sem vínculo remoto. Sincronize clientes antes do faturamento.",
      });
    }

    if (serviceOrderCoverage.localCount > serviceOrderCoverage.linkedCount) {
      warnings.push({
        code: "SERVICE_ORDERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem ordens de serviço sem vínculo remoto. Sincronize ordens antes do faturamento.",
      });
    }
  }

  if (
    params.target === "billing_document" &&
    params.provider === "conta_azul"
  ) {
    const config = normalizeContaAzulConnectionConfig(params.config);
    const customerCoverage = params.coverageByTarget.customer;

    if (customerCoverage.localCount > customerCoverage.linkedCount) {
      warnings.push({
        code: "CUSTOMERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem clientes locais sem vínculo remoto. Sincronize clientes antes do faturamento.",
      });
    }

    if (!config.defaultFinancialAccountId) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Selecione uma conta financeira padrão da Conta Azul antes de exportar recebíveis.",
      });
    }

    if (
      (config.exportMode === "sale" ||
        config.exportMode === "sale_and_receivable") &&
      !isContaAzulCommercialCatalogEnabled(config)
    ) {
      warnings.push({
        code: "CATALOG_NOT_ENABLED",
        target: params.target,
        severity: "warning",
        message:
          "Habilite catálogo de serviços ou produtos para resolver os itens comerciais exigidos pelas vendas da Conta Azul.",
      });
    }
  }

  if (params.target === "payable" && params.provider === "conta_azul") {
    const config = normalizeContaAzulConnectionConfig(params.config);
    const supplierCoverage = params.coverageByTarget.supplier;

    if (!config.enabledTargets.payables && !config.enabledTargets.expenses) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Habilite contas a pagar ou despesas na Conta Azul antes de exportar obrigações de terceiros.",
      });
    }

    if (!config.enabledTargets.suppliers) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Habilite fornecedores da Conta Azul antes de exportar contas a pagar.",
      });
    }

    if (supplierCoverage.localCount > supplierCoverage.linkedCount) {
      warnings.push({
        code: "SUPPLIERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem fornecedores locais sem vínculo remoto. Sincronize fornecedores antes das contas a pagar.",
      });
    }

    if (!config.defaultFinancialAccountId) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Selecione uma conta financeira padrão da Conta Azul antes de exportar contas a pagar.",
      });
    }
  }

  return warnings;
}

function dedupeDependencyWarnings(
  warnings: IntegrationDependencyWarning[],
): IntegrationDependencyWarning[] {
  const map = new Map<string, IntegrationDependencyWarning>();

  for (const warning of warnings) {
    const key = `${warning.target}:${warning.code}`;
    if (!map.has(key)) {
      map.set(key, warning);
    }
  }

  return Array.from(map.values());
}

function getIntegrationOverviewTargets(
  provider: (typeof organizationIntegration.$inferSelect)["provider"],
): readonly IntegrationSyncTarget[] {
  return provider === "conta_azul"
    ? CONTA_AZUL_SCHEDULED_SYNC_TARGETS
    : INTEGRATION_TARGETS;
}

function buildSetupStatus(params: {
  record: GenericConnectionRecord;
  validated: boolean;
}): IntegrationSetupStatus {
  const baseUrl = params.record.connection.config.baseUrl.trim();

  if (!baseUrl || !params.record.connection.encryptedSecret) {
    return "NOT_CONFIGURED";
  }

  if (params.record.integration.lastValidationError) {
    return "ACTION_REQUIRED";
  }

  if (params.validated) {
    return "READY";
  }

  return "CONFIGURED";
}

function buildReadinessStatus(params: {
  setupStatus: IntegrationSetupStatus;
  canSync: boolean;
  dependencyWarnings: IntegrationDependencyWarning[];
}): IntegrationReadinessStatus {
  if (params.setupStatus === "NOT_CONFIGURED") {
    return "NOT_READY";
  }

  if (!params.canSync) {
    return "NOT_READY";
  }

  return params.dependencyWarnings.length > 0 ? "DEGRADED" : "READY";
}

function buildPreviewSampleRecord(
  payload: IntegrationSyncPayload,
  mappedPayload: Record<string, unknown>,
  issues: string[],
) {
  if ("kind" in payload) {
    return {
      externalId: payload.externalId,
      label: payload.name,
      subtitle: payload.code ?? payload.kind,
      mappedPayload,
      issues,
    };
  }

  if ("pessoaRole" in payload || ("name" in payload && "taxId" in payload)) {
    return {
      externalId: payload.externalId,
      label: payload.name,
      subtitle: payload.email ?? payload.taxId ?? null,
      mappedPayload,
      issues,
    };
  }

  if ("recurrence" in payload) {
    return {
      externalId: payload.externalId,
      label: payload.contractNumber
        ? `Contrato ${payload.contractNumber}`
        : `Contrato ${payload.externalId}`,
      subtitle: payload.customerExternalId ?? payload.startsAt ?? null,
      mappedPayload,
      issues,
    };
  }

  if ("assetName" in payload) {
    return {
      externalId: payload.externalId,
      label: `OS ${payload.jobId}`,
      subtitle:
        payload.customerName ??
        payload.assetName ??
        payload.serviceName ??
        payload.unitName ??
        null,
      mappedPayload,
      issues,
    };
  }

  if ("amountCents" in payload) {
    return {
      externalId: payload.externalId,
      label: payload.documentNumber
        ? `Conta a pagar ${payload.documentNumber}`
        : `Conta a pagar ${payload.externalId}`,
      subtitle: payload.supplierExternalId ?? payload.dueDate ?? null,
      mappedPayload,
      issues,
    };
  }

  return {
    externalId: payload.externalId,
    label: payload.documentNumber
      ? `Faturamento ${payload.documentNumber}`
      : `Faturamento ${payload.externalId}`,
    subtitle: payload.customerName ?? payload.unitName ?? null,
    mappedPayload,
    issues,
  };
}

function getMappingValidationIssues(
  config: Pick<FinancialErpConnectionConfig, "mappings">,
  target?: IntegrationSyncTarget,
): IntegrationMappingValidationIssue[] {
  const issues = validateIntegrationMappings(config.mappings);
  if (!target) return issues;
  return issues.filter((issue) => issue.target === target);
}

function assertValidMappings(
  config: Pick<FinancialErpConnectionConfig, "mappings">,
  target?: IntegrationSyncTarget,
) {
  const issues = getMappingValidationIssues(config, target);
  if (issues.length === 0) return;

  throw new Error(issues.map((issue) => issue.message).join(" "));
}

function buildMappedTargetPayload(params: {
  config: Pick<FinancialErpConnectionConfig, "mappings">;
  target: IntegrationSyncTarget;
  payload:
    | IntegrationCatalogItemPayload
    | IntegrationContractPayload
    | IntegrationCustomerPayload
    | IntegrationSupplierPayload
    | IntegrationTransporterPayload
    | IntegrationPayablePayload
    | IntegrationServiceOrderPayload
    | IntegrationBillingDocumentPayload;
}) {
  return applyIntegrationMappings(
    params.target,
    toRecord(params.payload),
    params.config.mappings[params.target],
  );
}

function isSuccessfulRun(run: typeof integrationSyncRun.$inferSelect): boolean {
  return (
    run.status === "COMPLETED" ||
    (run.status === "PARTIAL" && run.successCount > 0)
  );
}

function isFailingRun(run: typeof integrationSyncRun.$inferSelect): boolean {
  return (
    run.status === "FAILED" || (run.status === "PARTIAL" && run.errorCount > 0)
  );
}

function getRunDurationMs(run: typeof integrationSyncRun.$inferSelect) {
  if (!run.startedAt || !run.finishedAt) return null;
  return Math.max(run.finishedAt.getTime() - run.startedAt.getTime(), 0);
}

function getConsecutiveFailures(
  runs: (typeof integrationSyncRun.$inferSelect)[],
) {
  let streak = 0;

  for (const run of runs) {
    if (run.status === "PENDING" || run.status === "RUNNING") {
      continue;
    }

    if (isFailingRun(run)) {
      streak += 1;
      continue;
    }

    break;
  }

  return streak;
}

function getLastBlockedAt(runs: (typeof integrationSyncRun.$inferSelect)[]) {
  for (const run of runs) {
    const summary =
      run.summary && typeof run.summary === "object"
        ? toRecord(run.summary)
        : null;

    if (summary?.blocked === true) {
      return toIsoDate(run.finishedAt ?? run.updatedAt ?? run.createdAt);
    }
  }

  return null;
}

function buildScheduleStatus(params: {
  mode: IntegrationRunMode;
  nextScheduledRunAt: string | null;
  hasActiveRun: boolean;
  blocked: boolean;
  consecutiveFailures: number;
  now: Date;
}): IntegrationScheduleStatus {
  if (params.mode === "disabled") return "disabled";
  if (params.mode === "manual_only") return "manual_only";
  if (params.hasActiveRun) return "running";
  if (params.blocked) return "blocked";
  if (params.consecutiveFailures > 0) return "failing";

  const nextRun = parseDate(params.nextScheduledRunAt);
  if (nextRun && nextRun.getTime() <= params.now.getTime()) {
    return "due";
  }

  return "scheduled";
}

function buildEmptyCoverage(
  target: IntegrationSyncTarget,
): IntegrationTargetCoverageSummary {
  return {
    target,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  };
}

function getMetadataString(
  metadata: Record<string, unknown>,
  field: string,
): string | null {
  const value = metadata[field];
  return typeof value === "string" ? value : null;
}

export function buildEmptyRemoteDocumentSummary(): IntegrationRemoteDocumentSummary {
  return {
    totalCount: 0,
    availableCount: 0,
    unavailableCount: 0,
    salePdfCount: 0,
    fiscalXmlCount: 0,
    otherCount: 0,
    lastSyncedAt: null,
  };
}

export function summarizeRemoteDocumentLinks(
  links: {
    metadata: Record<string, unknown> | null;
    lastSyncedAt: Date | null;
  }[],
): IntegrationRemoteDocumentSummary {
  const summary = buildEmptyRemoteDocumentSummary();
  let lastSyncedAt: Date | null = null;

  for (const link of links) {
    const metadata = toRecord(link.metadata);
    const status = getMetadataString(metadata, "status");
    const documentKind = getMetadataString(metadata, "documentKind");

    summary.totalCount += 1;

    if (status === "available") {
      summary.availableCount += 1;
    } else if (status === "unavailable") {
      summary.unavailableCount += 1;
    }

    if (documentKind === "sale_pdf") {
      summary.salePdfCount += 1;
    } else if (documentKind === "fiscal_xml") {
      summary.fiscalXmlCount += 1;
    } else {
      summary.otherCount += 1;
    }

    if (
      link.lastSyncedAt &&
      (!lastSyncedAt || link.lastSyncedAt.getTime() > lastSyncedAt.getTime())
    ) {
      lastSyncedAt = link.lastSyncedAt;
    }
  }

  return {
    ...summary,
    lastSyncedAt: toIsoDate(lastSyncedAt),
  };
}

export function getContaAzulReferenceLinkTarget(
  domain: ContaAzulReferenceDomain,
): IntegrationObjectLinkTarget | null {
  switch (domain) {
    case "accounts":
    case "balances":
      return "financial_account";
    case "categories":
      return "category";
    case "costCenters":
      return "cost_center";
    case "dreCategories":
      return "dre_category";
    case "cest":
    case "ncm":
    case "productCategories":
    case "productEcommerceBrands":
    case "productEcommerceCategories":
    case "units":
      return "catalog_item";
    case "products":
      return "product";
    case "sellers":
      return "seller";
    case "serviceCategories":
      return "service";
    case "transfers":
      return "financial_transfer";
    default:
      return null;
  }
}

function getContaAzulReferenceRemoteEntityType(
  domain: ContaAzulReferenceDomain,
) {
  switch (domain) {
    case "accounts":
      return "conta_azul_financial_account";
    case "balances":
      return "conta_azul_financial_account_balance";
    case "categories":
      return "conta_azul_financial_category";
    case "costCenters":
      return "conta_azul_cost_center";
    case "dreCategories":
      return "conta_azul_dre_category";
    case "cest":
      return "conta_azul_product_cest";
    case "ncm":
      return "conta_azul_product_ncm";
    case "productCategories":
      return "conta_azul_product_category";
    case "productEcommerceBrands":
      return "conta_azul_product_ecommerce_brand";
    case "productEcommerceCategories":
      return "conta_azul_product_ecommerce_category";
    case "products":
      return "conta_azul_product";
    case "sellers":
      return "conta_azul_seller";
    case "serviceCategories":
      return "conta_azul_service";
    case "transfers":
      return "conta_azul_financial_transfer";
    case "units":
      return "conta_azul_product_unit";
    default:
      return "conta_azul_reference";
  }
}

export function buildContaAzulReferenceLink(params: {
  domain: ContaAzulReferenceDomain;
  item: ContaAzulReferenceItem;
  fetchedAt: string;
}): {
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
  remoteEntityId: string;
  remoteDisplayId: string;
  remoteEntityType: string;
  metadata: Record<string, unknown>;
} | null {
  const target = getContaAzulReferenceLinkTarget(params.domain);
  if (!target || !params.item.id.trim()) {
    return null;
  }

  return {
    target,
    localEntityId: `conta_azul:${params.domain}:${params.item.id}`,
    remoteEntityId: params.item.id,
    remoteDisplayId: params.item.name,
    remoteEntityType: getContaAzulReferenceRemoteEntityType(params.domain),
    metadata: {
      provider: "conta_azul",
      source: "reference_catalog",
      domain: params.domain,
      code: params.item.code,
      active: params.item.active,
      referenceMetadata: params.item.metadata,
      fetchedAt: params.fetchedAt,
    },
  };
}

function getLocalCatalogLinkFromContaAzulReference(params: {
  domain: ContaAzulReferenceDomain;
  item: ContaAzulReferenceItem;
}): {
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
} | null {
  const externalId = getMetadataString(
    toRecord(params.item.metadata),
    "externalId",
  );
  if (!externalId) {
    return null;
  }

  if (
    params.domain === "serviceCategories" &&
    externalId.startsWith("service:")
  ) {
    return {
      target: "catalog_item",
      localEntityId: externalId,
    };
  }

  if (
    params.domain === "products" &&
    (externalId.startsWith("product:") || externalId.startsWith("material:"))
  ) {
    return {
      target: "catalog_item",
      localEntityId: externalId,
    };
  }

  return null;
}

export function buildContaAzulReferenceLinks(params: {
  domain: ContaAzulReferenceDomain;
  item: ContaAzulReferenceItem;
  fetchedAt: string;
}): Array<{
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
  remoteEntityId: string;
  remoteDisplayId: string;
  remoteEntityType: string;
  metadata: Record<string, unknown>;
}> {
  const referenceLink = buildContaAzulReferenceLink(params);
  if (!referenceLink) {
    return [];
  }

  const localCatalogLink = getLocalCatalogLinkFromContaAzulReference(params);
  if (!localCatalogLink) {
    return [referenceLink];
  }

  return [
    referenceLink,
    {
      ...referenceLink,
      target: localCatalogLink.target,
      localEntityId: localCatalogLink.localEntityId,
      metadata: {
        ...referenceLink.metadata,
        source: "reference_catalog_external_id",
        consultationOnly: params.domain === "serviceCategories",
        matchedBy: "id_externo",
      },
    },
  ];
}

async function cacheContaAzulReferenceLinks(params: {
  integrationId: string;
  organizationId: string;
  domain: ContaAzulReferenceDomain;
  items: ContaAzulReferenceItem[];
}) {
  const fetchedAt = new Date().toISOString();
  const links = params.items.flatMap((item) =>
    buildContaAzulReferenceLinks({
      domain: params.domain,
      item,
      fetchedAt,
    }),
  );

  await Promise.all(
    links.map((link) =>
      upsertLink({
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        target: link.target,
        localEntityId: link.localEntityId,
        remoteEntityId: link.remoteEntityId,
        remoteDisplayId: link.remoteDisplayId,
        remoteEntityType: link.remoteEntityType,
        metadata: link.metadata,
      }),
    ),
  );
}

async function buildRemoteDocumentSummary(
  integrationId: string,
): Promise<IntegrationRemoteDocumentSummary> {
  const links = await db
    .select({
      metadata: integrationObjectLink.metadata,
      lastSyncedAt: integrationObjectLink.lastSyncedAt,
    })
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.integrationId, integrationId),
        eq(integrationObjectLink.target, "remote_document"),
      ),
    );

  return summarizeRemoteDocumentLinks(links);
}

export async function buildIntegrationOverview(
  record: GenericConnectionRecord,
): Promise<IntegrationOverview> {
  const now = new Date();
  const normalizedConfig = normalizeFinancialErpConnectionConfig(
    record.integration.provider,
    record.connection.config,
  );
  const overviewTargets = getIntegrationOverviewTargets(
    record.integration.provider,
  );
  const [recentRuns, recentErrorEvent, remoteDocuments] = await Promise.all([
    db.query.integrationSyncRun.findMany({
      where: eq(integrationSyncRun.integrationId, record.integration.id),
      orderBy: [desc(integrationSyncRun.createdAt)],
      limit: 50,
    }),
    db.query.integrationEventLog.findFirst({
      where: and(
        eq(integrationEventLog.integrationId, record.integration.id),
        eq(integrationEventLog.level, "error"),
      ),
      orderBy: [desc(integrationEventLog.createdAt)],
    }),
    record.integration.provider === "conta_azul"
      ? buildRemoteDocumentSummary(record.integration.id)
      : Promise.resolve(buildEmptyRemoteDocumentSummary()),
  ]);

  const coverageEntries = await Promise.all(
    overviewTargets.map(async (target) => {
      const [localCount, linkedCount] = await Promise.all([
        countLocalTargetRecords(record.integration.organizationId, target),
        countLinkedTargetRecords(record.integration.id, target),
      ]);

      return [
        target,
        {
          target,
          localCount,
          linkedCount,
          unlinkedCount: Math.max(localCount - linkedCount, 0),
        } satisfies IntegrationTargetCoverageSummary,
      ] as const;
    }),
  );

  const getCoverage = (target: IntegrationSyncTarget) =>
    coverageEntries.find(([entryTarget]) => entryTarget === target)?.[1] ??
    buildEmptyCoverage(target);

  const coverageByTarget: Record<
    IntegrationSyncTarget,
    IntegrationTargetCoverageSummary
  > = {
    catalog_item: getCoverage("catalog_item"),
    contract: getCoverage("contract"),
    customer: getCoverage("customer"),
    supplier: getCoverage("supplier"),
    transporter: getCoverage("transporter"),
    service_order: getCoverage("service_order"),
    billing_document: getCoverage("billing_document"),
    payable: getCoverage("payable"),
  };

  const validated = hasRemoteValidation(record);
  const targets: IntegrationTargetSyncSummary[] = overviewTargets.map(
    (target) => {
      const targetRuns = recentRuns.filter((run) => run.target === target);
      const lastRun = targetRuns[0] ?? null;
      const lastSuccessfulRun = targetRuns.find(isSuccessfulRun) ?? null;
      const warnings = buildDependencyWarnings({
        target,
        provider: record.integration.provider,
        config: normalizedConfig,
        integrationStatus: record.integration.status,
        validated,
        coverageByTarget,
      });
      const scheduleConfig = getTargetScheduleConfig(normalizedConfig, target);
      const hasActiveRun = targetRuns.some(
        (run) => run.status === "PENDING" || run.status === "RUNNING",
      );
      const consecutiveFailures = getConsecutiveFailures(targetRuns);
      const blocked = warnings.some((warning) => warning.severity === "error");
      const schedule: IntegrationTargetScheduleSummary = {
        target,
        mode: scheduleConfig.mode,
        frequency: scheduleConfig.frequency,
        status: buildScheduleStatus({
          mode: scheduleConfig.mode,
          nextScheduledRunAt: scheduleConfig.nextScheduledRunAt,
          hasActiveRun,
          blocked,
          consecutiveFailures,
          now,
        }),
        nextScheduledRunAt: scheduleConfig.nextScheduledRunAt,
        lastScheduledRunAt: scheduleConfig.lastScheduledRunAt,
      };

      return {
        target,
        lastRunAt: toIsoDate(lastRun?.createdAt) ?? null,
        lastSuccessfulRunAt: toIsoDate(lastSuccessfulRun?.finishedAt) ?? null,
        lastStatus: lastRun?.status ?? null,
        lastTrigger: lastRun?.trigger ?? null,
        processedCount: lastRun?.processedCount ?? 0,
        successCount: lastRun?.successCount ?? 0,
        errorCount: lastRun?.errorCount ?? 0,
        blocked,
        warnings,
        coverage: coverageByTarget[target],
        schedule,
        lastRunDurationMs: lastRun ? getRunDurationMs(lastRun) : null,
        consecutiveFailures,
        lastBlockedAt: getLastBlockedAt(targetRuns),
        hasActiveRun,
      };
    },
  );

  const dependencyWarnings = dedupeDependencyWarnings(
    targets.flatMap((target) => target.warnings),
  );
  const setupStatus = buildSetupStatus({
    record,
    validated,
  });
  const canSync = validated && record.integration.status === "ACTIVE";
  const readiness: IntegrationReadinessSummary = {
    setupStatus,
    readinessStatus: buildReadinessStatus({
      setupStatus,
      canSync,
      dependencyWarnings,
    }),
    capabilities: getProviderCapabilities(record.integration.provider),
    validationRequired: !validated,
    canSync,
    lastValidatedAt:
      record.integration.lastValidatedAt?.toISOString?.() ?? null,
    lastValidationError: record.integration.lastValidationError,
    dependencyWarnings,
  };

  const lastRun = recentRuns[0] ?? null;
  const lastSuccessfulRun = recentRuns.find(isSuccessfulRun) ?? null;

  return {
    readiness,
    targets,
    remoteDocuments,
    syncSummary: {
      lastRunAt: toIsoDate(lastRun?.createdAt),
      lastSuccessfulRunAt: toIsoDate(lastSuccessfulRun?.finishedAt),
      lastErrorAt: toIsoDate(recentErrorEvent?.createdAt),
      hasRecentFailures: Boolean(recentErrorEvent),
    },
  };
}

export async function previewIntegrationSync(params: {
  record: GenericConnectionRecord;
  target: IntegrationSyncTarget;
  limit: number;
  mappings?: Partial<IntegrationMappingsConfig>;
}) {
  const normalizedConfig = normalizeFinancialErpConnectionConfig(
    params.record.integration.provider,
    {
      ...params.record.connection.config,
      mappings: params.mappings
        ? {
            ...params.record.connection.config.mappings,
            ...params.mappings,
          }
        : params.record.connection.config.mappings,
    },
  );
  assertValidMappings(normalizedConfig, params.target);

  const overview = await buildIntegrationOverview(params.record);
  const targetSummary = overview.targets.find(
    (target) => target.target === params.target,
  );

  if (!targetSummary) {
    throw new Error("Alvo de sincronização inválido");
  }

  const loadedPayloads = await loadTargetPayloads(
    params.record.integration.organizationId,
    params.target,
    Math.min(params.limit, 25),
  );
  // Mirror the run-time behavior: previews for a Conta Azul catalog only
  // include the kinds (services vs products/materials) the connection enabled.
  const payloads =
    params.target === "catalog_item" &&
    params.record.integration.provider !== "generic_http"
      ? filterContaAzulCatalogPayloadsByEnabledKinds(
          normalizeContaAzulConnectionConfig(params.record.connection.config),
          loadedPayloads.filter(isCatalogItemPayload),
        )
      : loadedPayloads;

  return {
    target: params.target,
    requestedLimit: params.limit,
    blocked: targetSummary.blocked,
    warnings: targetSummary.warnings,
    coverage: targetSummary.coverage,
    previewCount: payloads.length,
    sampleRecords: payloads
      .slice(0, 5)
      .map((payload): IntegrationMappedPreviewSample => {
        const { mappedPayload, issues } = buildMappedTargetPayload({
          config: normalizedConfig,
          target: params.target,
          payload,
        });

        return buildPreviewSampleRecord(payload, mappedPayload, issues);
      }),
  };
}

function buildRunSummary(params: {
  target: IntegrationSyncTarget;
  processedCount?: number;
  successCount?: number;
  errorCount?: number;
  requestedLimit?: number;
  blocked?: boolean;
  retryOfRunId?: string | null;
  pollKind?: ContaAzulScheduledPollKind;
  cursorType?: string;
  updatedCount?: number;
  warnings?: unknown[];
}) {
  return {
    target: params.target,
    processedCount: params.processedCount ?? 0,
    successCount: params.successCount ?? 0,
    errorCount: params.errorCount ?? 0,
    requestedLimit: params.requestedLimit ?? DEFAULT_INTEGRATION_SYNC_LIMIT,
    blocked: params.blocked ?? false,
    retryOfRunId: params.retryOfRunId ?? null,
    ...(params.pollKind
      ? {
          pollKind: params.pollKind,
          cursorType: params.cursorType ?? null,
          updatedCount: params.updatedCount ?? 0,
          warnings: params.warnings ?? [],
        }
      : {}),
  } satisfies Record<string, unknown>;
}

export function getRequestedLimitFromRun(
  run: typeof integrationSyncRun.$inferSelect,
) {
  const summary =
    run.summary && typeof run.summary === "object"
      ? toRecord(run.summary)
      : null;
  const requestedLimit = summary?.requestedLimit;

  if (typeof requestedLimit === "number" && Number.isFinite(requestedLimit)) {
    return Math.max(1, Math.min(250, Math.trunc(requestedLimit)));
  }

  return DEFAULT_INTEGRATION_SYNC_LIMIT;
}

function getServiceOrderCommercialDate(
  payload: IntegrationServiceOrderPayload,
) {
  return (
    payload.approvedAt?.slice(0, 10) ??
    payload.performedAt?.slice(0, 10) ??
    payload.updatedAt?.slice(0, 10) ??
    new Date().toISOString().slice(0, 10)
  );
}

function getServiceOrderTotalCents(payload: IntegrationServiceOrderPayload) {
  if (
    typeof payload.servicePriceCents !== "number" ||
    !Number.isFinite(payload.servicePriceCents) ||
    payload.servicePriceCents <= 0
  ) {
    throw new Error(
      "Ordem de serviço sem valor comercial para exportar à Conta Azul",
    );
  }

  return Math.trunc(payload.servicePriceCents);
}

function buildServiceOrderCommercialNotes(
  payload: IntegrationServiceOrderPayload,
) {
  return [
    `Origem CalibraFácil: ${payload.externalId}`,
    payload.jobId ? `OS/job: ${payload.jobId}` : null,
    payload.unitName ? `Unidade: ${payload.unitName}` : null,
    payload.assetName ? `Instrumento: ${payload.assetName}` : null,
    payload.assetTag ? `Tag: ${payload.assetTag}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function mapServiceOrderToSalePayload(
  payload: IntegrationServiceOrderPayload,
): IntegrationSalePayload {
  const saleDate = getServiceOrderCommercialDate(payload);
  const totalCents = getServiceOrderTotalCents(payload);

  return {
    externalId: payload.externalId,
    organizationId: payload.organizationId,
    customerExternalId: payload.customerExternalId,
    saleNumber: payload.jobId,
    saleDate,
    status: payload.status,
    sellerExternalId: null,
    categoryId: null,
    costCenterId: null,
    totalCents,
    currency: payload.currency ?? "BRL",
    notes: buildServiceOrderCommercialNotes(payload),
    items: [
      {
        lineId: `${payload.externalId}:service`,
        catalogItemExternalId: payload.serviceExternalId ?? null,
        description: payload.serviceName ?? `Serviço ${payload.jobId}`,
        quantity: 1,
        unitPriceCents: totalCents,
        totalCents,
      },
    ],
    paymentTerms: {
      paymentMethodId: null,
      financialAccountId: null,
      paymentConditionLabel: "À vista",
      dueDate: saleDate,
      installments: [
        {
          dueDate: saleDate,
          amountCents: totalCents,
          description: payload.jobId ? `OS ${payload.jobId}` : null,
        },
      ],
    },
  };
}

export function mapServiceOrderToBudgetPayload(
  payload: IntegrationServiceOrderPayload,
): IntegrationBudgetPayload {
  const salePayload = mapServiceOrderToSalePayload(payload);

  return {
    externalId: payload.externalId,
    organizationId: salePayload.organizationId,
    customerExternalId: salePayload.customerExternalId,
    budgetNumber: payload.jobId,
    issueDate: salePayload.saleDate,
    expirationDate: null,
    status: salePayload.status,
    sellerExternalId: salePayload.sellerExternalId,
    categoryId: salePayload.categoryId,
    costCenterId: salePayload.costCenterId,
    totalCents: salePayload.totalCents,
    currency: salePayload.currency,
    notes: salePayload.notes,
    items: salePayload.items,
    paymentTerms: salePayload.paymentTerms,
  };
}

export async function hasActiveSyncRun(params: {
  integrationId: string;
  organizationId: string;
  target: IntegrationSyncTarget;
}) {
  const existing = await db.query.integrationSyncRun.findFirst({
    where: and(
      eq(integrationSyncRun.integrationId, params.integrationId),
      eq(integrationSyncRun.organizationId, params.organizationId),
      eq(integrationSyncRun.target, params.target),
      inArray(integrationSyncRun.status, ["PENDING", "RUNNING"]),
    ),
    orderBy: [desc(integrationSyncRun.createdAt)],
  });

  return existing;
}

async function getExistingLink(
  integrationId: string,
  target: IntegrationObjectLinkTarget,
  localEntityId: string,
) {
  return db.query.integrationObjectLink.findFirst({
    where: and(
      eq(integrationObjectLink.integrationId, integrationId),
      eq(integrationObjectLink.target, target),
      eq(integrationObjectLink.localEntityId, localEntityId),
    ),
  });
}

async function upsertLink(params: {
  integrationId: string;
  organizationId: string;
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
  remoteEntityId: string | null;
  remoteDisplayId?: string | null;
  remoteEntityType?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const existing = await getExistingLink(
    params.integrationId,
    params.target,
    params.localEntityId,
  );

  if (existing) {
    await db
      .update(integrationObjectLink)
      .set({
        remoteEntityId: params.remoteEntityId,
        remoteDisplayId: params.remoteDisplayId ?? params.remoteEntityId,
        remoteEntityType: params.remoteEntityType ?? null,
        metadata: params.metadata ?? null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(integrationObjectLink.id, existing.id));
    return;
  }

  await db.insert(integrationObjectLink).values({
    id: crypto.randomUUID(),
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    target: params.target,
    localEntityId: params.localEntityId,
    remoteEntityId: params.remoteEntityId,
    remoteDisplayId: params.remoteDisplayId ?? params.remoteEntityId,
    remoteEntityType: params.remoteEntityType ?? null,
    metadata: params.metadata ?? null,
    lastSyncedAt: new Date(),
  });
}

async function refreshContaAzulTokenForConnection(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  const tokenBundle = parseContaAzulTokenBundle(
    decryptIntegrationSecret(
      params.record.connection.encryptedSecret,
      params.record.connection.secretIv,
      params.env,
    ),
  );
  let refreshed;
  try {
    refreshed = await refreshContaAzulAccessToken(
      await requireContaAzulOAuthConfig({
        organizationId: params.record.integration.organizationId,
        env: params.env,
      }),
      {
        refreshToken: tokenBundle.refreshToken,
      },
    );
  } catch (error) {
    const failure = buildContaAzulRefreshFailurePolicy(error);

    await markContaAzulReconnectRequired({
      integrationId: params.record.integration.id,
      organizationId: params.record.integration.organizationId,
      message: failure.message,
      details: {
        reason: failure.reason,
      },
    });

    throw new ContaAzulReconnectRequiredError(failure.message);
  }
  const encrypted = encryptIntegrationSecret(
    serializeContaAzulTokenBundle(refreshed),
    params.env,
  );
  const config = normalizeContaAzulConnectionConfig({
    ...params.record.connection.config,
    accessTokenExpiresAt: refreshed.expiresAt,
    scopes: refreshed.scopes,
  });

  await db
    .update(integrationConnection)
    .set({
      credentialType: "oauth2",
      config,
      encryptedSecret: encrypted.encryptedSecret,
      secretIv: encrypted.secretIv,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnection.id, params.record.connection.id));

  params.record.connection.credentialType = "oauth2";
  params.record.connection.config = config;
  params.record.connection.encryptedSecret = encrypted.encryptedSecret;
  params.record.connection.secretIv = encrypted.secretIv;

  await writeIntegrationEvent({
    integrationId: params.record.integration.id,
    organizationId: params.record.integration.organizationId,
    level: "info",
    event: "integration.conta_azul.token_refreshed",
    message: "Token OAuth da Conta Azul renovado",
    details: {
      provider: "conta_azul",
      source: "automatic",
      accessTokenExpiresAt: refreshed.expiresAt,
    },
  });

  return refreshed.accessToken;
}

export function shouldRefreshContaAzulTokenBeforeUse(
  tokenBundle: ReturnType<typeof parseContaAzulTokenBundle>,
  now = new Date(),
) {
  const expiresAtMs = Date.parse(tokenBundle.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  return expiresAtMs - now.getTime() <= CONTA_AZUL_TOKEN_REFRESH_SKEW_MS;
}

async function getContaAzulAccessTokenForRecord(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  const tokenBundle = parseContaAzulTokenBundle(
    decryptIntegrationSecret(
      params.record.connection.encryptedSecret,
      params.record.connection.secretIv,
      params.env,
    ),
  );

  if (shouldRefreshContaAzulTokenBeforeUse(tokenBundle)) {
    return refreshContaAzulTokenForConnection(params);
  }

  return tokenBundle.accessToken;
}

async function createContaAzulAdapterForRecord(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  const accessToken = await getContaAzulAccessTokenForRecord(params);
  const config = normalizeContaAzulConnectionConfig(
    params.record.connection.config,
  );

  return createFinancialErpAdapter({
    provider: "conta_azul",
    integrationId: params.record.integration.id,
    organizationId: params.record.integration.organizationId,
    config,
    accessToken,
    rateLimitKey: params.record.integration.id,
    links: {
      async getExistingRemoteId({ target, localEntityId }) {
        const existing = await getExistingLink(
          params.record.integration.id,
          target,
          localEntityId,
        );
        return existing?.remoteEntityId ?? null;
      },
      async listLinks({ targets, limit, offset }) {
        return db
          .select({
            target: integrationObjectLink.target,
            localEntityId: integrationObjectLink.localEntityId,
            remoteEntityId: integrationObjectLink.remoteEntityId,
            remoteDisplayId: integrationObjectLink.remoteDisplayId,
            remoteEntityType: integrationObjectLink.remoteEntityType,
            metadata: integrationObjectLink.metadata,
          })
          .from(integrationObjectLink)
          .where(
            and(
              eq(
                integrationObjectLink.integrationId,
                params.record.integration.id,
              ),
              inArray(integrationObjectLink.target, targets),
              isNotNull(integrationObjectLink.remoteEntityId),
            ),
          )
          .orderBy(integrationObjectLink.createdAt)
          .limit(limit)
          .offset(offset);
      },
      async upsertLink({
        target,
        localEntityId,
        remoteEntityId,
        remoteDisplayId,
        remoteEntityType,
        metadata,
      }) {
        await upsertLink({
          integrationId: params.record.integration.id,
          organizationId: params.record.integration.organizationId,
          target,
          localEntityId,
          remoteEntityId,
          remoteDisplayId,
          remoteEntityType,
          metadata,
        });
      },
    },
    async onUnauthorized() {
      return refreshContaAzulTokenForConnection(params);
    },
  });
}

async function createContaAzulClientForRecord(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  const accessToken = await getContaAzulAccessTokenForRecord(params);
  const config = normalizeContaAzulConnectionConfig(
    params.record.connection.config,
  );

  return new ContaAzulClient({
    accessToken,
    baseUrl: config.baseUrl,
    rateLimitKey: params.record.integration.id,
    async onUnauthorized() {
      return refreshContaAzulTokenForConnection(params);
    },
  });
}

export async function validateContaAzulConnection(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  return (await createContaAzulAdapterForRecord(params)).validateConnection();
}

export async function listContaAzulCatalog(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  catalog:
    | "accounts"
    | "categories"
    | "cost-centers"
    | "dre-categories"
    | "product-categories"
    | "product-cest"
    | "product-ecommerce-brands"
    | "product-ecommerce-categories"
    | "product-ncm"
    | "products"
    | "product-units"
    | "sellers"
    | "services"
    | "balances"
    | "transfers";
}) {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.listReferenceData) {
    throw new Error("Catálogo Conta Azul indisponível");
  }

  const domain = (() => {
    switch (params.catalog) {
      case "accounts":
        return "accounts";
      case "balances":
        return "balances";
      case "categories":
        return "categories";
      case "cost-centers":
        return "costCenters";
      case "dre-categories":
        return "dreCategories";
      case "product-categories":
        return "productCategories";
      case "product-cest":
        return "cest";
      case "product-ecommerce-brands":
        return "productEcommerceBrands";
      case "product-ecommerce-categories":
        return "productEcommerceCategories";
      case "product-ncm":
        return "ncm";
      case "products":
        return "products";
      case "product-units":
        return "units";
      case "sellers":
        return "sellers";
      case "services":
        return "serviceCategories";
      case "transfers":
        return "transfers";
    }
  })() satisfies ContaAzulReferenceDomain;

  const page = await adapter.listReferenceData(domain);

  await cacheContaAzulReferenceLinks({
    integrationId: record.integration.id,
    organizationId: record.integration.organizationId,
    domain,
    items: page.items,
  });

  return page;
}

function formatContaAzulDateTime(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, "");
}

function parseRemoteDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isContaAzulPaymentPollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  if (!params.config.enabledTargets.paymentStatusPolling) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.receivablesLastRemoteUpdatedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function isContaAzulPayablePollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  // Payable export already runs when either `payables` or `expenses` is on
  // (see isContaAzulPayableExportEnabled). Polling has to track the same set
  // so scheduled status reconciliation does not silently stall for
  // expenses-only configurations.
  const payablesOrExpensesEnabled =
    params.config.enabledTargets.payables ||
    params.config.enabledTargets.expenses;
  if (
    !params.config.enabledTargets.paymentStatusPolling ||
    !payablesOrExpensesEnabled
  ) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.payablesLastRemoteUpdatedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function isContaAzulFiscalPollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  if (!params.config.enabledTargets.fiscalDocuments) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.invoicesLastRemoteUpdatedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_FISCAL_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function isContaAzulProtocolPollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  if (!params.config.enabledTargets.protocols) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.protocolsLastRemoteUpdatedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_PROTOCOL_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function isContaAzulDriftPollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  if (!params.config.enabledTargets.driftChecks) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.driftLastCheckedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_DRIFT_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

function getContaAzulPollDefinition(kind: ContaAzulScheduledPollKind) {
  const definition = CONTA_AZUL_POLL_DEFINITIONS.find(
    (candidate) => candidate.kind === kind,
  );
  if (!definition) {
    throw new Error(`Poll Conta Azul inválido: ${kind}`);
  }
  return definition;
}

function isContaAzulScheduledPollKind(
  value: unknown,
): value is ContaAzulScheduledPollKind {
  return (
    typeof value === "string" &&
    CONTA_AZUL_POLL_DEFINITIONS.some((definition) => definition.kind === value)
  );
}

function isContaAzulPollEnabled(
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>,
  kind: ContaAzulScheduledPollKind,
) {
  if (kind === "paymentStatusPolling") {
    return config.enabledTargets.paymentStatusPolling;
  }
  if (kind === "payables") {
    return config.enabledTargets.payables;
  }
  if (kind === "fiscalDocuments") {
    return config.enabledTargets.fiscalDocuments;
  }
  if (kind === "protocols") {
    return config.enabledTargets.protocols;
  }
  if (kind === "productStock") {
    // The stock mirror rides on the products catalog sync opt-in.
    return config.enabledTargets.products;
  }
  return config.enabledTargets.driftChecks;
}

function isContaAzulPollDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  kind: ContaAzulScheduledPollKind;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  const base = {
    config: params.config,
    now: params.now,
    intervalMs: params.intervalMs,
    lastSuccessfulPollAt: params.lastSuccessfulPollAt,
    lastRemoteUpdatedAt: params.lastRemoteUpdatedAt,
    pendingNextPage: params.pendingNextPage,
  };

  if (params.kind === "paymentStatusPolling") {
    return isContaAzulPaymentPollingDue(base);
  }
  if (params.kind === "payables") {
    return isContaAzulPayablePollingDue(base);
  }
  if (params.kind === "fiscalDocuments") {
    return isContaAzulFiscalPollingDue(base);
  }
  if (params.kind === "protocols") {
    return isContaAzulProtocolPollingDue(base);
  }
  return isContaAzulDriftPollingDue(base);
}

function getRunPollKind(
  run: Pick<typeof integrationSyncRun.$inferSelect, "summary">,
): ContaAzulScheduledPollKind | null {
  const summary =
    run.summary && typeof run.summary === "object"
      ? toRecord(run.summary)
      : null;
  const pollKind = summary?.pollKind;
  return isContaAzulScheduledPollKind(pollKind) ? pollKind : null;
}

async function hasActiveContaAzulPollRun(params: {
  integrationId: string;
  organizationId: string;
  kind: ContaAzulScheduledPollKind;
  target: IntegrationSyncTarget;
}) {
  const activeRuns = await db.query.integrationSyncRun.findMany({
    where: and(
      eq(integrationSyncRun.integrationId, params.integrationId),
      eq(integrationSyncRun.organizationId, params.organizationId),
      eq(integrationSyncRun.target, params.target),
      inArray(integrationSyncRun.status, ["PENDING", "RUNNING"]),
    ),
    orderBy: [desc(integrationSyncRun.createdAt)],
  });

  // TODO(canonicalize-poll-kind-lock): move pollKind out of summary JSONB so this can be filtered by SQL.
  return activeRuns.some((run) => getRunPollKind(run) === params.kind);
}

async function runContaAzulPollByKind(params: {
  kind: ContaAzulScheduledPollKind;
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
}) {
  if (params.kind === "paymentStatusPolling") {
    return pollContaAzulBillingStatus(params);
  }
  if (params.kind === "payables") {
    return pollContaAzulPayableStatus(params);
  }
  if (params.kind === "fiscalDocuments") {
    return pollContaAzulFiscalDocuments(params);
  }
  if (params.kind === "protocols") {
    return pollContaAzulProtocols(params);
  }
  if (params.kind === "productStock") {
    return pollContaAzulProductStock(params);
  }
  return pollContaAzulRemoteDrift(params);
}

export async function runContaAzulScheduledPoll(params: {
  kind: ContaAzulScheduledPollKind;
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
}): Promise<RemoteStatusPollResult> {
  const definition = getContaAzulPollDefinition(params.kind);
  const activeRun = await hasActiveContaAzulPollRun({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    kind: params.kind,
    target: definition.target,
  });

  if (activeRun) {
    throw new Error("Polling Conta Azul já está em execução");
  }

  const requestedLimit = params.limit ?? DEFAULT_INTEGRATION_SYNC_LIMIT;
  const runId = await createSyncRun({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    trigger: "scheduled",
    target: definition.target,
    requestedLimit,
    pollKind: params.kind,
    cursorType: definition.cursorType,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    runId,
    level: "info",
    event: "sync.scheduled.dispatched",
    message: "Polling Conta Azul agendado iniciado",
    details: {
      provider: "conta_azul",
      pollKind: params.kind,
      cursorType: definition.cursorType,
      trigger: "scheduled",
    },
  });

  await db
    .update(integrationSyncRun)
    .set({
      status: "RUNNING",
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(integrationSyncRun.id, runId));

  try {
    const result = await runContaAzulPollByKind(params);
    await db
      .update(integrationSyncRun)
      .set({
        status: "COMPLETED",
        processedCount: result.processedCount,
        successCount: result.processedCount,
        errorCount: 0,
        errorSummary: null,
        summary: buildRunSummary({
          target: definition.target,
          requestedLimit,
          processedCount: result.processedCount,
          successCount: result.processedCount,
          errorCount: 0,
          pollKind: params.kind,
          cursorType: definition.cursorType,
          updatedCount: result.updatedCount,
          warnings: result.warnings,
        }),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(integrationSyncRun.id, runId));

    await writeIntegrationEvent({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      runId,
      level: result.warnings.length > 0 ? "warning" : "info",
      event: "sync.completed",
      message: "Polling Conta Azul agendado concluído",
      details: {
        provider: "conta_azul",
        pollKind: params.kind,
        cursorType: definition.cursorType,
        completedEvent: definition.completedEvent,
        processedCount: result.processedCount,
        updatedCount: result.updatedCount,
        warnings: result.warnings,
      },
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : definition.failedMessage;
    await failIntegrationSyncRun({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      runId,
      target: definition.target,
      message,
      details: {
        provider: "conta_azul",
        pollKind: params.kind,
        cursorType: definition.cursorType,
        trigger: "scheduled",
      },
    });
    throw error;
  }
}

async function processScheduledContaAzulPollKind(params: {
  definition: ContaAzulPollDefinition;
  env: IntegrationsEnv;
  now: Date;
  limit?: number;
  intervalMs?: number;
}) {
  const rows = await db
    .select({
      integrationId: organizationIntegration.id,
      organizationId: organizationIntegration.organizationId,
      config: integrationConnection.config,
    })
    .from(organizationIntegration)
    .innerJoin(
      integrationConnection,
      eq(integrationConnection.integrationId, organizationIntegration.id),
    )
    .where(
      and(
        eq(organizationIntegration.status, "ACTIVE"),
        eq(organizationIntegration.provider, "conta_azul"),
      ),
    );

  let dueIntegrations = 0;
  let successfulPolls = 0;
  let failedPolls = 0;
  let processedCount = 0;
  let updatedCount = 0;

  for (const row of rows) {
    const config = normalizeContaAzulConnectionConfig(row.config);

    if (!isContaAzulPollEnabled(config, params.definition.kind)) {
      await writeIntegrationEvent({
        integrationId: row.integrationId,
        organizationId: row.organizationId,
        level: "info",
        event: "sync.skipped.disabled",
        message: params.definition.disabledMessage,
        details: {
          provider: "conta_azul",
          pollKind: params.definition.kind,
          cursorType: params.definition.cursorType,
          trigger: "scheduled",
        },
      });
      continue;
    }

    const cursor = await getIntegrationCursor({
      integrationId: row.integrationId,
      cursorType: params.definition.cursorType,
    });

    if (
      !isContaAzulPollDue({
        config,
        kind: params.definition.kind,
        now: params.now,
        intervalMs: params.intervalMs ?? params.definition.intervalMs,
        lastSuccessfulPollAt: cursor?.lastSuccessfulPollAt?.toISOString(),
        lastRemoteUpdatedAt: cursor?.lastRemoteUpdatedAt?.toISOString(),
        pendingNextPage: cursor?.nextPage ?? null,
      })
    ) {
      continue;
    }

    const activeRun = await hasActiveContaAzulPollRun({
      integrationId: row.integrationId,
      organizationId: row.organizationId,
      kind: params.definition.kind,
      target: params.definition.target,
    });

    if (activeRun) {
      await writeIntegrationEvent({
        integrationId: row.integrationId,
        organizationId: row.organizationId,
        level: "info",
        event: "sync.skipped.locked",
        message: "Polling Conta Azul já está em execução",
        details: {
          provider: "conta_azul",
          pollKind: params.definition.kind,
          cursorType: params.definition.cursorType,
          trigger: "scheduled",
        },
      });
      continue;
    }

    dueIntegrations += 1;

    try {
      const result = await runContaAzulScheduledPoll({
        kind: params.definition.kind,
        integrationId: row.integrationId,
        organizationId: row.organizationId,
        env: params.env,
        limit: params.limit,
      });

      successfulPolls += 1;
      processedCount += result.processedCount;
      updatedCount += result.updatedCount;
    } catch {
      failedPolls += 1;
    }
  }

  return {
    scannedIntegrations: rows.length,
    dueIntegrations,
    successfulPolls,
    failedPolls,
    processedCount,
    updatedCount,
  };
}

export async function processScheduledContaAzulPolls(params: {
  env: IntegrationsEnv;
  now?: Date;
  limit?: number;
  intervalMs?: number;
}) {
  const now = params.now ?? new Date();
  const results: Awaited<
    ReturnType<typeof processScheduledContaAzulPollKind>
  >[] = [];

  for (const definition of CONTA_AZUL_POLL_DEFINITIONS) {
    const startedAt = Date.now();
    const result = await processScheduledContaAzulPollKind({
      definition,
      env: params.env,
      now,
      limit: params.limit,
      intervalMs: params.intervalMs,
    });
    console.info("[IntegrationsCron] Conta Azul poll kind processed", {
      pollKind: definition.kind,
      scannedIntegrations: result.scannedIntegrations,
      dueIntegrations: result.dueIntegrations,
      successfulPolls: result.successfulPolls,
      failedPolls: result.failedPolls,
      durationMs: Date.now() - startedAt,
    });
    if (result.failedPolls > 0) {
      console.warn("[IntegrationsCron] Conta Azul poll kind failed", {
        pollKind: definition.kind,
        scannedIntegrations: result.scannedIntegrations,
        dueIntegrations: result.dueIntegrations,
        successfulPolls: result.successfulPolls,
        failedPolls: result.failedPolls,
        durationMs: Date.now() - startedAt,
      });
    }
    results.push(result);
  }

  return {
    scannedIntegrations: Math.max(
      0,
      ...results.map((result) => result.scannedIntegrations),
    ),
    dueIntegrations: results.reduce(
      (total, result) => total + result.dueIntegrations,
      0,
    ),
    successfulPolls: results.reduce(
      (total, result) => total + result.successfulPolls,
      0,
    ),
    failedPolls: results.reduce(
      (total, result) => total + result.failedPolls,
      0,
    ),
    processedCount: results.reduce(
      (total, result) => total + result.processedCount,
      0,
    ),
    updatedCount: results.reduce(
      (total, result) => total + result.updatedCount,
      0,
    ),
    byKind: Object.fromEntries(
      CONTA_AZUL_POLL_DEFINITIONS.map((definition, index) => [
        definition.kind,
        results[index],
      ]),
    ),
  };
}

export type ContaAzulScheduleRow = {
  enabled: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  nextDueAt: string | null;
  intervalMinutes: number;
};

export type ContaAzulScheduleState = Record<
  ContaAzulScheduledPollKind,
  ContaAzulScheduleRow
>;

function addMilliseconds(value: string, intervalMs: number) {
  const parsed = parseRemoteDate(value);
  if (!parsed) return null;
  return new Date(parsed.getTime() + intervalMs).toISOString();
}

function isSuccessfulScheduleRun(
  run: typeof integrationSyncRun.$inferSelect,
  kind: ContaAzulScheduledPollKind,
) {
  return (
    run.trigger === "scheduled" &&
    getRunPollKind(run) === kind &&
    (run.status === "COMPLETED" || run.status === "PARTIAL")
  );
}

function isFailedScheduleRun(
  run: typeof integrationSyncRun.$inferSelect,
  kind: ContaAzulScheduledPollKind,
) {
  return (
    run.trigger === "scheduled" &&
    getRunPollKind(run) === kind &&
    run.status === "FAILED"
  );
}

function getEventPollKind(
  event: Pick<typeof integrationEventLog.$inferSelect, "details">,
) {
  const details =
    event.details && typeof event.details === "object"
      ? toRecord(event.details)
      : null;
  const pollKind = details?.pollKind;
  return isContaAzulScheduledPollKind(pollKind) ? pollKind : null;
}

function buildEmptyScheduleRow(): ContaAzulScheduleRow {
  return {
    enabled: false,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    nextDueAt: null,
    intervalMinutes: 0,
  };
}

export async function getContaAzulScheduleState(params: {
  integrationId: string;
  organizationId: string;
  now?: Date;
}): Promise<ContaAzulScheduleState> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  const runs = await db.query.integrationSyncRun.findMany({
    where: and(
      eq(integrationSyncRun.integrationId, params.integrationId),
      eq(integrationSyncRun.organizationId, params.organizationId),
      eq(integrationSyncRun.trigger, "scheduled"),
    ),
    orderBy: [desc(integrationSyncRun.createdAt)],
    limit: 100,
  });
  const errorEvents = await db.query.integrationEventLog.findMany({
    where: and(
      eq(integrationEventLog.integrationId, params.integrationId),
      eq(integrationEventLog.organizationId, params.organizationId),
      eq(integrationEventLog.level, "error"),
      isNotNull(sql`${integrationEventLog.details}->>'pollKind'`),
      inArray(
        sql<string>`${integrationEventLog.details}->>'pollKind'`,
        CONTA_AZUL_POLL_DEFINITIONS.map((definition) => definition.kind),
      ),
    ),
    orderBy: [desc(integrationEventLog.createdAt)],
    limit: 500,
  });

  const state: ContaAzulScheduleState = {
    paymentStatusPolling: buildEmptyScheduleRow(),
    payables: buildEmptyScheduleRow(),
    fiscalDocuments: buildEmptyScheduleRow(),
    protocols: buildEmptyScheduleRow(),
    driftChecks: buildEmptyScheduleRow(),
    productStock: buildEmptyScheduleRow(),
  };

  for (const definition of CONTA_AZUL_POLL_DEFINITIONS) {
    const enabled = isContaAzulPollEnabled(config, definition.kind);
    const lastSuccessRun = runs.find((run) =>
      isSuccessfulScheduleRun(run, definition.kind),
    );
    const lastFailedRun = runs.find((run) =>
      isFailedScheduleRun(run, definition.kind),
    );
    const lastErrorEvent = errorEvents.find(
      (event) => getEventPollKind(event) === definition.kind,
    );
    const lastSuccessAt =
      lastSuccessRun?.finishedAt?.toISOString?.() ??
      lastSuccessRun?.createdAt?.toISOString?.() ??
      null;
    const lastErrorAt =
      lastFailedRun?.finishedAt?.toISOString?.() ??
      lastFailedRun?.createdAt?.toISOString?.() ??
      lastErrorEvent?.createdAt?.toISOString?.() ??
      null;
    const hasRecentFailure =
      lastErrorAt !== null &&
      (lastSuccessAt === null || lastErrorAt > lastSuccessAt);
    const nextDueAt =
      enabled && lastSuccessAt && !hasRecentFailure
        ? addMilliseconds(lastSuccessAt, definition.intervalMs)
        : null;

    state[definition.kind] = {
      enabled,
      lastSuccessAt,
      lastErrorAt,
      lastErrorMessage:
        lastFailedRun?.errorSummary ?? lastErrorEvent?.message ?? null,
      nextDueAt,
      intervalMinutes: Math.round(definition.intervalMs / 60_000),
    };
  }

  return state;
}

function readCursorStateText(
  cursor: typeof integrationSyncCursor.$inferSelect | null | undefined,
  key: string,
) {
  const value = toRecord(cursor?.state)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function getIntegrationCursor(params: {
  integrationId: string;
  cursorType: string;
}) {
  return db.query.integrationSyncCursor.findFirst({
    where: and(
      eq(integrationSyncCursor.integrationId, params.integrationId),
      eq(integrationSyncCursor.cursorType, params.cursorType),
    ),
  });
}

async function upsertIntegrationCursor(params: {
  integrationId: string;
  organizationId: string;
  cursor: IntegrationSyncCursor;
}) {
  const existing = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: params.cursor.cursorType,
  });
  const values = {
    lastRemoteUpdatedAt: parseRemoteDate(params.cursor.lastRemoteUpdatedAt),
    lastSuccessfulPollAt: parseRemoteDate(params.cursor.lastSuccessfulPollAt),
    nextPage: params.cursor.nextPage,
    state: params.cursor.state,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(integrationSyncCursor)
      .set(values)
      .where(eq(integrationSyncCursor.id, existing.id));
    return;
  }

  await db.insert(integrationSyncCursor).values({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursorType: params.cursor.cursorType,
    ...values,
  });
}

async function getDocumentStatusAfterInstallmentUpdate(documentId: number) {
  const installments = await db
    .select({ status: receivableInstallment.status })
    .from(receivableInstallment)
    .where(eq(receivableInstallment.documentId, documentId));

  if (
    installments.length > 0 &&
    installments.every((row) => row.status === "PAID")
  ) {
    return "PAID" as const;
  }
  if (installments.some((row) => row.status === "OVERDUE")) {
    return "OVERDUE" as const;
  }
  if (
    installments.length > 0 &&
    installments.every((row) => row.status === "VOID")
  ) {
    return "VOID" as const;
  }

  return "ISSUED" as const;
}

async function upsertContaAzulPaymentReceipt(params: {
  organizationId: string;
  recordedBy: string;
  installmentId: number;
  remoteInstallmentId: string;
  receivedAt: Date;
  amountCents: number;
  paymentMethod: NonNullable<typeof paymentReceipt.$inferInsert.paymentMethod>;
  reference: string;
}) {
  const [existing] = await db
    .select({ id: paymentReceipt.id })
    .from(paymentReceipt)
    .where(
      and(
        eq(paymentReceipt.installmentId, params.installmentId),
        eq(paymentReceipt.reference, params.reference),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(paymentReceipt)
      .set({
        receivedAt: params.receivedAt,
        amountCents: params.amountCents,
        paymentMethod: params.paymentMethod,
        notes: "Reconciliado automaticamente pela Conta Azul",
        updatedAt: new Date(),
      })
      .where(eq(paymentReceipt.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(paymentReceipt)
    .values({
      installmentId: params.installmentId,
      recordedBy: params.recordedBy,
      receivedAt: params.receivedAt,
      amountCents: params.amountCents,
      paymentMethod: params.paymentMethod,
      reference: params.reference,
      notes: "Reconciliado automaticamente pela Conta Azul",
    })
    .returning();

  await db.insert(financialAuditLog).values({
    organizationId: params.organizationId,
    entityType: "receipt",
    entityId: String(created?.id ?? params.installmentId),
    action: "receipt.reconciled.conta_azul",
    changes: {
      installmentId: params.installmentId,
      remoteInstallmentId: params.remoteInstallmentId,
      amountCents: params.amountCents,
      paymentMethod: params.paymentMethod,
      receivedAt: params.receivedAt.toISOString(),
    },
    performedBy: params.recordedBy,
    reason: "Reconciliado automaticamente pela Conta Azul",
  });

  return created?.id ?? null;
}

export async function pollContaAzulBillingStatus(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
  now?: Date;
}): Promise<RemoteStatusPollResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.paymentStatusPolling) {
    throw new Error("Polling de pagamentos da Conta Azul está desativado");
  }

  const now = params.now ?? new Date();
  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: CONTA_AZUL_RECEIVABLES_CURSOR_TYPE,
  });
  const lastRemoteUpdatedAt =
    storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
    config.polling.receivablesLastRemoteUpdatedAt;
  const pendingNextPage =
    typeof storedCursor?.nextPage === "number" && storedCursor.nextPage > 0
      ? storedCursor.nextPage
      : null;
  const pendingWindowEndAt = parseRemoteDate(
    readCursorStateText(storedCursor, "windowEndAt"),
  );
  const windowEnd =
    pendingNextPage && pendingWindowEndAt ? pendingWindowEndAt : now;
  const from = lastRemoteUpdatedAt
    ? (parseRemoteDate(lastRemoteUpdatedAt) ??
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const requestedLimit = Math.max(1, Math.min(params.limit ?? 50, 500));
  const pageSize = Math.min(requestedLimit, 100);
  const client = await createContaAzulClientForRecord({
    record,
    env: params.env,
  });
  const items: ReturnType<typeof extractReceivableItems> = [];
  let page = pendingNextPage ?? 1;
  let totalItems: number | null = null;
  let nextPage: number | null = null;

  while (items.length < requestedLimit) {
    const response =
      await client.searchReceivableEvents<ContaAzulReceivableSearchResponse>({
        pagina: page,
        tamanho_pagina: pageSize,
        data_alteracao_de: formatContaAzulDateTime(from),
        data_alteracao_ate: formatContaAzulDateTime(windowEnd),
      });
    const pageItems = extractReceivableItems(response);
    totalItems = extractReceivableTotalItems(response);
    const remainingLimit = requestedLimit - items.length;
    const consumedItems = pageItems.slice(0, remainingLimit);

    items.push(...consumedItems);

    if (consumedItems.length < pageItems.length) {
      nextPage = page;
      break;
    }

    const hasMorePages =
      pageItems.length >= pageSize &&
      (totalItems === null || page * pageSize < totalItems);
    if (!hasMorePages) {
      break;
    }

    if (items.length >= requestedLimit) {
      nextPage = page + 1;
      break;
    }

    page += 1;
  }

  let updatedCount = 0;
  const warnings: string[] = [];

  for (const item of items) {
    const matched = matchContaAzulInstallmentToBillingDocument(item);
    if (!matched) {
      warnings.push(`Parcela ${item.id} sem referência CalibraFácil`);
      continue;
    }

    const [localInstallment] = await db
      .select({
        id: receivableInstallment.id,
        documentId: receivableInstallment.documentId,
        amountCents: receivableInstallment.amountCents,
        documentStatus: billingDocument.status,
      })
      .from(receivableInstallment)
      .innerJoin(
        billingDocument,
        eq(receivableInstallment.documentId, billingDocument.id),
      )
      .where(
        and(
          eq(billingDocument.id, matched.documentId),
          eq(billingDocument.organizationId, params.organizationId),
          eq(
            receivableInstallment.installmentNumber,
            matched.installmentNumber,
          ),
        ),
      )
      .limit(1);

    if (!localInstallment) {
      warnings.push(`Parcela local não encontrada para ${matched.externalId}`);
      continue;
    }

    const mapped = mapContaAzulInstallmentStatus(item);
    const dueDate = parseRemoteDate(item.data_vencimento);
    const paidAt =
      mapped.installmentStatus === "PAID"
        ? (parseRemoteDate(item.data_pagamento) ??
          parseRemoteDate(item.data_alteracao) ??
          now)
        : null;
    const receiptSummary = buildContaAzulPaymentReceiptSummary({
      installment: item,
      localAmountCents: localInstallment.amountCents,
    });

    await db
      .update(receivableInstallment)
      .set({
        status: mapped.installmentStatus,
        ...(dueDate ? { dueDate } : {}),
        paidAt,
        paymentMethod: receiptSummary?.paymentMethod ?? null,
        paymentReference: item.nsu ?? item.id,
        updatedAt: new Date(),
      })
      .where(eq(receivableInstallment.id, localInstallment.id));

    if (receiptSummary) {
      await upsertContaAzulPaymentReceipt({
        organizationId: params.organizationId,
        recordedBy: record.integration.createdBy,
        installmentId: localInstallment.id,
        remoteInstallmentId: item.id,
        receivedAt:
          parseRemoteDate(item.data_pagamento) ??
          parseRemoteDate(item.data_alteracao) ??
          now,
        amountCents: receiptSummary.amountCents,
        paymentMethod: receiptSummary.paymentMethod,
        reference: receiptSummary.reference,
      });
    }

    const documentStatus = await getDocumentStatusAfterInstallmentUpdate(
      localInstallment.documentId,
    );

    if (localInstallment.documentStatus !== "VOID") {
      await db
        .update(billingDocument)
        .set({
          status: documentStatus,
          updatedAt: new Date(),
        })
        .where(eq(billingDocument.id, localInstallment.documentId));
    }

    // Phase 2 slice 1: recompute certificate release state for any
    // calibration jobs linked (via service_order_certificate_link) to a
    // service order pointing at this billing document. Read-only with
    // respect to calibration_job.status / issued_certificate_snapshot.status.
    await recomputeCertificateReleasesForBillingDocument({
      organizationId: params.organizationId,
      billingDocumentId: localInstallment.documentId,
    });

    if (item.evento?.id) {
      const billingDocumentLink = await getExistingLink(
        params.integrationId,
        "billing_document",
        matched.externalId,
      );
      const protocolId =
        billingDocumentLink?.remoteEntityType ===
          "conta_azul_receivable_protocol" &&
        billingDocumentLink.remoteEntityId !== item.evento.id
          ? billingDocumentLink.remoteEntityId
          : null;

      await upsertLink({
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        target: "billing_document",
        localEntityId: matched.externalId,
        remoteEntityId: item.evento.id,
        remoteDisplayId: item.evento.id,
        remoteEntityType: "conta_azul_receivable_event",
        metadata: buildContaAzulReceivableEventLinkMetadata({
          installment: item,
          protocolId,
        }),
      });
    }

    await upsertLink({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      target: "receivable_installment",
      localEntityId: `receivable_installment:${localInstallment.id}`,
      remoteEntityId: item.id,
      remoteDisplayId: item.id,
      remoteEntityType: "conta_azul_receivable_installment",
      metadata: buildContaAzulReceivableInstallmentLinkMetadata({
        installment: item,
        matched,
      }),
    });

    if (mapped.requiresReview) {
      warnings.push(`Parcela ${item.id} requer revisão manual`);
    }
    if (receiptSummary && mapped.installmentStatus !== "PAID") {
      warnings.push(`Parcela ${item.id} possui pagamento parcial`);
    }

    updatedCount += 1;
  }

  const completedWindow = nextPage === null;
  const nextLastRemoteUpdatedAt = completedWindow
    ? windowEnd.toISOString()
    : lastRemoteUpdatedAt;
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      receivablesLastRemoteUpdatedAt:
        nextLastRemoteUpdatedAt ??
        config.polling.receivablesLastRemoteUpdatedAt,
    },
  });

  await db
    .update(integrationConnection)
    .set({
      config: nextConfig,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnection.id, record.connection.id));

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_RECEIVABLES_CURSOR_TYPE,
    lastRemoteUpdatedAt: nextLastRemoteUpdatedAt,
    lastSuccessfulPollAt: now.toISOString(),
    nextPage,
    state: {
      processedCount: items.length,
      updatedCount,
      requestedLimit,
      pageSize,
      totalItems,
      ...(nextPage ? { windowEndAt: windowEnd.toISOString() } : {}),
    },
  };

  await upsertIntegrationCursor({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursor,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: warnings.length > 0 ? "warning" : "info",
    event: "integration.conta_azul.payment_poll.completed",
    message: "Polling de pagamentos da Conta Azul concluído",
    details: {
      processedCount: items.length,
      updatedCount,
      warnings,
    },
  });

  return {
    processedCount: items.length,
    updatedCount,
    cursor,
    warnings,
  };
}

export async function processScheduledContaAzulPaymentPolling(params: {
  env: IntegrationsEnv;
  now?: Date;
  limit?: number;
  intervalMs?: number;
}): Promise<{
  scannedIntegrations: number;
  dueIntegrations: number;
  successfulPolls: number;
  failedPolls: number;
  processedCount: number;
  updatedCount: number;
}> {
  return processScheduledContaAzulPollKind({
    definition: getContaAzulPollDefinition("paymentStatusPolling"),
    env: params.env,
    now: params.now ?? new Date(),
    limit: params.limit,
    intervalMs: params.intervalMs,
  });
}

export async function pollContaAzulPayableStatus(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
}): Promise<RemoteStatusPollResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.payables) {
    throw new Error("Polling de contas a pagar da Conta Azul está desativado");
  }

  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: CONTA_AZUL_PAYABLES_CURSOR_TYPE,
  });
  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.pollPayableStatus) {
    throw new Error(
      "Provider Conta Azul sem suporte a polling de contas a pagar",
    );
  }

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_PAYABLES_CURSOR_TYPE,
    lastRemoteUpdatedAt:
      storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
      config.polling.payablesLastRemoteUpdatedAt,
    lastSuccessfulPollAt:
      storedCursor?.lastSuccessfulPollAt?.toISOString() ?? null,
    nextPage:
      typeof storedCursor?.nextPage === "number" && storedCursor.nextPage > 0
        ? storedCursor.nextPage
        : null,
    state: {
      ...toRecord(storedCursor?.state),
      requestedLimit: Math.max(1, Math.min(params.limit ?? 50, 200)),
    },
  };

  const result = await adapter.pollPayableStatus(cursor);
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      payablesLastRemoteUpdatedAt:
        result.cursor.lastRemoteUpdatedAt ??
        config.polling.payablesLastRemoteUpdatedAt,
    },
  });

  await db
    .update(integrationConnection)
    .set({
      config: nextConfig,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnection.id, record.connection.id));

  await upsertIntegrationCursor({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursor: result.cursor,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: result.warnings.length > 0 ? "warning" : "info",
    event: "integration.conta_azul.payable_poll.completed",
    message: "Polling de contas a pagar da Conta Azul concluído",
    details: {
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      warnings: result.warnings,
    },
  });

  return result;
}

/**
 * Manual entrada/ajuste for a catalog material bound to a Conta Azul
 * product: sets the ERP product's absolute on-hand quantity (the ERP
 * records the movement as the difference) and refreshes the local
 * snapshot. Stock truth stays in the ERP — this is the one deliberate
 * write path besides the sale-driven decrement.
 */
export async function adjustMaterialErpStock(params: {
  organizationId: string;
  materialId: number;
  quantity: number;
  env: IntegrationsEnv;
}): Promise<{ stockQuantity: number; stockSyncedAt: Date }> {
  if (!Number.isFinite(params.quantity) || params.quantity < 0) {
    throw new Error("Quantidade de estoque inválida");
  }

  const [integrationRow] = await db
    .select({ integrationId: organizationIntegration.id })
    .from(organizationIntegration)
    .where(
      and(
        eq(organizationIntegration.organizationId, params.organizationId),
        eq(organizationIntegration.type, "financial_erp"),
        eq(organizationIntegration.provider, "conta_azul"),
        eq(organizationIntegration.status, "ACTIVE"),
      ),
    )
    .orderBy(desc(organizationIntegration.updatedAt))
    .limit(1);
  if (!integrationRow) {
    throw new Error("Nenhuma integração Conta Azul ativa encontrada");
  }

  const record = await getIntegrationRecord(
    params.organizationId,
    integrationRow.integrationId,
  );
  if (!record) {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.products) {
    throw new Error("Sincronização de produtos da Conta Azul está desativada");
  }

  const [link] = await db
    .select({ remoteEntityId: integrationObjectLink.remoteEntityId })
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.integrationId, integrationRow.integrationId),
        eq(integrationObjectLink.target, "catalog_item"),
        eq(
          integrationObjectLink.localEntityId,
          `material:${params.materialId}`,
        ),
      ),
    )
    .limit(1);
  if (!link?.remoteEntityId) {
    throw new Error(
      "Material não está vinculado a um produto na Conta Azul — sincronize o catálogo antes de ajustar o estoque",
    );
  }
  const remoteEntityId = link.remoteEntityId;

  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.setProductStock) {
    throw new Error("Provider Conta Azul sem suporte a ajuste de estoque");
  }

  await adapter.setProductStock(remoteEntityId, params.quantity);

  const stockSyncedAt = new Date();
  await db
    .update(material)
    .set({ stockQuantity: params.quantity, stockSyncedAt })
    .where(
      and(
        eq(material.id, params.materialId),
        eq(material.organizationId, params.organizationId),
      ),
    );

  await writeIntegrationEvent({
    integrationId: integrationRow.integrationId,
    organizationId: params.organizationId,
    level: "info",
    event: "integration.conta_azul.product_stock_adjusted",
    message: "Ajuste de estoque enviado à Conta Azul",
    details: {
      materialId: params.materialId,
      quantity: params.quantity,
      remoteEntityId,
    },
  });

  return { stockQuantity: params.quantity, stockSyncedAt };
}

/**
 * Refresh the local on-hand snapshot (material.stock_quantity) from the ERP
 * for materials bound to Conta Azul products. Stock truth stays remote —
 * saída happens via the exported sale, entrada/ajuste via the explicit
 * stock-adjust action; this poll only mirrors balances for picker badges
 * and the materials list. Stalest snapshots refresh first so every linked
 * material converges even when there are more links than the per-run limit.
 */
export async function pollContaAzulProductStock(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
}): Promise<RemoteStatusPollResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.products) {
    throw new Error("Sincronização de produtos da Conta Azul está desativada");
  }

  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.fetchProductStock) {
    throw new Error("Provider Conta Azul sem suporte a estoque de produtos");
  }

  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  const rows = await db
    .select({
      materialId: material.id,
      remoteEntityId: integrationObjectLink.remoteEntityId,
    })
    .from(integrationObjectLink)
    .innerJoin(
      material,
      sql`${integrationObjectLink.localEntityId} = 'material:' || ${material.id}`,
    )
    .where(
      and(
        eq(integrationObjectLink.integrationId, params.integrationId),
        eq(integrationObjectLink.target, "catalog_item"),
        eq(material.organizationId, params.organizationId),
        eq(material.isActive, true),
      ),
    )
    .orderBy(sql`${material.stockSyncedAt} asc nulls first`)
    .limit(limit);

  const warnings: string[] = [];
  let updatedCount = 0;

  for (const row of rows) {
    if (!row.remoteEntityId) {
      warnings.push(`material:${row.materialId}: vínculo sem id remoto`);
      continue;
    }
    try {
      const { quantity } = await adapter.fetchProductStock(row.remoteEntityId);
      await db
        .update(material)
        .set({ stockQuantity: quantity, stockSyncedAt: new Date() })
        .where(eq(material.id, row.materialId));
      updatedCount += 1;
    } catch (error) {
      warnings.push(
        `material:${row.materialId}: ${
          error instanceof Error
            ? error.message
            : "falha ao ler estoque do produto"
        }`,
      );
    }
  }

  const result: RemoteStatusPollResult = {
    processedCount: rows.length,
    updatedCount,
    warnings,
    cursor: {
      cursorType: CONTA_AZUL_PRODUCT_STOCK_CURSOR_TYPE,
      lastRemoteUpdatedAt: null,
      lastSuccessfulPollAt: new Date().toISOString(),
      nextPage: null,
      state: {},
    },
  };

  await upsertIntegrationCursor({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursor: result.cursor,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: warnings.length > 0 ? "warning" : "info",
    event: "integration.conta_azul.product_stock_poll.completed",
    message: "Polling de estoque de produtos da Conta Azul concluído",
    details: {
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      warnings: result.warnings,
    },
  });

  return result;
}

export async function processScheduledContaAzulPayablePolling(params: {
  env: IntegrationsEnv;
  now?: Date;
  limit?: number;
  intervalMs?: number;
}): Promise<{
  scannedIntegrations: number;
  dueIntegrations: number;
  successfulPolls: number;
  failedPolls: number;
  processedCount: number;
  updatedCount: number;
}> {
  return processScheduledContaAzulPollKind({
    definition: getContaAzulPollDefinition("payables"),
    env: params.env,
    now: params.now ?? new Date(),
    limit: params.limit,
    intervalMs: params.intervalMs,
  });
}

export async function pollContaAzulFiscalDocuments(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
}): Promise<RemoteStatusPollResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.fiscalDocuments) {
    throw new Error("Sincronização fiscal da Conta Azul está desativada");
  }

  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE,
  });
  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.pollFiscalDocuments) {
    throw new Error("Provider Conta Azul sem suporte a polling fiscal");
  }

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE,
    lastRemoteUpdatedAt:
      storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
      config.polling.invoicesLastRemoteUpdatedAt,
    lastSuccessfulPollAt:
      storedCursor?.lastSuccessfulPollAt?.toISOString() ?? null,
    nextPage:
      typeof storedCursor?.nextPage === "number" && storedCursor.nextPage > 0
        ? storedCursor.nextPage
        : null,
    state: {
      ...toRecord(storedCursor?.state),
      requestedLimit: Math.max(1, Math.min(params.limit ?? 50, 100)),
    },
  };

  const result = await adapter.pollFiscalDocuments(cursor);
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      invoicesLastRemoteUpdatedAt:
        result.cursor.lastRemoteUpdatedAt ??
        config.polling.invoicesLastRemoteUpdatedAt,
    },
  });

  await db
    .update(integrationConnection)
    .set({
      config: nextConfig,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnection.id, record.connection.id));

  await upsertIntegrationCursor({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursor: result.cursor,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: result.warnings.length > 0 ? "warning" : "info",
    event: "integration.conta_azul.fiscal_poll.completed",
    message: "Polling fiscal da Conta Azul concluído",
    details: {
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      warnings: result.warnings,
    },
  });

  return result;
}

export async function linkContaAzulFiscalDocumentsToMdfe(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  payload: IntegrationMdfeLinkPayload;
}) {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.fiscalDocuments) {
    throw new Error("Sincronização fiscal da Conta Azul está desativada");
  }

  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.linkFiscalDocumentsToMdfe) {
    throw new Error("Provider Conta Azul sem suporte a vínculo MDF-e");
  }

  const result = await adapter.linkFiscalDocumentsToMdfe({
    ...params.payload,
    organizationId: params.organizationId,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: "info",
    event: "integration.conta_azul.mdfe_link.completed",
    message: "Vínculo MDF-e da Conta Azul concluído",
    details: {
      remoteEntityId: result.remoteEntityId,
      remoteEntityType: result.remoteEntityType,
      accessKeyCount: params.payload.fiscalDocumentAccessKeys.length,
      status: params.payload.status,
    },
  });

  return result;
}

export async function pollContaAzulProtocols(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
}): Promise<RemoteStatusPollResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.protocols) {
    throw new Error("Polling de protocolos da Conta Azul está desativado");
  }

  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: CONTA_AZUL_PROTOCOLS_CURSOR_TYPE,
  });
  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.pollProtocols) {
    throw new Error("Provider Conta Azul sem suporte a polling de protocolos");
  }

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_PROTOCOLS_CURSOR_TYPE,
    lastRemoteUpdatedAt:
      storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
      config.polling.protocolsLastRemoteUpdatedAt,
    lastSuccessfulPollAt:
      storedCursor?.lastSuccessfulPollAt?.toISOString() ?? null,
    nextPage:
      typeof storedCursor?.nextPage === "number" && storedCursor.nextPage > 0
        ? storedCursor.nextPage
        : null,
    state: {
      ...toRecord(storedCursor?.state),
      requestedLimit: Math.max(1, Math.min(params.limit ?? 50, 200)),
    },
  };

  const result = await adapter.pollProtocols(cursor);
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      protocolsLastRemoteUpdatedAt:
        result.cursor.lastRemoteUpdatedAt ??
        config.polling.protocolsLastRemoteUpdatedAt,
    },
  });

  await db
    .update(integrationConnection)
    .set({
      config: nextConfig,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnection.id, record.connection.id));

  await upsertIntegrationCursor({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursor: result.cursor,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: result.warnings.length > 0 ? "warning" : "info",
    event: "integration.conta_azul.protocol_poll.completed",
    message: "Polling de protocolos da Conta Azul concluído",
    details: {
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      warnings: result.warnings,
    },
  });

  return result;
}

export async function processScheduledContaAzulFiscalPolling(params: {
  env: IntegrationsEnv;
  now?: Date;
  limit?: number;
  intervalMs?: number;
}): Promise<{
  scannedIntegrations: number;
  dueIntegrations: number;
  successfulPolls: number;
  failedPolls: number;
  processedCount: number;
  updatedCount: number;
}> {
  return processScheduledContaAzulPollKind({
    definition: getContaAzulPollDefinition("fiscalDocuments"),
    env: params.env,
    now: params.now ?? new Date(),
    limit: params.limit,
    intervalMs: params.intervalMs,
  });
}

export async function processScheduledContaAzulProtocolPolling(params: {
  env: IntegrationsEnv;
  now?: Date;
  limit?: number;
  intervalMs?: number;
}): Promise<{
  scannedIntegrations: number;
  dueIntegrations: number;
  successfulPolls: number;
  failedPolls: number;
  processedCount: number;
  updatedCount: number;
}> {
  return processScheduledContaAzulPollKind({
    definition: getContaAzulPollDefinition("protocols"),
    env: params.env,
    now: params.now ?? new Date(),
    limit: params.limit,
    intervalMs: params.intervalMs,
  });
}

export async function pollContaAzulRemoteDrift(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
}): Promise<RemoteStatusPollResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.driftChecks) {
    throw new Error("Verificação de drift da Conta Azul está desativada");
  }

  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: CONTA_AZUL_DRIFT_CURSOR_TYPE,
  });
  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.pollRemoteDrift) {
    throw new Error("Provider Conta Azul sem suporte a verificação de drift");
  }

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_DRIFT_CURSOR_TYPE,
    lastRemoteUpdatedAt:
      storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
      config.polling.driftLastCheckedAt,
    lastSuccessfulPollAt:
      storedCursor?.lastSuccessfulPollAt?.toISOString() ?? null,
    nextPage:
      typeof storedCursor?.nextPage === "number" && storedCursor.nextPage > 0
        ? storedCursor.nextPage
        : null,
    state: {
      ...toRecord(storedCursor?.state),
      requestedLimit: Math.max(1, Math.min(params.limit ?? 50, 200)),
    },
  };

  const result = await adapter.pollRemoteDrift(cursor);
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      driftLastCheckedAt:
        result.cursor.lastRemoteUpdatedAt ?? config.polling.driftLastCheckedAt,
    },
  });

  await db
    .update(integrationConnection)
    .set({
      config: nextConfig,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnection.id, record.connection.id));

  await upsertIntegrationCursor({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursor: result.cursor,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: result.warnings.length > 0 ? "warning" : "info",
    event: "integration.conta_azul.drift_poll.completed",
    message: "Verificação de drift da Conta Azul concluída",
    details: {
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      warnings: result.warnings,
    },
  });

  return result;
}

export async function processScheduledContaAzulDriftPolling(params: {
  env: IntegrationsEnv;
  now?: Date;
  limit?: number;
  intervalMs?: number;
}): Promise<{
  scannedIntegrations: number;
  dueIntegrations: number;
  successfulPolls: number;
  failedPolls: number;
  processedCount: number;
  updatedCount: number;
}> {
  return processScheduledContaAzulPollKind({
    definition: getContaAzulPollDefinition("driftChecks"),
    env: params.env,
    now: params.now ?? new Date(),
    limit: params.limit,
    intervalMs: params.intervalMs,
  });
}

function isContaAzulTargetEnabled(
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>,
  target: IntegrationSyncTarget,
) {
  if (target === "catalog_item") {
    return config.enabledTargets.products || config.enabledTargets.services;
  }
  if (target === "contract") {
    return config.enabledTargets.contracts;
  }
  if (target === "customer") {
    return config.enabledTargets.customers;
  }
  if (target === "supplier") {
    return config.enabledTargets.suppliers;
  }
  if (target === "transporter") {
    return config.enabledTargets.transporters;
  }
  if (target === "billing_document") {
    return config.enabledTargets.billingDocuments;
  }
  if (target === "payable") {
    return config.enabledTargets.payables || config.enabledTargets.expenses;
  }
  return (
    config.enabledTargets.sales ||
    (config.exportMode === "budget_to_sale" && config.enabledTargets.budgets)
  );
}

export function isContaAzulScheduledSyncDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  target: IntegrationSyncTarget;
  now: Date;
}) {
  if (!isContaAzulTargetEnabled(params.config, params.target)) {
    return false;
  }

  const schedule = params.config.schedules[params.target];
  const nextScheduledRunAt = parseRemoteDate(schedule.nextScheduledRunAt);

  if (schedule.mode !== "scheduled" || !nextScheduledRunAt) {
    return false;
  }

  return nextScheduledRunAt.getTime() <= params.now.getTime();
}

function isCatalogItemPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationCatalogItemPayload {
  return "kind" in payload && "code" in payload && "priceCents" in payload;
}

function isContractPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationContractPayload {
  return "recurrence" in payload && "contractNumber" in payload;
}

function isCustomerPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationCustomerPayload {
  return "taxId" in payload && "name" in payload && !("pessoaRole" in payload);
}

function isServiceOrderPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationServiceOrderPayload {
  return "jobId" in payload && "assetName" in payload;
}

function isPayablePayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationPayablePayload {
  return "amountCents" in payload && "supplierExternalId" in payload;
}

function isBillingDocumentPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationBillingDocumentPayload {
  return "documentNumber" in payload && "totalCents" in payload;
}

export async function processScheduledContaAzulIntegrationSyncs(params: {
  env: IntegrationsEnv;
  now?: Date;
  limit?: number;
  dispatch?: (message: IntegrationSyncBackgroundJobMessage) => Promise<void>;
}): Promise<{
  scannedIntegrations: number;
  dueRuns: number;
  queuedRuns: number;
  completedRuns: number;
  failedRuns: number;
}> {
  const now = params.now ?? new Date();
  const rows = await db
    .select({
      integrationId: organizationIntegration.id,
      organizationId: organizationIntegration.organizationId,
      config: integrationConnection.config,
    })
    .from(organizationIntegration)
    .innerJoin(
      integrationConnection,
      eq(integrationConnection.integrationId, organizationIntegration.id),
    )
    .where(
      and(
        eq(organizationIntegration.status, "ACTIVE"),
        eq(organizationIntegration.provider, "conta_azul"),
      ),
    );

  let dueRuns = 0;
  let queuedRuns = 0;
  let completedRuns = 0;
  let failedRuns = 0;

  for (const row of rows) {
    let currentConfig = normalizeContaAzulConnectionConfig(row.config);

    for (const target of CONTA_AZUL_SCHEDULED_SYNC_TARGETS) {
      const schedule = currentConfig.schedules[target];
      if (
        !isContaAzulScheduledSyncDue({ config: currentConfig, target, now })
      ) {
        continue;
      }

      const activeRun = await hasActiveSyncRun({
        integrationId: row.integrationId,
        organizationId: row.organizationId,
        target,
      });

      if (activeRun) {
        continue;
      }

      dueRuns += 1;

      const runId = await createSyncRun({
        integrationId: row.integrationId,
        organizationId: row.organizationId,
        trigger: "scheduled",
        target,
        requestedLimit: params.limit ?? DEFAULT_INTEGRATION_SYNC_LIMIT,
      });

      await writeIntegrationEvent({
        integrationId: row.integrationId,
        organizationId: row.organizationId,
        runId,
        level: "info",
        event: "sync.scheduled_requested",
        message: "Sincronização Conta Azul agendada solicitada",
        details: {
          target,
          trigger: "scheduled",
        },
      });

      let syncStarted = false;

      try {
        const nextConfig = updateTargetScheduleConfig({
          config: currentConfig,
          target,
          mode: "scheduled",
          frequency: schedule.frequency,
          lastScheduledRunAt: now.toISOString(),
          nextScheduledRunAt: buildNextScheduledRunAtFrom({
            frequency: schedule.frequency,
            from: now,
          }),
        });

        await db
          .update(integrationConnection)
          .set({
            config: nextConfig,
            updatedAt: new Date(),
          })
          .where(eq(integrationConnection.integrationId, row.integrationId));
        currentConfig = normalizeContaAzulConnectionConfig(nextConfig);

        const message: IntegrationSyncBackgroundJobMessage = {
          type: "INTEGRATION_SYNC",
          provider: "conta_azul",
          integrationId: row.integrationId,
          organizationId: row.organizationId,
          runId,
          target,
          limit: params.limit ?? DEFAULT_INTEGRATION_SYNC_LIMIT,
          trigger: "scheduled",
        };

        if (params.dispatch) {
          await params.dispatch(message);
          queuedRuns += 1;
        } else {
          syncStarted = true;
          await runIntegrationSync({
            integrationId: row.integrationId,
            organizationId: row.organizationId,
            runId,
            target,
            limit: params.limit ?? DEFAULT_INTEGRATION_SYNC_LIMIT,
            env: params.env,
          });
          completedRuns += 1;
        }
      } catch (error) {
        failedRuns += 1;
        const message =
          error instanceof Error
            ? error.message
            : "Falha na sincronização Conta Azul agendada";
        if (!syncStarted) {
          await failIntegrationSyncRun({
            integrationId: row.integrationId,
            organizationId: row.organizationId,
            runId,
            target,
            message,
            details: {
              trigger: "scheduled",
            },
          });
        }
        await writeIntegrationEvent({
          integrationId: row.integrationId,
          organizationId: row.organizationId,
          runId,
          level: "error",
          event: "sync.scheduled_failed",
          message,
          details: {
            target,
            trigger: "scheduled",
          },
        });
      }
    }
  }

  return {
    scannedIntegrations: rows.length,
    dueRuns,
    queuedRuns,
    completedRuns,
    failedRuns,
  };
}

async function pushContaAzulTargetRecord(params: {
  record: GenericConnectionRecord;
  target: IntegrationSyncTarget;
  env: IntegrationsEnv;
  payload: IntegrationSyncPayload;
}) {
  const adapter = await createContaAzulAdapterForRecord({
    record: params.record,
    env: params.env,
  });
  const config = normalizeContaAzulConnectionConfig(
    params.record.connection.config,
  );

  if (params.target === "catalog_item") {
    if (!isCatalogItemPayload(params.payload)) {
      throw new Error("Payload de catálogo inválido para Conta Azul");
    }
    // Gate per kind: services and products (materials) are enabled
    // independently on the connection.
    if (params.payload.kind === "service" && !config.enabledTargets.services) {
      throw new Error("Sincronização de serviços Conta Azul desativada");
    }
    if (params.payload.kind === "product" && !config.enabledTargets.products) {
      throw new Error("Sincronização de produtos Conta Azul desativada");
    }
    if (!adapter.upsertCatalogItem) {
      throw new Error("Provider Conta Azul sem suporte a catálogo");
    }
    return adapter.upsertCatalogItem(params.payload);
  }

  if (params.target === "contract") {
    if (!isContractPayload(params.payload)) {
      throw new Error("Payload de contrato inválido para Conta Azul");
    }
    if (!config.enabledTargets.contracts) {
      throw new Error("Sincronização de contratos Conta Azul desativada");
    }
    if (!adapter.upsertContract) {
      throw new Error("Provider Conta Azul sem suporte a contratos");
    }
    return adapter.upsertContract(params.payload);
  }

  if (params.target === "customer") {
    if (!isCustomerPayload(params.payload)) {
      throw new Error("Payload de cliente inválido para Conta Azul");
    }
    if (!config.enabledTargets.customers) {
      throw new Error("Sincronização de clientes Conta Azul desativada");
    }
    return adapter.upsertCustomer(params.payload);
  }

  if (params.target === "supplier") {
    if (
      !("pessoaRole" in params.payload) ||
      params.payload.pessoaRole !== "supplier"
    ) {
      throw new Error("Payload de fornecedor inválido para Conta Azul");
    }
    if (!config.enabledTargets.suppliers) {
      throw new Error("Sincronização de fornecedores Conta Azul desativada");
    }
    if (!adapter.upsertSupplier) {
      throw new Error("Provider Conta Azul sem suporte a fornecedores");
    }
    return adapter.upsertSupplier(params.payload);
  }

  if (params.target === "transporter") {
    if (
      !("pessoaRole" in params.payload) ||
      params.payload.pessoaRole !== "transporter"
    ) {
      throw new Error("Payload de transportadora inválido para Conta Azul");
    }
    if (!config.enabledTargets.transporters) {
      throw new Error("Sincronização de transportadoras Conta Azul desativada");
    }
    if (!adapter.upsertTransporter) {
      throw new Error("Provider Conta Azul sem suporte a transportadoras");
    }
    return adapter.upsertTransporter(params.payload);
  }

  if (params.target === "service_order") {
    if (!isServiceOrderPayload(params.payload)) {
      throw new Error("Payload de ordem de serviço inválido para Conta Azul");
    }

    if (config.exportMode === "budget_to_sale") {
      if (!config.enabledTargets.budgets) {
        throw new Error("Sincronização de orçamentos Conta Azul desativada");
      }
      if (!adapter.exportBudget) {
        throw new Error("Provider Conta Azul sem suporte a orçamentos");
      }
      const budget = await adapter.exportBudget(
        mapServiceOrderToBudgetPayload(params.payload),
      );
      await upsertLink({
        integrationId: params.record.integration.id,
        organizationId: params.record.integration.organizationId,
        target: "service_order",
        localEntityId: params.payload.externalId,
        remoteEntityId: budget.remoteEntityId,
        remoteDisplayId: budget.remoteDisplayId ?? budget.remoteEntityId,
        remoteEntityType: budget.remoteEntityType ?? "conta_azul_budget_sale",
        metadata: {
          provider: "conta_azul",
          resource: "venda/busca",
          exportMode: config.exportMode,
          aliasForTarget: "budget",
          budgetRemoteId: budget.remoteEntityId,
        },
      });
      return budget;
    }

    if (!config.enabledTargets.sales) {
      throw new Error("Sincronização de vendas Conta Azul desativada");
    }
    if (!adapter.exportSale) {
      throw new Error("Provider Conta Azul sem suporte a vendas");
    }
    const sale = await adapter.exportSale(
      mapServiceOrderToSalePayload(params.payload),
    );
    await upsertLink({
      integrationId: params.record.integration.id,
      organizationId: params.record.integration.organizationId,
      target: "service_order",
      localEntityId: params.payload.externalId,
      remoteEntityId: sale.remoteEntityId,
      remoteDisplayId: sale.remoteDisplayId ?? sale.remoteEntityId,
      remoteEntityType: sale.remoteEntityType ?? "conta_azul_sale",
      metadata: {
        provider: "conta_azul",
        resource: "venda",
        exportMode: config.exportMode,
        aliasForTarget: "sale",
        saleRemoteId: sale.remoteEntityId,
      },
    });
    return sale;
  }

  if (params.target === "payable") {
    if (!isPayablePayload(params.payload)) {
      throw new Error("Payload de conta a pagar inválido para Conta Azul");
    }
    if (!config.enabledTargets.payables && !config.enabledTargets.expenses) {
      throw new Error("Sincronização de contas a pagar Conta Azul desativada");
    }
    if (!config.enabledTargets.suppliers) {
      // Preview blocking already prevents new payables from being scheduled
      // without a supplier sync, but scheduled runs created when the domain
      // was still enabled can race with a toggle-off. Stop the export here so
      // suppliers and payables stay in lockstep.
      throw new Error(
        "Habilite fornecedores da Conta Azul antes de exportar contas a pagar",
      );
    }
    if (!adapter.exportPayable) {
      throw new Error("Provider Conta Azul sem suporte a contas a pagar");
    }
    return adapter.exportPayable(params.payload);
  }

  if (!isBillingDocumentPayload(params.payload)) {
    throw new Error("Payload de faturamento inválido para Conta Azul");
  }
  if (!config.enabledTargets.billingDocuments) {
    throw new Error("Sincronização de faturamento Conta Azul desativada");
  }

  try {
    return await adapter.exportBillingDocument(params.payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      !message.includes("Cliente precisa ser sincronizado") ||
      !params.payload.customerExternalId
    ) {
      throw error;
    }

    // Respect the customers domain toggle: do not auto-create the customer in
    // Conta Azul when that domain is disabled, even on the billing recovery path.
    if (!config.enabledTargets.customers) {
      throw error;
    }

    const customerPayload = await loadCustomerPayloadByExternalId(
      params.record.integration.organizationId,
      params.payload.customerExternalId,
    );

    if (!customerPayload) {
      throw error;
    }

    await adapter.upsertCustomer(customerPayload);
    await writeIntegrationEvent({
      integrationId: params.record.integration.id,
      organizationId: params.record.integration.organizationId,
      level: "info",
      event: "integration.conta_azul.customer_auto_synced",
      message: "Cliente sincronizado automaticamente antes do faturamento",
      details: {
        customerExternalId: customerPayload.externalId,
        billingDocumentExternalId: params.payload.externalId,
      },
    });

    return adapter.exportBillingDocument(params.payload);
  }
}

function getTargetPath(
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
) {
  switch (target) {
    case "customer":
      return config.customerPath;
    case "catalog_item":
    case "contract":
    case "supplier":
    case "transporter":
    case "payable":
      throw new Error("Este alvo é suportado apenas pelo provider Conta Azul");
    case "service_order":
      return config.serviceOrderPath;
    case "billing_document":
      return config.billingDocumentPath;
  }
}

async function pushTargetRecord(params: {
  integrationId: string;
  organizationId: string;
  target: IntegrationSyncTarget;
  config: GenericFinancialErpConnectionConfig;
  secret: string;
  payload:
    | IntegrationCatalogItemPayload
    | IntegrationContractPayload
    | IntegrationCustomerPayload
    | IntegrationSupplierPayload
    | IntegrationTransporterPayload
    | IntegrationPayablePayload
    | IntegrationServiceOrderPayload
    | IntegrationBillingDocumentPayload;
}) {
  const { mappedPayload, issues } = buildMappedTargetPayload({
    config: params.config,
    target: params.target,
    payload: params.payload,
  });

  if (issues.length > 0) {
    throw new Error(
      `Payload inválido para ${params.target}: ${issues.join(" ")}`,
    );
  }

  const existing = await getExistingLink(
    params.integrationId,
    params.target,
    params.payload.externalId,
  );
  const targetPath = getTargetPath(params.config, params.target);
  const remoteEntityId = existing?.remoteEntityId ?? null;
  const url = remoteEntityId
    ? `${params.config.baseUrl}${targetPath}/${encodeURIComponent(remoteEntityId)}`
    : `${params.config.baseUrl}${targetPath}`;
  const method = remoteEntityId ? "PUT" : "POST";

  const result = await callRemoteJson(url, {
    method,
    headers: buildAuthHeaders(params.secret),
    body: JSON.stringify(mappedPayload),
  });

  if (!result.ok) {
    throw new Error(
      `Falha ao sincronizar ${params.target}: remoto respondeu ${result.status}`,
    );
  }

  const resolvedRemoteId = extractRemoteId(result.data) ?? remoteEntityId;

  await upsertLink({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    target: params.target,
    localEntityId: params.payload.externalId,
    remoteEntityId: resolvedRemoteId,
  });

  return {
    remoteEntityId: resolvedRemoteId,
    remoteDisplayId: resolvedRemoteId,
    remoteEntityType: params.target,
  };
}

function getSyncItemOperation(target: IntegrationSyncTarget) {
  if (
    target === "billing_document" ||
    target === "contract" ||
    target === "payable" ||
    target === "service_order"
  ) {
    return "create" as const;
  }

  return "upsert" as const;
}

function getIntegrationErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && code.trim()) return code.trim();
  }
  if (error && typeof error === "object" && "name" in error) {
    const name = error.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return "INTEGRATION_RECORD_ERROR";
}

async function getNextSyncItemAttempt(params: {
  integrationId: string;
  target: IntegrationSyncTarget;
  localEntityId: string;
}) {
  const [row] = await db
    .select({ total: count() })
    .from(integrationSyncItem)
    .where(
      and(
        eq(integrationSyncItem.integrationId, params.integrationId),
        eq(integrationSyncItem.target, params.target),
        eq(integrationSyncItem.localEntityId, params.localEntityId),
        inArray(integrationSyncItem.status, ["FAILED", "DEAD_LETTER"]),
      ),
    );

  return Number(row?.total ?? 0) + 1;
}

async function createRunningSyncItem(params: {
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  payload: IntegrationSyncPayload;
}) {
  const attemptCount = await getNextSyncItemAttempt({
    integrationId: params.integrationId,
    target: params.target,
    localEntityId: params.payload.externalId,
  });
  const id = crypto.randomUUID();

  await db.insert(integrationSyncItem).values({
    id,
    runId: params.runId,
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    target: params.target,
    localEntityId: params.payload.externalId,
    operation: getSyncItemOperation(params.target),
    status: "RUNNING",
    attemptCount,
    requestFingerprint: createIntegrationPayloadFingerprint(params.payload),
    metadata: {
      providerTarget: params.target,
      payloadKind: "kind" in params.payload ? params.payload.kind : null,
      createdFrom: "runIntegrationSync",
    },
  });

  return { id, attemptCount };
}

async function markSyncItemSucceeded(params: {
  itemId: string;
  remoteEntityId: string | null;
}) {
  await db
    .update(integrationSyncItem)
    .set({
      remoteEntityId: params.remoteEntityId,
      status: "SUCCEEDED",
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(integrationSyncItem.id, params.itemId));
}

async function markSyncItemFailed(params: {
  itemId: string;
  attemptCount: number;
  error: unknown;
}) {
  const message =
    params.error instanceof Error ? params.error.message : "Falha desconhecida";

  await db
    .update(integrationSyncItem)
    .set({
      status: params.attemptCount >= 3 ? "DEAD_LETTER" : "FAILED",
      lastErrorCode: getIntegrationErrorCode(params.error),
      lastErrorMessage: message.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(integrationSyncItem.id, params.itemId));
}

export async function runIntegrationSync(params: {
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  limit: number;
  env: IntegrationsEnv;
}): Promise<IntegrationRunExecutionResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record) {
    throw new Error("Integração não encontrada");
  }

  await db
    .update(integrationSyncRun)
    .set({
      status: "RUNNING",
      startedAt: new Date(),
      summary: buildRunSummary({
        target: params.target,
        requestedLimit: params.limit,
      }),
      updatedAt: new Date(),
    })
    .where(eq(integrationSyncRun.id, params.runId));

  try {
    if (record.integration.status !== "ACTIVE") {
      throw new Error("Integração desativada");
    }

    const isGenericHttp = record.integration.provider === "generic_http";
    const config = isGenericHttp
      ? normalizeGenericFinancialErpConfig(record.connection.config)
      : null;
    const secret = isGenericHttp
      ? decryptIntegrationSecret(
          record.connection.encryptedSecret,
          record.connection.secretIv,
          params.env,
        )
      : null;

    if (config) {
      assertValidMappings(config, params.target);
    }

    const loadedPayloads = await loadTargetPayloads(
      params.organizationId,
      params.target,
      params.limit,
    );
    // Catalog runs against Conta Azul only push the kinds the connection
    // enabled (services vs products/materials) instead of failing per item.
    const payloads =
      params.target === "catalog_item" && !isGenericHttp
        ? filterContaAzulCatalogPayloadsByEnabledKinds(
            normalizeContaAzulConnectionConfig(record.connection.config),
            loadedPayloads.filter(isCatalogItemPayload),
          )
        : loadedPayloads;

    let successCount = 0;
    let errorCount = 0;
    let errorSummary: string | null = null;

    for (const payload of payloads) {
      const syncItem = await createRunningSyncItem({
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        runId: params.runId,
        target: params.target,
        payload,
      });

      try {
        let result;
        if (isGenericHttp && config && secret) {
          result = await pushTargetRecord({
            integrationId: params.integrationId,
            organizationId: params.organizationId,
            target: params.target,
            config,
            secret,
            payload,
          });
        } else {
          result = await pushContaAzulTargetRecord({
            record,
            target: params.target,
            env: params.env,
            payload,
          });
        }

        await markSyncItemSucceeded({
          itemId: syncItem.id,
          remoteEntityId: result?.remoteEntityId ?? null,
        });
        successCount += 1;
      } catch (error) {
        await markSyncItemFailed({
          itemId: syncItem.id,
          attemptCount: syncItem.attemptCount,
          error,
        });

        if (isContaAzulReconnectRequiredError(error)) {
          throw error;
        }

        errorCount += 1;
        errorSummary =
          error instanceof Error ? error.message : "Falha desconhecida";

        await writeIntegrationEvent({
          integrationId: params.integrationId,
          organizationId: params.organizationId,
          runId: params.runId,
          level: "error",
          event: "sync.record_failed",
          message: errorSummary,
          details: {
            target: params.target,
            localEntityId: payload.externalId,
          },
        });
      }
    }

    const processedCount = payloads.length;
    const status: IntegrationSyncStatus =
      errorCount === 0
        ? "COMPLETED"
        : successCount === 0
          ? "FAILED"
          : "PARTIAL";

    await db
      .update(integrationSyncRun)
      .set({
        status,
        processedCount,
        successCount,
        errorCount,
        errorSummary,
        summary: buildRunSummary({
          target: params.target,
          processedCount,
          successCount,
          errorCount,
          requestedLimit: params.limit,
        }),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(integrationSyncRun.id, params.runId));

    await writeIntegrationEvent({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      runId: params.runId,
      level: status === "COMPLETED" ? "info" : "warning",
      event: "sync.completed",
      message:
        status === "COMPLETED"
          ? "Sincronização concluída"
          : "Sincronização concluída com ressalvas",
      details: {
        target: params.target,
        processedCount,
        successCount,
        errorCount,
      },
    });

    return {
      status,
      processedCount,
      successCount,
      errorCount,
      errorSummary,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao processar integração";

    await failIntegrationSyncRun({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      runId: params.runId,
      target: params.target,
      message,
      details: {
        phase: "runtime",
      },
    });

    throw error;
  }
}

export async function createSyncRun(params: {
  integrationId: string;
  organizationId: string;
  trigger: IntegrationSyncTrigger;
  target: IntegrationSyncTarget;
  initiatedBy?: string | null;
  requestedLimit?: number;
  retryOfRunId?: string | null;
  pollKind?: ContaAzulScheduledPollKind;
  cursorType?: string;
}) {
  const id = crypto.randomUUID();

  await db.insert(integrationSyncRun).values({
    id,
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    trigger: params.trigger,
    target: params.target,
    status: "PENDING",
    initiatedBy: params.initiatedBy ?? null,
    summary: buildRunSummary({
      target: params.target,
      requestedLimit: params.requestedLimit,
      retryOfRunId: params.retryOfRunId,
      pollKind: params.pollKind,
      cursorType: params.cursorType,
    }),
  });

  return id;
}

export async function failSyncRunAsBlocked(params: {
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  requestedLimit: number;
  message: string;
}) {
  await db
    .update(integrationSyncRun)
    .set({
      status: "FAILED",
      errorSummary: params.message,
      finishedAt: new Date(),
      summary: buildRunSummary({
        target: params.target,
        requestedLimit: params.requestedLimit,
        blocked: true,
      }),
      updatedAt: new Date(),
    })
    .where(eq(integrationSyncRun.id, params.runId));

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    runId: params.runId,
    level: "warning",
    event: "sync.blocked",
    message: params.message,
    details: {
      target: params.target,
      blocked: true,
    },
  });
}

export function buildInitialNextScheduledRunAt(
  frequency: IntegrationScheduleFrequency = DEFAULT_INTEGRATION_SCHEDULE_FREQUENCY,
) {
  return calculateNextScheduledRunAt(frequency, new Date());
}

export function buildNextScheduledRunAtFrom(params: {
  frequency: IntegrationScheduleFrequency;
  from: Date;
}) {
  return calculateNextScheduledRunAt(params.frequency, params.from);
}
