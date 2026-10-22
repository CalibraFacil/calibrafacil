import {
  type FinancialErpConnectionConfig,
  normalizeFinancialErpConnectionConfig,
  type IntegrationRunMode,
  type IntegrationScheduleFrequency,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";

export function toIsoDate(value?: Date | null) {
  return value?.toISOString?.() ?? null;
}

export function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function calculateNextScheduledRunAt(
  frequency: IntegrationScheduleFrequency,
  from: Date,
) {
  const next = new Date(from);
  next.setMilliseconds(0);

  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

export function getTargetScheduleConfig(
  config: Pick<FinancialErpConnectionConfig, "schedules">,
  target: IntegrationSyncTarget,
) {
  return config.schedules[target];
}

export function updateTargetScheduleConfig(params: {
  config: FinancialErpConnectionConfig;
  target: IntegrationSyncTarget;
  mode?: IntegrationRunMode;
  frequency?: IntegrationScheduleFrequency;
  nextScheduledRunAt?: string | null;
  lastScheduledRunAt?: string | null;
}) {
  const provider =
    "provider" in params.config ? params.config.provider : "generic_http";
  return normalizeFinancialErpConnectionConfig(provider, {
    ...params.config,
    schedules: {
      ...params.config.schedules,
      [params.target]: {
        ...params.config.schedules[params.target],
        mode: params.mode ?? params.config.schedules[params.target].mode,
        frequency:
          params.frequency ?? params.config.schedules[params.target].frequency,
        nextScheduledRunAt:
          params.nextScheduledRunAt === undefined
            ? params.config.schedules[params.target].nextScheduledRunAt
            : params.nextScheduledRunAt,
        lastScheduledRunAt:
          params.lastScheduledRunAt === undefined
            ? params.config.schedules[params.target].lastScheduledRunAt
            : params.lastScheduledRunAt,
      },
    },
  });
}
