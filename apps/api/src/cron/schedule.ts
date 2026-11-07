import type { CronEntry } from "../lib/cron-scheduler";

/**
 * Every job under /api/cron/*: its schedule (UTC) and how long its run holds the lease that keeps
 * two API replicas from running it at once. The dispatcher's handlers are keyed by these names
 * (a job without a handler, or a handler without a schedule, fails type-checking), and the
 * health check judges staleness from the same schedules.
 */
export const CRON_SCHEDULE = {
  integrations: { schedule: "*/30 * * * *", leaseSeconds: 120 },
  notifications: { schedule: "0 8 * * *", leaseSeconds: 120 },
  "portal-digest": { schedule: "0 9 * * *", leaseSeconds: 120 },
  "auth-maintenance": { schedule: "30 4 * * 1", leaseSeconds: 120 },
  "service-order-emails": { schedule: "*/30 * * * *", leaseSeconds: 120 },
  "oot-emails": { schedule: "*/30 * * * *", leaseSeconds: 120 },
  "queue-backstop": { schedule: "*/30 * * * *", leaseSeconds: 120 },
  "spc-recompute": { schedule: "0 3 * * *", leaseSeconds: 120 },
  "email-domain-health": { schedule: "30 3 * * *", leaseSeconds: 120 },
  "certificate-drift": { schedule: "0 6 * * *", leaseSeconds: 300 },
  "records-purge": { schedule: "0 5 * * 0", leaseSeconds: 300 },
  "sync-change-log-purge": { schedule: "15 4 * * *", leaseSeconds: 300 },
  "approval-effects-reconcile": { schedule: "45 3 * * *", leaseSeconds: 600 },
  "audit-chain-verify": { schedule: "45 4 * * *", leaseSeconds: 900 },
} as const satisfies Record<string, { schedule: string; leaseSeconds: number }>;

export type CronJobName = keyof typeof CRON_SCHEDULE;

export function isCronJobName(value: string): value is CronJobName {
  return Object.hasOwn(CRON_SCHEDULE, value);
}

export const CRON_ENTRIES: readonly CronEntry[] = Object.entries(
  CRON_SCHEDULE,
).map(([name, { schedule }]) => ({ path: `/api/cron/${name}`, schedule }));
