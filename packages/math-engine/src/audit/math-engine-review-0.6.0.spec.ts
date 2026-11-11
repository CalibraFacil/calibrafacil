/**
 * Regressions for the second batch of the review of 2026-11-11 (engine 0.6.0):
 * the items the 0.5.0 release left open. Each case failed on 0.5.0.
 */

import { describe, expect, it } from "vitest";
import { createCalculationEngine } from "../engine/create.js";
import { normalizeEngineOptions } from "../engine/options.js";
import { ERROR_CODES } from "../errors/codes.js";
import { numericalDerivative, symbolicDerivative } from "../formula/derivative.js";
import { DecimalBackend, NumberBackend } from "../numeric/backend.js";
import { numberInputText } from "../numeric/validation.js";
import { mergeFormulaLimits, DEFAULT_FORMULA_LIMITS } from "../parser/options.js";
import { parseFormula } from "../parser/parser.js";
import { normalizeNumericValidationOptions } from "../uncertainty/type-a.js";
import { canonicalJson } from "./canonical-json.js";
import { resolveCurrentDossierDir } from "./engine-dossier-gate.js";

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("formula limits", () => {
  const engine = createCalculationEngine();

  it("a plain sum goes as far as the node limit lets it (0.5.0: 65 terms were too deep, with 129 of 512 nodes)", () => {
    const sum = (terms: number): string => Array.from({ length: terms }, () => "a").join(" + ");
    expect(engine.evaluateFormula(sum(65), { a: 1 }).valueText).toBe("65");
    // 256 terms are 511 nodes in a tree 256 deep: both default limits end here.
    expect(engine.evaluateFormula(sum(256), { a: 1 }).valueText).toBe("256");
    expect([ERROR_CODES.AST_TOO_LARGE, ERROR_CODES.AST_TOO_DEEP]).toContain(errorCode(() => engine.compileFormula(sum(257))));
  });

  it("the deepest tree the options allow is evaluated, not a stack overflow (0.5.0: RangeError from about 1500 of the 10000 allowed)", () => {
    const deep = createCalculationEngine({ maxAstDepth: 500, maxAstNodes: 5000, maxExpressionLength: 20000 });
    const depth = 498;
    expect(deep.evaluateFormula(`${"(".repeat(depth)}a${")".repeat(depth)}`, { a: 2 }).valueText).toBe("2");
    expect(deep.evaluateFormula(`${"-".repeat(depth)}a`, { a: 2 }).valueText).toBe("2");
    expect(deep.evaluateFormula(Array.from({ length: depth }, () => "a").join(" + "), { a: 1 }).valueText).toBe(String(depth));
    expect(deep.evaluateFormula(Array.from({ length: depth }, () => "a").join(" ^ "), { a: 1 }).valueText).toBe("1");
    expect(errorCode(() => createCalculationEngine({ maxAstDepth: 501 }))).toBe(ERROR_CODES.INVALID_OPTIONS);
  });

  it("a signed literal exponent is checked when the formula is compiled (0.5.0: x^-13 compiled and failed at every evaluation)", () => {
    expect(errorCode(() => engine.compileFormula("x ^ 13"))).toBe(ERROR_CODES.EXPONENT_TOO_LARGE);
    expect(errorCode(() => engine.compileFormula("x ^ -13"))).toBe(ERROR_CODES.EXPONENT_TOO_LARGE);
    expect(errorCode(() => engine.compileFormula("x ^ - + 13"))).toBe(ERROR_CODES.EXPONENT_TOO_LARGE);
    expect(engine.evaluateFormula("x ^ -12", { x: 10 }).valueText).toBe("0.000000000001");
  });

  it("mergeFormulaLimits keeps maxSignificantDigits, and parseFormula applies it (0.5.0: dropped)", () => {
    expect(mergeFormulaLimits({ maxSignificantDigits: 5 }).maxSignificantDigits).toBe(5);
    expect(mergeFormulaLimits()).toStrictEqual(DEFAULT_FORMULA_LIMITS);
    expect(errorCode(() => parseFormula("1.23456 * x", mergeFormulaLimits({ maxSignificantDigits: 5 })))).toBe(ERROR_CODES.INVALID_NUMERIC_INPUT);
    expect(() => parseFormula("1.2345 * x", mergeFormulaLimits({ maxSignificantDigits: 5 }))).not.toThrow();
  });
});

