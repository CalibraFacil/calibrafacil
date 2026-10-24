import { decryptPassword } from "@calibra-facil/signing";
import type {
  GenericFinancialErpConnectionConfig,
  IntegrationSyncStatus,
  IntegrationSyncTarget,
  IntegrationTargetCoverageSummary,
} from "@calibra-facil/shared";
import {
  INTEGRATION_TARGETS,
  type IntegrationSyncQueueMessage,
  type IntegrationWorkerEnv,
  type SyncPayload,
  assertValidMappings,
  isGenericHttpSyncTarget,
} from "./helpers.js";
import { fetchRuntime, insertEvent, updateRun } from "./runtime-db.js";
import { withOrgSession } from "../pdf-render.js";
import {
  countLinkedTargetRecords,
  countLocalTargetRecords,
  loadPayloads,
} from "./payloads.js";
import { buildDependencyWarnings, buildRunSummary } from "./summary.js";
import { pushRecord } from "./push.js";

/**
 * What the read phase decided: the run was blocked by a dependency warning (and
 * its failure is already recorded), or it is ready to push.
 */
type SyncPlan =
  | { kind: "blocked" }
  | {
      kind: "ready";
      config: GenericFinancialErpConnectionConfig;
      secret: string;
      payloads: SyncPayload[];
    };

export async function processIntegrationSync(
  env: IntegrationWorkerEnv,
  message: IntegrationSyncQueueMessage,
): Promise<void> {
  // The message names its laboratory: every statement runs on one connection of
  // that laboratory, each in a short transaction that names it (row-level
  // security). The remote HTTP push below never runs inside a transaction.
  await withOrgSession(env, message.organizationId, async (lab) => {
    await lab.transaction((client) =>
      updateRun(client, {
        runId: message.runId,
        status: "RUNNING",
        startedAt: new Date(),
      }),
    );

    try {
      // Read phase: one transaction for the runtime, the coverage and the
      // payloads. A blocked run records its failure in the same transaction.
      const plan = await lab.transaction(async (client): Promise<SyncPlan> => {
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

          return { kind: "blocked" };
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

        return { kind: "ready", config: runtime.config, secret, payloads };
      });

      if (plan.kind === "blocked") return;
      const { config, secret, payloads } = plan;

      let successCount = 0;
      let errorCount = 0;
      let errorSummary: string | null = null;

      for (const payload of payloads) {
        try {
          await pushRecord(lab, {
            integrationId: message.integrationId,
            organizationId: message.organizationId,
            target: message.target,
            config,
            secret,
            payload,
          });
          successCount += 1;
        } catch (error) {
          errorCount += 1;
          const failure =
            error instanceof Error ? error.message : "Falha desconhecida";
          errorSummary = failure;

          await lab.transaction((client) =>
            insertEvent(client, {
              integrationId: message.integrationId,
              organizationId: message.organizationId,
              runId: message.runId,
              level: "error",
              event: "sync.record_failed",
              message: failure,
              details: {
                target: message.target,
                localEntityId: payload.externalId,
              },
            }),
          );
        }
      }

      const processedCount = payloads.length;
      const status: IntegrationSyncStatus =
        errorCount === 0
          ? "COMPLETED"
          : successCount === 0
            ? "FAILED"
            : "PARTIAL";

      // The run's final state and its closing event commit together.
      await lab.transaction(async (client) => {
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
      });
    } catch (error) {
      const messageText =
        error instanceof Error
          ? error.message
          : "Falha ao processar integração";

      await lab.transaction(async (client) => {
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
      });

      throw error;
    }
  });
}
