import { describe, expect, it } from "vitest";

import {
  classifyRenewalRisk,
  summarizeContractIntelligence,
} from "../contract-intelligence";

const NOW = new Date("2026-05-27T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("classifyRenewalRisk", () => {
  it("returns LOW for null effectiveTo", () => {
    expect(classifyRenewalRisk(null, NOW)).toEqual({
      risk: "LOW",
      daysUntilExpiry: null,
    });
  });

  it("returns EXPIRED when already past", () => {
    expect(
      classifyRenewalRisk(new Date(NOW.getTime() - 10 * DAY), NOW).risk,
    ).toBe("EXPIRED");
  });

  it("returns HIGH within 30 days", () => {
    expect(
      classifyRenewalRisk(new Date(NOW.getTime() + 15 * DAY), NOW).risk,
    ).toBe("HIGH");
  });

  it("returns MEDIUM within 90 days", () => {
    expect(
      classifyRenewalRisk(new Date(NOW.getTime() + 60 * DAY), NOW).risk,
    ).toBe("MEDIUM");
  });

  it("returns LOW beyond 90 days", () => {
    expect(
      classifyRenewalRisk(new Date(NOW.getTime() + 120 * DAY), NOW).risk,
    ).toBe("LOW");
  });
});

describe("summarizeContractIntelligence", () => {
  it("returns empty list for empty input", () => {
    expect(summarizeContractIntelligence([], NOW)).toEqual([]);
  });

  it("computes utilization percent when quota is set", () => {
    const result = summarizeContractIntelligence(
      [
        {
          id: 1,
          title: "Contrato A",
          status: "ACTIVE",
          effectiveFrom: new Date(NOW.getTime() - 30 * DAY),
          effectiveTo: new Date(NOW.getTime() + 200 * DAY),
          monthlyRecurringCents: 30_000,
          jobsCompletedThisPeriod: 5,
          jobsQuotaThisPeriod: 20,
          outsourcedCostThisPeriodCents: 10_000,
        },
      ],
      NOW,
    );
    expect(result[0]?.utilization).toEqual({
      completed: 5,
      quota: 20,
      percent: 25,
    });
    expect(result[0]?.profitability).toEqual({
      revenueCents: 30_000,
      outsourcedCostCents: 10_000,
      marginCents: 20_000,
      marginPercent: Math.round((20_000 / 30_000) * 10_000) / 100,
    });
    expect(result[0]?.renewalRisk).toBe("LOW");
  });

  it("leaves utilization.percent null when no quota is set", () => {
    const result = summarizeContractIntelligence(
      [
        {
          id: 1,
          title: "Contrato Aberto",
          status: "ACTIVE",
          effectiveFrom: new Date(NOW.getTime() - 30 * DAY),
          effectiveTo: null,
          monthlyRecurringCents: null,
          jobsCompletedThisPeriod: 7,
          jobsQuotaThisPeriod: null,
          outsourcedCostThisPeriodCents: 0,
        },
      ],
      NOW,
    );
    expect(result[0]?.utilization.percent).toBeNull();
    expect(result[0]?.profitability.marginPercent).toBeNull();
  });

  it("flags HIGH renewal risk when expiry within 30 days", () => {
    const result = summarizeContractIntelligence(
      [
        {
          id: 1,
          title: "Contrato",
          status: "ACTIVE",
          effectiveFrom: new Date(NOW.getTime() - 365 * DAY),
          effectiveTo: new Date(NOW.getTime() + 20 * DAY),
          monthlyRecurringCents: 10_000,
          jobsCompletedThisPeriod: 0,
          jobsQuotaThisPeriod: null,
          outsourcedCostThisPeriodCents: 0,
        },
      ],
      NOW,
    );
    expect(result[0]?.renewalRisk).toBe("HIGH");
  });
});
