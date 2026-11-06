import { Client } from "pg";
import { normalizeGenericFinancialErpConfig } from "@calibra-facil/shared";
import { INTEGRATION_SYNC_RUN_MACHINE } from "@calibra-facil/schemas/machines";
import type {
  GenericFinancialErpConnectionConfig,
  IntegrationSyncStatus,
} from "@calibra-facil/shared";
import { toIso } from "./helpers.js";

export async function insertEvent(
  client: Client,
  params: {
    integrationId: string;
    organizationId: string;
    runId?: string | null;
    level: "info" | "warning" | "error";
    event: string;
    message: string;
    details?: Record<string, unknown> | null;
  },
) {
  await client.query(
    `
        INSERT INTO integration_event_log
          (integration_id, organization_id, run_id, level, event, message, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `,
    [
      params.integrationId,
      params.organizationId,
      params.runId ?? null,
      params.level,
      params.event,
      params.message,
      params.details ? JSON.stringify(params.details) : null,
    ],
  );
}

/**
 * Moves a run by a command of INTEGRATION_SYNC_RUN_MACHINE, as a compare-and-set
 * on the states the command leaves: a redelivered message never revives a run
 * that already finished. Returns whether the run moved.
 */
export async function updateRun(
  client: Client,
  params: {
    runId: string;
    command: "start" | "finish" | "fail";
    status: IntegrationSyncStatus;
    processedCount?: number;
    successCount?: number;
    errorCount?: number;
    errorSummary?: string | null;
    summary?: Record<string, unknown> | null;
    startedAt?: Date;
    finishedAt?: Date;
  },
) {
  const from = INTEGRATION_SYNC_RUN_MACHINE.allowedFrom(params.command);
  if (
    !from.some((state) =>
      INTEGRATION_SYNC_RUN_MACHINE.canTransition(
        state,
        params.command,
        params.status,
      ),
    )
  ) {
    throw new Error(
      `integration sync run: ${params.command} never lands in ${params.status}`,
    );
  }
  const result = await client.query(
    `
        UPDATE integration_sync_run
        SET
          status = $2,
          processed_count = COALESCE($3, processed_count),
          success_count = COALESCE($4, success_count),
          error_count = COALESCE($5, error_count),
          error_summary = COALESCE($6, error_summary),
          summary = COALESCE($7::jsonb, summary),
          started_at = COALESCE($8, started_at),
          finished_at = COALESCE($9, finished_at),
          updated_at = NOW()
        WHERE id = $1 AND status = ANY($10::text[])
        `,
    [
      params.runId,
      params.status,
      params.processedCount ?? null,
      params.successCount ?? null,
      params.errorCount ?? null,
      params.errorSummary ?? null,
      params.summary ? JSON.stringify(params.summary) : null,
      params.startedAt ?? null,
      params.finishedAt ?? null,
      from,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateIntegrationConfig(
  client: Client,
  params: {
    integrationId: string;
    config: GenericFinancialErpConnectionConfig;
  },
) {
  await client.query(
    `
        UPDATE integration_connection
        SET config = $2::jsonb,
            updated_at = NOW()
        WHERE integration_id = $1
        `,
    [params.integrationId, JSON.stringify(params.config)],
  );
}

export async function fetchRuntime(
  client: Client,
  integrationId: string,
  organizationId: string,
): Promise<{
  config: GenericFinancialErpConnectionConfig;
  encryptedSecret: string;
  secretIv: string;
  status: "ACTIVE" | "DISABLED";
  lastValidatedAt: string | null;
  lastValidationError: string | null;
} | null> {
  const result = await client.query(
    `
        SELECT
          ic.config,
          ic.encrypted_secret,
          ic.secret_iv,
          oi.status,
          oi.last_validated_at,
          oi.last_validation_error
        FROM organization_integration oi
        INNER JOIN integration_connection ic ON ic.integration_id = oi.id
        WHERE oi.id = $1
          AND oi.organization_id = $2
          AND oi.provider = 'generic_http'
        LIMIT 1
        `,
    [integrationId, organizationId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    config: normalizeGenericFinancialErpConfig(row.config),
    encryptedSecret: row.encrypted_secret,
    secretIv: row.secret_iv,
    status: row.status,
    lastValidatedAt: toIso(row.last_validated_at),
    lastValidationError: row.last_validation_error ?? null,
  };
}
