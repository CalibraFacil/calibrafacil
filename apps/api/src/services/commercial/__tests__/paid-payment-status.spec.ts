import { describe, expect, it } from "vitest";

import { PAID_PAYMENT_STATUSES, isPaidPaymentStatus } from "../common";

/**
 * Three places used to decide independently whether money had arrived, and they
 * disagreed: a cash settlement marked the offer PAID and revoked its checkout
 * token, while activation and the customer notification ignored it. The
 * laboratory stayed on FREE with no way to repair it, because replaying the
 * webhook finds the offer already PAID.
 */
describe("paid payment statuses", () => {
  it("counts a boleto settled at the counter as paid", () => {
    expect(isPaidPaymentStatus("RECEIVED_IN_CASH")).toBe(true);
  });

  it("counts the ordinary confirmations as paid", () => {
    expect(isPaidPaymentStatus("CONFIRMED")).toBe(true);
    expect(isPaidPaymentStatus("RECEIVED")).toBe(true);
  });

  it("does not count anything still owed, refunded or gone", () => {
    for (const status of [
      "PENDING",
      "AWAITING_RISK_ANALYSIS",
      "OVERDUE",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "DELETED",
    ] as const) {
      expect(isPaidPaymentStatus(status)).toBe(false);
    }
  });

  it("exposes exactly the three paid statuses", () => {
    expect([...PAID_PAYMENT_STATUSES].sort()).toEqual([
      "CONFIRMED",
      "RECEIVED",
      "RECEIVED_IN_CASH",
    ]);
  });
});