describe("options", () => {
  it("evaluateFormula takes compile and evaluation options for a string and for a compiled formula (0.5.0: one kind each)", () => {
    const engine = createCalculationEngine();
    expect(errorCode(() => engine.evaluateFormula("a + 1", { a: 1, b: 2 }, { rejectUnusedInputs: true }))).toBe(ERROR_CODES.UNKNOWN_IDENTIFIER);
    expect(engine.evaluateFormula("a + 1", { a: 1, b: 2 }, { rejectUnusedInputs: false }).valueText).toBe("2");
    expect(engine.evaluateFormula("a + 1", { a: 1 }, { allowedVariables: ["a"], rejectUnusedInputs: true }).valueText).toBe("2");
    const compiled = engine.compileFormula("a + b");
    expect(engine.evaluateFormula(compiled, { a: 1, b: 2 }, { allowedVariables: ["a", "b"] }).valueText).toBe("3");
    expect(errorCode(() => engine.evaluateFormula(compiled, { a: 1, b: 2 }, { allowedVariables: ["a"] }))).toBe(ERROR_CODES.UNKNOWN_IDENTIFIER);
    expect(errorCode(() => engine.evaluateFormula("a", { a: 1 }, { nope: true } as never))).toBe(ERROR_CODES.UNSUPPORTED_INPUT_FIELD);
  });

  it("an option given as undefined is an option not given, everywhere (0.5.0: three behaviours)", () => {
    // What a caller spreading a partial configuration produces; the types forbid it under exactOptionalPropertyTypes.
    const withUndefined = { rejectUnusedInputs: undefined, decimalPrecision: undefined, maxExponentMagnitude: undefined } as never;
    expect(normalizeEngineOptions(withUndefined).rejectUnusedInputs).toBe(false);
    expect(normalizeEngineOptions(withUndefined).decimalPrecision).toBe(16);
    expect(normalizeNumericValidationOptions({ decimalPrecision: undefined, maxExponentMagnitude: undefined } as never).decimalPrecision).toBe(16);
  });

  it("the engine and the Type A/B helpers default the input length alike, and it leaves room for the digits allowed (0.5.0: 128 and 512)", () => {
    const engineOptions = normalizeEngineOptions();
    const helperOptions = normalizeNumericValidationOptions();
    expect(engineOptions.maxNumericInputLength).toBe(helperOptions.maxNumericInputLength);
    expect(engineOptions.maxSignificantDigits).toBe(helperOptions.maxSignificantDigits);
    // 128 significant digits with a sign and a decimal point: 130 characters.
    const longest = `-${"7".repeat(18)}.${"2".repeat(110)}`;
    expect(createCalculationEngine().evaluateFormula("x", { x: longest }).valueText).toBe(longest);
  });
});

describe("numeric inputs", () => {
  it("a JavaScript number is read like the same value written out (0.5.0: 1.5e-13 refused, \"0.00000000000015\" accepted)", () => {
    expect(numberInputText(1.5e-13)).toBe("0.00000000000015");
    expect(numberInputText(-2.5e-7)).toBe("-0.00000025");
    expect(numberInputText(1e21)).toBe("1000000000000000000000");
    expect(numberInputText(1.25e22)).toBe("12500000000000000000000");
    expect(numberInputText(123.456)).toBe("123.456");
    for (const value of [1.5e-13, 1e21, 5e-324, 1.7976931348623157e308, 6.02214076e23]) {
      expect(Number(numberInputText(value))).toBe(value);
    }
    const engine = createCalculationEngine();
    expect(engine.evaluateFormula("x", { x: 1.5e-13 }).valueText).toBe(engine.evaluateFormula("x", { x: "0.00000000000015" }).valueText);
    expect(engine.evaluateFormula("x", { x: 1e21 }).valueText).toBe(engine.evaluateFormula("x", { x: "1000000000000000000000" }).valueText);
    // The exponent limit is a limit on exponent notation, as before.
    expect(errorCode(() => engine.evaluateFormula("x", { x: "1.5e-13" }))).toBe(ERROR_CODES.EXPONENT_TOO_LARGE);
  });

  it("number mode refuses a non-zero input a double reads as 0 (0.5.0: silently 0)", () => {
    const wide = new NumberBackend(16, 400, 512, 128);
    expect(errorCode(() => wide.fromInput("1e-400"))).toBe(ERROR_CODES.UNSAFE_NUMERIC_RANGE);
    expect(errorCode(() => wide.fromInput("-1e-400"))).toBe(ERROR_CODES.UNSAFE_NUMERIC_RANGE);
    expect(wide.fromInput("0e-400")).toBe(0);
    expect(wide.fromInput("0.000")).toBe(0);
    expect(wide.fromInput("5e-324")).toBe(5e-324);
  });

  it("0 to a negative power is a division by zero in both modes (0.5.0: a non-finite result in number mode)", () => {
    const decimal = new DecimalBackend(16, 12);
    const number = new NumberBackend(16, 12);
    expect(errorCode(() => decimal.pow(decimal.fromInput("0"), decimal.fromInput("-1")))).toBe(ERROR_CODES.DIVISION_BY_ZERO);
    expect(errorCode(() => number.pow(0, -1))).toBe(ERROR_CODES.DIVISION_BY_ZERO);
  });
});

