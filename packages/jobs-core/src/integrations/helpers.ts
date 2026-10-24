import {
  applyIntegrationMappings,
  validateIntegrationMappings,
} from "@calibra-facil/shared";
import type {
  IntegrationMappingValidationIssue,
  GenericFinancialErpConnectionConfig,
  IntegrationBillingDocumentPayload,
  IntegrationCustomerPayload,
  IntegrationPayablePayload,
  IntegrationScheduleFrequency,
  IntegrationServiceOrderPayload,
  IntegrationSupplierPayload,
  IntegrationSyncTarget,
  IntegrationTargetScheduleConfig,
  IntegrationTransporterPayload,
} from "@calibra-facil/shared";
import type { IntegrationSyncBackgroundJobMessage } from "@calibra-facil/schemas";

export type IntegrationSyncQueueMessage = IntegrationSyncBackgroundJobMessage;

export type ScheduledIntegrationSyncOptions = {
  dispatch?: (message: IntegrationSyncQueueMessage) => Promise<void>;
};

export interface IntegrationWorkerEnv {
  DATABASE_URL: string;
  /** The table owner: the system path that lists every laboratory's integrations (see `Env`). */
  DATABASE_OWNER_URL?: string;
  DATABASE_RLS_MODE?: "shadow" | "enforced";
  INTEGRATIONS_MASTER_KEY?: string;
}

export type SyncPayload =
  | IntegrationCustomerPayload
  | IntegrationSupplierPayload
  | IntegrationTransporterPayload
  | IntegrationPayablePayload
  | IntegrationServiceOrderPayload
  | IntegrationBillingDocumentPayload;

export const INTEGRATION_TARGETS = [
  "customer",
  "service_order",
  "billing_document",
] as const satisfies readonly IntegrationSyncTarget[];

export const DEFAULT_SYNC_LIMIT = 50;

export function isGenericHttpSyncTarget(
  target: IntegrationSyncTarget,
): target is (typeof INTEGRATION_TARGETS)[number] {
  const targets: readonly IntegrationSyncTarget[] = INTEGRATION_TARGETS;
  return targets.includes(target);
}

export function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function calculateNextScheduledRunAt(
  frequency: IntegrationScheduleFrequency,
  from: Date,
): string {
  const next = new Date(from);
  next.setMilliseconds(0);

  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

export function getTargetSchedule(
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
): IntegrationTargetScheduleConfig {
  return config.schedules[target];
}

function getMappingValidationIssues(
  config: GenericFinancialErpConnectionConfig,
  target?: IntegrationSyncTarget,
): IntegrationMappingValidationIssue[] {
  const issues = validateIntegrationMappings(config.mappings);
  if (!target) return issues;
  return issues.filter((issue) => issue.target === target);
}

export function assertValidMappings(
  config: GenericFinancialErpConnectionConfig,
  target?: IntegrationSyncTarget,
) {
  const issues = getMappingValidationIssues(config, target);
  if (issues.length === 0) return;
  throw new Error(issues.map((issue) => issue.message).join(" "));
}

export function buildMappedTargetPayload(
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
  payload: SyncPayload,
) {
  const payloadRecord = Object.fromEntries(Object.entries(payload));

  return applyIntegrationMappings(
    target,
    payloadRecord,
    config.mappings[target],
  );
}
