import { describe, expect, it } from "vitest";

import {
  formatDegreesOfFreedom,
  formatPercent,
  formatQuantity,
  formatSignificant,
} from "./format";

describe("formatSignificant", () => {
  it("renders two significant figures with a pt-BR comma", () => {
    expect(formatSignificant(0.00316228)).toBe("0,0032");
  });

  it("keeps trailing zeros that carry significance", () => {
    expect(formatSignificant(0.2)).toBe("0,20");
  });

  it("falls back to scientific notation below a ten-thousandth", () => {
    expect(formatSignificant(0.0000316)).toBe("3,2 × 10^-5");
  });

  it("returns a dash for a non-finite value", () => {
    expect(formatSignificant(Number.NaN)).toBe("—");
  });
});

describe("formatDegreesOfFreedom", () => {
  it("renders an infinite dof as the infinity sign", () => {
    expect(formatDegreesOfFreedom(Number.POSITIVE_INFINITY)).toBe("∞");
  });

  it("rounds a finite dof to one decimal", () => {
    expect(formatDegreesOfFreedom(75.111)).toBe("75,1");
  });
});

describe("formatQuantity", () => {
  it("renders a mean without forcing significant digits", () => {
    expect(formatQuantity(100.02)).toBe("100,02");
  });
});

describe("formatPercent", () => {
  it("renders one decimal and a unit space", () => {
    expect(formatPercent(76.9)).toBe("76,9 %");
  });
});
