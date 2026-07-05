import { describe, expect, it } from "vitest";

import { MEASUREMENT_UNITS } from "./registry";
import {
  DIMENSIONLESS,
  KIND_DIMENSIONS,
  dimension,
  dimensionForRegistryUnit,
  dimensionsEqual,
  isDimensionless,
  rational,
} from "./dimensions";
import { parseUnitExpression } from "./unit-expression";

function dimOf(input: string) {
  const result = parseUnitExpression(input);
  if (!result.ok) {
    throw new Error(`expected "${input}" to parse, got: ${result.reason}`);
  }
  return result.dimension;
}

describe("Unit-expression parser (REQ-DIM-003)", () => {
  it("resolves the required real-world composite units", () => {
    expect(dimensionsEqual(dimOf("hPa"), KIND_DIMENSIONS.pressure)).toBe(true);
    expect(dimensionsEqual(dimOf("N·m"), KIND_DIMENSIONS.torque)).toBe(true);
    expect(
      dimensionsEqual(
        dimOf("m/s²"),
        dimension({ L: rational(1), T: rational(-2) }),
      ),
    ).toBe(true);
    // µm/(m·K) → L/(L·Θ) = Θ⁻¹  (linear thermal-expansion coefficient)
    expect(
      dimensionsEqual(dimOf("µm/(m·K)"), dimension({ "Θ": rational(-1) })),
    ).toBe(true);
    expect(dimensionsEqual(dimOf("kgf/cm²"), KIND_DIMENSIONS.pressure)).toBe(
      true,
    );
  });

  it("treats %, ppm and the literal \"1\" as dimensionless (parsed, not unknown)", () => {
    for (const token of ["%", "1", "ppm", "ppb"]) {
      const result = parseUnitExpression(token);
      expect(result.ok, token).toBe(true);
      if (result.ok) {
        expect(isDimensionless(result.dimension)).toBe(true);
      }
    }
  });

  it("resolves a ratio of equal dimensions to dimensionless (mV/V)", () => {
    const result = parseUnitExpression("mV/V");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isDimensionless(result.dimension)).toBe(true);
    }
  });

  it("returns unknown (not a wrong guess) for gibberish, never throwing", () => {
    for (const junk of ["blorp", "xyzzy", "widgets", "??", "kg/"]) {
      const result = parseUnitExpression(junk);
      expect(result.ok, junk).toBe(false);
    }
  });

  it("distinguishes parsed-dimensionless from unknown", () => {
    const percent = parseUnitExpression("%");
    const junk = parseUnitExpression("blorp");
    expect(percent.ok).toBe(true);
    expect(junk.ok).toBe(false);
  });

  it("accepts several separator spellings for multiplication", () => {
    const torque = KIND_DIMENSIONS.torque;
    for (const spelling of ["N·m", "N*m", "N.m", "N m"]) {
      expect(dimensionsEqual(dimOf(spelling), torque), spelling).toBe(true);
    }
  });
});

describe("Prefix ambiguity rule (REQ-DIM-003)", () => {
  it("reads a prefixed single token as prefix+atom: mN = millinewton (force)", () => {
    expect(dimensionsEqual(dimOf("mN"), KIND_DIMENSIONS.force)).toBe(true);
    expect(dimensionsEqual(dimOf("mV"), KIND_DIMENSIONS.voltage)).toBe(true);
  });

  it("reads a separated token as a product: m·N = metre·newton (≠ millinewton)", () => {
    const product = dimOf("m·N");
    expect(dimensionsEqual(product, KIND_DIMENSIONS.force)).toBe(false);
    expect(
      dimensionsEqual(
        product,
        dimension({ M: rational(1), L: rational(2), T: rational(-2) }),
      ),
    ).toBe(true);
  });
});

describe("Derived-unit coherence (REQ-DIM-004)", () => {
  it("identifies N/m² ≡ Pa ≡ hPa", () => {
    const pa = dimOf("Pa");
    expect(dimensionsEqual(dimOf("N/m²"), pa)).toBe(true);
    expect(dimensionsEqual(dimOf("hPa"), pa)).toBe(true);
    expect(dimensionsEqual(pa, KIND_DIMENSIONS.pressure)).toBe(true);
  });

  it("identifies V/A ≡ Ω", () => {
    expect(dimensionsEqual(dimOf("V/A"), dimOf("Ω"))).toBe(true);
    expect(dimensionsEqual(dimOf("V/A"), KIND_DIMENSIONS.resistance)).toBe(true);
  });
});

describe("Parser ⊇ registry (REQ-DIM-002 / REQ-DIM-003)", () => {
  it("parses every registry token to the same dimension the mapping gives", () => {
    for (const unit of MEASUREMENT_UNITS) {
      const expected = dimensionForRegistryUnit(unit);
      expect(expected, unit).not.toBeNull();
      const result = parseUnitExpression(unit);
      expect(result.ok, `parse failed for ${unit}`).toBe(true);
      if (result.ok && expected) {
        expect(
          dimensionsEqual(result.dimension, expected),
          `${unit} → ${JSON.stringify(result.dimension)}`,
        ).toBe(true);
      }
    }
  });

  it("empty / whitespace input is unknown, not dimensionless", () => {
    expect(parseUnitExpression("").ok).toBe(false);
    expect(parseUnitExpression("   ").ok).toBe(false);
    // sanity: DIMENSIONLESS is the zero vector, reachable only via a real token
    expect(isDimensionless(DIMENSIONLESS)).toBe(true);
  });
});
