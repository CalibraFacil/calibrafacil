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
      "force",
      "voltage",
      "current",
      "resistance",
      "frequency",
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
    expect(unitsForKind("volume")).toEqual(["µL", "mL", "L", "m³"]);
    expect(unitsForKind("force")).toEqual(["N", "kN", "kgf"]);
    expect(unitsForKind("voltage")).toEqual(["µV", "mV", "V", "kV"]);
    expect(unitsForKind("current")).toEqual(["µA", "mA", "A"]);
    expect(unitsForKind("resistance")).toEqual(["Ω", "kΩ", "MΩ"]);
    expect(unitsForKind("frequency")).toEqual(["Hz", "kHz", "MHz", "rpm"]);
    for (const unit of unitsForKind("pressure")) {
      expect(isUnitOfKind(unit, "pressure")).toBe(true);
    }
  });

  it("keeps electrical dimensions separate (volt/ampere/ohm never convert)", () => {
    expect(unitKind("V")).toBe("voltage");
    expect(unitKind("A")).toBe("current");
    expect(unitKind("Ω")).toBe("resistance");
    // Cross-dimension conversions must fail — a single "electrical" kind would
    // have let these silently succeed by factor ratio.
    expect(convertUnitValue(1, "V", "A")).toBeNull();
    expect(convertUnitValue(1, "A", "Ω")).toBeNull();
    expect(convertUnitValue(1, "Ω", "V")).toBeNull();
  });
});

describe("convertUnitValue / Delta round-trips", () => {
  const roundTripCases: Array<[string, string, number]> = [
    ["mg", "kg", 1234.5],
    ["µm", "m", 9.87],
    ["bar", "psi", 3.2],
    ["mL", "L", 250],
    ["m³", "L", 1.5],
    ["min", "h", 90],
    ["kgf·m", "N·m", 4.4],
    ["kgf", "N", 5],
    ["mV", "kV", 1234.5],
    ["mA", "A", 250],
    ["kΩ", "MΩ", 47],
    ["rpm", "Hz", 3000],
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
    ["m³", "m³"], // U+00B3 superscript three
    ["m3", "m³"],
    ["M3", "m³"],
    ["m^3", "m³"],
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
    ["N", "N"],
    ["kgf", "kgf"],
    ["newton", "N"],
    ["KN", "kN"],
    ["mV", "mV"],
    ["volt", "V"],
    ["a", "A"],
    ["amp", "A"],
    ["ohm", "Ω"],
    ["Ω", "Ω"],
    ["kΩ", "kΩ"],
    ["MΩ", "MΩ"],
    ["megohm", "MΩ"],
    ["hz", "Hz"],
    ["RPM", "rpm"],
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
      ["N", "N"], // dinamômetro (U+0020 plain N)
      ["V", "V"], // multímetro tensão
      ["A", "A"], // multímetro corrente
      ["MΩ", "MΩ"], // multímetro resistência (M = U+004D, Ω = U+03A9)
      ["rpm", "rpm"], // tacômetro
      ["mmHg", "mmHg"], // esfigmomanômetro
      ["m³", "m³"], // hidrômetro / medidor de gás (³ = U+00B3)
      ["L", "L"], // hidrômetro resolução
      ["mL", "mL"], // vidraria volumétrica
      ["m", "m"], // trena
      ["kN", "kN"], // prensa hidráulica
    ];
    for (const [token, expected] of seedTokens) {
      expect(normalizeUnitToken(token)).toBe(expected);
    }
  });
});
