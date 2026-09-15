/**
 * Unit tests for the observability-alert deciders (issue #653 / REL-04).
 *
 * These are the pure decision functions that turn the three "built-but-blind"
 * signals into operator-alert specs:
 *
 *   REQ-REL-OBS-001 — a cron whose `consecutive_failures` reaches the threshold
 *                     produces a `cron_failing` operator-alert spec.
 *   REQ-REL-OBS-003 — the dead-letter decider (`isReleaseExhausting`) and the
 *                     `email_outbox_dead_letter` operator-alert spec.
 *
 * The DB reconcile that upserts these specs into `operator_alert` is the
 * already-proven engine in operator-alerts.ts; here we prove the specs are
 * generated (or NOT) under the right conditions.
 */

import { describe, it, expect } from "vitest";
import {
  CRON_CONSECUTIVE_FAILURE_ALERT_THRESHOLD,
  shouldAlertForCronFailures,
  cronFailureSeverity,
  buildCronFailureAlertSpecs,
  isReleaseExhausting,
  buildOutboxDeadLetterAlertSpec,
  shapeRecentQueueFailures,
} from "./observability-alerts";

// ===========================================================================
// REQ-REL-OBS-001 — cron consecutive-failure threshold → operator alert
// ===========================================================================

describe("REQ-REL-OBS-001: cron consecutive-failure alert decider", () => {
  const T = CRON_CONSECUTIVE_FAILURE_ALERT_THRESHOLD;

  it("does not trip below the threshold", () => {
    expect(shouldAlertForCronFailures(0)).toBe(false);
    expect(shouldAlertForCronFailures(T - 1)).toBe(false);
  });

  it("trips at exactly the threshold and above", () => {
    expect(shouldAlertForCronFailures(T)).toBe(true);
    expect(shouldAlertForCronFailures(T + 5)).toBe(true);
  });

  it("escalates severity from warning to critical at 2x threshold", () => {
    expect(cronFailureSeverity(T)).toBe("warning");
    expect(cronFailureSeverity(T * 2 - 1)).toBe("warning");
    expect(cronFailureSeverity(T * 2)).toBe("critical");
  });

  it("generates one cron_failing alert spec per failing cron (>= threshold only)", () => {
    const specs = buildCronFailureAlertSpecs([
      {
        job: "service-order-emails",
        consecutiveFailures: T,
        lastError: "502 gotenberg",
      },
      { job: "portal-digest", consecutiveFailures: T - 1, lastError: null }, // below threshold
      { job: "operator-alerts", consecutiveFailures: T * 2, lastError: "boom" },
    ]);

    // Only the two at/over threshold produce specs.
    expect(specs).toHaveLength(2);
    const jobs = specs.map((s) => s.dedupeKey);
    expect(jobs).toContain("cron:service-order-emails:failing");
    expect(jobs).toContain("cron:operator-alerts:failing");
    expect(jobs).not.toContain("cron:portal-digest:failing");
  });

  it("the generated spec carries the real last_error and an escalating severity", () => {
    const [spec] = buildCronFailureAlertSpecs([
      {
        job: "service-order-emails",
        consecutiveFailures: T * 2,
        lastError: "connection refused",
      },
    ]);
    expect(spec).toBeDefined();
    expect(spec?.kind).toBe("cron_failing");
    expect(spec?.dedupeKey).toBe("cron:service-order-emails:failing");
    expect(spec?.severity).toBe("critical");
    expect(spec?.organizationId).toBeNull();
    // The real cron error must reach the operator, not be swallowed.
    expect(spec?.detail).toContain("connection refused");
  });
});

// ===========================================================================
// REQ-REL-OBS-003 — email-outbox dead-letter decider + alert spec
// ===========================================================================

describe("REQ-REL-OBS-003: outbox dead-letter decider", () => {
  it("is not exhausting while a retry remains", () => {
    // maxAttempts=3: a row at attempts 0 or 1 still has retries left after release.
    expect(isReleaseExhausting(0, 3)).toBe(false);
    expect(isReleaseExhausting(1, 3)).toBe(false);
  });

  it("is exhausting when this release pushes attempts to maxAttempts", () => {
    // attempts=2 → after release attempts=3 → never selected again → dead-letter.
    expect(isReleaseExhausting(2, 3)).toBe(true);
    expect(isReleaseExhausting(4, 3)).toBe(true);
  });

  it("produces a dead-letter alert spec only when the count is positive", () => {
    expect(buildOutboxDeadLetterAlertSpec(0)).toBeNull();
    const spec = buildOutboxDeadLetterAlertSpec(4);
    expect(spec?.kind).toBe("email_outbox_dead_letter");
    expect(spec?.dedupeKey).toBe("outbox:service_order_email:dead_letter");
    expect(spec?.detail).toContain("4");
  });
});

// ===========================================================================
// REQ-REL-OBS-002 — backoffice surfaces the REAL last_error of failed jobs
// ===========================================================================

describe("REQ-REL-OBS-002: recent-failure shaping preserves the real last_error", () => {
  it("maps the real last_error of a failed queue job into the exposed view", () => {
    const view = shapeRecentQueueFailures([
      {
        id: 42,
        type: "CERTIFICATE",
        attempts: 3,
        maxAttempts: 3,
        lastError: "gotenberg 502: upstream timeout",
        updatedAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    ]);

    expect(view).toHaveLength(1);
    // The exposed value must be the REAL error, not a generic placeholder.
    expect(view[0]?.lastError).toBe("gotenberg 502: upstream timeout");
    expect(view[0]?.id).toBe(42);
    expect(view[0]?.type).toBe("CERTIFICATE");
    expect(view[0]?.attempts).toBe(3);
  });

  it("tolerates a null last_error without inventing one", () => {
    const view = shapeRecentQueueFailures([
      {
        id: 7,
        type: "LABEL",
        attempts: 3,
        maxAttempts: 3,
        lastError: null,
        updatedAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    ]);
    expect(view[0]?.lastError).toBeNull();
  });
});
