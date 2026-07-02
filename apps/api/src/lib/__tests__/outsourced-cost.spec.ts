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
      partsCostCents: 0,
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
      partsCostCents: 0,
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
      partsCostCents: 0,
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
      partsCostCents: 0,
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
      partsCostCents: 0,
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

  it("subtracts parts COGS (quantity × unit cost) from the margin", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 100_000,
        outsourcedCosts: [],
        partsCosts: [
          { quantity: 2, unitCostCents: 10_000 },
          { quantity: 1, unitCostCents: 5_000 },
        ],
      }),
    ).toEqual({
      revenueCents: 100_000,
      expectedCostCents: 0,
      actualCostCents: 0,
      outsourcedCostCents: 0,
      partsCostCents: 25_000,
      marginCents: 75_000,
      marginPercent: 75,
    });
  });

  it("combines parts COGS with outsourced costs", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 100_000,
        outsourcedCosts: [
          { expectedCostCents: 30_000, actualCostCents: null, voided: false },
        ],
        partsCosts: [{ quantity: 1, unitCostCents: 50_000 }],
      }),
    ).toEqual({
      revenueCents: 100_000,
      expectedCostCents: 30_000,
      actualCostCents: 0,
      outsourcedCostCents: 30_000,
      partsCostCents: 50_000,
      marginCents: 20_000,
      marginPercent: 20,
    });
  });

  it("rounds fractional quantities per part row", () => {
    expect(
      summarizeServiceOrderMargin({
        revenueCents: 10_000,
        outsourcedCosts: [],
        // 0.5 m of cable at R$ 3,33/m → 167 cents (rounded per row)
        partsCosts: [
          { quantity: 0.5, unitCostCents: 333 },
          { quantity: 0.5, unitCostCents: 333 },
        ],
      }).partsCostCents,
    ).toBe(334);
  });

  it("reports a negative margin when parts cost exceeds revenue", () => {
    const result = summarizeServiceOrderMargin({
      revenueCents: 20_000,
      outsourcedCosts: [],
      partsCosts: [{ quantity: 3, unitCostCents: 10_000 }],
    });
    expect(result.partsCostCents).toBe(30_000);
    expect(result.marginCents).toBe(-10_000);
    expect(result.marginPercent).toBe(-50);
  });
});
