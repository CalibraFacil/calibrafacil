import { describe, expect, test } from "vitest";

import {
  checkMethodDimensions,
  type DimensionalDiagnostic,
} from "../src/dimensional";

function codes(diags: readonly DimensionalDiagnostic[]): string[] {
  return diags.map((d) => d.code);
}

describe("REQ-DIM-101 incompatible +/- combination", () => {
  test("massa[g] + tensao[V] yields a named mismatch identifying both dimensions", () => {
    const diags = checkMethodDimensions({
      fields: [
        { symbol: "massa", unit: "g" },
        { symbol: "tensao", unit: "V" },
      ],
      formulas: [{ id: "f1", expression: "massa + tensao" }],
    });

    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("DIMENSIONAL_MISMATCH");
    expect(diags[0].formulaId).toBe("f1");
    const dims = [diags[0].detail.left, diags[0].detail.right];
    // mass dimension M and voltage dimension M·L^2·T^-3·I^-1 both named.
    expect(dims).toContain("M");
    expect(dims).toContain("M·L^2·T^-3·I^-1");
  });

  test("subtraction is caught the same way", () => {
    const diags = checkMethodDimensions({
      fields: [
        { symbol: "massa", unit: "g" },
        { symbol: "tensao", unit: "V" },
      ],
      formulas: [{ id: "f1", expression: "massa - tensao" }],
    });
    expect(codes(diags)).toEqual(["DIMENSIONAL_MISMATCH"]);
  });

  test("commuted operands give the same verdict (property)", () => {
    const forward = checkMethodDimensions({
      fields: [
        { symbol: "massa", unit: "g" },
        { symbol: "tensao", unit: "V" },
      ],
      formulas: [{ id: "f", expression: "massa + tensao" }],
    });
    const reversed = checkMethodDimensions({
      fields: [
        { symbol: "massa", unit: "g" },
        { symbol: "tensao", unit: "V" },
      ],
      formulas: [{ id: "f", expression: "tensao + massa" }],
    });
    expect(codes(forward)).toEqual(codes(reversed));
    expect(forward).toHaveLength(1);
  });

  test("compatible +/- (same dimension via a prefixed unit) passes", () => {
    const diags = checkMethodDimensions({
      fields: [
        { symbol: "m1", unit: "g" },
        { symbol: "m2", unit: "kg" },
      ],
      formulas: [{ id: "f", expression: "m1 + m2", resultUnit: "g" }],
    });
    expect(diags).toEqual([]);
  });
});

describe("REQ-DIM-103 sqrt / pow", () => {
  test("sqrt(u1^2 + u2^2) with same-unit u's passes and result is that unit", () => {
    const diags = checkMethodDimensions({
      fields: [
        { symbol: "u1", unit: "g" },
        { symbol: "u2", unit: "g" },
      ],
      formulas: [
        { id: "rss", expression: "sqrt(u1 ^ 2 + u2 ^ 2)", resultUnit: "g" },
      ],
    });
    expect(diags).toEqual([]);
  });

  test("sqrt(u1^2 + u2^2) declared as a WRONG unit is a result-unit mismatch", () => {
    const diags = checkMethodDimensions({
      fields: [
        { symbol: "u1", unit: "g" },
        { symbol: "u2", unit: "g" },
      ],
      formulas: [
        { id: "rss", expression: "sqrt(u1 ^ 2 + u2 ^ 2)", resultUnit: "V" },
      ],
    });
    expect(codes(diags)).toEqual(["DIMENSIONAL_RESULT_UNIT"]);
  });

  test("x[g] ^ y where y is a variable produces an exponent diagnostic", () => {
    const diags = checkMethodDimensions({
      fields: [{ symbol: "x", unit: "g" }, { symbol: "y" }],
      formulas: [{ id: "p", expression: "x ^ y" }],
    });
    expect(codes(diags)).toEqual(["DIMENSIONAL_EXPONENT"]);
  });

  test("x[g] ^ 2 (literal exponent on dimensional base) passes; result is g^2", () => {
    const noUnit = checkMethodDimensions({
      fields: [{ symbol: "x", unit: "g" }],
      formulas: [{ id: "p", expression: "x ^ 2" }],
    });
    expect(noUnit).toEqual([]);
    // Declaring the coherent squared unit also passes.
    const squared = checkMethodDimensions({
      fields: [{ symbol: "x", unit: "g" }],
      formulas: [{ id: "p", expression: "x ^ 2", resultUnit: "g^2" }],
    });
    expect(squared).toEqual([]);
  });
});

