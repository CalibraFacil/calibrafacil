import { describe, expect, it } from "vitest";

import { SetCalibrationIntervalSchema } from "./index";

describe("SetCalibrationIntervalSchema", () => {
  // REQ-INTERVAL-010 + REQ-INTERVAL-011: a valid in-bounds payload parses.
  it("accepts an integer interval within [1, 120] with a rationale", () => {
    const result = SetCalibrationIntervalSchema.safeParse({
      intervalMonths: 12,
      rationale: "Histórico estável; estendido conforme ILAC-G24.",
    });
    expect(result.success).toBe(true);
  });

  // REQ-INTERVAL-010: lower bound.
  it("rejects an interval below 1 month", () => {
    expect(
      SetCalibrationIntervalSchema.safeParse({
        intervalMonths: 0,
        rationale: "x",
      }).success,
    ).toBe(false);
  });

  // REQ-INTERVAL-010: upper bound.
  it("rejects an interval above 120 months", () => {
    expect(
      SetCalibrationIntervalSchema.safeParse({
        intervalMonths: 121,
        rationale: "x",
      }).success,
    ).toBe(false);
  });

  // REQ-INTERVAL-010: integer-only (no fractional months).
  it("rejects a non-integer interval", () => {
    expect(
      SetCalibrationIntervalSchema.safeParse({
        intervalMonths: 12.5,
        rationale: "x",
      }).success,
    ).toBe(false);
  });

  // REQ-INTERVAL-011: rationale required (the §7.5 technical record).
  it("rejects a missing or whitespace-only rationale", () => {
    expect(
      SetCalibrationIntervalSchema.safeParse({ intervalMonths: 12 }).success,
    ).toBe(false);
    expect(
      SetCalibrationIntervalSchema.safeParse({
        intervalMonths: 12,
        rationale: "   ",
      }).success,
    ).toBe(false);
  });
});
