import { describe, expect, it } from "vitest";

import { isServiceOrderStatus, SERVICE_ORDER_STATUSES } from "./service-orders";

// The lifecycle rules (which command moves an order where) live in
// SERVICE_ORDER_MACHINE, @calibra-facil/schemas/machines, with their tests.

describe("isServiceOrderStatus", () => {
  it("accepts every known status", () => {
    for (const status of SERVICE_ORDER_STATUSES) {
      expect(isServiceOrderStatus(status)).toBe(true);
    }
  });

  it("rejects values a jsonb column could plausibly hold", () => {
    // The reopen path reads a status back out of the event log, where a row
    // written by another deploy could carry anything.
    for (const value of [
      undefined,
      null,
      "",
      "CLOSED",
      "not_a_status",
      42,
      { status: "closed" },
      ["closed"],
    ]) {
      expect(isServiceOrderStatus(value)).toBe(false);
    }
  });
});
