import { db } from "@calibra-facil/db";
import {
  integrationEventLog,
  integrationSyncRun,
} from "@calibra-facil/db/schema";
import {
  getProviderCapabilities,
  normalizeContaAzulConnectionConfig,
  type IntegrationMappedPreviewSample,
  type IntegrationMappingsConfig,
  normalizeFinancialErpConnectionConfig,
  type IntegrationReadinessSummary,
  type IntegrationSyncTarget,
  type IntegrationTargetScheduleSummary,
  type IntegrationTargetCoverageSummary,
  type IntegrationTargetSyncSummary,
} from "@calibra-facil/shared";
import { and, desc, eq } from "drizzle-orm";
import {
  type GenericConnectionRecord,
  type IntegrationOverview,
} from "./types";
import {
  buildEmptyCoverage,
  buildPreviewSampleRecord,
  buildReadinessStatus,
  buildScheduleStatus,
  buildSetupStatus,
  getConsecutiveFailures,
  getIntegrationOverviewTargets,
  getLastBlockedAt,
  getRunDurationMs,
  isSuccessfulRun,
} from "./overview-status";
import {
  buildEmptyRemoteDocumentSummary,
  buildRemoteDocumentSummary,
} from "./reference-links";
import {
  countLinkedTargetRecords,
  countLocalTargetRecords,
  hasRemoteValidation,
  loadTargetPayloads,
} from "./payload-targets";
import {
  buildDependencyWarnings,
  dedupeDependencyWarnings,
} from "./dependency-warnings";
import { getTargetScheduleConfig, toIsoDate } from "./schedule-config";
import { assertValidMappings, buildMappedTargetPayload } from "./mapping";
import { filterContaAzulCatalogPayloadsByEnabledKinds } from "./payloads-commercial";
import { isCatalogItemPayload } from "./payload-guards";

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
