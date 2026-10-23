import { Client } from "pg";
import type {
  IntegrationSyncTarget,
  IntegrationSyncTrigger,
} from "@calibra-facil/shared";
import { buildRunSummary } from "./summary.js";

export async function createSyncRun(
  client: Client,
  params: {
    integrationId: string;
    organizationId: string;
    target: IntegrationSyncTarget;
    trigger: IntegrationSyncTrigger;
    requestedLimit: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await client.query(
    `
        INSERT INTO integration_sync_run
          (id, integration_id, organization_id, trigger, target, status, summary)
        VALUES ($1, $2, $3, $4, $5, 'PENDING', $6::jsonb)
        `,
    [
      id,
      params.integrationId,
      params.organizationId,
      params.trigger,
      params.target,
      JSON.stringify(
        buildRunSummary({
          target: params.target,
          requestedLimit: params.requestedLimit,
        }),
      ),
    ],
  );

  return id;
}

export async function hasActiveTargetRun(
  client: Client,
  params: {
    integrationId: string;
    organizationId: string;
    target: IntegrationSyncTarget;
  },
): Promise<boolean> {
  const result = await client.query(
    `
        SELECT 1
        FROM integration_sync_run
        WHERE integration_id = $1
          AND organization_id = $2
          AND target = $3
          AND status IN ('PENDING', 'RUNNING')
        LIMIT 1
        `,
    [params.integrationId, params.organizationId, params.target],
  );

  return result.rows.length > 0;
}
