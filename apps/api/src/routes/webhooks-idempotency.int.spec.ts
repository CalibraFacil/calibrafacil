import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  billingCustomer,
  commercialDeal,
  commercialOffer,
  commercialOfferStatusHistory,
  organization,
  paymentRecord,
  providerWebhookEvent,
  subscription,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { webhooksRouter } from "./webhooks";

// REQ-REL-ASA-003: reprocessing an already-applied ASAAS event stays idempotent
// (no duplicate activation / no duplicate payment credit). Runs the REAL reconcile
// path (no mock) end to end against the ephemeral Docker Postgres.
//
// Also proves the reliability fix that makes REQ-REL-ASA-001's non-2xx retries
// USEFUL: a delivery whose event row exists but was never finished (processedAt
// IS NULL — the first attempt's money transaction rolled back) must be RE-PROCESSED
// on retry, not silently dropped as a duplicate; while a fully-applied event
// (processedAt set) must stay a no-op duplicate.

const JSON_HEADERS = { "content-type": "application/json" };
const VALID_TOKEN = "test-asaas-webhook-secret-1234567890";
const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z");

type SeededOffer = { offerId: string; orgId: string; providerSubscriptionId: string };

/** Seed org -> billing customer -> deal -> a plan-recurring offer awaiting payment. */
async function seedActivatableOffer(orgId: string): Promise<SeededOffer> {
  await db.insert(organization).values({
    id: orgId,
    name: `Lab ${orgId}`,
    slug: orgId,
    type: "LAB",
    status: "ACTIVE",
    createdAt: FIXED_NOW,
  });

  const [customerRow] = await db
    .insert(billingCustomer)
    .values({
      organizationId: orgId,
      provider: "ASAAS",
      providerCustomerId: `cus_${orgId}`,
      status: "ACTIVE",
      name: `Cliente ${orgId}`,
      email: `${orgId}@billing.test`,
      taxId: "12345678000190",
    })
    .returning({ id: billingCustomer.id });
  if (!customerRow) throw new Error("seed: billingCustomer failed");

  const [deal] = await db
    .insert(commercialDeal)
    .values({ organizationId: orgId, title: `Deal ${orgId}`, status: "OPEN" })
    .returning({ id: commercialDeal.id });
  if (!deal) throw new Error("seed: commercialDeal failed");

  const providerSubscriptionId = `sub_${orgId}`;
  const [offer] = await db
    .insert(commercialOffer)
    .values({
      dealId: deal.id,
      organizationId: orgId,
      kind: "PLAN_RECURRING",
      status: "PENDING_PAYMENT",
      provider: "ASAAS",
      providerMode: "SUBSCRIPTION",
      activationBehavior: "NONE",
      basePlanId: "STANDARD",
      billingCycle: "MONTHLY",
      renewalMode: "AUTOMATIC",
      currency: "BRL",
      subtotalAmount: 1499_00,
      discountAmount: 0,
      totalAmount: 1499_00,
      dueDate: FUTURE,
      paymentMethods: ["PIX"],
      termsSnapshot: {},
      customerSnapshot: { name: `Pagador ${orgId}`, email: `${orgId}@payer.test` },
      billingCustomerId: customerRow.id,
      providerSubscriptionId,
      issuedAt: FIXED_NOW,
    })
    .returning({ id: commercialOffer.id });
  if (!offer) throw new Error("seed: commercialOffer failed");

  return { offerId: offer.id, orgId, providerSubscriptionId };
}

function confirmedPaymentEvent(seeded: SeededOffer, eventId: string) {
  return {
    id: eventId,
    event: "PAYMENT_CONFIRMED",
    dateCreated: "2026-01-05T00:00:00.000Z",
    payment: {
      id: `pay_${seeded.orgId}`,
      customer: `cus_${seeded.orgId}`,
      subscription: seeded.providerSubscriptionId,
      billingType: "PIX",
      value: 1499,
      netValue: 1450,
      dueDate: "2026-01-10",
      paymentDate: "2026-01-05",
      status: "CONFIRMED",
      externalReference: `commercial-offer:${seeded.offerId}`,
    },
  };
}

async function post(body: unknown) {
  return webhooksRouter.request("/asaas", {
    method: "POST",
    headers: { ...JSON_HEADERS, "asaas-access-token": VALID_TOKEN },
    body: JSON.stringify(body),
  });
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await res.json();
  return parsed && typeof parsed === "object" ? { ...parsed } : {};
}

