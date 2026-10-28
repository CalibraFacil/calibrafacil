import { Cron } from "croner";
import { db } from "@calibra-facil/db";
import { cronRun } from "@calibra-facil/db/schema";
import { countQueueJobsByStatus } from "@calibra-facil/db/queue";
import { CRON_ENTRIES, type CronEntry } from "./cron-scheduler";

/**
 * What an operator must look at, apart from whether the API can serve
 * (roadmap 2 G2, review 3.6): a scheduled job that stopped succeeding, and
 * background jobs the queue gave up on (dead letters).
 *
 * These are alerts, not readiness: a stale cron does not take the API out of
 * service. `/api/health` reports them (status "degraded"); `/api/health/alerts`
 * answers 503 while any is open, for an uptime monitor.
 */
export type HealthAlerts = {
  ok: boolean;
  /** Jobs whose last success is older than twice their interval (plus a margin). */
  staleCrons: string[];
  /** Jobs that failed three or more times in a row. */
  failingCrons: string[];
  /** Background jobs that exhausted their attempts (FAILED). */
  deadLetters: number;
};

export type CronState = {
  job: string;
  lastSuccessAt: Date | null;
  lastRunAt: Date | null;
  consecutiveFailures: number;
};

const MARGIN_MS = 10 * 60 * 1000;
const FAILURE_STREAK = 3;

/** The time between two runs of a schedule (its next two occurrences). */
export function intervalOf(schedule: string, now: Date): number {
  const [first, second] = new Cron(schedule, {
    paused: true,
    timezone: "UTC",
  }).nextRuns(2, now);
  if (!first || !second) return 24 * 60 * 60 * 1000;
  return second.getTime() - first.getTime();
}

export function judgeCrons(
  states: readonly CronState[],
  entries: readonly CronEntry[],
  now: Date,
): { stale: string[]; failing: string[] } {
  const byJob = new Map(states.map((state) => [state.job, state]));
  const stale: string[] = [];
  const failing: string[] = [];
  for (const entry of entries) {
    const job = entry.path.replace("/api/cron/", "");
    const state = byJob.get(job);
    // Never ran here (a fresh install, or no scheduler): nothing to judge yet.
    if (!state?.lastRunAt) continue;
    if (state.consecutiveFailures >= FAILURE_STREAK) failing.push(job);
    const limit = 2 * intervalOf(entry.schedule, now) + MARGIN_MS;
    const since = state.lastSuccessAt ?? state.lastRunAt;
    if (now.getTime() - since.getTime() > limit) stale.push(job);
  }
  return { stale, failing };
}

export async function readHealthAlerts(
  now: Date = new Date(),
): Promise<HealthAlerts> {
  const [states, depth] = await Promise.all([
    db
      .select({
        job: cronRun.job,
        lastSuccessAt: cronRun.lastSuccessAt,
        lastRunAt: cronRun.lastRunAt,
        consecutiveFailures: cronRun.consecutiveFailures,
      })
      .from(cronRun),
    countQueueJobsByStatus(),
  ]);
  const { stale, failing } = judgeCrons(states, CRON_ENTRIES, now);
  return {
    ok: stale.length === 0 && failing.length === 0 && depth.failed === 0,
    staleCrons: stale,
    failingCrons: failing,
    deadLetters: depth.failed,
  };
}

/** Each scheduled job's last success, for the metrics. */
export async function readCronSuccesses() {
  return db
    .select({ job: cronRun.job, lastSuccessAt: cronRun.lastSuccessAt })
    .from(cronRun);
}
