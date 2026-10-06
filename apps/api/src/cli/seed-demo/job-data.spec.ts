import { describe, expect, it } from "vitest";

import {
  buildExecutionData,
  decimalsOf,
  e2MpeMg,
  hasExactStandardDeviation,
  roundTo,
  weighingLoads,
  withSpread,
} from "./job-data";
import { createRng } from "./prng";

describe("number helpers", () => {
  it("counts the decimals of a resolution", () => {
    expect(decimalsOf(0.0001)).toBe(4);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(1)).toBe(0);
  });

  it("rounds to the resolution without float noise", () => {
    expect(roundTo(100.00064, 0.0001)).toBe(100.0006);
    expect(roundTo(12.34, 0.5)).toBe(12.5);
  });
});

describe("physics helpers", () => {
  it("interpolates the E2 tolerance table", () => {
    expect(e2MpeMg(100)).toBeCloseTo(0.16, 6);
    const between = e2MpeMg(150);
    expect(between).toBeGreaterThan(0.16);
    expect(between).toBeLessThan(0.3);
  });

  it("picks the five largest ladder loads below the capacity", () => {
    expect(weighingLoads(220)).toEqual([10, 20, 50, 100, 200]);
    expect(weighingLoads(30000)).toEqual([1000, 2000, 5000, 10000, 20000]);
  });
});

describe("withSpread", () => {
  it("breaks up identical readings", () => {
    const result = withSpread([20, 20, 20, 20, 20], 0.001);
    expect(new Set(result).size).toBeGreaterThan(1);
  });

  it("removes exact standard deviations and keeps already-irrational ones", () => {
    // 200, 200.0002 x2, 200.0001, 200: s is exactly 0.0001.
    expect(
      hasExactStandardDeviation(
        [200, 200.0002, 200.0002, 200.0001, 200],
        0.0001,
      ),
    ).toBe(true);
    const fixed = withSpread([200, 200.0002, 200.0002, 200.0001, 200], 0.0001);
    expect(hasExactStandardDeviation(fixed, 0.0001)).toBe(false);
    const fine = [10, 10, 10, 10, 10.0001];
    expect(withSpread(fine, 0.0001)).toEqual(fine);
  });
});

describe("buildExecutionData", () => {
  it("is reproducible for the same generator state", () => {
    const specs = { capacity: 220, resolution: 0.0001 };
    expect(
      buildExecutionData("weighing-instrument", specs, createRng(5)),
    ).toEqual(buildExecutionData("weighing-instrument", specs, createRng(5)));
  });

  it("never produces a worksheet row with identical repeatability readings", () => {
    const rng = createRng(31);
    for (let i = 0; i < 40; i += 1) {
      const { data } = buildExecutionData(
        "weighing-instrument",
        { capacity: 30000, resolution: 1 },
        rng,
      );
      const rows = data.pontos_pesagem;
      if (!Array.isArray(rows)) throw new Error("rows missing");
      for (const row of rows) {
        const readings = [
          row.rep_1,
          row.rep_2,
          row.rep_3,
          row.rep_4,
          row.rep_5,
        ];
        expect(hasExactStandardDeviation(readings, 1)).toBe(false);
      }
    }
  });

  it("fills every column of the weighing worksheet", () => {
    const { data, standardKeys } = buildExecutionData(
      "weighing-instrument",
      { capacity: 620, resolution: 0.001 },
      createRng(9),
    );
    const rows = data.pontos_pesagem;
    expect(Array.isArray(rows)).toBe(true);
    if (!Array.isArray(rows)) return;
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(Object.values(row).every((value) => Number.isFinite(value))).toBe(
        true,
      );
    }
    expect(standardKeys).toEqual(["pesos-e2"]);
  });

  it("covers every method the demo adopts", () => {
    for (const key of [
      "weighing-instrument",
      "electrical-indication",
      "force-indication",
      "frequency-indication",
    ] as const) {
      const { data, standardKeys } = buildExecutionData(key, {}, createRng(2));
      expect(Object.keys(data)).toHaveLength(1);
      expect(standardKeys.length).toBeGreaterThan(0);
    }
  });
});
