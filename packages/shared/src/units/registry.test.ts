import { describe, expect, it } from "vitest";

import {
  type QuantityKind,
  CANONICAL_BY_KIND,
  MEASUREMENT_UNITS,
  canonicalUnitFor,
  isMeasurementUnit,
  isUnitOfKind,
  unitKind,
  unitsForKind,
} from "./registry";
import {
  convertUnitDelta,
  convertUnitValue,
  decimalsForResolution,
  fromCanonicalValue,
  toCanonicalValue,
} from "./convert";
import { normalizeUnitToken } from "./registry";

describe("registry membership", () => {
  it("recognizes every canonical unit", () => {
    for (const unit of MEASUREMENT_UNITS) {
      expect(isMeasurementUnit(unit)).toBe(true);
      expect(unitKind(unit)).not.toBeNull();
    }
  });

  it("canonical unit belongs to its own kind", () => {
    const kinds: QuantityKind[] = [
      "mass",
      "length",
      "temperature",
      "pressure",
      "volume",
      "time",
      "torque",
      "humidity",
    ];
    for (const kind of kinds) {
      const canonical = canonicalUnitFor(kind);
      expect(unitKind(canonical)).toBe(kind);
      expect(CANONICAL_BY_KIND[kind]).toBe(canonical);
      expect(convertUnitValue(1, canonical, canonical)).toBe(1);
    }
  });

  it("unitsForKind only returns same-kind units", () => {
    expect(unitsForKind("mass")).toEqual(["mg", "g", "kg"]);
    expect(unitsForKind("humidity")).toEqual(["%RH"]);
    expect(unitsForKind("length")).toEqual(["µm", "mm", "cm", "m"]);
    for (const unit of unitsForKind("pressure")) {
      expect(isUnitOfKind(unit, "pressure")).toBe(true);
    }
  });
});

describe("convertUnitValue / Delta round-trips", () => {
  const roundTripCases: Array<[string, string, number]> = [
    ["mg", "kg", 1234.5],
    ["µm", "m", 9.87],
    ["bar", "psi", 3.2],
    ["mL", "L", 250],
    ["min", "h", 90],
    ["kgf·m", "N·m", 4.4],
  ];

  it("is reversible within a kind", () => {
    for (const [from, to, value] of roundTripCases) {
      const forward = convertUnitValue(value, from, to);
      expect(forward).not.toBeNull();
      const back = convertUnitValue(forward ?? 0, to, from);
      expect(back).toBeCloseTo(value, 9);
    }
  });

  it("returns null across kinds and for unknown tokens", () => {
    expect(convertUnitValue(1, "g", "mm")).toBeNull();
    expect(convertUnitValue(1, "°C", "kPa")).toBeNull();
    expect(convertUnitValue(1, "g", "furlong")).toBeNull();
    expect(convertUnitDelta(1, "g", "mm")).toBeNull();
  });
});

describe("affine temperature", () => {
  it("converts absolute values with offsets", () => {
    expect(convertUnitValue(25, "°C", "°F")).toBeCloseTo(77, 9);
    expect(convertUnitValue(0, "°C", "K")).toBeCloseTo(273.15, 9);
    expect(convertUnitValue(77, "°F", "°C")).toBeCloseTo(25, 9);
    expect(toCanonicalValue(273.15, "K")).toBeCloseTo(0, 9);
    expect(fromCanonicalValue(0, "K")).toBeCloseTo(273.15, 9);
  });

  it("converts deltas factor-only (no offset)", () => {
    // 0.1 °C resolution is 0.18 °F, never 32.18 °F.
    expect(convertUnitDelta(0.1, "°C", "°F")).toBeCloseTo(0.18, 9);
    expect(convertUnitDelta(1, "K", "°C")).toBeCloseTo(1, 9);
  });

  it("caps display decimals from a delta-converted resolution", () => {
    // 0.1 °C shown in °F -> 0.18 -> 2 decimals.
    expect(decimalsForResolution(0.1, "°C", "°F")).toBe(2);
    expect(decimalsForResolution(0.1, "°C", "°C")).toBe(1);
    expect(decimalsForResolution(0.5)).toBe(1);
    expect(decimalsForResolution(0)).toBeNull();
  });
});

describe("normalizeUnitToken pitfalls", () => {
  const cases: Array<[string, string | null]> = [
    ["KG", "kg"],
    ["Kg", "kg"],
    ["g ", "g"],
    ["um", "µm"],
    ["uL", "µL"],
    ["ml", "mL"],
    ["ºC", "°C"], // U+00BA masculine ordinal
    ["°C", "°C"], // U+00B0 degree sign
    ["C", "°C"],
    ["celsius", "°C"],
    ["F", "°F"],
    ["K", "K"],
    ["kelvin", "K"],
    ["kgf/cm2", "kgf/cm²"],
    ["kgf/cm^2", "kgf/cm²"],
    ["N.m", "N·m"],
    ["Nm", "N·m"],
    ["%UR", "%RH"],
    ["%RH", "%RH"],
    ["%", null], // bare percent must stay kind-less
    ["µm/(m·K)", null], // composite bloco-padrão token
    ["", null],
    ["nonsense", null],
  ];

  it.each(cases)("normalizes %s -> %s", (input, expected) => {
    expect(normalizeUnitToken(input)).toBe(expected);
  });

  it("bare percent and composite tokens have no kind", () => {
    expect(unitKind("%")).toBeNull();
    expect(unitKind("µm/(m·K)")).toBeNull();
  });

  it("accepts every token used by the asset-type seeds verbatim", () => {
    // Codepoints matter: N·m uses U+00B7, °C uses U+00B0, µ uses U+00B5,
    // kgf/cm² uses U+00B2. µm/(m·K) is deliberately kind-less.
    const seedTokens: Array<[string, string | null]> = [
      ["mm", "mm"],
      ["bar", "bar"],
      ["N·m", "N·m"],
      ["°C", "°C"],
      ["s", "s"],
      ["g", "g"],
      ["µL", "µL"],
      ["%RH", "%RH"],
      ["kgf/cm²", "kgf/cm²"],
      ["µm/(m·K)", null],
    ];
    for (const [token, expected] of seedTokens) {
      expect(normalizeUnitToken(token)).toBe(expected);
    }
  });
});
