/**
 * Characterization/coverage tests for packages/method-definition/src/criteria.ts
 *
 * Engine usage per REQ:
 *   REQ-CRIT-001 — compareDecimalInputs only, NO engine
 *   REQ-CRIT-002 — compareDecimalInputs only, NO engine
 *   REQ-CRIT-003 — compareDecimalInputs only, NO engine
 *   REQ-CRIT-004 — fake engine (compileCriterionExpression)
 *   REQ-CRIT-005 — fake engine (compileCriterionExpression)
 *   REQ-CRIT-006 — fake engine (compileCriterionExpression)
 *   REQ-CRIT-007 — fake engine (compileCriterionExpression)
 *   REQ-CRIT-008 — fake engine (compileCriterionExpression + evaluateCompiledCriterion)
 */

import { describe, expect, it } from "vitest";
import {
  compareDecimalInputs,
  compileCriterionExpression,
  evaluateCompiledCriterion,
} from "../src/criteria";
import type {
  CalculationEngineLike,
  CompiledFormulaLike,
  MethodAcceptanceCriterion,
  NumericInput,
} from "../src/types";

// ---------------------------------------------------------------------------
// Minimal fake engine — satisfies CalculationEngineLike without `as` casts.
// compileFormula returns variables extracted by a simple token regex and an
// evaluate function that resolves each token from inputs, or parses it as a
// numeric literal.
// ---------------------------------------------------------------------------

function buildFakeEngine(): CalculationEngineLike {
  const engine = {
    compileFormula(
      expression: string,
      _options?: { allowedVariables?: readonly string[] },
    ): CompiledFormulaLike {
      // Extract identifier tokens (variable references or function names).
      const tokenPattern = /[A-Za-z][A-Za-z0-9_]*/g;
      const rawTokens = expression.match(tokenPattern) ?? [];
      // Report ALL non-builtin identifiers as variables — the criteria code
      // is responsible for checking them against allowedVariables and throwing
      // for unknown ones (src/criteria.ts lines 89-98).
      const knownBuiltins = new Set(["abs", "mean", "std", "min", "max"]);
      const variables = [
        ...new Set(rawTokens.filter((t) => !knownBuiltins.has(t))),
      ].toSorted();

      const compiled = {
        normalizedFormula: expression.trim(),
        formulaFingerprint: `fp:${expression}`,
        variables,
        evaluate(inputs: Readonly<Record<string, NumericInput>>): {
          value: NumericInput;
          variables: readonly string[];
          normalizedFormula: string;
          formulaFingerprint: string;
        } {
          const trimmed = expression.trim();
          // Try numeric literal first.
          const asNum = Number(trimmed);
          if (Number.isFinite(asNum)) {
            return {
              value: asNum,
              variables,
              normalizedFormula: trimmed,
              formulaFingerprint: `fp:${expression}`,
            };
          }
          // Single variable reference.
          if (inputs[trimmed] !== undefined) {
            return {
              value: inputs[trimmed] ?? 0,
              variables,
              normalizedFormula: trimmed,
              formulaFingerprint: `fp:${expression}`,
            };
          }
          // cf_internal_criterion_agg_* synthetic variables.
          for (const [key, val] of Object.entries(inputs)) {
            if (expression.includes(key)) {
              return {
                value: val ?? 0,
                variables,
                normalizedFormula: trimmed,
                formulaFingerprint: `fp:${expression}`,
              };
            }
          }
          throw new Error(
            `Fake engine cannot evaluate expression: ${expression}`,
          );
        },
      } satisfies CompiledFormulaLike;
      return compiled;
    },
    evaluateFormula(
      expression: string | CompiledFormulaLike,
      inputs: Readonly<Record<string, NumericInput>>,
    ) {
      const formula =
        typeof expression === "string"
          ? engine.compileFormula(expression)
          : expression;
      return formula.evaluate(inputs);
    },
    evaluateMeasurementModel(): never {
      throw new Error(
        "evaluateMeasurementModel not supported in criteria fake engine",
      );
    },
  } satisfies CalculationEngineLike;
  return engine;
}

