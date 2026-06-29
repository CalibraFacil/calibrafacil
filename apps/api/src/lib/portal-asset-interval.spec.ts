import { describe, expect, it } from "vitest";

import {
  decidePortalIntervalWrite,
  deriveNextCalibrationDate,
} from "./portal-asset-interval";

describe("decidePortalIntervalWrite", () => {
  // REQ-MLR-040: an in-scope asset is allowed REGARDLESS of metrology regime — the customer
  // owns the calibration interval for every instrument, so there is no legal-metrology lock
  // here anymore (a legal asset's regulated verification periodicity is a separate track).
  it("allows when the asset is in scope (any regime)", () => {
    expect(
      decidePortalIntervalWrite({
        asset: { customerId: 7 },
        scopedCustomerIds: [7, 9],
      }),
    ).toEqual({ allowed: true });
  });

  // REQ-MLR-041: a missing asset is 404 (never 403/200).
  it("rejects a missing asset with 404", () => {
    expect(
      decidePortalIntervalWrite({ asset: null, scopedCustomerIds: [7] }),
    ).toEqual({ allowed: false, status: 404, reason: "asset_not_found" });
  });

  // REQ-MLR-041: an asset belonging to another tenant is 404 (no disclosure, never 403).
  it("rejects an out-of-scope asset with 404", () => {
    expect(
      decidePortalIntervalWrite({
        asset: { customerId: 99 },
        scopedCustomerIds: [7, 9],
      }),
    ).toEqual({ allowed: false, status: 404, reason: "asset_not_found" });
  });
});

describe("deriveNextCalibrationDate", () => {
  // REQ-INTERVAL-003: last + interval months, in UTC.
  it("adds the interval in months", () => {
    const next = deriveNextCalibrationDate(new Date(Date.UTC(2026, 0, 15)), 12);
    expect(next?.toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  it("rolls the year over for intervals past December", () => {
    const next = deriveNextCalibrationDate(new Date(Date.UTC(2026, 10, 10)), 6);
    expect(next?.toISOString()).toBe("2027-05-10T00:00:00.000Z");
  });

  // End-of-month clamp (mirrors date-fns addMonths): 31 Jan + 1 month → 28 Feb.
  it("clamps the day to the last day of the target month", () => {
    const next = deriveNextCalibrationDate(new Date(Date.UTC(2026, 0, 31)), 1);
    expect(next?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  // REQ-INTERVAL-002/003: no last-calibration date → no derived next date.
  it("returns null when there is no last-calibration date", () => {
    expect(deriveNextCalibrationDate(null, 12)).toBeNull();
  });
});
