import { decryptPassword } from "@calibra-facil/signing";
import type {
  IntegrationSyncStatus,
  IntegrationSyncTarget,
  IntegrationTargetCoverageSummary,
} from "@calibra-facil/shared";
import {
  INTEGRATION_TARGETS,
  type IntegrationSyncQueueMessage,
  type IntegrationWorkerEnv,
  assertValidMappings,
  isGenericHttpSyncTarget,
} from "./helpers.js";
import {
  fetchRuntime,
  insertEvent,
  updateRun,
  withDbClient,
} from "./runtime-db.js";
import {
  countLinkedTargetRecords,
  countLocalTargetRecords,
  loadPayloads,
} from "./payloads.js";
import { buildDependencyWarnings, buildRunSummary } from "./summary.js";
import { pushRecord } from "./push.js";

export async function processIntegrationSync(
  env: IntegrationWorkerEnv,
  message: IntegrationSyncQueueMessage,
): Promise<void> {
  await withDbClient(env, async (client) => {
    await updateRun(client, {
      runId: message.runId,
      status: "RUNNING",
      startedAt: new Date(),
    });

    try {
      const runtime = await fetchRuntime(
        client,
        message.integrationId,
        message.organizationId,
      );

      if (!runtime) {
        throw new Error("Integração não encontrada");
      }
      if (!env.INTEGRATIONS_MASTER_KEY) {
        throw new Error("INTEGRATIONS_MASTER_KEY não configurada");
      }
      if (!isGenericHttpSyncTarget(message.target)) {
        throw new Error(
          "Alvo de sincronização não suportado pelo worker generic_http",
        );
      }

      const validated =
        Boolean(runtime.lastValidatedAt) && !runtime.lastValidationError;
      const coverageSummaries = await Promise.all(
        INTEGRATION_TARGETS.map(async (target) => {
          const [localCount, linkedCount] = await Promise.all([
            countLocalTargetRecords(client, message.organizationId, target),
            countLinkedTargetRecords(client, message.integrationId, target),
          ]);

          return {
            target,
            localCount,
            linkedCount,
            unlinkedCount: Math.max(localCount - linkedCount, 0),
          } satisfies IntegrationTargetCoverageSummary;
        }),
      );
      const getCoverage = (target: IntegrationSyncTarget) =>
        coverageSummaries.find((summary) => summary.target === target) ?? {
          target,
          localCount: 0,
          linkedCount: 0,
          unlinkedCount: 0,
        };
      const coverageByTarget = {
        catalog_item: getCoverage("catalog_item"),
        contract: getCoverage("contract"),
        customer: getCoverage("customer"),
        supplier: getCoverage("supplier"),
        transporter: getCoverage("transporter"),
        service_order: getCoverage("service_order"),
        billing_document: getCoverage("billing_document"),
        payable: getCoverage("payable"),
      } satisfies Record<
        IntegrationSyncTarget,
        IntegrationTargetCoverageSummary
      >;
      const blockingWarnings = buildDependencyWarnings({
        target: message.target,
        validated,
        integrationStatus: runtime.status,
        coverageByTarget,
      }).filter((warning) => warning.severity === "error");

      if (blockingWarnings.length > 0) {
        const blockedMessage =
          blockingWarnings[0]?.message ?? "Sincronização bloqueada";

        await updateRun(client, {
          runId: message.runId,
          status: "FAILED",
          errorSummary: blockedMessage,
          summary: buildRunSummary({
            target: message.target,
            requestedLimit: message.limit,
            blocked: true,
          }),
          finishedAt: new Date(),
        });

        await insertEvent(client, {
          integrationId: message.integrationId,
          organizationId: message.organizationId,
          runId: message.runId,
          level: "warning",
          event: "sync.blocked",
          message: blockedMessage,
          details: {
            target: message.target,
            warnings: blockingWarnings,
            trigger: message.trigger,
          },
        });

        return;
      }

      assertValidMappings(runtime.config, message.target);

      const secret = decryptPassword(
        runtime.encryptedSecret,
        runtime.secretIv,
        env.INTEGRATIONS_MASTER_KEY,
      );

      const payloads = await loadPayloads(
        client,
        message.organizationId,
        message.target,
        message.limit,
      );

      let successCount = 0;
      let errorCount = 0;
      let errorSummary: string | null = null;

      for (const payload of payloads) {
        try {
          await pushRecord(client, {
            integrationId: message.integrationId,
            organizationId: message.organizationId,
            target: message.target,
            config: runtime.config,
            secret,
            payload,
          });
          successCount += 1;
        } catch (error) {
          errorCount += 1;
          errorSummary =
            error instanceof Error ? error.message : "Falha desconhecida";

          await insertEvent(client, {
            integrationId: message.integrationId,
            organizationId: message.organizationId,
            runId: message.runId,
            level: "error",
            event: "sync.record_failed",
            message: errorSummary,
            details: {
              target: message.target,
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

      await updateRun(client, {
        runId: message.runId,
        status,
        processedCount,
        successCount,
        errorCount,
        errorSummary,
        summary: buildRunSummary({
          target: message.target,
          requestedLimit: message.limit,
          processedCount,
          successCount,
          errorCount,
        }),
        finishedAt: new Date(),
      });

      await insertEvent(client, {
        integrationId: message.integrationId,
        organizationId: message.organizationId,
        runId: message.runId,
        level: status === "COMPLETED" ? "info" : "warning",
        event: "sync.completed",
        message:
          status === "COMPLETED"
            ? "Sincronização concluída"
            : "Sincronização concluída com ressalvas",
        details: {
          target: message.target,
          processedCount,
          successCount,
          errorCount,
        },
      });
    } catch (error) {
      const messageText =
        error instanceof Error
          ? error.message
          : "Falha ao processar integração";

      await updateRun(client, {
        runId: message.runId,
        status: "FAILED",
        errorSummary: messageText,
        summary: buildRunSummary({
          target: message.target,
          requestedLimit: message.limit,
        }),
        finishedAt: new Date(),
      });

      await insertEvent(client, {
        integrationId: message.integrationId,
        organizationId: message.organizationId,
        runId: message.runId,
        level: "error",
        event: "sync.failed",
        message: messageText,
        details: {
          target: message.target,
        },
      });

      throw error;
    }
  });
}
