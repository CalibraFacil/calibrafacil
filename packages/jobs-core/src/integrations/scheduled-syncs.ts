import { normalizeGenericFinancialErpConfig } from "@calibra-facil/shared";
import type { IntegrationSyncTarget } from "@calibra-facil/shared";
import {
  DEFAULT_SYNC_LIMIT,
  INTEGRATION_TARGETS,
  type IntegrationSyncQueueMessage,
  type IntegrationWorkerEnv,
  type ScheduledIntegrationSyncOptions,
  calculateNextScheduledRunAt,
  getTargetSchedule,
  parseDate,
} from "./helpers.js";
import {
  fetchRuntime,
  updateIntegrationConfig,
  withDbClient,
} from "./runtime-db.js";
import { createSyncRun, hasActiveTargetRun } from "./runs.js";
import { processIntegrationSync } from "./process-sync.js";

type DueScheduledRun = {
  integrationId: string;
  organizationId: string;
  target: IntegrationSyncTarget;
  limit: number;
  trigger: "scheduled";
};

export async function processScheduledIntegrationSyncs(
  env: IntegrationWorkerEnv,
  options: ScheduledIntegrationSyncOptions = {},
): Promise<{ scheduledRuns: number }> {
  return withDbClient(env, async (client) => {
    const integrations = await client.query(
      `
            SELECT
              oi.id,
              oi.organization_id,
              ic.config
            FROM organization_integration oi
            INNER JOIN integration_connection ic ON ic.integration_id = oi.id
            WHERE oi.status = 'ACTIVE'
              AND oi.provider = 'generic_http'
            `,
    );

    const now = new Date();
    const dueRuns: DueScheduledRun[] = [];

    for (const row of integrations.rows) {
      const config = normalizeGenericFinancialErpConfig(row.config);

      for (const target of INTEGRATION_TARGETS) {
        const schedule = getTargetSchedule(config, target);
        const nextRun = parseDate(schedule.nextScheduledRunAt);

        if (schedule.mode !== "scheduled" || !nextRun) {
          continue;
        }

        if (nextRun.getTime() > now.getTime()) {
          continue;
        }

        const active = await hasActiveTargetRun(client, {
          integrationId: row.id,
          organizationId: row.organization_id,
          target,
        });

        if (active) {
          continue;
        }

        dueRuns.push({
          integrationId: row.id,
          organizationId: row.organization_id,
          target,
          limit: DEFAULT_SYNC_LIMIT,
          trigger: "scheduled",
        });
      }
    }

    for (const dueRun of dueRuns) {
      const runtime = await fetchRuntime(
        client,
        dueRun.integrationId,
        dueRun.organizationId,
      );

      if (!runtime) {
        continue;
      }

      const advancedConfig = normalizeGenericFinancialErpConfig({
        ...runtime.config,
        schedules: {
          ...runtime.config.schedules,
          [dueRun.target]: {
            ...runtime.config.schedules[dueRun.target],
            lastScheduledRunAt: now.toISOString(),
            nextScheduledRunAt: calculateNextScheduledRunAt(
              runtime.config.schedules[dueRun.target].frequency,
              now,
            ),
          },
        },
      });

      await updateIntegrationConfig(client, {
        integrationId: dueRun.integrationId,
        config: advancedConfig,
      });

      const runId = await createSyncRun(client, {
        integrationId: dueRun.integrationId,
        organizationId: dueRun.organizationId,
        target: dueRun.target,
        trigger: "scheduled",
        requestedLimit: dueRun.limit,
      });

      const message: IntegrationSyncQueueMessage = {
        type: "INTEGRATION_SYNC",
        integrationId: dueRun.integrationId,
        organizationId: dueRun.organizationId,
        runId,
        target: dueRun.target,
        limit: dueRun.limit,
        trigger: dueRun.trigger,
      };

      try {
        if (options.dispatch) {
          await options.dispatch(message);
        } else {
          await processIntegrationSync(env, message);
        }
      } catch (error) {
        console.error("[IntegrationScheduler] Failed scheduled run", {
          integrationId: dueRun.integrationId,
          organizationId: dueRun.organizationId,
          target: dueRun.target,
          runId,
          error,
        });
      }
    }

    return { scheduledRuns: dueRuns.length };
  });
}
