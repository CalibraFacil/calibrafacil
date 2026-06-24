import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webhooksRouter } from "./webhooks";
import { db } from "@calibra-facil/db";
import { providerWebhookEvent } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";

// Real-DB integration test for webhooksRouter (POST /webhooks/asaas).
//
// This is a PUBLIC, provider-facing endpoint (no better-auth session). It is
// NOT gated by RBAC — it is gated by a SHARED-SECRET header. See webhooks.ts:
//
//   export function verifyWebhookToken(request: Request): boolean {
//     const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;        // line 12
//     if (!webhookToken) { ...; return false; }                   // lines 14-19
//     const receivedToken = request.headers.get("asaas-access-token"); // line 21
//     if (!receivedToken) { return false; }                       // lines 22-24
//     const expected = Buffer.from(webhookToken, "utf8");         // line 26
//     const received = Buffer.from(receivedToken, "utf8");        // line 27
//     if (expected.length !== received.length) { return false; }  // lines 29-31
//     return timingSafeEqual(expected, received);                 // line 33
//   }
//   ...
//   if (!verifyWebhookToken(c.req.raw)) {
//     return c.json({ error: "Unauthorized" }, 401);              // lines 45-47
//   }
//
// SIGNATURE SCHEME: a constant-time (timingSafeEqual) byte-compare of the
//   `asaas-access-token` request header against `process.env.ASAAS_WEBHOOK_TOKEN`.
//   The secret is an ENV shared-secret (NOT an HMAC over a provider-private key),
//   so a VALID signature IS reproducible in-test by setting the same env var.
//
// SIDE EFFECT of a valid call (reconcile-webhook.ts lines 254-259): a row is
//   INSERTED into `provider_webhook_event` (provider "ASAAS", eventId, eventType,
//   payload). With no matching commercialOffer the reconcile short-circuits after
//   that insert and returns { duplicate: false } — so the persisted event row is
//   the directly-observable side effect of acceptance, with no offer-chain seed.
//
// KEY SECURITY PROPERTY proven here: a valid-secret call is processed (event row
//   persists); an invalid/missing-secret call is rejected 401 with NO row written.

const JSON_HEADERS = { "content-type": "application/json" };
const VALID_TOKEN = "test-asaas-webhook-secret-1234567890";

const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;

function buildPayload(overrides?: { id?: string; event?: string }) {
  return {
    id: overrides?.id ?? "evt_int_0001",
    // event is a no-match payment event; reconcile inserts the event row then
    // short-circuits because findOfferForPayload returns null (no seeded offer).
    event: overrides?.event ?? "PAYMENT_RECEIVED",
    dateCreated: "2026-01-01T00:00:00.000Z",
    payment: {
      id: "pay_int_0001",
      customer: "cus_int_0001",
      billingType: "PIX",
      value: 1499,
      dueDate: "2026-01-10",
      status: "RECEIVED",
      externalReference: "no-such-offer-reference",
    },
  };
}

async function eventRowCount(): Promise<number> {
  const rows = await db.select().from(providerWebhookEvent);
  return rows.length;
}

beforeEach(async () => {
  await truncateAll();
  process.env.ASAAS_WEBHOOK_TOKEN = VALID_TOKEN;
});

afterEach(() => {
  if (previousToken === undefined) {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
  } else {
    process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
  }
});

