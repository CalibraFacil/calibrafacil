import { db } from "@calibra-facil/db";
import {
  integrationSyncItem,
  integrationSyncRun,
} from "@calibra-facil/db/schema";
import {
  DEFAULT_INTEGRATION_SCHEDULE_FREQUENCY,
  normalizeContaAzulConnectionConfig,
  normalizeGenericFinancialErpConfig,
  type IntegrationScheduleFrequency,
  type IntegrationSyncStatus,
  type IntegrationSyncTarget,
  type IntegrationSyncTrigger,
} from "@calibra-facil/shared";
import { and, count, eq, inArray } from "drizzle-orm";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import {
  type ContaAzulScheduledPollKind,
  type IntegrationRunExecutionResult,
  type IntegrationSyncPayload,
} from "./types";
import {
  createIntegrationPayloadFingerprint,
  decryptIntegrationSecret,
} from "./credentials";
import {
  failIntegrationSyncRun,
  getIntegrationRecord,
  writeIntegrationEvent,
} from "./records";
import { buildRunSummary } from "./run-summary";
import { assertValidMappings } from "./mapping";
import { loadTargetPayloads } from "./payload-targets";
import { filterContaAzulCatalogPayloadsByEnabledKinds } from "./payloads-commercial";
import { isCatalogItemPayload } from "./payload-guards";
import { pushContaAzulTargetRecord, pushTargetRecord } from "./sync-push";
import { isContaAzulReconnectRequiredError } from "./errors";
import { calculateNextScheduledRunAt } from "./schedule-config";

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
