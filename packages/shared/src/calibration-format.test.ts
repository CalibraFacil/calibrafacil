import { describe, expect, it } from "vitest";
import {
  formatCalibrationNumber,
  formatCalibrationValue,
  isPartialMeasurementInput,
  parseMeasurementInput,
  withDecimalComma,
} from "./calibration-format";

describe("measurement values in pt-BR (roadmap 2 F3, Q47)", () => {
  it("formats with the decimal comma by default; a point only when asked", () => {
    expect(formatCalibrationNumber(12.5)).toBe("12,5");
    expect(formatCalibrationNumber(-0.0031)).toBe("-0,0031");
    expect(formatCalibrationNumber(12.5, { decimalSeparator: "." })).toBe(
      "12.5",
    );
    expect(formatCalibrationValue([1.5, 2.25])).toBe("1,5; 2,25");
    expect(formatCalibrationValue([1.5, 2.25], { decimalSeparator: "." })).toBe(
      "1.5, 2.25",
    );
  });

  it("parses a typed reading with a comma or a point, never with grouping", () => {
    expect(parseMeasurementInput("1,5")).toBe(1.5);
    expect(parseMeasurementInput(" -0.25 ")).toBe(-0.25);
    expect(parseMeasurementInput(",5")).toBe(0.5);
    expect(parseMeasurementInput("1,5e-3")).toBe(0.0015);
    expect(parseMeasurementInput("1.234,5")).toBeNull();
    expect(parseMeasurementInput("1,2,3")).toBeNull();
    expect(parseMeasurementInput("")).toBeNull();
    expect(parseMeasurementInput("abc")).toBeNull();
  });

  it("accepts text that can still become a number while typing", () => {
    for (const partial of ["", "-", "1", "1,", "1.", "-0,0"]) {
      expect(isPartialMeasurementInput(partial)).toBe(true);
    }
    expect(isPartialMeasurementInput("1,2,")).toBe(false);
    expect(isPartialMeasurementInput("1a")).toBe(false);
  });

  it("puts the comma into a machine-formatted number", () => {
    expect(withDecimalComma("12.5")).toBe("12,5");
    expect(withDecimalComma("1e-7")).toBe("1e-7");
  });
});
