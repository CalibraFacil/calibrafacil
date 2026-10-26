import { describe, expect, it } from "vitest";
import {
  BackgroundJobMessageSchema,
  QueueMessageSchema,
  parseBackgroundJobMessage,
  parseQueueMessage,
  type BackgroundJobMessage,
} from "./background-jobs";

// One fixture per payload shape a producer writes today. Rows already queued in
// production carry exactly these shapes, so each must keep parsing (and parse to
// itself: no field is dropped or renamed).
const PRODUCER_FIXTURES = {
  // apps/api/src/modules/jobs/approve-job.ts (outbox stage + post-commit dispatch)
  "certificate render from approval (type omitted)": {
    jobId: 42,
    userId: "user_1",
  },
  // apps/api/src/routes/jobs.ts (amendment re-render); rows read back from
  // the queue written by getMessageType-era code may carry the explicit type
  "certificate render with explicit type": {
    type: "CERTIFICATE",
    jobId: 42,
    userId: "user_1",
  },
  // apps/api/src/routes/jobs.ts (POST /:id/label)
  label: { type: "LABEL", jobId: 42, userId: "user_1" },
  // apps/api/src/modules/service-orders/service-order.documents.ts
  "service order intake document": {
    type: "SERVICE_ORDER_INTAKE_DOCUMENT",
    serviceOrderId: 7,
    documentId: 3,
    userId: "user_1",
  },
  // service-order.commands.ts (create): no documentId yet
  "service order intake document without documentId": {
    type: "SERVICE_ORDER_INTAKE_DOCUMENT",
    serviceOrderId: 7,
    userId: "user_1",
  },
  "service order tag": {
    type: "SERVICE_ORDER_TAG",
    serviceOrderId: 7,
    tagId: 5,
    userId: "user_1",
  },
  "service order tag without tagId": {
    type: "SERVICE_ORDER_TAG",
    serviceOrderId: 7,
    userId: "user_1",
  },
  // service-order.quotes.ts
  "service order quote": {
    type: "SERVICE_ORDER_QUOTE",
    serviceOrderId: 7,
    quoteId: 9,
    userId: "user_1",
  },
  "service order delivery receipt": {
    type: "SERVICE_ORDER_DELIVERY_RECEIPT",
    serviceOrderId: 7,
    documentId: 3,
    userId: "user_1",
  },
  // apps/api/src/lib/oot-notifications.ts
  "out-of-tolerance notification": {
    type: "OOT_NOTIFICATION",
    notificationId: 11,
    userId: "user_1",
  },
  // apps/api/src/lib/public-api-webhooks.ts (staged with the event's transaction)
  "public API webhook delivery": {
    type: "WEBHOOK_DELIVERY",
    deliveryId: "5c2f2c1e-0000-4000-8000-000000000001",
    organizationId: "org_1",
  },
  // apps/api/src/modules/jobs/approve-job.ts (outbox, staged in the approval transaction)
  "job approved notification": {
    type: "JOB_APPROVED_NOTIFICATION",
    jobId: 42,
    userId: "user_1",
  },
  "asset out-of-tolerance notification": {
    type: "ASSET_OOT_NOTIFICATION",
    eventId: 5,
    organizationId: "org_1",
    userId: "user_1",
  },
  // apps/api/src/routes/integrations.ts (generic ERP, no provider)
  "integration sync without provider": {
    type: "INTEGRATION_SYNC",
    integrationId: "int_1",
    organizationId: "org_1",
    runId: "run_1",
    target: "customer",
    limit: 50,
    trigger: "manual",
  },
  // apps/api/src/routes/integrations.ts + src/modules/integrations/ (Conta Azul)
  "integration sync for conta_azul": {
    type: "INTEGRATION_SYNC",
    provider: "conta_azul",
    integrationId: "int_1",
    organizationId: "org_1",
    runId: "run_1",
    target: "billing_document",
    limit: 50,
    trigger: "scheduled",
  },
  // apps/api/src/routes/portal.ts
  "portal audit pack": { type: "AUDIT_PACK", exportId: 13, userId: "user_1" },
  // apps/api/src/cron/dispatch.ts timers
  "spc recompute timer": { type: "SPC_RECOMPUTE" },
  "email domain health timer": { type: "EMAIL_DOMAIN_HEALTH" },
  "scheduled notifications timer": { type: "SCHEDULED_NOTIFICATIONS" },
  "portal digest timer": { type: "PORTAL_DIGEST" },
} satisfies Record<string, BackgroundJobMessage>;

