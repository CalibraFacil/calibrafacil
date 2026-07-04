import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  cronRun,
  operatorAlert,
  organization,
  serviceOrder,
  serviceOrderEmailOutbox,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { recomputeOperatorAlerts } from "./operator-alerts";

/**
 * Real-DB reconcile test for issue #653 (REL-04) — proves the two NEW
 * observability signals actually turn into `operator_alert` rows end to end,
 * not just via mocked `computeAlertSpecs` unit tests.
 *
 * Proven properties:
 *   REQ-REL-OBS-001  A `cron_run` row whose consecutive_failures has reached
 *                     the alert threshold produces a `cron_failing`
 *                     operator_alert row carrying the real last_error, and the
 *                     alert is SWEPT once the streak clears (recompute is a
 *                     reconcile, not an append-only log).
 *   REQ-REL-OBS-003  A dead-lettered service-order email-outbox row produces an
 *                     `email_outbox_dead_letter` operator_alert row.
 */

async function seedMinimalServiceOrder(tag: string) {
  const org = await seedOrg({ orgId: `org-${tag}`, role: "admin" });

  // customer.authOrganizationId is a real FK to organization — seed the
  // CLIENT-type org it points at (mirrors billing-document-material.int.spec.ts).
  await db.insert(organization).values({
    id: `client-${tag}`,
    name: `Client ${tag}`,
    slug: `client-${tag}`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });

  const [customerRow] = await db
    .insert(customer)
    .values({
      name: `Customer ${tag}`,
      authOrganizationId: `client-${tag}`,
      labOrganizationId: org.orgId,
    })
    .returning({ id: customer.id });
  if (!customerRow) throw new Error("seed: customer insert failed");

  const [type] = await db
    .insert(assetType)
    .values({ name: `Type ${tag}`, slug: `type-${tag}`, definition: [] })
    .returning({ id: assetType.id });
  if (!type) throw new Error("seed: asset type insert failed");

  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId: customerRow.id,
      assetTypeId: type.id,
      name: `Asset ${tag}`,
      serialNumber: `SN-${tag}`,
      tag: `TAG-${tag}`,
    })
    .returning({ id: asset.id });
  if (!assetRow) throw new Error("seed: asset insert failed");

  const [serviceOrderRow] = await db
    .insert(serviceOrder)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: customerRow.id,
      assetId: assetRow.id,
      openedByUserId: org.userId,
      serviceOrderNumber: `OS-${tag}`,
      status: "ready_for_delivery",
      claimedDefect: "Defeito de teste",
      intakeCondition: "Condição de teste",
      intakeType: "counter",
      deliveryMethod: "pickup_at_lab",
      priority: "normal",
      totalQuotedCents: 90_000,
      totalApprovedCents: 90_000,
      evaluationFeeCents: 0,
      evaluationFeeApplied: false,
      isExternalService: false,
    })
    .returning({ id: serviceOrder.id });
  if (!serviceOrderRow) throw new Error("seed: service order insert failed");

  return { organizationId: org.orgId, serviceOrderId: serviceOrderRow.id };
}

describe("recomputeOperatorAlerts — real-DB reconcile of the new REL-04 signals", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-REL-OBS-001: a failing cron's real cron_run row reconciles into a cron_failing operator_alert, then sweeps once it recovers", async () => {
    await db.insert(cronRun).values({
      job: "service-order-emails",
      consecutiveFailures: 5,
      lastError: "gotenberg 502: upstream timeout",
    });

    await recomputeOperatorAlerts();

    const [alert] = await db
      .select()
      .from(operatorAlert)
      .where(eq(operatorAlert.dedupeKey, "cron:service-order-emails:failing"));

    expect(alert).toBeDefined();
    expect(alert?.kind).toBe("cron_failing");
    // The REAL cron error reaches the operator alert, not a placeholder.
    expect(alert?.detail).toContain("gotenberg 502: upstream timeout");

    // The cron recovers (heartbeat resets consecutive_failures to 0, as
    // cron-run.ts does on a successful run) — recompute must SWEEP the alert,
    // proving this is a reconcile against current state, not an append-only log.
    await db
      .update(cronRun)
      .set({ consecutiveFailures: 0, lastError: null })
      .where(eq(cronRun.job, "service-order-emails"));

    await recomputeOperatorAlerts();

    const afterRecovery = await db
      .select()
      .from(operatorAlert)
      .where(eq(operatorAlert.dedupeKey, "cron:service-order-emails:failing"));
    expect(afterRecovery).toHaveLength(0);
  });

  it("REQ-REL-OBS-003: a real dead-lettered service-order email-outbox row reconciles into an email_outbox_dead_letter operator_alert", async () => {
    const { organizationId, serviceOrderId } =
      await seedMinimalServiceOrder("dlq");

    await db.insert(serviceOrderEmailOutbox).values({
      organizationId,
      serviceOrderId,
      eventKey: "status_email:ready_for_pickup",
      targetStatus: "ready_for_pickup",
      payload: {},
      attempts: 3,
      lastError: "SMTP down",
      processedAt: null,
      deadLetterAt: new Date(),
    });

    await recomputeOperatorAlerts();

    const [alert] = await db
      .select()
      .from(operatorAlert)
      .where(
        eq(
          operatorAlert.dedupeKey,
          "outbox:service_order_email:dead_letter",
        ),
      );

    expect(alert).toBeDefined();
    expect(alert?.kind).toBe("email_outbox_dead_letter");
    expect(alert?.detail).toContain("1");
  });
});
