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
import { fetchRuntime, updateIntegrationConfig } from "./runtime-db.js";
import { withOrgSession, withSystemDbClient } from "../pdf-render.js";
import { createSyncRun, hasActiveTargetRun } from "./runs.js";
import { processIntegrationSync } from "./process-sync.js";

type DueScheduledRun = {
  integrationId: string;
  organizationId: string;
  target: IntegrationSyncTarget;
  limit: number;
  trigger: "scheduled";
};

/**
 * Thrown at the END of a sweep in which some integrations failed: every other
 * integration was still scheduled, and `result` is what the sweep did, so the
 * cron reports the failure without losing the work of the other laboratories.
 */
export class ScheduledIntegrationSyncError extends Error {
  constructor(
    readonly result: { scheduledRuns: number },
    readonly failures: ReadonlyArray<{
      integrationId: string;
      organizationId: string;
      error: unknown;
    }>,
  ) {
    super(
      `scheduled integration syncs: ${failures.length} integration(s) failed (${failures.map((failure) => failure.integrationId).join(", ")})`,
    );
    this.name = "ScheduledIntegrationSyncError";
  }
}

export async function processScheduledIntegrationSyncs(
  env: IntegrationWorkerEnv,
  options: ScheduledIntegrationSyncOptions = {},
): Promise<{ scheduledRuns: number }> {
  // The scheduler is a cron job: no message names a laboratory. The active
  // generic_http integrations of EVERY laboratory are listed here, in ONE
  // statement on the system path (the owner connection), because row-level
  // security names one laboratory per transaction. Everything after it runs in
  // transactions that name the integration's own laboratory.
  const integrations = await withSystemDbClient(env, (client) =>
    client.query(
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
    ),
  );

  const now = new Date();
  const dueRuns: DueScheduledRun[] = [];
  const failures: Array<{
    integrationId: string;
    organizationId: string;
    error: unknown;
  }> = [];

  for (const row of integrations.rows) {
    const config = normalizeGenericFinancialErpConfig(row.config);

    const dueTargets = INTEGRATION_TARGETS.filter((target) => {
      const schedule = getTargetSchedule(config, target);
      const nextRun = parseDate(schedule.nextScheduledRunAt);
      return (
        schedule.mode === "scheduled" &&
        nextRun !== null &&
        nextRun.getTime() <= now.getTime()
      );
    });
    if (dueTargets.length === 0) continue;

    // A run still PENDING or RUNNING for the target is not scheduled twice. One
    // laboratory failing here must not stop the others.
    let idle: typeof dueTargets;
    try {
      idle = await withOrgSession(env, row.organization_id, async (lab) => {
        const targets: typeof dueTargets = [];
        for (const target of dueTargets) {
          const active = await lab.transaction((client) =>
            hasActiveTargetRun(client, {
              integrationId: row.id,
              organizationId: row.organization_id,
              target,
            }),
          );
          if (!active) targets.push(target);
        }
        return targets;
      });
    } catch (error) {
      failures.push({
        integrationId: row.id,
        organizationId: row.organization_id,
        error,
      });
      console.error("[IntegrationScheduler] Failed to check active runs", {
        integrationId: row.id,
        organizationId: row.organization_id,
        error,
      });
      continue;
    }

    for (const target of idle) {
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
    // The schedule advance and the run row commit together; the sync itself
    // (remote HTTP) runs after this transaction ended.
    let runId: string | null;
    try {
      runId = await withOrgSession(env, dueRun.organizationId, (lab) =>
        lab.transaction(async (client) => {
          const runtime = await fetchRuntime(
            client,
            dueRun.integrationId,
            dueRun.organizationId,
          );

          if (!runtime) {
            return null;
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

          return createSyncRun(client, {
            integrationId: dueRun.integrationId,
            organizationId: dueRun.organizationId,
            target: dueRun.target,
            trigger: "scheduled",
            requestedLimit: dueRun.limit,
          });
        }),
      );
    } catch (error) {
      failures.push({
        integrationId: dueRun.integrationId,
        organizationId: dueRun.organizationId,
        error,
      });
      console.error("[IntegrationScheduler] Failed to schedule a run", {
        integrationId: dueRun.integrationId,
        organizationId: dueRun.organizationId,
        target: dueRun.target,
        error,
      });
      continue;
    }

    if (!runId) {
      continue;
    }

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

  const result = { scheduledRuns: dueRuns.length };
  if (failures.length > 0) {
    throw new ScheduledIntegrationSyncError(result, failures);
  }
  return result;
}
