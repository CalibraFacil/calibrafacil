import { describe, expect, it } from "vitest";

import { summarizeMarginByEntity } from "../margin-dashboards";

describe("summarizeMarginByEntity", () => {
  it("returns an empty list for empty input", () => {
    expect(summarizeMarginByEntity([])).toEqual([]);
  });

  it("computes margin per entity reusing summarizeServiceOrderMargin", () => {
    const result = summarizeMarginByEntity([
      {
        entityId: 1,
        entityName: "Cliente A",
        revenueCents: 100_000,
        outsourcedCosts: [
          { expectedCostCents: 30_000, actualCostCents: 35_000, voided: false },
        ],
        serviceOrderCount: 3,
      },
      {
        entityId: 2,
        entityName: "Cliente B",
        revenueCents: 50_000,
        outsourcedCosts: [],
        serviceOrderCount: 1,
      },
    ]);
    const a = result.find((r) => r.entityId === 1);
    const b = result.find((r) => r.entityId === 2);
    expect(a).toMatchObject({
      revenueCents: 100_000,
      outsourcedCostCents: 35_000,
      partsCostCents: 0,
      marginCents: 65_000,
      marginPercent: 65,
      serviceOrderCount: 3,
    });
    expect(b).toMatchObject({
      revenueCents: 50_000,
      outsourcedCostCents: 0,
      partsCostCents: 0,
      marginCents: 50_000,
      marginPercent: 100,
      serviceOrderCount: 1,
    });
  });

  it("subtracts parts COGS alongside outsourced costs per entity", () => {
    const result = summarizeMarginByEntity([
      {
        entityId: 1,
        entityName: "Cliente com peças",
        revenueCents: 100_000,
        outsourcedCosts: [
          { expectedCostCents: 20_000, actualCostCents: null, voided: false },
        ],
        partsCosts: [
          { quantity: 2, unitCostCents: 10_000 },
          { quantity: 1, unitCostCents: 5_000 },
        ],
        serviceOrderCount: 2,
      },
    ]);
    expect(result[0]).toMatchObject({
      outsourcedCostCents: 20_000,
      partsCostCents: 25_000,
      marginCents: 55_000,
      marginPercent: 55,
    });
  });

  it("sorts entities by margin cents descending", () => {
    const result = summarizeMarginByEntity([
      {
        entityId: 1,
        entityName: "Pequeno",
        revenueCents: 10_000,
        outsourcedCosts: [],
        serviceOrderCount: 1,
      },
      {
        entityId: 2,
        entityName: "Grande",
        revenueCents: 200_000,
        outsourcedCosts: [],
        serviceOrderCount: 5,
      },
      {
        entityId: 3,
        entityName: "Médio",
        revenueCents: 50_000,
        outsourcedCosts: [],
        serviceOrderCount: 2,
      },
    ]);
    expect(result.map((r) => r.entityId)).toEqual([2, 3, 1]);
  });

  it("includes negative-margin entities at the bottom of the sort", () => {
    const result = summarizeMarginByEntity([
      {
        entityId: 1,
        entityName: "Saudável",
        revenueCents: 100_000,
        outsourcedCosts: [],
        serviceOrderCount: 1,
      },
      {
        entityId: 2,
        entityName: "Custo > Receita",
        revenueCents: 50_000,
        outsourcedCosts: [
          { expectedCostCents: 0, actualCostCents: 90_000, voided: false },
        ],
        serviceOrderCount: 1,
      },
    ]);
    expect(result[0]?.entityId).toBe(1);
    expect(result[1]?.entityId).toBe(2);
    expect(result[1]?.marginCents).toBe(-40_000);
  });
});
