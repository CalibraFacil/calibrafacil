import { describe, expect, it } from "vitest";

import {
  formatAtDecimals,
  roundMeasurementForReport,
} from "./reporting-rounding.js";

/**
 * NIT-DICLA-021 Rev. 10 A.6.3 / ILAC-P14: U at no more than two significant
 * figures, and the measured value rounded to the decimal place of U's LAST
 * significant figure.
 *
 * These are conformance assertions, not formatting preferences. Each case
 * below is a way a certificate can be wrong while still looking plausible,
 * which is exactly how the lab-authored `formatter: "number:N"` strings failed.
 */
describe("roundMeasurementForReport", () => {
  it("rounds U to two significant figures and the value to U's last place", () => {
    // U = 0,00123 -> 0,0012 (2 s.f.), last figure in the 4th decimal, so the
    // value prints with 4 decimals and NOT with the 6 it arrived with.
    const result = roundMeasurementForReport(10.000123, 0.00123);
    expect(result).toEqual({
      value: "10,0001",
      uncertainty: "0,0012",
      decimals: 4,
    });
  });

  it("does not let the value out-precise its uncertainty", () => {
    // The failure mode the rule exists to prevent: a value quoted to five
    // decimals beside an uncertainty good to two.
    const result = roundMeasurementForReport(0.123456, 0.021);
    expect(result?.value).toBe("0,123");
    expect(result?.uncertainty).toBe("0,021");
  });

  it("rounds the value onto the tens grid when U is in the tens", () => {
    // U = 118 -> 120 (2 s.f.). The last significant figure is the TENS digit,
    // so 1234 must print as 1230, not as 1234. toFixed() cannot express this,
    // which is why the module does the arithmetic itself.
    const result = roundMeasurementForReport(1234, 118);
    expect(result).toEqual({ value: "1230", uncertainty: "120", decimals: 0 });
  });

  it("keeps a leading zero pair, not one significant figure", () => {
    // 0,00005 must not collapse to a single figure.
    const result = roundMeasurementForReport(1.000051, 0.00005);
    expect(result?.uncertainty).toBe("0,000050");
    expect(result?.decimals).toBe(6);
  });

  it("uses pt-BR decimal separators", () => {
    const result = roundMeasurementForReport(1.5, 0.25);
    expect(result?.value).toBe("1,50");
    expect(result?.uncertainty).toBe("0,25");
    expect(result?.value).not.toContain(".");
  });

  it("takes the magnitude of a negative uncertainty", () => {
    // An error term can be negative; an uncertainty cannot. If one arrives
    // signed, the sign must not drive log10 into NaN.
    const result = roundMeasurementForReport(-0.5, -0.012);
    expect(result?.uncertainty).toBe("0,012");
    expect(result?.value).toBe("-0,500");
  });

  it("reports no uncertainty rather than a fabricated zero", () => {
    // A row that genuinely carries no uncertainty must leave the cell empty.
    // Printing "0" would claim a perfect measurement.
    for (const missing of [
      null,
      undefined,
      0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const result = roundMeasurementForReport(2.5, missing);
      expect(result?.uncertainty, `for ${String(missing)}`).toBeNull();
    }
  });

  it("caps float dust when there is no uncertainty to set the place", () => {
    const result = roundMeasurementForReport(0.30000000000000004, null);
    expect(result?.value).toBe("0,3");
  });

  it("returns null when there is no value at all", () => {
    expect(roundMeasurementForReport(null, 0.01)).toBeNull();
    expect(roundMeasurementForReport(undefined, 0.01)).toBeNull();
    expect(roundMeasurementForReport(Number.NaN, 0.01)).toBeNull();
  });
});

describe("formatAtDecimals", () => {
  it("aligns a sibling column to the decided decimal place", () => {
    // The error column must not show more decimals than the uncertainty that
    // qualifies it — that reads as the error being the more precise number.
    expect(formatAtDecimals(-0.0004567, 4)).toBe("-0,0005");
    expect(formatAtDecimals(500, 4)).toBe("500,0000");
  });

  it("returns null for a missing value so the cell stays empty", () => {
    expect(formatAtDecimals(null, 2)).toBeNull();
    expect(formatAtDecimals(undefined, 2)).toBeNull();
    expect(formatAtDecimals(Number.NaN, 2)).toBeNull();
  });
});