describe("REQ-DIM-104 transcendental arguments", () => {
  test("exp(t[°C]) with a bare dimensional argument is flagged", () => {
    const diags = checkMethodDimensions({
      fields: [{ symbol: "t", unit: "°C" }],
      formulas: [{ id: "e", expression: "exp(t)" }],
    });
    expect(codes(diags)).toEqual(["DIMENSIONAL_TRANSCENDENTAL_ARGUMENT"]);
  });

  test("the Magnus exp (ratio form) is NOT flagged", () => {
    const diags = checkMethodDimensions({
      fields: [{ symbol: "t", unit: "°C" }],
      formulas: [
        {
          id: "ew",
          expression: "6.112 * exp(17.62 * t / (243.12 + t))",
          resultUnit: "hPa",
        },
      ],
    });
    expect(diags).toEqual([]);
  });

  test("log/sin with dimensional arguments are flagged too", () => {
    const diags = checkMethodDimensions({
      fields: [{ symbol: "p", unit: "kPa" }],
      formulas: [{ id: "l", expression: "log(p) + sin(p)" }],
    });
    expect(codes(diags)).toEqual([
      "DIMENSIONAL_TRANSCENDENTAL_ARGUMENT",
      "DIMENSIONAL_TRANSCENDENTAL_ARGUMENT",
    ]);
  });
});

describe("REQ-DIM-105 soundness — unknown/missing units never self-flag", () => {
  test("two gibberish units unify freely", () => {
    const diags = checkMethodDimensions({
      fields: [
        { symbol: "a", unit: "zzz" },
        { symbol: "b", unit: "qqq" },
      ],
      formulas: [{ id: "g", expression: "a + b" }],
    });
    expect(diags).toEqual([]);
  });

  test("one known + one unknown unit unifies (single wildcard solves)", () => {
    const diags = checkMethodDimensions({
      fields: [
        { symbol: "m", unit: "g" },
        { symbol: "b", unit: "qqq" },
      ],
      formulas: [{ id: "g2", expression: "m + b", resultUnit: "g" }],
    });
    expect(diags).toEqual([]);
  });

  test("no units at all → no diagnostics", () => {
    const diags = checkMethodDimensions({
      fields: [{ symbol: "a" }, { symbol: "b" }],
      formulas: [{ id: "g3", expression: "a + b + a * b / a" }],
    });
    expect(diags).toEqual([]);
  });

  test("a dimension-bearing constant added to a variable never flags", () => {
    const diags = checkMethodDimensions({
      fields: [{ symbol: "t", unit: "°C" }],
      formulas: [{ id: "g4", expression: "243.12 + t", resultUnit: "°C" }],
    });
    expect(diags).toEqual([]);
  });
});

describe("formula chaining", () => {
  test("an earlier formula's result unit flows into a later formula", () => {
    const diags = checkMethodDimensions({
      fields: [
        { symbol: "t", unit: "°C" },
        { symbol: "td", unit: "°C" },
      ],
      formulas: [
        {
          id: "es_t",
          expression: "6.112 * exp(17.62 * t / (243.12 + t))",
          resultUnit: "hPa",
        },
        {
          id: "es_td",
          expression: "6.112 * exp(17.62 * td / (243.12 + td))",
          resultUnit: "hPa",
        },
        {
          id: "ur",
          expression: "100 * es_td / es_t",
          resultUnit: "%RH",
        },
      ],
    });
    expect(diags).toEqual([]);
  });
});
