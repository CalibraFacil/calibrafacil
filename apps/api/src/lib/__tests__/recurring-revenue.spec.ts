import { describe, expect, it } from "vitest";

import { summarizeRecurringRevenue } from "../recurring-revenue";

const NOW = new Date("2026-05-26T00:00:00.000Z");

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("summarizeRecurringRevenue", () => {
  it("returns zeros for an empty list", () => {
    expect(summarizeRecurringRevenue([], NOW)).toEqual({
      activeCount: 0,
      activeWithoutPricingCount: 0,
      monthlyCents: 0,
      annualCents: 0,
      expiringIn30DaysCount: 0,
      expiringIn90DaysCount: 0,
    });
  });

  it("ignores non-active agreements", () => {
    expect(
      summarizeRecurringRevenue(
        [
          {
            status: "DRAFT",
            effectiveFrom: daysFromNow(-30),
            effectiveTo: null,
            monthlyRecurringCents: 50_000,
          },
          {
            status: "EXPIRED",
            effectiveFrom: daysFromNow(-365),
            effectiveTo: daysFromNow(-1),
            monthlyRecurringCents: 50_000,
          },
          {
            status: "CANCELED",
            effectiveFrom: daysFromNow(-30),
            effectiveTo: null,
            monthlyRecurringCents: 50_000,
          },
        ],
        NOW,
      ).activeCount,
    ).toBe(0);
  });

  it("sums monthly cents and multiplies into annual", () => {
    const summary = summarizeRecurringRevenue(
      [
        {
          status: "ACTIVE",
          effectiveFrom: daysFromNow(-30),
          effectiveTo: null,
          monthlyRecurringCents: 50_000,
        },
        {
          status: "ACTIVE",
          effectiveFrom: daysFromNow(-30),
          effectiveTo: null,
          monthlyRecurringCents: 25_000,
        },
      ],
      NOW,
    );
    expect(summary.activeCount).toBe(2);
    expect(summary.monthlyCents).toBe(75_000);
    expect(summary.annualCents).toBe(900_000);
    expect(summary.activeWithoutPricingCount).toBe(0);
  });

  it("counts unpriced agreements separately and excludes them from monthlyCents", () => {
    const summary = summarizeRecurringRevenue(
      [
        {
          status: "ACTIVE",
          effectiveFrom: daysFromNow(-30),
          effectiveTo: null,
          monthlyRecurringCents: 30_000,
        },
        {
          status: "ACTIVE",
          effectiveFrom: daysFromNow(-30),
          effectiveTo: null,
          monthlyRecurringCents: null,
        },
      ],
      NOW,
    );
    expect(summary.activeCount).toBe(2);
    expect(summary.activeWithoutPricingCount).toBe(1);
    expect(summary.monthlyCents).toBe(30_000);
  });

  it("classifies agreements expiring within 30 and 90 days", () => {
    const summary = summarizeRecurringRevenue(
      [
        {
          status: "ACTIVE",
          effectiveFrom: daysFromNow(-365),
          effectiveTo: daysFromNow(15),
          monthlyRecurringCents: 10_000,
        },
        {
          status: "ACTIVE",
          effectiveFrom: daysFromNow(-365),
          effectiveTo: daysFromNow(60),
          monthlyRecurringCents: 10_000,
        },
        {
          status: "ACTIVE",
          effectiveFrom: daysFromNow(-365),
          effectiveTo: daysFromNow(120),
          monthlyRecurringCents: 10_000,
        },
      ],
      NOW,
    );
    expect(summary.expiringIn30DaysCount).toBe(1);
    expect(summary.expiringIn90DaysCount).toBe(2);
  });

  it("does not classify already-expired effectiveTo as 'expiring'", () => {
    const summary = summarizeRecurringRevenue(
      [
        {
          status: "ACTIVE",
          effectiveFrom: daysFromNow(-365),
          effectiveTo: daysFromNow(-10),
          monthlyRecurringCents: 10_000,
        },
      ],
      NOW,
    );
    expect(summary.expiringIn30DaysCount).toBe(0);
    expect(summary.expiringIn90DaysCount).toBe(0);
  });
});