describe("POST /webhooks/asaas (real DB, shared-secret gated)", () => {
  // -------------------------------------------------------------------------
  // REQ-WH-001 [HIGH RISK]: invalid/missing/wrong secret → 401, NO side effect.
  // -------------------------------------------------------------------------
  describe("REQ-WH-001: rejects without a valid shared secret, no DB write", () => {
    it("REQ-WH-001 rejects a MISSING access-token header (401, no row)", async () => {
      const res = await webhooksRouter.request("/asaas", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(buildPayload()),
      });

      expect(res.status).toBe(401);
      const body: unknown = await res.json();
      expect(body && typeof body === "object" && "error" in body).toBe(true);
      // The rejection must happen BEFORE any persistence.
      expect(await eventRowCount()).toBe(0);
    });

    it("REQ-WH-001 rejects a WRONG access-token (401, no row)", async () => {
      const res = await webhooksRouter.request("/asaas", {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "asaas-access-token": "definitely-not-the-secret",
        },
        body: JSON.stringify(buildPayload()),
      });

      expect(res.status).toBe(401);
      expect(await eventRowCount()).toBe(0);
    });

    it("REQ-WH-001 rejects when no server secret is configured (401, no row)", async () => {
      // If ASAAS_WEBHOOK_TOKEN is unset the endpoint fails closed (lines 14-19),
      // even when the caller sends a header.
      delete process.env.ASAAS_WEBHOOK_TOKEN;

      const res = await webhooksRouter.request("/asaas", {
        method: "POST",
        headers: { ...JSON_HEADERS, "asaas-access-token": VALID_TOKEN },
        body: JSON.stringify(buildPayload()),
      });

      expect(res.status).toBe(401);
      expect(await eventRowCount()).toBe(0);
    });

    it("REQ-WH-001 rejects a token of the WRONG LENGTH (401, no row)", async () => {
      // length-mismatch branch (lines 29-31) returns before timingSafeEqual.
      const res = await webhooksRouter.request("/asaas", {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "asaas-access-token": `${VALID_TOKEN}-extra-bytes`,
        },
        body: JSON.stringify(buildPayload()),
      });

      expect(res.status).toBe(401);
      expect(await eventRowCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // REQ-WH-002: a VALID shared secret + well-formed payload → processed, the
  // documented side effect (provider_webhook_event row) persists.
  // The secret IS reproducible in-test (env shared-secret), so this binds to the
  // ACCEPT path — not just the reject path.
  // -------------------------------------------------------------------------
  describe("REQ-WH-002: a valid secret is processed and persists the event", () => {
    it("REQ-WH-002 accepts a valid signature and writes the provider_webhook_event row", async () => {
      const payload = buildPayload({ id: "evt_int_accept_001" });

      const res = await webhooksRouter.request("/asaas", {
        method: "POST",
        headers: { ...JSON_HEADERS, "asaas-access-token": VALID_TOKEN },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      expect(body).toMatchObject({ received: true });

      const rows = await db
        .select()
        .from(providerWebhookEvent)
        .where(eq(providerWebhookEvent.eventId, "evt_int_accept_001"));

      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row?.provider).toBe("ASAAS");
      expect(row?.eventType).toBe("PAYMENT_RECEIVED");
      // The raw payload is persisted verbatim for audit/replay.
      const stored = row?.payload;
      expect(stored && typeof stored === "object" && "event" in stored).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // happy-path: idempotent re-delivery (binds to ACTUAL behavior).
  //
  // A second delivery of the SAME eventId with a valid secret must NOT create a
  // second `provider_webhook_event` row — the eventId UNIQUE constraint enforces
  // exactly-once persistence regardless of how the duplicate is reported. This
  // is the integrity property that matters and it holds.
  //
  // FINDING (NOT asserted as the intended behavior): reconcile-webhook.ts intends
  // to report a duplicate as { duplicate: true } via isUniqueConstraintError()
  // (lines 24-31, 260-264), but under postgres-js the thrown error is a drizzle
  // DrizzleQueryError WRAPPER whose own `code` is NOT "23505" — the 23505 lives on
  // error.cause (the PostgresError). So isUniqueConstraintError(error) returns
  // false, the error is re-thrown, and the router's outer catch (webhooks.ts
  // lines 65-78) swallows it, returning 200 { received: true } with NO `duplicate`
  // flag. The dedup REPORTING is broken; the dedup INTEGRITY (single row) still
  // holds via the DB constraint. The test below binds to this real behavior. See
  // the report for the suggested one-line fix (unwrap error.cause).
  // -------------------------------------------------------------------------
  describe("happy-path: idempotent re-delivery", () => {
    it("REQ-WH-002 a repeated eventId never creates a second row (exactly-once persistence)", async () => {
      const payload = buildPayload({ id: "evt_int_dup_001" });
      const headers = { ...JSON_HEADERS, "asaas-access-token": VALID_TOKEN };

      const first = await webhooksRouter.request("/asaas", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      expect(first.status).toBe(200);
      const firstBody: unknown = await first.json();
      expect(firstBody).toMatchObject({ received: true, duplicate: false });

      const second = await webhooksRouter.request("/asaas", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      // The endpoint always acks the provider with 200 (it must not make ASAAS
      // retry), even when the duplicate is hit. The KEY property is integrity:
      // the eventId UNIQUE constraint keeps it to a single persisted row.
      expect(second.status).toBe(200);
      const secondBody: unknown = await second.json();
      expect(secondBody).toMatchObject({ received: true });

      const rows = await db
        .select()
        .from(providerWebhookEvent)
        .where(eq(providerWebhookEvent.eventId, "evt_int_dup_001"));
      expect(rows).toHaveLength(1);
    });
  });
});
