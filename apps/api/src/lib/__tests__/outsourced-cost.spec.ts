import { describe, expect, it } from "vitest";

import { summarizeServiceOrderMargin } from "../outsourced-cost";

describe("summarizeServiceOrderMargin", () => {
  it("returns zero costs and revenue when there are no outsourced rows", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 0,
        outsourcedCosts: [],
      }),
    ).toEqual({
      revenueCents: 0,
      expectedCostCents: 0,
      actualCostCents: 0,
      outsourcedCostCents: 0,
      marginCents: 0,
      marginPercent: null,
    });
  });

  it("uses expected cost when actual is not yet reconciled", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 100_000,
        outsourcedCosts: [
          { expectedCostCents: 30_000, actualCostCents: null, voided: false },
        ],
      }),
    ).toEqual({
      revenueCents: 100_000,
      expectedCostCents: 30_000,
      actualCostCents: 0,
      outsourcedCostCents: 30_000,
      marginCents: 70_000,
      marginPercent: 70,
    });
  });

  it("prefers actual cost over expected when reconciled", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 100_000,
        outsourcedCosts: [
          { expectedCostCents: 30_000, actualCostCents: 35_000, voided: false },
        ],
      }),
    ).toEqual({
      revenueCents: 100_000,
      expectedCostCents: 30_000,
      actualCostCents: 35_000,
      outsourcedCostCents: 35_000,
      marginCents: 65_000,
      marginPercent: 65,
    });
  });

  it("excludes voided rows entirely", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 100_000,
        outsourcedCosts: [
          { expectedCostCents: 30_000, actualCostCents: 35_000, voided: true },
          { expectedCostCents: 20_000, actualCostCents: null, voided: false },
        ],
      }),
    ).toEqual({
      revenueCents: 100_000,
      expectedCostCents: 20_000,
      actualCostCents: 0,
      outsourcedCostCents: 20_000,
      marginCents: 80_000,
      marginPercent: 80,
    });
  });

  it("computes a negative margin when costs exceed revenue", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 50_000,
        outsourcedCosts: [
          { expectedCostCents: 0, actualCostCents: 75_000, voided: false },
        ],
      }),
    ).toEqual({
      revenueCents: 50_000,
      expectedCostCents: 0,
      actualCostCents: 75_000,
      outsourcedCostCents: 75_000,
      marginCents: -25_000,
      marginPercent: -50,
    });
  });

  it("returns null marginPercent when revenue is zero", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 0,
        outsourcedCosts: [
          { expectedCostCents: 1_000, actualCostCents: null, voided: false },
        ],
      }).marginPercent,
    ).toBeNull();
  });
});
