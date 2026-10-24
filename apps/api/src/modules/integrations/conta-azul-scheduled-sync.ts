import { integrationConnection } from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";
import type { IntegrationSyncBackgroundJobMessage } from "@calibra-facil/schemas";
import { eq } from "drizzle-orm";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import { inOrgTransaction } from "../../lib/org-transaction";
import { listActiveContaAzulConnections } from "./active-connections";
import { isContaAzulTargetEnabled } from "./payload-guards";
import { parseRemoteDate } from "./conta-azul-due";
import {
  CONTA_AZUL_SCHEDULED_SYNC_TARGETS,
  DEFAULT_INTEGRATION_SYNC_LIMIT,
} from "./constants";
import { hasActiveSyncRun } from "./sync-state";
import {
  buildNextScheduledRunAtFrom,
  createSyncRun,
  runIntegrationSync,
} from "./sync-run";
import { failIntegrationSyncRun, writeIntegrationEvent } from "./records";
import { updateTargetScheduleConfig } from "./schedule-config";

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
  const rows = await listActiveContaAzulConnections();

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

      // The run row and the event that requests it commit together.
      const runId = await inOrgTransaction(
        row.organizationId,
        undefined,
        async (o) => {
          const created = await createSyncRun(
            {
              integrationId: row.integrationId,
              organizationId: row.organizationId,
              trigger: "scheduled",
              target,
              requestedLimit: params.limit ?? DEFAULT_INTEGRATION_SYNC_LIMIT,
            },
            o,
          );

          await writeIntegrationEvent(
            {
              integrationId: row.integrationId,
              organizationId: row.organizationId,
              runId: created,
              level: "info",
              event: "sync.scheduled_requested",
              message: "Sincronização Conta Azul agendada solicitada",
              details: {
                target,
                trigger: "scheduled",
              },
            },
            o,
          );
          return created;
        },
      );

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

        await inOrgTransaction(row.organizationId, undefined, async (o) => {
          await o
            .update(integrationConnection)
            .set({
              config: nextConfig,
              updatedAt: new Date(),
            })
            .where(eq(integrationConnection.integrationId, row.integrationId));
        });
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
