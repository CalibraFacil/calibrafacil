import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  billingCustomer,
  commercialDeal,
  commercialOffer,
  commercialOfferAccessLog,
  commercialOfferItem,
  organization,
  paymentRecord,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  createCommercialPublicToken,
  hashCommercialPublicToken,
} from "../services/commercial/common";
import { publicCommercialCheckoutRouter } from "./public-commercial-checkout";
import { truncateAll } from "../../test/integration/db";

// Real-DB integration test for the PUBLIC commercial-checkout router.
//
// This router is mounted at /api/public/commercial-checkout with NO auth
// middleware (route-mounts.ts). The ONLY security boundary is the OPAQUE PUBLIC
// TOKEN carried in the path (`/:token`). The service hashes the token
// (SHA-256 hex via hashCommercialPublicToken) and looks the offer up by
// `commercial_offer.public_token_hash` (public-checkout.ts:
//   loadOfferContextByTokenHash ->
//     db.query.commercialOffer.findFirst({
//       where: eq(commercialOffer.publicTokenHash, tokenHash) }) ).
// A caller who does not hold a token sees nothing; a token only ever resolves
// to the single offer whose hash matches.
//
// Cut-line invariants covered (token boundary + token-scoped flow):
//   REQ-PCC-001  A valid token returns ONLY its own offer; a second seeded
//                offer (token B) is never returned for token A.   [HIGH RISK]
//   REQ-PCC-002  Unknown / malformed token → INVALID (no offer, no presentation,
//                no side effect). The status route maps INVALID to HTTP 404.
//                                                                  [HIGH RISK]
//   REQ-PCC-003  Happy path: GET /:token + GET /:token/status return the
//                documented snapshot/status shape for a seeded offer.
//
// No session mock is needed — there is no session. The whole point is that the
// token, and only the token, gates access.
//
// UNREACHABLE-IN-HARNESS (flagged, not asserted): POST /:token/start.
// startCommercialPublicCheckout opens a transaction and locks the offer with a
// RAW SQL `select id ... for update` via tx.execute(), then reads the locked id
// through getLockedOfferId(), which expects the driver result to carry a `.rows`
// array (the Neon serverless QueryResult shape used in production). The
// integration harness runs the postgres-js driver, whose tx.execute() returns a
// bare RowList (no `.rows`), so getLockedOfferId() always yields undefined and
// EVERY /start call — valid token or not — throws INVALID_TOKEN → HTTP 404.
// That is a driver-result-shape divergence between the harness (postgres-js) and
// prod (neon-serverless), NOT a production defect. Asserting on /start here would
// be a tautology (always 404), so the /start branch is intentionally not tested.
// (Same class of "round-trip unreachable in harness" flag as the customer-groups
// integration work.)

// ---------------------------------------------------------------------------
// Inline seed helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z");

type SeededOffer = {
  token: string;
  tokenHash: string;
  offerId: string;
  organizationId: string;
  billingCustomerId: number;
};

/** Seed the org whose identity becomes the offer's "seller" snapshot. */
async function seedSellerOrg(params: {
  orgId: string;
  name: string;
  cnpj: string;
}): Promise<void> {
  await db.insert(organization).values({
    id: params.orgId,
    name: params.name,
    slug: params.orgId,
    type: "LAB",
    status: "ACTIVE",
    cnpj: params.cnpj,
    email: `${params.orgId}@seller.test`,
    phone: "+55 11 99999-0000",
    createdAt: FIXED_NOW,
  });
}

/**
 * Seed a full public-checkout-ready commercial offer:
 *   org -> billing customer -> deal -> offer (with a fresh public token) ->
 *   one offer item. Returns the RAW token (never persisted) + its hash.
 */
