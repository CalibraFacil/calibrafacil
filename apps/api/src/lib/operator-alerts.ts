import { and, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";

import { db } from "@calibra-facil/db";
import {
  cronRun,
  entitlementOverride,
  operatorAlert,
  organization,
  serviceOrderEmailOutbox,
} from "@calibra-facil/db/schema";
import {
  CRON_CONSECUTIVE_FAILURE_ALERT_THRESHOLD,
  buildCronFailureAlertSpecs,
  buildOutboxDeadLetterAlertSpec,
  type AlertSpec,
} from "./observability-alerts";

/**
 * Operator-addressed alerting engine (operations-console gap #5).
 *
 * Recomputes proactive, directly-queryable risk signals and reconciles them into
 * the `operator_alert` table so the *team* is notified — historically only labs
 * were. Idempotent: each signal has a stable `dedupeKey`; recompute upserts the
 * present ones and sweeps any whose condition has cleared. Acknowledgement
 * persists while the condition still holds. Invoked by the `operator-alerts` cron
 * (the scheduler) and by a manual recompute endpoint.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function computeAlertSpecs(now: Date): Promise<AlertSpec[]> {
  const in7d = new Date(now.getTime() + 7 * DAY_MS);
  const in3d = new Date(now.getTime() + 3 * DAY_MS);
  const specs: AlertSpec[] = [];

  // 1. Suspended tenants — a paying account is locked out; someone must act.
  const suspended = await db
    .select({
      id: organization.id,
      name: organization.name,
      reason: organization.suspensionReason,
    })
    .from(organization)
    .where(eq(organization.status, "SUSPENDED"));
  for (const org of suspended) {
    specs.push({
      dedupeKey: `org:${org.id}:suspended`,
      organizationId: org.id,
      kind: "tenant_suspended",
      severity: "critical",
      title: `Conta suspensa: ${org.name}`,
      detail: org.reason,
    });
  }

  // 2. Offboarding with deletion due within 7 days (or already past).
  const offboarding = await db
    .select({
      id: organization.id,
      name: organization.name,
      deletionAt: organization.deletionScheduledAt,
    })
    .from(organization)
    .where(
      and(
        eq(organization.status, "OFFBOARDING"),
        isNotNull(organization.deletionScheduledAt),
        lte(organization.deletionScheduledAt, in7d),
      ),
    );
  for (const org of offboarding) {
    const past = org.deletionAt ? org.deletionAt.getTime() <= now.getTime() : false;
    specs.push({
      dedupeKey: `org:${org.id}:offboarding`,
      organizationId: org.id,
      kind: "tenant_offboarding",
      severity: past ? "critical" : "warning",
      title: `Offboarding: ${org.name}`,
      detail: org.deletionAt
        ? `Exclusão agendada para ${isoDay(org.deletionAt)}`
        : null,
    });
  }

  // 3. Comp / entitlement overrides expiring within 3 days — decide renew vs lapse.
  const expiring = await db
    .select({
      id: entitlementOverride.id,
      organizationId: entitlementOverride.organizationId,
      feature: entitlementOverride.feature,
      expiresAt: entitlementOverride.expiresAt,
    })
    .from(entitlementOverride)
    .where(
      and(
        isNotNull(entitlementOverride.expiresAt),
        gte(entitlementOverride.expiresAt, now),
        lte(entitlementOverride.expiresAt, in3d),
      ),
    );
  for (const override of expiring) {
    specs.push({
      dedupeKey: `override:${override.id}:expiring`,
      organizationId: override.organizationId,
      kind: "entitlement_expiring",
      severity: "warning",
      title: `Acesso temporário expira: ${override.feature}`,
      detail: override.expiresAt
        ? `Expira em ${isoDay(override.expiresAt)}`
        : null,
    });
  }

  // 4. Failing crons — a cron whose consecutive-failure streak has reached the
  // alert threshold (REQ-REL-OBS-001). The heartbeat is written by the cron
  // dispatcher (`cron_run.consecutive_failures`) but had no consumer until now.
  const failingCrons = await db
    .select({
      job: cronRun.job,
      consecutiveFailures: cronRun.consecutiveFailures,
      lastError: cronRun.lastError,
    })
    .from(cronRun)
    .where(
      gte(
        cronRun.consecutiveFailures,
        CRON_CONSECUTIVE_FAILURE_ALERT_THRESHOLD,
      ),
    );
  specs.push(...buildCronFailureAlertSpecs(failingCrons));

  // 5. Dead-letter service-order emails — rows that exhausted `maxAttempts`
  // (REQ-REL-OBS-003). They stop being drained silently; surface them so a
  // stuck lifecycle email is fixed, not discovered by a customer complaint.
  const deadLetterRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceOrderEmailOutbox)
    .where(
      and(
        isNull(serviceOrderEmailOutbox.processedAt),
        isNotNull(serviceOrderEmailOutbox.deadLetterAt),
      ),
    );
  const deadLetterSpec = buildOutboxDeadLetterAlertSpec(
    deadLetterRows[0]?.count ?? 0,
  );
  if (deadLetterSpec) {
    specs.push(deadLetterSpec);
  }

  return specs;
}

export async function recomputeOperatorAlerts(): Promise<{
  active: number;
  resolved: number;
}> {
  const runStart = new Date();
  const specs = await computeAlertSpecs(runStart);

  for (const spec of specs) {
    await db
      .insert(operatorAlert)
      .values({
        organizationId: spec.organizationId,
        dedupeKey: spec.dedupeKey,
        kind: spec.kind,
        severity: spec.severity,
        title: spec.title,
        detail: spec.detail,
        firstSeenAt: runStart,
        lastSeenAt: runStart,
      })
      .onConflictDoUpdate({
        target: operatorAlert.dedupeKey,
        set: {
          severity: spec.severity,
          title: spec.title,
          detail: spec.detail,
          lastSeenAt: runStart,
          updatedAt: runStart,
        },
      });
  }

  // Sweep alerts whose condition no longer holds (not refreshed this run).
  const resolved = await db
    .delete(operatorAlert)
    .where(lt(operatorAlert.lastSeenAt, runStart))
    .returning();

  return { active: specs.length, resolved: resolved.length };
}
