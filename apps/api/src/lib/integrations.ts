import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  customer,
  integrationConnection,
  integrationEventLog,
  integrationObjectLink,
  integrationSyncRun,
  organizationEventLog,
  organizationIntegration,
  organizationUnit,
  service,
} from "@calibra-facil/db/schema";
import {
  decryptPassword,
  encryptPassword,
} from "@calibra-facil/signing";
import {
  applyIntegrationMappings,
  DEFAULT_INTEGRATION_SCHEDULE_FREQUENCY,
  type IntegrationMappedPreviewSample,
  type IntegrationMappingsConfig,
  type IntegrationMappingValidationIssue,
  formatIntegrationCustomerAddress,
  normalizeGenericFinancialErpConfig,
  validateIntegrationMappings,
  type GenericFinancialErpConnectionConfig,
  type IntegrationDependencyWarning,
  type IntegrationBillingDocumentPayload,
  type IntegrationCustomerPayload,
  type IntegrationReadinessSummary,
  type IntegrationReadinessStatus,
  type IntegrationRunMode,
  type IntegrationScheduleFrequency,
  type IntegrationScheduleStatus,
  type IntegrationServiceOrderPayload,
  type IntegrationSetupStatus,
  type IntegrationSyncStatus,
  type IntegrationSyncTarget,
  type IntegrationTargetScheduleSummary,
  type IntegrationTargetCoverageSummary,
  type IntegrationTargetSyncSummary,
  type IntegrationSyncTrigger,
} from "@calibra-facil/shared";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { loadBillingDocumentPayloadsForIntegration } from "./finance";

export interface IntegrationsEnv {
  INTEGRATIONS_MASTER_KEY?: string;
}

export interface IntegrationRunExecutionResult {
  status: IntegrationSyncStatus;
  processedCount: number;
  successCount: number;
  errorCount: number;
  errorSummary: string | null;
}

type GenericConnectionRecord = {
  integration: typeof organizationIntegration.$inferSelect;
  connection: typeof integrationConnection.$inferSelect;
};

export interface IntegrationOverview {
  readiness: IntegrationReadinessSummary;
  targets: IntegrationTargetSyncSummary[];
  syncSummary: {
    lastRunAt: string | null;
    lastSuccessfulRunAt: string | null;
    lastErrorAt: string | null;
    hasRecentFailures: boolean;
  };
}

export const INTEGRATION_TARGETS = [
  "customer",
  "service_order",
  "billing_document",
] as const satisfies readonly IntegrationSyncTarget[];

export const DEFAULT_INTEGRATION_SYNC_LIMIT = 50;