async function seedPublicOffer(params: {
  orgId: string;
  itemLabel: string;
  status?: "PENDING_PAYMENT" | "PAID" | "CANCELED";
  paymentMethods?: ("BOLETO" | "PIX")[];
  payerName?: string;
  totalAmount?: number;
  publicTokenRevokedAt?: Date | null;
  offerExpiresAt?: Date | null;
}): Promise<SeededOffer> {
  const [customerRow] = await db
    .insert(billingCustomer)
    .values({
      organizationId: params.orgId,
      provider: "ASAAS",
      providerCustomerId: `cus_${params.orgId}_${randomBytes(4).toString("hex")}`,
      status: "ACTIVE",
      name: `Cliente ${params.orgId}`,
      email: `${params.orgId}@billing.test`,
      taxId: "12345678000190",
    })
    .returning({ id: billingCustomer.id });
  if (!customerRow) throw new Error("seedPublicOffer: billingCustomer failed");

  const [deal] = await db
    .insert(commercialDeal)
    .values({
      organizationId: params.orgId,
      title: `Deal ${params.orgId}`,
      status: "OPEN",
    })
    .returning({ id: commercialDeal.id });
  if (!deal) throw new Error("seedPublicOffer: commercialDeal failed");

  const token = createCommercialPublicToken();
  const tokenHash = hashCommercialPublicToken(token);
  const total = params.totalAmount ?? 100_00;

  const [offer] = await db
    .insert(commercialOffer)
    .values({
      dealId: deal.id,
      organizationId: params.orgId,
      kind: "PLAN_UPFRONT",
      status: params.status ?? "PENDING_PAYMENT",
      provider: "ASAAS",
      providerMode: "PAYMENT",
      activationBehavior: "NONE",
      currency: "BRL",
      subtotalAmount: total,
      discountAmount: 0,
      totalAmount: total,
      dueDate: FUTURE,
      offerExpiresAt:
        params.offerExpiresAt === undefined ? FUTURE : params.offerExpiresAt,
      paymentMethods: params.paymentMethods ?? ["BOLETO"],
      customerVisibleDescription: `Oferta ${params.orgId}`,
      termsSnapshot: {},
      customerSnapshot: {
        name: params.payerName ?? `Pagador ${params.orgId}`,
        email: `${params.orgId}@payer.test`,
        phone: "+55 11 98888-0000",
        cpfCnpj: "98765432000100",
      },
      publicTokenHash: tokenHash,
      publicTokenIssuedAt: FIXED_NOW,
      publicTokenRevokedAt: params.publicTokenRevokedAt ?? null,
      billingCustomerId: customerRow.id,
      issuedAt: FIXED_NOW,
    })
    .returning({ id: commercialOffer.id });
  if (!offer) throw new Error("seedPublicOffer: commercialOffer failed");

  await db.insert(commercialOfferItem).values({
    offerId: offer.id,
    type: "PLAN",
    label: params.itemLabel,
    quantity: 1,
    unitAmount: total,
    totalAmount: total,
  });

  return {
    token,
    tokenHash,
    offerId: offer.id,
    organizationId: params.orgId,
    billingCustomerId: customerRow.id,
  };
}

/** Seed a pre-existing provider payment so /start resolves to the RESUME path. */
async function seedBoletoPayment(params: {
  offerId: string;
  organizationId: string;
}): Promise<number> {
  const [row] = await db
    .insert(paymentRecord)
    .values({
      commercialOfferId: params.offerId,
      organizationId: params.organizationId,
      provider: "ASAAS",
      providerPaymentId: `pay_${randomBytes(4).toString("hex")}`,
      externalReference: `commercial-offer:${params.offerId}`,
      amount: 100_00,
      currency: "BRL",
      paymentMethod: "BOLETO",
      status: "PENDING",
      dueDate: FUTURE,
      bankSlipUrl: "https://asaas.test/boleto/abc",
      providerSnapshot: { identificationField: "34191.79001 01043.510047" },
    })
    .returning({ id: paymentRecord.id });
  if (!row) throw new Error("seedBoletoPayment: insert failed");
  return row.id;
}

async function countAccessLogs(offerId: string): Promise<number> {
  const rows = await db
    .select({ id: commercialOfferAccessLog.id })
    .from(commercialOfferAccessLog)
    .where(eq(commercialOfferAccessLog.offerId, offerId));
  return rows.length;
}

/** A syntactically valid (43-char base64url) token that is NOT in the DB. */
function unknownValidToken(): string {
  return createCommercialPublicToken();
}

// ---------------------------------------------------------------------------

