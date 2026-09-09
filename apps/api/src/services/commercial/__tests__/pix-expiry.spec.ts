import { describe, expect, it } from "vitest";

import { pixPresentationIsExpired } from "../public-checkout";

const NOW = new Date("2026-09-08T21:00:00.000Z");

function pixPresentation(expirationDate: string | null) {
  return {
    type: "PIX" as const,
    paymentId: 1,
    providerPaymentId: "pay_1",
    providerUrl: null,
    pix: {
      qrCodeImage: "data:image/png;base64,x",
      payload: "000201",
      expirationDate,
    },
    boleto: null,
  };
}

describe("pixPresentationIsExpired", () => {
  it("treats a past expiry as expired", () => {
    expect(
      pixPresentationIsExpired(pixPresentation("2026-09-08 20:59:59"), NOW),
    ).toBe(true);
  });

  it("treats a future expiry as usable", () => {
    expect(
      pixPresentationIsExpired(pixPresentation("2026-09-09 23:59:59"), NOW),
    ).toBe(false);
  });

  it("does not guess when Asaas sends no expiry", () => {
    expect(pixPresentationIsExpired(pixPresentation(null), NOW)).toBe(false);
  });

  it("does not guess on an unparseable date", () => {
    expect(pixPresentationIsExpired(pixPresentation("nunca"), NOW)).toBe(false);
  });

  it("ignores boleto and card presentations", () => {
    expect(
      pixPresentationIsExpired(
        {
          type: "BOLETO",
          paymentId: 1,
          providerPaymentId: "pay_1",
          providerUrl: null,
          pix: null,
          boleto: {
            bankSlipUrl: null,
            identificationField: null,
            dueDate: "2026-01-01",
            amount: 100,
          },
        },
        NOW,
      ),
    ).toBe(false);
    expect(pixPresentationIsExpired(null, NOW)).toBe(false);
  });
});
