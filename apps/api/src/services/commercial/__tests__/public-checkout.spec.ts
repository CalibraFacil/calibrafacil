import { describe, expect, it } from "vitest";
import type { commercialOffer, paymentRecord } from "@calibra-facil/db/schema";
import { previewCommercialOffer } from "../preview";
import { resolveCommercialPublicState } from "../public-checkout";

type OfferRow = typeof commercialOffer.$inferSelect;
type PaymentRow = typeof paymentRecord.$inferSelect;

function makeOffer(overrides: Partial<OfferRow> = {}): OfferRow {
  return {
    id: "offer_123",
    dealId: "deal_123",
    organizationId: "org_123",
    kind: "PLAN_UPFRONT",
    status: "PENDING_PAYMENT",
    provider: "ASAAS",
    providerMode: "PAYMENT",
    activationBehavior: "IMMEDIATE_REPLACE",
    basePlanId: "PROFESSIONAL",
    billingCycle: "YEARLY",
    contractTermMonths: 12,
    renewalMode: "MANUAL",
    currency: "BRL",
    subtotalAmount: 100_00,
    discountAmount: 0,
    totalAmount: 100_00,
    dueDate: new Date("2099-04-15T12:00:00.000Z"),
    offerExpiresAt: new Date("2099-04-20T12:00:00.000Z"),
    paymentMethods: ["BOLETO"],
    customerVisibleDescription: "Oferta comercial",
    internalNotes: "interno",
    termsSnapshot: {},
    customerSnapshot: {},
    providerRequestSnapshot: null,
    providerResponseSnapshot: null,
    checkoutUrl: null,
    providerCheckoutId: null,
    providerPaymentId: null,
    providerSubscriptionId: null,
    publicTokenHash: "hash",
    publicTokenIssuedAt: new Date("2026-04-09T12:00:00.000Z"),
    publicTokenRevokedAt: null,
    publicViewedAt: null,
    publicLastAccessAt: null,
    customerCheckoutUrlPath: "/checkout/token",
    billingCustomerId: 1,
    issuedAt: new Date("2026-04-09T12:00:00.000Z"),
    paidAt: null,
    activatedAt: null,
    canceledAt: null,
    createdBy: "user_123",
    canceledBy: null,
    reissuedFromOfferId: null,
    createdAt: new Date("2026-04-09T12:00:00.000Z"),
    updatedAt: new Date("2026-04-09T12:00:00.000Z"),
    ...overrides,
  };
}

function makePayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 1,
    commercialOfferId: "offer_123",
    organizationId: "org_123",
    provider: "ASAAS",
    providerCheckoutId: null,
    providerPaymentId: "pay_123",
    providerSubscriptionId: null,
    externalReference: "commercial-offer:offer_123",
    amount: 100_00,
    netAmount: null,
    currency: "BRL",
    paymentMethod: "BOLETO",
    status: "PENDING",
    cardLast4: null,
    cardBrand: null,
    dueDate: new Date("2099-04-15T12:00:00.000Z"),
    paidAt: null,
    invoiceUrl: null,
    bankSlipUrl: "https://example.com/boleto",
    pixQrCodeUrl: null,
    pixPayload: null,
    providerSnapshot: {},
    createdAt: new Date("2026-04-09T12:00:00.000Z"),
    updatedAt: new Date("2026-04-09T12:00:00.000Z"),
    ...overrides,
  };
}

describe("previewCommercialOffer", () => {
  it("uses direct payment mode for one-time credit card offers", () => {
    const result = previewCommercialOffer({
      organizationId: "org_123",
      kind: "PLAN_UPFRONT",
      basePlanId: "PROFESSIONAL",
      billingCycle: "YEARLY",
      contractTermMonths: 12,
      negotiatedAmount: 100_00,
      discountAmount: 0,
      setupFeeAmount: 0,
      paymentMethods: ["CREDIT_CARD"],
      items: [],
    });

    expect(result.providerMode).toBe("PAYMENT");
  });

  it("keeps recurring credit card offers on hosted checkout mode", () => {
    const result = previewCommercialOffer({
      organizationId: "org_123",
      kind: "PLAN_RECURRING",
      basePlanId: "PROFESSIONAL",
      billingCycle: "MONTHLY",
      contractTermMonths: 12,
      negotiatedAmount: 100_00,
      discountAmount: 0,
      setupFeeAmount: 0,
      paymentMethods: ["CREDIT_CARD"],
      items: [],
    });

    expect(result.providerMode).toBe("CHECKOUT");
  });
});

describe("resolveCommercialPublicState", () => {
  it("marks superseded or revoked offers as revoked", () => {
    expect(
      resolveCommercialPublicState(
        makeOffer({ status: "SUPERSEDED", publicTokenRevokedAt: new Date() }),
        null,
      ),
    ).toBe("REVOKED");
  });

  it("returns pix-ready when a pix payment already exists", () => {
    expect(
      resolveCommercialPublicState(
        makeOffer({ paymentMethods: ["PIX"] }),
        makePayment({
          paymentMethod: "PIX",
          bankSlipUrl: null,
          pixQrCodeUrl: "data:image/png;base64,abc",
          pixPayload: "000201...",
        }),
      ),
    ).toBe("PIX_READY");
  });

  it("returns boleto-ready when a boleto payment already exists", () => {
    expect(resolveCommercialPublicState(makeOffer(), makePayment())).toBe(
      "BOLETO_READY",
    );
  });

  it("returns paid when the webhook status is confirmed", () => {
    expect(
      resolveCommercialPublicState(
        makeOffer(),
        makePayment({ status: "CONFIRMED", paidAt: new Date() }),
      ),
    ).toBe("PAID");
  });

  it("returns overdue when the payment is overdue", () => {
    expect(
      resolveCommercialPublicState(
        makeOffer(),
        makePayment({ status: "OVERDUE" }),
      ),
    ).toBe("OVERDUE");
  });

  it("returns refunded when the payment is refunded", () => {
    expect(
      resolveCommercialPublicState(
        makeOffer(),
        makePayment({ status: "REFUNDED" }),
      ),
    ).toBe("REFUNDED");
  });

  it("returns awaiting-payment before any provider artifact exists", () => {
    expect(resolveCommercialPublicState(makeOffer(), null)).toBe(
      "AWAITING_PAYMENT",
    );
  });
});
