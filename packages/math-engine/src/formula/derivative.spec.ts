/**
 * Symbolic differentiation: a sub-expression the variable does not appear in is
 * a constant (0.5.0). Up to 0.4.0 a call with two arguments, or a
 * non-differentiable one, made the whole formula "not differentiable" even when
 * it held no variable at all, and every sensitivity fell back to the numerical
 * derivative, whose step is absolute below 1.
 */

import { describe, expect, it } from "vitest";
import { createCalculationEngine } from "../engine/create.js";
import { evaluateAst } from "../evaluator/evaluate.js";
import { NumberBackend } from "../numeric/backend.js";
import { DEFAULT_FORMULA_LIMITS } from "../parser/options.js";
import { parseFormula } from "../parser/parser.js";
import { studentTQuantile } from "../gum/statistics.js";
import { symbolicDerivative } from "./derivative.js";

function derivativeAt(formula: string, variable: string, scope: Record<string, number>): number | null {
  const derivative = symbolicDerivative(parseFormula(formula, DEFAULT_FORMULA_LIMITS), variable);
  if (derivative === null) return null;
  const backend = new NumberBackend(16, 12);
  return backend.toNumber(evaluateAst(derivative, scope, backend));
}

describe("symbolicDerivative", () => {
  it("treats a call without the variable as a constant factor", () => {
    const k = studentTQuantile(0.975, 10);
    expect(derivativeAt("sqrt(x) * student_t_inverse_2t(0.05, 10)", "x", { x: 4 })).toBeCloseTo(k / 4, 13);
    expect(derivativeAt("x * abs(y) + min(y, 3)", "x", { x: 2, y: -5 })).toBe(5);
    expect(derivativeAt("x ^ 2 + if_zero(y, 1, 2)", "x", { x: 3, y: 0 })).toBe(6);
  });

  it("still refuses to differentiate through such a call", () => {
    expect(symbolicDerivative(parseFormula("student_t_inverse_2t(0.05, x)", DEFAULT_FORMULA_LIMITS), "x")).toBeNull();
    expect(symbolicDerivative(parseFormula("y * abs(x)", DEFAULT_FORMULA_LIMITS), "x")).toBeNull();
    expect(symbolicDerivative(parseFormula("min(x, y)", DEFAULT_FORMULA_LIMITS), "y")).toBeNull();
  });

  it("gives the exact sensitivity of a small quantity next to a constant call (0.4.0: 1575.5 for 1114.07, with a warning)", () => {
    const engine = createCalculationEngine({ numericMode: "decimal" });
    const result = engine.evaluateMeasurementModel({
      formula: "sqrt(x) * student_t_inverse_2t(0.05, 10)",
      quantities: { x: { estimate: "1e-6", standardUncertainty: "1e-7", degreesOfFreedom: "Infinity" } },
    });
    const expected = studentTQuantile(0.975, 10) / (2 * Math.sqrt(1e-6));
    expect(Math.abs(Number(result.sensitivityCoefficients.x) - expected) / expected).toBeLessThanOrEqual(1e-14);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("SENSITIVITY_SYMBOLIC");
    expect(codes).not.toContain("SENSITIVITY_NUMERICAL_FALLBACK");
    expect(codes).not.toContain("LINEARIZATION_NUMERICAL_INSTABILITY");
  });
});
