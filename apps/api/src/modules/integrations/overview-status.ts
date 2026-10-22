import {
  integrationSyncRun,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  type IntegrationDependencyWarning,
  type IntegrationReadinessStatus,
  type IntegrationRunMode,
  type IntegrationScheduleStatus,
  type IntegrationSetupStatus,
  type IntegrationSyncTarget,
  type IntegrationTargetCoverageSummary,
} from "@calibra-facil/shared";
import {
  CONTA_AZUL_SCHEDULED_SYNC_TARGETS,
  INTEGRATION_TARGETS,
} from "./constants";
import {
  type GenericConnectionRecord,
  type IntegrationSyncPayload,
} from "./types";
import { toRecord } from "./utils";
import { parseDate, toIsoDate } from "./schedule-config";

export function getIntegrationOverviewTargets(
  provider: (typeof organizationIntegration.$inferSelect)["provider"],
): readonly IntegrationSyncTarget[] {
  return provider === "conta_azul"
    ? CONTA_AZUL_SCHEDULED_SYNC_TARGETS
    : INTEGRATION_TARGETS;
}

export function buildSetupStatus(params: {
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

export function buildReadinessStatus(params: {
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

export function buildPreviewSampleRecord(
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

export function isSuccessfulRun(
  run: typeof integrationSyncRun.$inferSelect,
): boolean {
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

export function getRunDurationMs(run: typeof integrationSyncRun.$inferSelect) {
  if (!run.startedAt || !run.finishedAt) return null;
  return Math.max(run.finishedAt.getTime() - run.startedAt.getTime(), 0);
}

export function getConsecutiveFailures(
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

export function getLastBlockedAt(
  runs: (typeof integrationSyncRun.$inferSelect)[],
) {
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

export function buildScheduleStatus(params: {
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

export function buildEmptyCoverage(
  target: IntegrationSyncTarget,
): IntegrationTargetCoverageSummary {
  return {
    target,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  };
}