function formatCustomerAddress(
  address: typeof customer.$inferSelect["address"],
): string | null {
  if (!address) return null;

  const parts = [
    address.street,
    address.number,
    address.neighbourhood,
    address.city,
    address.state,
    address.cep,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  return parts.length > 0 ? parts.join(", ") : null;
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
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
) {
  return config.schedules[target];
}

export function updateTargetScheduleConfig(params: {
  config: GenericFinancialErpConnectionConfig;
  target: IntegrationSyncTarget;
  mode?: IntegrationRunMode;
  frequency?: IntegrationScheduleFrequency;
  nextScheduledRunAt?: string | null;
  lastScheduledRunAt?: string | null;
}) {
  return normalizeGenericFinancialErpConfig({
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

  const record = data as Record<string, unknown>;
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
  const normalizedConfig = normalizeGenericFinancialErpConfig(config);
  const result = await callRemoteJson(
    `${normalizedConfig.baseUrl}${normalizedConfig.healthPath}`,
    {
    method: "GET",
    headers: buildAuthHeaders(secret),
    },
  );

  if (!result.ok) {
    throw new Error(`Conector remoto respondeu ${result.status}`);
  }

  return result.data;
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
      config: normalizeGenericFinancialErpConfig(integration.connection.config),
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

  return rows.map((row) => ({
    externalId: `customer:${row.id}`,
    organizationId,
    name: row.name,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    address: formatIntegrationCustomerAddress(row.address),
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }));
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
      ...(params.details ?? {}),
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

async function loadTargetPayloads(
  organizationId: string,
  target: IntegrationSyncTarget,
  limit: number,
) {
  switch (target) {
    case "customer":
      return loadCustomerPayloads(organizationId, limit);
    case "service_order":
      return loadServiceOrderPayloads(organizationId, limit);
    case "billing_document":
      return loadBillingDocumentPayloads(organizationId, limit);
  }
}

async function countLocalTargetRecords(
  organizationId: string,
  target: IntegrationSyncTarget,
) {
  switch (target) {
    case "customer": {
      const [row] = await db
        .select({ total: count() })
        .from(customer)
        .where(eq(customer.labOrganizationId, organizationId));
      return Number(row?.total ?? 0);
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
    record.integration.lastValidatedAt && !record.integration.lastValidationError,
  );
}

function buildDependencyWarnings(params: {
  target: IntegrationSyncTarget;
  integrationStatus: typeof organizationIntegration.$inferSelect["status"];
  validated: boolean;
  coverageByTarget: Record<IntegrationSyncTarget, IntegrationTargetCoverageSummary>;
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
  }

  if (params.target === "billing_document") {
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
  payload:
    | IntegrationCustomerPayload
    | IntegrationServiceOrderPayload
    | IntegrationBillingDocumentPayload,
  mappedPayload: Record<string, unknown>,
  issues: string[],
) {
  if ("name" in payload) {
    return {
      externalId: payload.externalId,
      label: payload.name,
      subtitle: payload.email ?? payload.taxId ?? null,
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
  config: GenericFinancialErpConnectionConfig,
  target?: IntegrationSyncTarget,
): IntegrationMappingValidationIssue[] {
  const issues = validateIntegrationMappings(config.mappings);
  if (!target) return issues;
  return issues.filter((issue) => issue.target === target);
}

function assertValidMappings(
  config: GenericFinancialErpConnectionConfig,
  target?: IntegrationSyncTarget,
) {
  const issues = getMappingValidationIssues(config, target);
  if (issues.length === 0) return;

  throw new Error(issues.map((issue) => issue.message).join(" "));
}

function buildMappedTargetPayload(params: {
  config: GenericFinancialErpConnectionConfig;
  target: IntegrationSyncTarget;
  payload:
    | IntegrationCustomerPayload
    | IntegrationServiceOrderPayload
    | IntegrationBillingDocumentPayload;
}) {
  return applyIntegrationMappings(
    params.target,
    params.payload as unknown as Record<string, unknown>,
    params.config.mappings[params.target],
  );
}

function isSuccessfulRun(
  run: typeof integrationSyncRun.$inferSelect,
): boolean {
  return (
    run.status === "COMPLETED" ||
    (run.status === "PARTIAL" && run.successCount > 0)
  );
}

function isFailingRun(run: typeof integrationSyncRun.$inferSelect): boolean {
  return run.status === "FAILED" || (run.status === "PARTIAL" && run.errorCount > 0);
}

function getRunDurationMs(run: typeof integrationSyncRun.$inferSelect) {
  if (!run.startedAt || !run.finishedAt) return null;
  return Math.max(run.finishedAt.getTime() - run.startedAt.getTime(), 0);
}

function getConsecutiveFailures(runs: typeof integrationSyncRun.$inferSelect[]) {
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

function getLastBlockedAt(runs: typeof integrationSyncRun.$inferSelect[]) {
  for (const run of runs) {
    const summary =
      run.summary && typeof run.summary === "object"
        ? (run.summary as Record<string, unknown>)
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

export async function buildIntegrationOverview(
  record: GenericConnectionRecord,
): Promise<IntegrationOverview> {
  const now = new Date();
  const normalizedConfig = normalizeGenericFinancialErpConfig(record.connection.config);
  const [recentRuns, recentErrorEvent] = await Promise.all([
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
  ]);

  const coverageEntries = await Promise.all(
    (["customer", "service_order", "billing_document"] as const).map(
      async (target) => {
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
      },
    ),
  );

  const coverageByTarget = Object.fromEntries(coverageEntries) as Record<
    IntegrationSyncTarget,
    IntegrationTargetCoverageSummary
  >;

  const validated = hasRemoteValidation(record);
  const targets: IntegrationTargetSyncSummary[] = INTEGRATION_TARGETS.map(
    (target) => {
    const targetRuns = recentRuns.filter((run) => run.target === target);
    const lastRun = targetRuns[0] ?? null;
    const lastSuccessfulRun = targetRuns.find(isSuccessfulRun) ?? null;
    const warnings = buildDependencyWarnings({
      target,
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
    validationRequired: !validated,
    canSync,
    lastValidatedAt: record.integration.lastValidatedAt?.toISOString?.() ?? null,
    lastValidationError: record.integration.lastValidationError,
    dependencyWarnings,
  };

  const lastRun = recentRuns[0] ?? null;
  const lastSuccessfulRun = recentRuns.find(isSuccessfulRun) ?? null;

  return {
    readiness,
    targets,
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
  const normalizedConfig = normalizeGenericFinancialErpConfig(
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

  const payloads = await loadTargetPayloads(
    params.record.integration.organizationId,
    params.target,
    Math.min(params.limit, 25),
  );

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
}) {
  return {
    target: params.target,
    processedCount: params.processedCount ?? 0,
    successCount: params.successCount ?? 0,
    errorCount: params.errorCount ?? 0,
    requestedLimit: params.requestedLimit ?? DEFAULT_INTEGRATION_SYNC_LIMIT,
    blocked: params.blocked ?? false,
    retryOfRunId: params.retryOfRunId ?? null,
  } satisfies Record<string, unknown>;
}

export function getRequestedLimitFromRun(
  run: typeof integrationSyncRun.$inferSelect,
) {
  const summary =
    run.summary && typeof run.summary === "object"
      ? (run.summary as Record<string, unknown>)
      : null;
  const requestedLimit = summary?.requestedLimit;

  if (typeof requestedLimit === "number" && Number.isFinite(requestedLimit)) {
    return Math.max(1, Math.min(250, Math.trunc(requestedLimit)));
  }

  return DEFAULT_INTEGRATION_SYNC_LIMIT;
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
  target: IntegrationSyncTarget,
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
  target: IntegrationSyncTarget;
  localEntityId: string;
  remoteEntityId: string | null;
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
        remoteDisplayId: params.remoteEntityId,
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
    remoteDisplayId: params.remoteEntityId,
    lastSyncedAt: new Date(),
  });
}

function getTargetPath(
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
) {
  switch (target) {
    case "customer":
      return config.customerPath;
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
    | IntegrationCustomerPayload
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
}

export async function runIntegrationSync(params: {
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  limit: number;
  env: IntegrationsEnv;
}) : Promise<IntegrationRunExecutionResult> {
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

    const config = normalizeGenericFinancialErpConfig(record.connection.config);
    assertValidMappings(config, params.target);
    const secret = decryptIntegrationSecret(
      record.connection.encryptedSecret,
      record.connection.secretIv,
      params.env,
    );

    const payloads = await loadTargetPayloads(
      params.organizationId,
      params.target,
      params.limit,
    );

    let successCount = 0;
    let errorCount = 0;
    let errorSummary: string | null = null;

    for (const payload of payloads) {
      try {
        await pushTargetRecord({
          integrationId: params.integrationId,
          organizationId: params.organizationId,
          target: params.target,
          config,
          secret,
          payload,
        });

        successCount += 1;
      } catch (error) {
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
