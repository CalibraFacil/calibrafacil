import { describe, expect, it } from "vitest";
import { isServiceOrderFinalStatus } from "@calibra-facil/shared";

import {
  calculatePricedItems,
  hashServiceOrderToken,
} from "../service-order-workflow";

describe("service order workflow helpers", () => {
  it("knows the final statuses", () => {
    // The transition rules are SERVICE_ORDER_MACHINE's, tested beside it in
    // @calibra-facil/schemas.
    expect(isServiceOrderFinalStatus("closed")).toBe(true);
    expect(isServiceOrderFinalStatus("ready_for_pickup")).toBe(false);
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
