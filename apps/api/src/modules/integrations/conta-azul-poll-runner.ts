import { db } from "@calibra-facil/db";
import {
  integrationConnection,
  integrationSyncRun,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  type IntegrationSyncTarget,
  type RemoteStatusPollResult,
} from "@calibra-facil/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import {
  type ContaAzulPollDefinition,
  type ContaAzulScheduledPollKind,
} from "./types";
import {
  getContaAzulPollDefinition,
  getRunPollKind,
  isContaAzulPollDue,
  isContaAzulPollEnabled,
} from "./conta-azul-due";
import { pollContaAzulBillingStatus } from "./conta-azul-billing-poll";
import { pollContaAzulPayableStatus } from "./conta-azul-payable-poll";
import {
  pollContaAzulFiscalDocuments,
  pollContaAzulProtocols,
} from "./conta-azul-fiscal-poll";
import { pollContaAzulProductStock } from "./conta-azul-stock-poll";
import { pollContaAzulRemoteDrift } from "./conta-azul-drift-poll";
import {
  CONTA_AZUL_POLL_DEFINITIONS,
  DEFAULT_INTEGRATION_SYNC_LIMIT,
} from "./constants";
import { createSyncRun } from "./sync-run";
import { failIntegrationSyncRun, writeIntegrationEvent } from "./records";
import { buildRunSummary } from "./run-summary";
import { getIntegrationCursor } from "./conta-azul-schedule-state";

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
