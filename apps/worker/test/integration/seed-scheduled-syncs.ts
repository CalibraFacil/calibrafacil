import { db } from "@calibra-facil/db";
import {
  organizationIntegration,
  integrationConnection,
  integrationSyncRun,
} from "@calibra-facil/db/schema";
import { encryptPassword } from "@calibra-facil/signing";
import { normalizeGenericFinancialErpConfig } from "@calibra-facil/shared";
import type {
  IntegrationScheduleFrequency,
  IntegrationSyncStatus,
  IntegrationSyncTarget,
} from "@calibra-facil/shared";
import { TEST_INTEGRATIONS_MASTER_KEY } from "./env";

// Seed helpers SPECIFIC to processScheduledIntegrationSyncs (the cron that scans
// organization_integration, advances per-target schedules, and dispatches sync
// runs for DUE targets). The shared seed.ts seeds a generic_http integration
// whose per-target schedules are all `manual_only` with a null nextScheduledRunAt
// — so nothing is ever "due". The scheduler reads the schedule out of the JSONB
// `integration_connection.config`, so to make a target due we must seed that
// config with `mode: "scheduled"` and a `nextScheduledRunAt` in the past.
//
// We DO NOT touch the shared seed.ts. These helpers live alongside it and reuse
// the same TEST_INTEGRATIONS_MASTER_KEY + drizzle singleton.

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

/** A per-target schedule entry to write into the connection config JSONB. */
export type ScheduleSpec = {
  target: IntegrationSyncTarget;
  /** "scheduled" makes the target eligible; "manual_only"/"disabled" never run. */
  mode: "scheduled" | "manual_only" | "disabled";
  frequency?: IntegrationScheduleFrequency;
  /**
   * ISO timestamp written to the target's `nextScheduledRunAt`. A value in the
   * past (relative to the scheduler's `now`) makes a `scheduled` target DUE; a
   * future value (or null) leaves it not-yet-due.
   */
  nextScheduledRunAt: string | null;
};

/**
 * Seed an ACTIVE generic_http integration whose per-target schedules are set by
 * `schedules`. Mirrors the shared `seedIntegration` (valid encrypted bearer
 * secret, last_validated_at set / no validation error) so the integration is not
 * blocked, but threads explicit per-target schedule config through
 * `normalizeGenericFinancialErpConfig` so a target can be made DUE.
 */
export async function seedScheduledIntegration(params: {
  integrationId: string;
  organizationId: string;
  createdBy: string;
  schedules: ScheduleSpec[];
  baseUrl?: string;
}): Promise<{ integrationId: string }> {
  const baseUrl = params.baseUrl ?? "https://erp.example.test";

  const scheduleConfig: Partial<
    Record<
      IntegrationSyncTarget,
      {
        mode: ScheduleSpec["mode"];
        frequency: IntegrationScheduleFrequency;
        nextScheduledRunAt: string | null;
        lastScheduledRunAt: string | null;
      }
    >
  > = {};
  for (const spec of params.schedules) {
    scheduleConfig[spec.target] = {
      mode: spec.mode,
      frequency: spec.frequency ?? "daily",
      nextScheduledRunAt: spec.nextScheduledRunAt,
      lastScheduledRunAt: null,
    };
  }

  const config = normalizeGenericFinancialErpConfig({
    baseUrl,
    schedules: scheduleConfig,
  });

  const { encryptedPassword, iv } = encryptPassword(
    "test-bearer-secret",
    TEST_INTEGRATIONS_MASTER_KEY,
  );

  await db.insert(organizationIntegration).values({
    id: params.integrationId,
    organizationId: params.organizationId,
    type: "financial_erp",
    provider: "generic_http",
    name: "ERP Agendado de Teste",
    status: "ACTIVE",
    createdBy: params.createdBy,
    lastValidatedAt: EPOCH,
    lastValidationError: null,
    createdAt: EPOCH,
  });

  await db.insert(integrationConnection).values({
    id: `conn-${params.integrationId}`,
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    credentialType: "bearer",
    config,
    encryptedSecret: encryptedPassword,
    secretIv: iv,
    createdBy: params.createdBy,
    createdAt: EPOCH,
  });

  return { integrationId: params.integrationId };
}

/**
 * Seed an integration_sync_run with an explicit status so a target can be put in
 * an ACTIVE state (PENDING or RUNNING) — exactly what `hasActiveTargetRun` looks
 * for to suppress a second dispatch. The shared `seedSyncRun` always seeds
 * PENDING; this lets the spec use RUNNING (the more representative in-flight
 * state) and any target.
 */
export async function seedSyncRunWithStatus(params: {
  runId: string;
  integrationId: string;
  organizationId: string;
  target: IntegrationSyncTarget;
  status: IntegrationSyncStatus;
}): Promise<{ runId: string }> {
  await db.insert(integrationSyncRun).values({
    id: params.runId,
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    trigger: "scheduled",
    target: params.target,
    status: params.status,
    createdAt: EPOCH,
  });
  return { runId: params.runId };
}

/** A timestamp guaranteed to be in the past relative to the scheduler's `now`. */
export function pastIso(): string {
  return new Date("2020-01-01T00:00:00.000Z").toISOString();
}

/** A timestamp guaranteed to be in the future relative to the scheduler's `now`. */
export function futureIso(): string {
  return new Date("2999-01-01T00:00:00.000Z").toISOString();
}