describe("sensitivities", () => {
  it("the power rule keeps the exponent exact (0.5.0: x^1.1 differentiated to 1.1·x^0.10000000000000009)", () => {
    const derivative = symbolicDerivative(parseFormula("x ^ 1.1", DEFAULT_FORMULA_LIMITS), "x");
    expect(canonicalJson(derivative as never)).toContain('"raw":"0.1"');
    const square = symbolicDerivative(parseFormula("x ^ 2", DEFAULT_FORMULA_LIMITS), "x");
    expect(canonicalJson(square as never)).not.toContain('"^"');
  });

  it("the numerical derivative takes the step it is given (0.5.0: 1e-6·max(|x|, 1), which reaches 0 from x = 1e-6)", () => {
    const sqrt = parseFormula("sqrt(x)", DEFAULT_FORMULA_LIMITS);
    const options = { maxExponentMagnitude: 12, decimalPrecision: 16 };
    const exact = 1 / (2 * Math.sqrt(1e-6));
    expect(Math.abs(numericalDerivative(sqrt, "x", { x: 1e-6 }, { ...options, step: 5e-8 }) - exact) / exact).toBeLessThanOrEqual(1e-5);
    // Without a step the old rule still applies, and is still wrong here.
    expect(Math.abs(numericalDerivative(sqrt, "x", { x: 1e-6 }, options) - exact) / exact).toBeGreaterThan(0.1);
  });

  it("the measurement model's fallback spans the estimate ± its standard uncertainty", () => {
    const engine = createCalculationEngine({ numericMode: "decimal" });
    const result = engine.evaluateMeasurementModel({
      formula: "x * student_t_inverse_2t(0.05, n)",
      quantities: {
        x: { estimate: "0.000002", standardUncertainty: "0.0000001" },
        n: { estimate: "10.5", standardUncertainty: "0.2" },
      },
    });
    const fallback = result.diagnostics.filter((diagnostic) => diagnostic.code === "SENSITIVITY_NUMERICAL_FALLBACK");
    // x is outside the call: symbolic. n is inside it: numerical, over 10.5 ± 0.2.
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.details).toMatchObject({ symbol: "n", stepBasis: "standardUncertainty", step: 0.1 });
    // 10.3 to 10.7 all truncate to ν = 10: the output does not move with n.
    expect(Math.abs(Number(result.sensitivityCoefficients.n))).toBeLessThanOrEqual(1e-15);
  });

  it("an uncertainty too small for a double to resolve does not set the step", () => {
    const engine = createCalculationEngine();
    const sensitivity = (standardUncertainty: string) => {
      const result = engine.evaluateMeasurementModel({
        formula: "s * student_t_inverse_2t(a, 10)",
        quantities: {
          a: { estimate: "0.05", standardUncertainty },
          s: { estimate: "1", standardUncertainty: "0" },
        },
      });
      const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.details?.symbol === "a");
      return {
        coefficient: Number(result.sensitivityCoefficients.a),
        fallback: diagnostics.find((diagnostic) => diagnostic.code === "SENSITIVITY_NUMERICAL_FALLBACK")?.details,
        unstable: diagnostics.some((diagnostic) => diagnostic.code === "LINEARIZATION_NUMERICAL_INSTABILITY"),
      };
    };
    // dt/dα of the two-tailed quantile at α = 0.05, ν = 10: −1/(2·f(t)), mpmath.
    const exact = -11.796630431732665;
    const ordinary = sensitivity("0.0001");
    expect(ordinary.fallback).toMatchObject({ stepBasis: "standardUncertainty", step: 0.00005 });
    expect(Math.abs(ordinary.coefficient - exact) / -exact).toBeLessThanOrEqual(1e-9);
    // u/|x| = 2e-14: over x ± u the stencil has two digits left (the coefficient
    // came out 8 % off, and with the wrong sign at 2e-15). The step is then
    // numericalDerivativeRelativeStep·|x|.
    for (const tiny of ["0.000000000000001", "0.0000000000000001", "0.000000000000000001"]) {
      const result = sensitivity(tiny);
      expect(result.fallback).toMatchObject({ stepBasis: "relativeFloor", step: 1e-6 * 0.05 });
      expect(Math.abs(result.coefficient - exact) / -exact).toBeLessThanOrEqual(1e-9);
      expect(result.unstable).toBe(false);
    }
  });
});

