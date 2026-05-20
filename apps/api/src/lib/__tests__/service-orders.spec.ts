import { describe, expect, it } from "vitest";
import {
  canEditServiceOrderQuote,
  canTransitionServiceOrderStatus,
  isServiceOrderFinalStatus,
} from "@calibra-facil/shared";

import {
  calculatePricedItems,
  hashServiceOrderToken,
} from "../service-order-workflow";

describe("service order workflow helpers", () => {
  it("allows only supported status transitions", () => {
    expect(
      canTransitionServiceOrderStatus("opened", "awaiting_tech_evaluation"),
    ).toBe(true);
    expect(
      canTransitionServiceOrderStatus("closed", "repair_in_progress"),
    ).toBe(false);
    expect(isServiceOrderFinalStatus("closed")).toBe(true);
    expect(isServiceOrderFinalStatus("ready_for_pickup")).toBe(false);
  });

  it("locks sent and approved quotes against draft edits", () => {
    expect(canEditServiceOrderQuote("draft")).toBe(true);
    expect(canEditServiceOrderQuote("sent")).toBe(false);
    expect(canEditServiceOrderQuote("approved")).toBe(false);
  });

  it("calculates service order line item totals in cents", () => {
    const result = calculatePricedItems([
      {
        type: "service",
        description: "Servico de reparo",
        quantity: 2,
        unitPriceCents: 12_500,
      },
      {
        type: "discount",
        description: "Desconto comercial",
        quantity: 1,
        unitPriceCents: -2_000,
      },
    ]);

    expect(result.items).toEqual([
      expect.objectContaining({ totalPriceCents: 25_000 }),
      expect.objectContaining({ totalPriceCents: -2_000 }),
    ]);
    expect(result.totalCents).toBe(23_000);
  });

  it("hashes public access tokens without storing the clear token", async () => {
    const hashA = await hashServiceOrderToken("token-a");
    const hashB = await hashServiceOrderToken("token-b");

    expect(hashA).toHaveLength(64);
    expect(hashA).not.toBe("token-a");
    expect(hashA).not.toBe(hashB);
  });
});
