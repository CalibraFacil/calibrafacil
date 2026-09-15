import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import { providerWebhookEvent } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { TransientWebhookError } from "../services/commercial/webhook-errors";

// REQ-REL-ASA-001 (handler-branch half): drives POST /webhooks/asaas against the
// REAL db but with `reconcileCommercialWebhook` replaced so we can deterministically
// surface a TRANSIENT vs a PERMANENT processing failure (a real deadlock/pool
// exhaustion can't be induced on demand). The classifier itself is proven against
// real error shapes in services/commercial/__tests__/webhook-errors.spec.ts.
//
// WHY the split matters (grounded in docs.asaas.com/docs/about-webhooks, fetched
// 2026-07-04): ASAAS treats any non-2xx as a delivery failure and RETRIES, but the
// sync queue is SEQUENTIAL and, after 15 consecutive failures, PAUSES entirely
// (events then queue undelivered and are purged after 14 days). So the handler must
// return non-2xx ONLY for transient failures (retry can succeed) and MUST still ack
// (2xx) a permanent one — the periodic reconciliation cron (REQ-REL-ASA-002) is the
// backstop for permanent-error acks and lost events.

vi.mock("../services/commercial/reconcile-webhook", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../services/commercial/reconcile-webhook")
    >();
  return {
    ...actual,
    reconcileCommercialWebhook: vi.fn(),
  };
});

// Imported after vi.mock (hoisted by vitest) so the router captures the mocked
// reconcile binding.
import { webhooksRouter } from "./webhooks";
import { reconcileCommercialWebhook } from "../services/commercial/reconcile-webhook";

const JSON_HEADERS = { "content-type": "application/json" };
const VALID_TOKEN = "test-asaas-webhook-secret-1234567890";
const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;

function payloadWithId(eventId: string) {
  return {
    id: eventId,
    event: "PAYMENT_RECEIVED",
    dateCreated: "2026-01-01T00:00:00.000Z",
    payment: {
      id: `pay_${eventId}`,
      customer: "cus_x",
      billingType: "PIX",
      value: 1499,
      dueDate: "2026-01-10",
      status: "RECEIVED",
    },
  };
}

/** Seed the event row a first (failed) delivery would have already inserted. */
async function seedUnprocessedEvent(eventId: string) {
  await db.insert(providerWebhookEvent).values({
    provider: "ASAAS",
    eventId,
    eventType: "PAYMENT_RECEIVED",
    payload: payloadWithId(eventId),
  });
}

async function eventRow(eventId: string) {
  const [row] = await db
    .select()
    .from(providerWebhookEvent)
    .where(eq(providerWebhookEvent.eventId, eventId));
  return row;
}

beforeEach(async () => {
  await truncateAll();
  process.env.ASAAS_WEBHOOK_TOKEN = VALID_TOKEN;
  vi.mocked(reconcileCommercialWebhook).mockReset();
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
  else process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
});

describe("POST /webhooks/asaas — transient vs permanent failure (REQ-REL-ASA-001)", () => {
  it("REQ-REL-ASA-001 a TRANSIENT processing failure → non-2xx (so ASAAS retries) and does NOT mark the event processed", async () => {
    await seedUnprocessedEvent("evt_transient_001");
    vi.mocked(reconcileCommercialWebhook).mockRejectedValueOnce(
      new TransientWebhookError("simulated connection pool exhaustion"),
    );

    const res = await webhooksRouter.request("/asaas", {
      method: "POST",
      headers: { ...JSON_HEADERS, "asaas-access-token": VALID_TOKEN },
      body: JSON.stringify(payloadWithId("evt_transient_001")),
    });

    // Non-2xx is the whole point: ASAAS interprets anything outside 200-299 as a
    // delivery failure and re-sends the event.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);

    const row = await eventRow("evt_transient_001");
    // SHALL NOT mark processed-successfully.
    expect(row?.processedAt).toBeNull();
    // The failure is recorded for observability.
    expect(row?.processingError).toContain("connection pool exhaustion");
  });

  it("REQ-REL-ASA-001 a PERMANENT processing failure → 2xx ack (must NOT retry / must NOT pause the sequential queue), still unprocessed", async () => {
    await seedUnprocessedEvent("evt_permanent_001");
    vi.mocked(reconcileCommercialWebhook).mockRejectedValueOnce(
      new Error("payload references an offer that will never exist"),
    );

    const res = await webhooksRouter.request("/asaas", {
      method: "POST",
      headers: { ...JSON_HEADERS, "asaas-access-token": VALID_TOKEN },
      body: JSON.stringify(payloadWithId("evt_permanent_001")),
    });

    // A permanent error is acked so it does not poison ASAAS's sequential queue;
    // the reconciliation cron is the safety net for the divergence it leaves.
    expect(res.status).toBe(200);

    const row = await eventRow("evt_permanent_001");
    expect(row?.processedAt).toBeNull();
    expect(row?.processingError).toContain("will never exist");
  });
});
