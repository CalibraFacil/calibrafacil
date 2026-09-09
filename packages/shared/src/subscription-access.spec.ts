import { describe, expect, it } from "vitest";

import { subscriptionGrantsAccess } from "./plans";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const NEXT_YEAR = new Date("2027-09-08T12:00:00.000Z");
const LAST_MONTH = new Date("2026-08-08T12:00:00.000Z");

describe("subscriptionGrantsAccess", () => {
  it("grants while active or on trial", () => {
    expect(subscriptionGrantsAccess({ status: "ACTIVE" }, NOW)).toBe(true);
    expect(subscriptionGrantsAccess({ status: "TRIAL" }, NOW)).toBe(true);
  });

  // Cancelling used to revoke a period the customer had already paid for —
  // up to twelve months of an annual plan, on the day they clicked cancel.
  it("keeps a cancelled subscription until the paid period ends", () => {
    expect(
      subscriptionGrantsAccess(
        { status: "CANCELED", currentPeriodEnd: NEXT_YEAR },
        NOW,
      ),
    ).toBe(true);
  });

  it("stops once that period is over", () => {
    expect(
      subscriptionGrantsAccess(
        { status: "CANCELED", currentPeriodEnd: LAST_MONTH },
        NOW,
      ),
    ).toBe(false);
  });

  it("accepts the period as an ISO string, the way the API serialises it", () => {
    expect(
      subscriptionGrantsAccess(
        { status: "CANCELED", currentPeriodEnd: NEXT_YEAR.toISOString() },
        NOW,
      ),
    ).toBe(true);
  });

  it("does not invent a paid period it cannot prove", () => {
    expect(subscriptionGrantsAccess({ status: "CANCELED" }, NOW)).toBe(false);
    expect(
      subscriptionGrantsAccess(
        { status: "CANCELED", currentPeriodEnd: "não é data" },
        NOW,
      ),
    ).toBe(false);
  });

  it("still refuses a lapsed or past-due subscription", () => {
    expect(
      subscriptionGrantsAccess(
        { status: "PAST_DUE", currentPeriodEnd: NEXT_YEAR },
        NOW,
      ),
    ).toBe(false);
  });
});
