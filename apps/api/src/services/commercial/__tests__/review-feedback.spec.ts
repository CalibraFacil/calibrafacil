import { describe, expect, it } from "vitest";
import type { AsaasWebhookPayload } from "../../asaas";
import { resolveProviderSubscriptionId } from "../reconcile-webhook";
import { resolveReissueItems } from "../reissue";

describe("commercial review feedback regressions", () => {
  it("preserves original reissue items when overrides omit the items field", () => {
    const originalItems = [
      {
        type: "PLAN",
        label: "Plano Professional",
        quantity: 1,
        unitAmount: 120_00,
        totalAmount: 120_00,
      },
      {
        type: "DISCOUNT",
        label: "Desconto comercial",
        quantity: 1,
        unitAmount: 20_00,
        totalAmount: 20_00,
      },
    ];

    expect(
      resolveReissueItems(
        { negotiatedAmount: 100_00 },
        { items: originalItems },
      ),
    ).toEqual(originalItems);
  });

  it("still respects explicit reissue item overrides", () => {
    expect(
      resolveReissueItems(
        { items: [] },
        {
          items: [
            {
              type: "PLAN",
              label: "Plano legado",
              quantity: 1,
              unitAmount: 100_00,
              totalAmount: 100_00,
            },
          ],
        },
      ),
    ).toEqual([]);
  });

  it("prefers the subscription payload id when reconciling webhook state", () => {
    const payload = {
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: "pay_123",
        customer: "cus_123",
        subscription: "sub_from_payment",
        billingType: "CREDIT_CARD",
        value: 100,
        dueDate: "2026-04-09",
        status: "CONFIRMED",
      },
      subscription: {
        id: "sub_from_payload",
        customer: "cus_123",
        billingType: "CREDIT_CARD",
        value: 100,
        nextDueDate: "2026-05-09",
        cycle: "MONTHLY",
        status: "ACTIVE",
        dateCreated: "2026-04-09",
      },
    } satisfies AsaasWebhookPayload;

    expect(resolveProviderSubscriptionId(payload, null)).toBe("sub_from_payload");
  });

  it("falls back to payment and stored offer subscription ids", () => {
    const paymentPayload = {
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: "pay_123",
        customer: "cus_123",
        subscription: "sub_from_payment",
        billingType: "BOLETO",
        value: 100,
        dueDate: "2026-04-09",
        status: "CONFIRMED",
      },
    } satisfies AsaasWebhookPayload;

    expect(resolveProviderSubscriptionId(paymentPayload, null)).toBe("sub_from_payment");
    expect(
      resolveProviderSubscriptionId(
        { event: "SUBSCRIPTION_UPDATED" } as AsaasWebhookPayload,
        "sub_existing",
      ),
    ).toBe("sub_existing");
  });
});