async function paymentRows(orgId: string) {
  return db
    .select()
    .from(paymentRecord)
    .where(eq(paymentRecord.organizationId, orgId));
}

async function subscriptionRows(orgId: string) {
  return db
    .select()
    .from(subscription)
    .where(eq(subscription.organizationId, orgId));
}

async function activatedHistoryCount(offerId: string) {
  const rows = await db
    .select()
    .from(commercialOfferStatusHistory)
    .where(
      and(
        eq(commercialOfferStatusHistory.offerId, offerId),
        eq(commercialOfferStatusHistory.toStatus, "ACTIVATED"),
      ),
    );
  return rows.length;
}

beforeEach(async () => {
  await truncateAll();
  process.env.ASAAS_WEBHOOK_TOKEN = VALID_TOKEN;
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
  else process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
});

describe("POST /webhooks/asaas — idempotent reprocessing (REQ-REL-ASA-003)", () => {
  it("REQ-REL-ASA-003 re-delivering an already-applied CONFIRMED payment does NOT duplicate activation or credit", async () => {
    const seeded = await seedActivatableOffer("org-idem-1");
    const event = confirmedPaymentEvent(seeded, "evt_idem_001");

    const first = await post(event);
    expect(first.status).toBe(200);
    expect(await jsonOf(first)).toMatchObject({
      received: true,
      duplicate: false,
    });

    // First delivery applied the money state exactly once.
    expect(await paymentRows(seeded.orgId)).toHaveLength(1);
    const subsAfterFirst = await subscriptionRows(seeded.orgId);
    expect(subsAfterFirst).toHaveLength(1);
    expect(subsAfterFirst[0]?.status).toBe("ACTIVE");
    expect(await activatedHistoryCount(seeded.offerId)).toBe(1);

    // Re-delivery of the SAME eventId is a no-op duplicate.
    const second = await post(event);
    expect(second.status).toBe(200);
    expect(await jsonOf(second)).toMatchObject({
      received: true,
      duplicate: true,
    });

    // No second payment record, no second subscription, no second activation.
    expect(await paymentRows(seeded.orgId)).toHaveLength(1);
    expect(await subscriptionRows(seeded.orgId)).toHaveLength(1);
    expect(await activatedHistoryCount(seeded.offerId)).toBe(1);
  });

  it("REQ-REL-ASA-003 a retried delivery whose prior attempt failed (event row unprocessed) IS re-processed, then idempotent", async () => {
    const seeded = await seedActivatableOffer("org-idem-2");
    const event = confirmedPaymentEvent(seeded, "evt_idem_retry");

    // Simulate the aftermath of a first attempt that returned non-2xx: the event
    // row was inserted (dedup guard) but its money transaction rolled back, so
    // processedAt IS NULL and nothing was activated.
    await db.insert(providerWebhookEvent).values({
      provider: "ASAAS",
      eventId: "evt_idem_retry",
      eventType: "PAYMENT_CONFIRMED",
      payload: event,
    });
    expect(await paymentRows(seeded.orgId)).toHaveLength(0);

    // ASAAS retries → the delivery must be RE-PROCESSED, not dropped as a duplicate.
    const retry = await post(event);
    expect(retry.status).toBe(200);
    expect(await jsonOf(retry)).toMatchObject({
      received: true,
      duplicate: false,
    });

    expect(await paymentRows(seeded.orgId)).toHaveLength(1);
    const subs = await subscriptionRows(seeded.orgId);
    expect(subs).toHaveLength(1);
    expect(subs[0]?.status).toBe("ACTIVE");
    expect(await activatedHistoryCount(seeded.offerId)).toBe(1);

    const [row] = await db
      .select()
      .from(providerWebhookEvent)
      .where(eq(providerWebhookEvent.eventId, "evt_idem_retry"));
    expect(row?.processedAt).not.toBeNull();

    // A further re-delivery is now a pure duplicate — still exactly once.
    const third = await post(event);
    expect(await jsonOf(third)).toMatchObject({ duplicate: true });
    expect(await paymentRows(seeded.orgId)).toHaveLength(1);
    expect(await subscriptionRows(seeded.orgId)).toHaveLength(1);
    expect(await activatedHistoryCount(seeded.offerId)).toBe(1);
  });
});