const fakeEngine = buildFakeEngine();

// Shorthand for building a MethodAcceptanceCriterion without boilerplate.
function criterion(expression: string): MethodAcceptanceCriterion {
  return {
    key: "test_criterion",
    label: "Test",
    expression,
    severity: "blocking",
    message: "test",
  };
}

// Simple deterministic fingerprint used by all compile calls below.
function fp(value: unknown): string {
  return `crit:${JSON.stringify(value)}`;
}

// ---------------------------------------------------------------------------
// REQ-CRIT-001 — exact decimal comparison via bigint backend
// ---------------------------------------------------------------------------

describe("REQ-CRIT-001: compareDecimalInputs exact decimal semantics", () => {
  // Basic ordering: -1 / 0 / 1
  it("returns -1 when left < right", () => {
    expect(compareDecimalInputs(1, 2)).toBe(-1);
  });

  it("returns 0 when left === right (integer)", () => {
    expect(compareDecimalInputs(5, 5)).toBe(0);
  });

  it("returns 1 when left > right", () => {
    expect(compareDecimalInputs(10, 3)).toBe(1);
  });

  // Differing scale: "1.50" vs "1.5" must compare equal (REQ-CRIT-001).
  it("treats '1.50' and '1.5' as equal despite differing trailing zeros", () => {
    expect(compareDecimalInputs("1.50", "1.5")).toBe(0);
  });

  it("treats '0.10' and '0.1' as equal", () => {
    expect(compareDecimalInputs("0.10", "0.1")).toBe(0);
  });

  // Float would mis-order this but bigint must not.
  it("orders correctly for large numbers that float truncates", () => {
    // These two values differ only after the 16th significant digit —
    // floating-point would consider them equal; bigint must return -1.
    const left = "100000000000000000000.1";
    const right = "100000000000000000000.2";
    expect(compareDecimalInputs(left, right)).toBe(-1);
  });

  // Negative numbers.
  it("returns -1 when left is negative and right is positive", () => {
    // -1 < 1, so result is -1.
    expect(compareDecimalInputs(-1, 1)).toBe(-1);
  });

  it("returns -1 when left is a more-negative number", () => {
    expect(compareDecimalInputs(-5, -3)).toBe(-1);
  });

  it("returns 0 for two negative numbers with the same magnitude", () => {
    expect(compareDecimalInputs(-2.0, "-2.00")).toBe(0);
  });

  // String vs number overload.
  it("accepts string left and numeric right", () => {
    expect(compareDecimalInputs("3.14", 3.14)).toBe(0);
  });

  it("accepts numeric left and string right", () => {
    expect(compareDecimalInputs(0, "0")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-CRIT-002 — scientific notation treated as equal to decimal form
// ---------------------------------------------------------------------------

describe("REQ-CRIT-002: compareDecimalInputs scientific notation parity", () => {
  it("treats '1e-2' and '0.01' as equal", () => {
    expect(compareDecimalInputs("1e-2", "0.01")).toBe(0);
  });

  it("treats '1e-2' and '0.01' symmetrically", () => {
    expect(compareDecimalInputs("0.01", "1e-2")).toBe(0);
  });

  it("treats '1.5e3' and '1500' as equal", () => {
    expect(compareDecimalInputs("1.5e3", "1500")).toBe(0);
  });

  it("treats '2.5e-1' and '0.25' as equal", () => {
    expect(compareDecimalInputs("2.5e-1", "0.25")).toBe(0);
  });

  it("correctly orders '1e-3' < '1e-2'", () => {
    expect(compareDecimalInputs("1e-3", "1e-2")).toBe(-1);
  });

  it("correctly orders '1e2' > '99'", () => {
    expect(compareDecimalInputs("1e2", "99")).toBe(1);
  });

  it("treats '0e0' and '0' as equal", () => {
    expect(compareDecimalInputs("0e0", "0")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-CRIT-003 — non-finite / non-numeric input throws
// ---------------------------------------------------------------------------

describe("REQ-CRIT-003: compareDecimalInputs rejects non-finite values", () => {
  it("throws on 'NaN' string", () => {
    expect(() => compareDecimalInputs("NaN", "1")).toThrow("non-finite value");
  });

  it("throws on 'Infinity' string", () => {
    expect(() => compareDecimalInputs("Infinity", "1")).toThrow(
      "non-finite value",
    );
  });

  it("throws on '-Infinity' string", () => {
    expect(() => compareDecimalInputs("-Infinity", "1")).toThrow(
      "non-finite value",
    );
  });

  it("throws on empty string", () => {
    expect(() => compareDecimalInputs("", "1")).toThrow("non-finite value");
  });

  it("throws on non-numeric string 'abc'", () => {
    expect(() => compareDecimalInputs("abc", "1")).toThrow("non-finite value");
  });

  it("throws when right operand is non-numeric", () => {
    expect(() => compareDecimalInputs("1", "xyz")).toThrow("non-finite value");
  });
});

// ---------------------------------------------------------------------------
// REQ-CRIT-004 — missing comparator throws
// ---------------------------------------------------------------------------

describe("REQ-CRIT-004: compileCriterionExpression throws without boolean comparator", () => {
  it("throws when expression has no comparator token", () => {
    expect(() =>
      compileCriterionExpression(
        criterion("error + 1"),
        fakeEngine,
        ["error"],
        fp,
      ),
    ).toThrow("must be a boolean comparison");
  });

  it("throws on a bare identifier (no operator)", () => {
    expect(() =>
      compileCriterionExpression(criterion("error"), fakeEngine, ["error"], fp),
    ).toThrow("must be a boolean comparison");
  });

  it("does NOT throw when a valid comparator is present", () => {
    expect(() =>
      compileCriterionExpression(
        criterion("error <= 0.1"),
        fakeEngine,
        ["error"],
        fp,
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// REQ-CRIT-005 — each comparator token parsed to the correct operator field;
//                unrecognized token defaults to "<"
// ---------------------------------------------------------------------------

describe("REQ-CRIT-005: compileCriterionExpression operator parsing", () => {
  const comparators = ["<", "<=", ">", ">=", "==", "!="] as const;

  for (const op of comparators) {
    it(`parses '${op}' correctly`, () => {
      const compiled = compileCriterionExpression(
        criterion(`a ${op} b`),
        fakeEngine,
        ["a", "b"],
        fp,
      );
      expect(compiled.operator).toBe(op);
    });
  }

  // The COMPARATOR_PATTERN greedily matches the LAST comparator sequence; an
  // expression that can't match any of the six tokens should not be reachable
  // through compileCriterionExpression (it would fail REQ-CRIT-004 first).
  // However, parseCriterionOperator itself defaults "<" for anything else.
  // We test that "<" is returned for the plain "<" case (covered above) and
  // also note that the default path can only be observed if the regex
  // produces an unexpected match[2] token — not currently possible via the
  // public surface. The six covered cases are sufficient per REQ-CRIT-005.

  it("compiled criterion carries the parsed operator in CompiledCriterion", () => {
    const compiled = compileCriterionExpression(
      criterion("x >= 0"),
      fakeEngine,
      ["x"],
      fp,
    );
    // Verify it's the exact operator type, not just truthy.
    expect(compiled.operator).toBe(">=" satisfies typeof compiled.operator);
  });
});

// ---------------------------------------------------------------------------
// REQ-CRIT-006 — unknown variables throw
// ---------------------------------------------------------------------------

describe("REQ-CRIT-006: compileCriterionExpression rejects unknown variables", () => {
  it("throws naming an undeclared variable on the left side", () => {
    expect(() =>
      compileCriterionExpression(
        criterion("unknown_var <= 0.1"),
        fakeEngine,
        ["error"],
        fp,
      ),
    ).toThrow("unknown variable");
  });

  it("throws naming an undeclared variable on the right side", () => {
    expect(() =>
      compileCriterionExpression(
        criterion("error <= missing"),
        fakeEngine,
        ["error"],
        fp,
      ),
    ).toThrow("unknown variable");
  });

  it("does NOT throw when all variables are in allowedVariables", () => {
    expect(() =>
      compileCriterionExpression(
        criterion("error <= limit"),
        fakeEngine,
        ["error", "limit"],
        fp,
      ),
    ).not.toThrow();
  });

  it("error message includes the name of the unknown variable", () => {
    expect(() =>
      compileCriterionExpression(
        criterion("typo <= 0"),
        fakeEngine,
        ["error"],
        fp,
      ),
    ).toThrow("typo");
  });
});

// ---------------------------------------------------------------------------
// REQ-CRIT-007 — aggregate calls rewritten; source variables listed in
//                `variables`; synthetic names NOT leaked into `variables`
// ---------------------------------------------------------------------------

describe("REQ-CRIT-007: compileCriterionExpression aggregate rewriting", () => {
  it("succeeds with mean() over an allowed variable", () => {
    const compiled = compileCriterionExpression(
      criterion("mean(error) <= 0.1"),
      fakeEngine,
      ["error"],
      fp,
    );
    // The source variable must appear.
    expect(compiled.variables).toContain("error");
  });

  it("does NOT leak cf_internal_criterion_agg_* into variables", () => {
    const compiled = compileCriterionExpression(
      criterion("mean(error) <= 0.1"),
      fakeEngine,
      ["error"],
      fp,
    );
    const leaked = compiled.variables.filter((v) =>
      v.startsWith("cf_internal_criterion_agg_"),
    );
    expect(leaked).toHaveLength(0);
  });

  it("succeeds with max() and lists source variable", () => {
    const compiled = compileCriterionExpression(
      criterion("max(error) <= limit"),
      fakeEngine,
      ["error", "limit"],
      fp,
    );
    expect(compiled.variables).toContain("error");
    expect(compiled.variables).toContain("limit");
  });

  it("succeeds with min() and lists source variable", () => {
    const compiled = compileCriterionExpression(
      criterion("min(reading) >= 0"),
      fakeEngine,
      ["reading"],
      fp,
    );
    expect(compiled.variables).toContain("reading");
  });

  it("succeeds with std() and lists source variable", () => {
    const compiled = compileCriterionExpression(
      criterion("std(reading) <= 0.05"),
      fakeEngine,
      ["reading"],
      fp,
    );
    expect(compiled.variables).toContain("reading");
  });

  it("correctly separates leftVariables and rightVariables", () => {
    const compiled = compileCriterionExpression(
      criterion("max(error) <= limit"),
      fakeEngine,
      ["error", "limit"],
      fp,
    );
    expect(compiled.leftVariables).toContain("error");
    expect(compiled.rightVariables).toContain("limit");
    // error should NOT appear in rightVariables
    expect(compiled.rightVariables).not.toContain("error");
  });

  it("does NOT leak synthetic variable into leftVariables", () => {
    const compiled = compileCriterionExpression(
      criterion("mean(error) <= 0.1"),
      fakeEngine,
      ["error"],
      fp,
    );
    const leaked = compiled.leftVariables.filter((v) =>
      v.startsWith("cf_internal_criterion_agg_"),
    );
    expect(leaked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-CRIT-008 — evaluateCompiledCriterion returns correct boolean result
//                (true AND false case per representative operator)
// ---------------------------------------------------------------------------

describe("REQ-CRIT-008: evaluateCompiledCriterion returns correct boolean", () => {
  // Helper: compile + evaluate in one call.
  function evalCrit(
    expression: string,
    allowed: string[],
    context: Record<string, NumericInput>,
  ): boolean {
    const compiled = compileCriterionExpression(
      criterion(expression),
      fakeEngine,
      allowed,
      fp,
    );
    return evaluateCompiledCriterion(compiled, context);
  }

  // --- "<" ---
  it("< returns true when left < right", () => {
    expect(evalCrit("a < b", ["a", "b"], { a: 1, b: 2 })).toBe(true);
  });
  it("< returns false when left >= right", () => {
    expect(evalCrit("a < b", ["a", "b"], { a: 2, b: 2 })).toBe(false);
  });

  // --- "<=" ---
  it("<= returns true when left === right", () => {
    expect(evalCrit("a <= b", ["a", "b"], { a: 2, b: 2 })).toBe(true);
  });
  it("<= returns false when left > right", () => {
    expect(evalCrit("a <= b", ["a", "b"], { a: 3, b: 2 })).toBe(false);
  });

  // --- ">" ---
  it("> returns true when left > right", () => {
    expect(evalCrit("a > b", ["a", "b"], { a: 5, b: 3 })).toBe(true);
  });
  it("> returns false when left <= right", () => {
    expect(evalCrit("a > b", ["a", "b"], { a: 3, b: 3 })).toBe(false);
  });

  // --- ">=" ---
  it(">= returns true when left === right", () => {
    expect(evalCrit("a >= b", ["a", "b"], { a: 4, b: 4 })).toBe(true);
  });
  it(">= returns false when left < right", () => {
    expect(evalCrit("a >= b", ["a", "b"], { a: 1, b: 4 })).toBe(false);
  });

  // --- "==" ---
  it("== returns true when left === right", () => {
    expect(evalCrit("a == b", ["a", "b"], { a: 7, b: 7 })).toBe(true);
  });
  it("== returns false when left !== right", () => {
    expect(evalCrit("a == b", ["a", "b"], { a: 7, b: 8 })).toBe(false);
  });

  // --- "!=" ---
  it("!= returns true when left !== right", () => {
    expect(evalCrit("a != b", ["a", "b"], { a: 1, b: 2 })).toBe(true);
  });
  it("!= returns false when left === right", () => {
    expect(evalCrit("a != b", ["a", "b"], { a: 3, b: 3 })).toBe(false);
  });

  // Decimal precision: the comparison delegates to compareDecimalInputs (bigint).
  it("uses decimal comparison (string values do not float-truncate)", () => {
    // 100000000000000000000.1 < 100000000000000000000.2 should be TRUE.
    // With floats both stringify to the same IEEE-754 value, so comparison
    // would incorrectly return false. With bigint it returns true.
    const compiled = compileCriterionExpression(
      criterion("a < b"),
      fakeEngine,
      ["a", "b"],
      fp,
    );
    const result = evaluateCompiledCriterion(compiled, {
      a: "100000000000000000000.1",
      b: "100000000000000000000.2",
    });
    expect(result).toBe(true);
  });

  // Aggregate evaluation: evaluateCompiledCriterion handles array context values
  // via prepareCriterionSide / rewriteArrayAggregates.
  it("evaluates max(error) <= limit correctly when criterion passes", () => {
    const compiled = compileCriterionExpression(
      criterion("max(error) <= limit"),
      fakeEngine,
      ["error", "limit"],
      fp,
    );
    expect(
      evaluateCompiledCriterion(compiled, {
        error: [0.1, 0.2, 0.3],
        limit: 0.3,
      }),
    ).toBe(true);
  });

  it("evaluates max(error) <= limit correctly when criterion fails", () => {
    const compiled = compileCriterionExpression(
      criterion("max(error) <= limit"),
      fakeEngine,
      ["error", "limit"],
      fp,
    );
    expect(
      evaluateCompiledCriterion(compiled, {
        error: [0.1, 0.2, 0.4],
        limit: 0.3,
      }),
    ).toBe(false);
  });
});