describe("publicCommercialCheckoutRouter — real DB, opaque-token boundary", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-PCC-001  Token isolation: token A returns ONLY offer A, never offer B.
  // =========================================================================
  it("REQ-PCC-001: a valid token returns only its own offer; token B's offer never leaks", async () => {
    await seedSellerOrg({
      orgId: "org-a",
      name: "Laboratório Alfa",
      cnpj: "11111111000111",
    });
    await seedSellerOrg({
      orgId: "org-b",
      name: "Laboratório Beta",
      cnpj: "22222222000122",
    });

    const offerA = await seedPublicOffer({
      orgId: "org-a",
      itemLabel: "Plano Alfa exclusivo",
      payerName: "Pagador Alfa",
    });
    const offerB = await seedPublicOffer({
      orgId: "org-b",
      itemLabel: "Plano Beta exclusivo",
      payerName: "Pagador Beta",
    });

    // Request with token A.
    const resA = await publicCommercialCheckoutRouter.request(
      `/${offerA.token}`,
    );
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();

    // Token A resolves to offer A, and ONLY offer A.
    expect(bodyA.state).not.toBe("INVALID");
    expect(bodyA.offer.id).toBe(offerA.offerId);
    expect(bodyA.offer.seller.name).toBe("Laboratório Alfa");
    expect(bodyA.offer.seller.cnpj).toBe("11111111000111");
    expect(bodyA.offer.payer.name).toBe("Pagador Alfa");
    const labelsA = bodyA.offer.items.map((i: { label: string }) => i.label);
    expect(labelsA).toContain("Plano Alfa exclusivo");

    // Offer B never appears in token A's response — by id, seller, payer, item.
    const serializedA = JSON.stringify(bodyA);
    expect(bodyA.offer.id).not.toBe(offerB.offerId);
    expect(serializedA).not.toContain(offerB.offerId);
    expect(serializedA).not.toContain("Laboratório Beta");
    expect(serializedA).not.toContain("Pagador Beta");
    expect(serializedA).not.toContain("Plano Beta exclusivo");

    // Symmetry: token B resolves to offer B, and ONLY offer B.
    const resB = await publicCommercialCheckoutRouter.request(
      `/${offerB.token}`,
    );
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();
    expect(bodyB.offer.id).toBe(offerB.offerId);
    expect(JSON.stringify(bodyB)).not.toContain("Laboratório Alfa");
  });

  // =========================================================================
  // REQ-PCC-002  Unknown / malformed token → INVALID, HTTP 404, no side effect.
  // =========================================================================
  it("REQ-PCC-002: unknown valid-format and malformed tokens → INVALID/404, no offer mutated", async () => {
    await seedSellerOrg({
      orgId: "org-a",
      name: "Laboratório Alfa",
      cnpj: "11111111000111",
    });
    const offerA = await seedPublicOffer({
      orgId: "org-a",
      itemLabel: "Plano Alfa",
    });

    // Snapshot the offer's access-tracking columns BEFORE the bad requests.
    const before = await db.query.commercialOffer.findFirst({
      where: eq(commercialOffer.id, offerA.offerId),
    });
    expect(before).toBeTruthy();
    const accessLogsBefore = await countAccessLogs(offerA.offerId);
    expect(accessLogsBefore).toBe(0);

    // (a) A syntactically valid (43-char) token whose hash is not in the DB.
    const unknown = unknownValidToken();
    const resUnknownSnapshot = await publicCommercialCheckoutRouter.request(
      `/${unknown}`,
    );
    expect(resUnknownSnapshot.status).toBe(200); // snapshot route returns INVALID body w/ 200
    const unknownSnapshot = await resUnknownSnapshot.json();
    expect(unknownSnapshot.state).toBe("INVALID");
    expect(unknownSnapshot.offer).toBeNull();
    expect(unknownSnapshot.presentation).toBeNull();

    // The status route maps INVALID -> HTTP 404 (real contract).
    const resUnknownStatus = await publicCommercialCheckoutRouter.request(
      `/${unknown}/status`,
    );
    expect(resUnknownStatus.status).toBe(404);
    const unknownStatusBody = await resUnknownStatus.json();
    expect(unknownStatusBody.state).toBe("INVALID");

    // NOTE: /start is deliberately NOT exercised on the unknown token here —
    // under the postgres-js harness it returns 404 for ANY token (see the
    // UNREACHABLE-IN-HARNESS note above), so a 404 assertion would be a
    // tautology rather than proof of the token boundary.

    // (b) A malformed token (wrong length / illegal chars) -> INVALID/404 too.
    const resMalformedSnapshot =
      await publicCommercialCheckoutRouter.request("/not-a-real-token");
    const malformedSnapshot = await resMalformedSnapshot.json();
    expect(malformedSnapshot.state).toBe("INVALID");
    expect(malformedSnapshot.offer).toBeNull();

    const resMalformedStatus = await publicCommercialCheckoutRouter.request(
      "/not-a-real-token/status",
    );
    expect(resMalformedStatus.status).toBe(404);

    // No side effect on the real offer: access-tracking columns untouched and
    // no access-log rows were written for the seeded offer.
    const after = await db.query.commercialOffer.findFirst({
      where: eq(commercialOffer.id, offerA.offerId),
    });
    expect(after?.publicViewedAt ?? null).toBeNull();
    expect(after?.publicLastAccessAt ?? null).toBeNull();
    expect(await countAccessLogs(offerA.offerId)).toBe(0);
  });

  // =========================================================================
  // REQ-PCC-003  Happy path: GET /:token snapshot + GET /:token/status shape
  //              for a seeded offer with a pre-existing boleto payment.
  // =========================================================================
  it("REQ-PCC-003: GET /:token + /:token/status return the documented snapshot/status shape", async () => {
    await seedSellerOrg({
      orgId: "org-a",
      name: "Laboratório Alfa",
      cnpj: "11111111000111",
    });
    const offer = await seedPublicOffer({
      orgId: "org-a",
      itemLabel: "Plano Profissional Anual",
      paymentMethods: ["BOLETO"],
      totalAmount: 250_00,
    });
    // Pre-existing provider payment -> /start hits the RESUME branch
    // (coerceStartResponse), which never calls Asaas.
    const paymentId = await seedBoletoPayment({
      offerId: offer.offerId,
      organizationId: offer.organizationId,
    });

    // --- GET /:token snapshot shape ---
    const resSnapshot = await publicCommercialCheckoutRouter.request(
      `/${offer.token}`,
    );
    expect(resSnapshot.status).toBe(200);
    // Public, no-store cache headers from the router's middleware.
    expect(resSnapshot.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(resSnapshot.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const snapshot = await resSnapshot.json();
    expect(snapshot.state).toBe("BOLETO_READY"); // boleto payment exists
    expect(snapshot.offer.id).toBe(offer.offerId);
    expect(snapshot.offer.totalAmount).toBe(250_00);
    expect(snapshot.offer.paymentMethod).toBe("BOLETO");
    expect(snapshot.offer.seller.name).toBe("Laboratório Alfa");
    expect(snapshot.offer.items[0].label).toBe("Plano Profissional Anual");
    expect(snapshot.presentation.type).toBe("BOLETO");
    expect(snapshot.presentation.paymentId).toBe(paymentId);
    expect(snapshot.presentation.boleto.bankSlipUrl).toBe(
      "https://asaas.test/boleto/abc",
    );

    // The snapshot route marks the offer viewed (a deliberate side effect).
    const afterView = await db.query.commercialOffer.findFirst({
      where: eq(commercialOffer.id, offer.offerId),
    });
    expect(afterView?.publicViewedAt).toBeTruthy();

    // --- GET /:token/status shape ---
    const resStatus = await publicCommercialCheckoutRouter.request(
      `/${offer.token}/status`,
    );
    expect(resStatus.status).toBe(200);
    const status = await resStatus.json();
    expect(status.state).toBe("BOLETO_READY");
    expect(status.paymentId).toBe(paymentId);
    expect(status.status).toBe("PENDING");
    expect(status.presentation.type).toBe("BOLETO");

    // The status route is also token-scoped: it logs a STATUS_CHECKED access
    // row against THIS offer (proves reads land only on the token's offer).
    const statusRow = await db.query.commercialOfferAccessLog.findFirst({
      where: eq(commercialOfferAccessLog.eventType, "STATUS_CHECKED"),
    });
    expect(statusRow?.offerId).toBe(offer.offerId);
  });
});