describe("the calculation fingerprint of a correlated model", () => {
  const quantity = { standardUncertainty: "0.1", degreesOfFreedom: 10 };
  const model = {
    formula: "a + b + c",
    quantities: { a: { estimate: "1", ...quantity }, b: { estimate: "2", ...quantity }, c: { estimate: "3", ...quantity } },
  };
  const engine = createCalculationEngine({ numericMode: "decimal" });
  const fingerprint = (correlations: unknown): string =>
    engine.evaluateMeasurementModel({ ...model, correlations } as never).calculationFingerprint;

  it("is one for one model, however the relationships are written (0.5.0: the raw text was recorded)", () => {
    const reference = fingerprint([["a", "b", "0.5"], ["b", "c", "0.25"]]);
    expect(fingerprint([["a", "b", "0.50"], ["b", "c", "0.250"]])).toBe(reference);
    expect(fingerprint([["b", "a", 0.5], ["c", "b", "2.5e-1"]])).toBe(reference);
    expect(fingerprint([{ symbols: ["a", "b"], coefficient: "0.5" }, { symbols: ["b", "c"], correlation: 0.25 }])).toBe(reference);
    expect(fingerprint({ a: { a: 1, b: "0.5" }, b: { a: "0.5", c: "0.25" }, c: { b: "0.25", c: 1 } })).toBe(reference);
  });

  it("still tells two models apart", () => {
    expect(fingerprint([["a", "b", "0.5"]])).not.toBe(fingerprint([["a", "b", "0.51"]]));
    expect(fingerprint([["a", "b", "0.5"]])).not.toBe(fingerprint([["a", "c", "0.5"]]));
  });
});

describe("canonical JSON", () => {
  it("is linear in the depth of the value (0.5.0: 350 ms for a chain of 3000)", () => {
    let nested: unknown = 1;
    for (let level = 0; level < 400; level += 1) nested = { a: [nested, "x"], b: level };
    const text = canonicalJson(nested as never);
    expect(text.length).toBeGreaterThan(400 * 16);
    expect(JSON.parse(text)).toStrictEqual(nested);
  });
});

describe("the dossier in force", () => {
  it("is the highest released version: a suffixed directory is not a release (0.5.0: it won or lost by listing order)", () => {
    expect(resolveCurrentDossierDir(["v0.4.0-rc1", "v0.4.0"])).toBe("v0.4.0");
    expect(resolveCurrentDossierDir(["v0.4.0", "v0.4.0-rc1"])).toBe("v0.4.0");
    expect(resolveCurrentDossierDir(["v0.4.0.bak", "v0.4.0"])).toBe("v0.4.0");
    expect(resolveCurrentDossierDir(["v0.9.0", "v1.0.0-draft"])).toBe("v0.9.0");
    expect(resolveCurrentDossierDir(["v0.10.0", "v0.9.0"])).toBe("v0.10.0");
    expect(resolveCurrentDossierDir(["notes", "v1.0.0-draft"])).toBeNull();
  });
});
