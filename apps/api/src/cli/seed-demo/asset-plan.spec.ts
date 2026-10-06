import { describe, expect, it } from "vitest";

import { ASSET_COUNTS, buildAssetPlan } from "./asset-plan";
import { DEMO_CUSTOMERS } from "./customers";
import { createRng } from "./prng";

describe("buildAssetPlan", () => {
  const plan = buildAssetPlan(createRng("test-plan"));

  it("builds the configured number of instruments per type", () => {
    const total = Object.values(ASSET_COUNTS).reduce((sum, n) => sum + n, 0);
    expect(plan).toHaveLength(total);
    expect(plan.filter((a) => a.typeSlug === "balanca-digital")).toHaveLength(
      ASSET_COUNTS["balanca-digital"],
    );
  });

  it("never repeats a tag (they are unique per laboratory)", () => {
    expect(new Set(plan.map((a) => a.tag)).size).toBe(plan.length);
  });

  it("only assigns known customers", () => {
    const codes = new Set(DEMO_CUSTOMERS.map((c) => c.code));
    expect(plan.every((a) => codes.has(a.customerCode))).toBe(true);
  });

  it("is reproducible for the same seed", () => {
    expect(buildAssetPlan(createRng("test-plan"))).toEqual(plan);
  });

  it("gives every balance a capacity and a resolution", () => {
    for (const balance of plan.filter(
      (a) => a.typeSlug === "balanca-digital",
    )) {
      expect(balance.specifications.capacity).toBeGreaterThan(0);
      expect(balance.specifications.resolution).toBeGreaterThan(0);
      expect(balance.baseMeasurementUnit).toBe("g");
    }
  });

  it("keeps a few instruments out of service", () => {
    expect(plan.filter((a) => a.status !== "ACTIVE")).toHaveLength(3);
  });

  it("keeps machine-shop instruments off the clinical laboratory", () => {
    expect(
      plan.filter(
        (a) => a.customerCode === "LES" && a.typeSlug === "micrometro",
      ),
    ).toHaveLength(0);
  });
});
