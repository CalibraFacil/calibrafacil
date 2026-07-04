/**
 * Observability-alert deciders (issue #653 / REL-04 — "activate the
 * built-but-blind observability").
 *
 * Three signals are recorded by the system but nobody reads them:
 *   1. `cron_run.consecutive_failures` — written each run, no consumer/alert.
 *   2. `app_queue_job.last_error` — the real error, surfaced nowhere.
 *   3. Service-order email-outbox rows that exhaust `maxAttempts` — silently
 *      stop being selected, with no dead-letter state and no alert.
 *
 * This module holds the PURE decision logic that turns those signals into
 * operator-alert specs (reconciled into `operator_alert` by the existing
 * engine in operator-alerts.ts) and into the backoffice queue-health view. It
 * imports no runtime (no db, no io) so every decider is unit-testable.
 */

import type { OperatorAlertSeverity } from "@calibra-facil/db/schema";

/**
 * Shape of a proactive operator-alert. Mirrors the row reconciled into
 * `operator_alert`: each spec has a stable `dedupeKey` so recompute upserts the
 * present ones and sweeps any whose condition has cleared.
 */
export interface AlertSpec {
  dedupeKey: string;
  organizationId: string | null;
  kind: string;
  severity: OperatorAlertSeverity;
  title: string;
  detail: string | null;
}

// ===========================================================================
// REQ-REL-OBS-001 — cron consecutive-failure → operator alert
// ===========================================================================

/**
 * Consecutive-failure count at which a cron is considered "failing" and worth
 * paging an operator. Three misses in a row is well past a transient blip on
 * any of the current cadences, so it catches a genuinely stuck cron without
 * firing on a single flaky run.
 */
export const CRON_CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 3;

/** True when a cron's consecutive-failure streak has reached the alert threshold. */
export function shouldAlertForCronFailures(
  consecutiveFailures: number,
  threshold: number = CRON_CONSECUTIVE_FAILURE_ALERT_THRESHOLD,
): boolean {
  return (
    Number.isFinite(consecutiveFailures) && consecutiveFailures >= threshold
  );
}

/**
 * Escalate severity as the streak grows: `warning` from the threshold, and
 * `critical` once it has failed twice the threshold in a row (a cron that has
 * been down long enough to matter operationally).
 */
export function cronFailureSeverity(
  consecutiveFailures: number,
  threshold: number = CRON_CONSECUTIVE_FAILURE_ALERT_THRESHOLD,
): OperatorAlertSeverity {
  return consecutiveFailures >= threshold * 2 ? "critical" : "warning";
}

/** A `cron_run` heartbeat row, reduced to the fields the alert decider needs. */
export interface CronRunHealthRow {
  job: string;
  consecutiveFailures: number;
  lastError: string | null;
}

/**
 * Build one `cron_failing` alert spec per cron whose consecutive-failure streak
 * has reached the threshold. The real `last_error` is carried into the alert
 * detail so the operator sees WHY it is failing, not just that it is.
 */
export function buildCronFailureAlertSpecs(
  rows: CronRunHealthRow[],
  threshold: number = CRON_CONSECUTIVE_FAILURE_ALERT_THRESHOLD,
): AlertSpec[] {
  const specs: AlertSpec[] = [];
  for (const row of rows) {
    if (!shouldAlertForCronFailures(row.consecutiveFailures, threshold)) {
      continue;
    }
    specs.push({
      dedupeKey: `cron:${row.job}:failing`,
      organizationId: null,
      kind: "cron_failing",
      severity: cronFailureSeverity(row.consecutiveFailures, threshold),
      title: `Cron falhando: ${row.job}`,
      detail:
        `${row.consecutiveFailures} falhas consecutivas` +
        (row.lastError ? ` — ${row.lastError}` : ""),
    });
  }
  return specs;
}

// ===========================================================================
// REQ-REL-OBS-003 — email-outbox dead-letter
// ===========================================================================

/**
 * The outbox drain selects rows with `attempts < maxAttempts`. A release
 * increments `attempts` by one, so once THIS release pushes it to `maxAttempts`
 * the row will never be selected again — it is dead-lettered at that moment.
 *
 * @param currentAttempts the row's `attempts` BEFORE this release increments it
 */
export function isReleaseExhausting(
  currentAttempts: number,
  maxAttempts: number,
): boolean {
  return currentAttempts + 1 >= maxAttempts;
}

/**
 * Build the aggregate dead-letter alert (one spec for the whole outbox, not one
 * per row) when at least one service-order email has exhausted its attempts.
 * Returns null when nothing is dead-lettered so recompute sweeps a stale alert.
 */
export function buildOutboxDeadLetterAlertSpec(
  deadLetterCount: number,
): AlertSpec | null {
  if (!Number.isFinite(deadLetterCount) || deadLetterCount <= 0) {
    return null;
  }
  return {
    dedupeKey: "outbox:service_order_email:dead_letter",
    organizationId: null,
    kind: "email_outbox_dead_letter",
    severity: "warning",
    title: "E-mails de OS em dead-letter",
    detail: `${deadLetterCount} e-mail(s) de ordem de serviço esgotaram as tentativas e não serão reenviados`,
  };
}

// ===========================================================================
// REQ-REL-OBS-002 — backoffice surfaces the real last_error of failed jobs
// ===========================================================================

/** A failed `app_queue_job` row as read for the backoffice queue-health view. */
export interface FailedQueueJobRow {
  id: number;
  type: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: Date | null;
}

/** The operator-facing view of a failed queue job — the real error included. */
export interface RecentQueueFailureView {
  id: number;
  type: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string | null;
}

/**
 * Shape failed-job rows for the backoffice, PRESERVING the real `last_error`
 * (the whole point of REQ-REL-OBS-002 — the generic "Job was not acknowledged
 * by worker" clobber is fixed at the source in the worker runtime).
 */
export function shapeRecentQueueFailures(
  rows: FailedQueueJobRow[],
): RecentQueueFailureView[] {
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  }));
}
