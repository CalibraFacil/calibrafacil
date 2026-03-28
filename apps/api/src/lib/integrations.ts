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
  normalizeGenericFinancialErpConfig,
  type GenericFinancialErpConnectionConfig,
  type IntegrationBillingDocumentPayload,
  type IntegrationCustomerPayload,
  type IntegrationServiceOrderPayload,
  type IntegrationSyncStatus,
  type IntegrationSyncTarget,
  type IntegrationSyncTrigger,
} from "@calibra-facil/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

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
}) {
  return normalizeGenericFinancialErpConfig(input);
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
  const result = await callRemoteJson(`${config.baseUrl}${config.healthPath}`, {
    method: "GET",
    headers: buildAuthHeaders(secret),
  });

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
    connection: integration.connection,
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
    address: formatCustomerAddress(row.address),
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }));
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
  const rows = await db
    .select({
      id: calibrationJob.id,
      unitId: calibrationJob.unitId,
      unitName: organizationUnit.name,
      jobId: calibrationJob.jobId,
      customerId: customer.id,
      customerName: customer.name,
      serviceName: service.name,
      amount: service.price,
      currency: service.currency,
      approvedAt: calibrationJob.approvedAt,
      dueDate: calibrationJob.dueDate,
    })
    .from(calibrationJob)
    .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
    .leftJoin(service, eq(calibrationJob.serviceId, service.id))
    .leftJoin(organizationUnit, eq(calibrationJob.unitId, organizationUnit.id))
    .where(
      and(
        eq(calibrationJob.organizationId, organizationId),
        inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
      ),
    )
    .limit(limit)
    .orderBy(desc(calibrationJob.approvedAt));

  return rows
    .filter((row) => typeof row.amount === "number" && row.amount > 0)
    .map((row) => ({
      externalId: `billing_document:${row.id}`,
      organizationId,
      unitId: row.unitId,
      unitName: row.unitName ?? null,
      jobId: row.jobId,
      customerExternalId: row.customerId ? `customer:${row.customerId}` : null,
      customerName: row.customerName ?? null,
      serviceName: row.serviceName ?? null,
      amountCents: row.amount as number,
      currency: row.currency ?? "BRL",
      issuedAt: row.approvedAt?.toISOString?.() ?? null,
      dueAt: row.dueDate?.toISOString?.() ?? null,
      status: "ready",
    }));
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
    body: JSON.stringify(params.payload),
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

  const config = record.connection.config;
  const secret = decryptIntegrationSecret(
    record.connection.encryptedSecret,
    record.connection.secretIv,
    params.env,
  );

  await db
    .update(integrationSyncRun)
    .set({
      status: "RUNNING",
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(integrationSyncRun.id, params.runId));

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
      summary: {
        target: params.target,
        processedCount,
        successCount,
        errorCount,
      },
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
}

export async function createSyncRun(params: {
  integrationId: string;
  organizationId: string;
  trigger: IntegrationSyncTrigger;
  target: IntegrationSyncTarget;
  initiatedBy: string;
}) {
  const id = crypto.randomUUID();

  await db.insert(integrationSyncRun).values({
    id,
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    trigger: params.trigger,
    target: params.target,
    status: "PENDING",
    initiatedBy: params.initiatedBy,
  });

  return id;
}
