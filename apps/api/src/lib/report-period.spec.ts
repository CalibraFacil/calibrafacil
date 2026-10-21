import { describe, expect, it } from "vitest";

import { resolvePeriodRange } from "./report-period";

describe("resolvePeriodRange", () => {
  it("starts the month at midnight on the 1st in the laboratory's time zone", () => {
    const now = new Date("2026-05-20T15:00:00.000Z");
    const range = resolvePeriodRange("month", now);

    expect(range.startDate).toEqual(new Date("2026-05-01T03:00:00.000Z"));
    expect(range.endDate).toEqual(now);
  });

  it("still counts the last evening of a month at the laboratory as that month", () => {
    // 01:30 UTC on 1 June is 22:30 on 31 May in Sao Paulo.
    const range = resolvePeriodRange(
      "month",
      new Date("2026-06-01T01:30:00.000Z"),
    );

    expect(range.startDate).toEqual(new Date("2026-05-01T03:00:00.000Z"));
  });

  it("looks back a whole number of days for rolling windows", () => {
    const now = new Date("2026-05-20T15:00:00.000Z");

    expect(resolvePeriodRange("7d", now).startDate).toEqual(
      new Date("2026-05-13T15:00:00.000Z"),
    );
    expect(resolvePeriodRange("30d", now).startDate).toEqual(
      new Date("2026-04-20T15:00:00.000Z"),
    );
    expect(resolvePeriodRange("90d", now).startDate).toEqual(
      new Date("2026-02-19T15:00:00.000Z"),
    );
  });
});
