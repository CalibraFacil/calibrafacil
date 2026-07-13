import { describe, expect, it } from "vitest";

import { formatNumberForXlsx, fractionDigitsOf } from "./xlsx-number-format.js";

describe("fractionDigitsOf", () => {
  // Locale-independent, exact. The original bug: for 5e-7,
  // String(5e-7).split(".")[1] is undefined, so the old code used 1 decimal.
  it("counts fractional digits, correct for scientific notation", () => {
    expect(fractionDigitsOf(5e-7)).toBe(7);
    expect(fractionDigitsOf(1e-9)).toBe(9);
    expect(fractionDigitsOf(2)).toBe(0);
    expect(fractionDigitsOf(9999.99)).toBe(2);
    expect(fractionDigitsOf(1.000061)).toBe(6);
    expect(fractionDigitsOf(0.0110000000004)).toBe(13);
  });
});

describe("formatNumberForXlsx", () => {
  it("does not collapse sub-microgram scientific-notation values to 0,0", () => {
    const tiny = formatNumberForXlsx(5e-7);
    expect(tiny).not.toBe("0,0");
    expect(tiny).toMatch(/^0,\d{6}$/);
  });

  it("formats pt-BR values with derived or explicit decimals", () => {
    expect(formatNumberForXlsx(6e-7)).toBe("0,000001");
    expect(formatNumberForXlsx(9999.99)).toBe("9999,99");
    expect(formatNumberForXlsx(20000.46)).toBe("20000,46");
    expect(formatNumberForXlsx(1.000061)).toBe("1,000061");
    expect(formatNumberForXlsx(0.05)).toBe("0,05");
    expect(formatNumberForXlsx(2)).toBe("2");
    expect(formatNumberForXlsx(20000, 0)).toBe("20000");
  });
});