const CRON_ONLY = new Set([
  "scheduled notifications timer",
  "portal digest timer",
]);

describe("background job union", () => {
  it.each(Object.entries(PRODUCER_FIXTURES))(
    "REQ-Q-1 parses the current producer shape: %s",
    (_name, fixture) => {
      const result = parseBackgroundJobMessage(fixture);
      expect(result).toEqual({ ok: true, message: fixture });
    },
  );

  it.each(
    Object.entries(PRODUCER_FIXTURES).filter(([name]) => !CRON_ONLY.has(name)),
  )(
    "REQ-Q-1 the queue schema accepts the queue shape: %s",
    (_name, fixture) => {
      expect(parseQueueMessage(fixture)).toEqual({
        ok: true,
        message: fixture,
      });
      expect(QueueMessageSchema.safeParse(fixture).success).toBe(true);
    },
  );

  it("REQ-Q-1 the cron-only timers are in the union but not in the queue union", () => {
    for (const type of ["SCHEDULED_NOTIFICATIONS", "PORTAL_DIGEST"]) {
      expect(BackgroundJobMessageSchema.safeParse({ type }).success).toBe(true);
      const queue = parseQueueMessage({ type });
      expect(queue.ok).toBe(false);
    }
  });

  it("REQ-Q-1 the certificate render is the only member that may omit `type`", () => {
    const types = BackgroundJobMessageSchema.options.map(
      (member) => member.shape.type,
    );
    const values = types.flatMap((schema) =>
      schema.safeParse(undefined).success ? ["(omitted)"] : [],
    );
    // Only the certificate render may omit its discriminator.
    expect(values).toEqual(["(omitted)"]);
    expect(types).toHaveLength(16);
  });

  it("REQ-Q-3 an unknown type is rejected with a reason naming it", () => {
    const result = parseBackgroundJobMessage({
      type: "SHIP_PIZZA",
      jobId: 1,
      userId: "u",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("SHIP_PIZZA");
  });

  it("REQ-Q-3 a payload failing its member schema names the type and the field", () => {
    const result = parseBackgroundJobMessage({
      type: "AUDIT_PACK",
      exportId: "13",
      userId: "u",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("AUDIT_PACK");
      expect(result.reason).toContain("exportId");
    }
  });

  it("REQ-Q-3 a certificate payload with no type is validated as a certificate", () => {
    const result = parseBackgroundJobMessage({ jobId: "x", userId: "u" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("jobId");
  });

  it.each([
    ["a string", "hello"],
    ["an array", [1, 2]],
    ["null", null],
    ["a number", 7],
    ["undefined", undefined],
  ])("REQ-Q-3 rejects %s without throwing", (_name, value) => {
    expect(parseBackgroundJobMessage(value).ok).toBe(false);
    expect(parseQueueMessage(value).ok).toBe(false);
  });

  it("REQ-Q-3 rejects wrong field types on every member", () => {
    const bad: unknown[] = [
      { type: "LABEL", jobId: "1", userId: "u" },
      { type: "LABEL", jobId: 1 },
      {
        type: "SERVICE_ORDER_QUOTE",
        serviceOrderId: 1,
        quoteId: "9",
        userId: "u",
      },
      { type: "SERVICE_ORDER_TAG", serviceOrderId: "1", userId: "u" },
      { type: "OOT_NOTIFICATION", notificationId: 1 },
      { type: "WEBHOOK_DELIVERY", deliveryId: "d" },
      { type: "JOB_APPROVED_NOTIFICATION", jobId: "1", userId: "u" },
      { type: "ASSET_OOT_NOTIFICATION", eventId: 1, userId: "u" },
      {
        type: "INTEGRATION_SYNC",
        integrationId: "i",
        organizationId: "o",
        runId: "r",
        target: "not_a_target",
        limit: 5,
        trigger: "manual",
      },
      {
        type: "INTEGRATION_SYNC",
        integrationId: "i",
        organizationId: "o",
        runId: "r",
        target: "customer",
        limit: 5,
        trigger: "whenever",
      },
    ];
    for (const value of bad) {
      expect(parseBackgroundJobMessage(value).ok).toBe(false);
    }
  });

  it("REQ-Q-4 the parsed message is the typed value handlers receive: unknown keys are stripped", () => {
    const result = parseBackgroundJobMessage({
      type: "LABEL",
      jobId: 1,
      userId: "u",
      leaked: "secret",
    });
    expect(result).toEqual({
      ok: true,
      message: { type: "LABEL", jobId: 1, userId: "u" },
    });
  });
});
