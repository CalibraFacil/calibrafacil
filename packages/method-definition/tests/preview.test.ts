/**
 * Characterization / coverage tests for `runMethodPreview`.
 *
 * These tests assert the EXISTING, OBSERVED behaviour of the public
 * `runMethodPreview` entrypoint.  Production code is NOT modified.
 *
 * REQ-PREV-001  Top-level result shape
 * REQ-PREV-002  Draft / non-released method — "preview/watermark" signal
 * REQ-PREV-003  Acceptance-criterion outcome reflected in result
 * REQ-PREV-004  Invalid / incomplete method — guarded error / empty state
 * REQ-PREV-005  Determinism: identical inputs → deep-equal output
 *
 * Fixture: the same `validDraft` helper used in compile.test.ts, reproduced
 * here so this file is self-contained (avoids coupling to the compile test
 * module's private helpers).
 */

import { describe, expect, it } from "vitest";
import {
  compileMethodDraft,
  runMethodPreview,
  type CalculationEngineLike,
  type MethodDraft,
  type NumericInput,
  type CompiledMethod,
} from "../src";

// ---------------------------------------------------------------------------
// Shared fake engine (mirrors the one in compile.test.ts)
// ---------------------------------------------------------------------------

function evaluateTestExpression(
  expression: string,
  inputs: Readonly<Record<string, NumericInput>>,
): number {
  const trimmed = expression.trim();

  const absMatch = trimmed.match(/^abs\(([^)]+)\)$/);
  if (absMatch?.[1]) {
    return Math.abs(evaluateTestExpression(absMatch[1], inputs));
  }

  const aggregateMatch = trimmed.match(/^(mean|std|min|max)\(([^)]+)\)$/);
  if (aggregateMatch?.[1] && aggregateMatch[2]) {
    const value = inputs[aggregateMatch[2]];
    if (!Array.isArray(value)) {
      throw new Error(`Expected array input ${aggregateMatch[2]}`);
    }
    const numbers = value.map(Number);
    const mean = numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
    if (aggregateMatch[1] === "mean") return mean;
    if (aggregateMatch[1] === "min") return Math.min(...numbers);
    if (aggregateMatch[1] === "max") return Math.max(...numbers);
    if (numbers.length < 2) return 0;
    const variance =
      numbers.reduce((sum, item) => sum + (item - mean) ** 2, 0) /
      (numbers.length - 1);
    return Math.sqrt(variance);
  }

  for (const operator of ["-", "+"] as const) {
    const parts = trimmed.split(operator);
    if (parts.length === 2 && parts[0] && parts[1]) {
      const left = evaluateTestExpression(parts[0], inputs);
      const right = evaluateTestExpression(parts[1], inputs);
      return operator === "-" ? left - right : left + right;
    }
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const value = inputs[trimmed];
  if (value === undefined) throw new Error(`Missing test input ${trimmed}`);
  return Number(value);
}

const fakeEngine: CalculationEngineLike = {
  options: { engineVersion: "fake-test" },
  compileFormula(expression) {
    const variables = [
      ...new Set(
        expression
          .match(/[a-zA-Z][a-zA-Z0-9_]*/g)
          ?.filter(
            (token) => !["abs", "mean", "std", "min", "max"].includes(token),
          ) ?? [],
      ),
    ].toSorted();
    return {
      normalizedFormula: expression.replace(/\s+/g, " ").trim(),
      formulaFingerprint: `formula:${expression}`,
      variables,
      evaluate(inputs) {
        const value = evaluateTestExpression(expression, inputs);
        return {
          value,
          variables,
          normalizedFormula: expression.replace(/\s+/g, " ").trim(),
          formulaFingerprint: `formula:${expression}`,
        };
      },
    };
  },
  evaluateFormula(expression, inputs) {
    const formula =
      typeof expression === "string"
        ? this.compileFormula(expression)
        : expression;
    return formula.evaluate(inputs);
  },
  evaluateMeasurementModel() {
    throw new Error("Measurement model not supported in fakeEngine");
  },
};

// ---------------------------------------------------------------------------
// Shared draft + compile helper
// ---------------------------------------------------------------------------

function validDraft(overrides: Partial<MethodDraft> = {}): MethodDraft {
  return {
    id: "mass_error",
    version: 1,
    status: "draft",
    name: "Erro de indicação",
    inputs: [
      {
        kind: "scalar",
        key: "indication",
        label: "Indicação",
        unit: "g",
        required: true,
      },
      {
        kind: "scalar",
        key: "reference",
        label: "Referência",
        unit: "g",
        required: true,
      },
    ],
    formulas: [
      {
        key: "error",
        label: "Erro",
        expression: "indication - reference",
        outputUnit: "g",
        outputKind: "error",
        required: true,
      },
    ],
    measurementModels: [],
    acceptanceCriteria: [
      {
        key: "max_error",
        label: "Erro máximo",
        expression: "abs(error) <= 0.1",
        severity: "blocking",
        message: "Erro acima do limite",
      },
    ],
    previewScenarios: [
      {
        key: "nominal",
        label: "Nominal",
        inputs: { indication: "10.02", reference: "10" },
        expected: { formulas: { error: "0.02" } },
      },
    ],
    metadata: { validationStatus: "pending_revalidation" },
    ...overrides,
  };
}

/** Compile a draft and return the CompiledMethod, or throw on failure. */
function compileOrThrow(draft: MethodDraft): CompiledMethod {
  const result = compileMethodDraft(draft, { engine: fakeEngine });
  if (!result.ok) {
    throw new Error(
      `compileMethodDraft failed: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result.method;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMethodPreview", () => {
  // REQ-PREV-001 -----------------------------------------------------------------
  describe("REQ-PREV-001: top-level result shape", () => {
    it("returns all documented top-level keys for a valid scenario", () => {
      // REQ-PREV-001: MethodPreviewResult must have the expected shape.
      const method = compileOrThrow(validDraft());

      const result = runMethodPreview(
        method,
        {
          key: "nominal",
          label: "Nominal",
          inputs: { indication: "10.02", reference: "10" },
        },
        { engine: fakeEngine },
      );

      // All documented keys present (no extra hidden shape)
      expect(result).toSatisfy(
        (r: unknown) => r !== null && typeof r === "object",
      );
      const keys = Object.keys(result).toSorted();
      expect(keys).toEqual(
        [
          "acceptanceCriteriaResults",
          "diagnostics",
          "formulaResults",
          "measurementModelResults",
          "passed",
          "scenarioKey",
        ].toSorted(),
      );
    });

    it("scenarioKey in result matches the scenario key passed in", () => {
      // REQ-PREV-001: scenarioKey must echo the scenario.key value.
      const method = compileOrThrow(validDraft());

      const result = runMethodPreview(
        method,
        {
          key: "my_custom_scenario_key",
          label: "Custom",
          inputs: { indication: "10.02", reference: "10" },
        },
        { engine: fakeEngine },
      );

      expect(result.scenarioKey).toBe("my_custom_scenario_key");
    });

    it("formulaResults carries key, value, normalizedFormula and formulaFingerprint", () => {
      // REQ-PREV-001: each FormulaPreviewResult has all documented sub-fields.
      const method = compileOrThrow(validDraft());

      const result = runMethodPreview(
        method,
        {
          key: "check_shape",
          label: "Check shape",
          inputs: { indication: "10.5", reference: "10" },
        },
        { engine: fakeEngine },
      );

      expect(result.formulaResults).toHaveLength(1);
      const formulaResult = result.formulaResults[0];
      // Type-narrowing guard — no `as` assertions
      if (!formulaResult) throw new Error("Expected a formula result");

      expect(typeof formulaResult.key).toBe("string");
      expect(formulaResult.key).toBe("error");
      // value must be finite
      expect(typeof formulaResult.value).toBe("number");
      expect(typeof formulaResult.normalizedFormula).toBe("string");
      expect(typeof formulaResult.formulaFingerprint).toBe("string");
    });
  });

  // REQ-PREV-002 -----------------------------------------------------------------
  describe("REQ-PREV-002: draft / non-released method preview signal", () => {
    /**
     * FINDING: `MethodPreviewResult` has no explicit `isPreview`, `watermark`,
     * or similar field.  The "not a real certificate" signal is conveyed by
     * `passed: false` combined with a non-empty `diagnostics` array when the
     * scenario contains errors.  When the scenario is healthy the result
     * expresses `passed: true` but there is still no watermark flag — the
     * caller must consult the source `CompiledMethod.status` (always
     * `"compiled"`) and the draft's workflow status (obtained separately)
     * to decide whether to watermark a rendered output.
     *
     * These tests assert the OBSERVED behaviour; the spec author's intent
     * ("flag/field that signals 'not a real certificate'") maps to
     * `passed: false` + populated `diagnostics`.
     */

    it("passed is false and diagnostics non-empty when a blocking criterion fails", () => {
      // REQ-PREV-002: a failed preview signals "not usable as a real certificate".
      const method = compileOrThrow(validDraft());

      // indication - reference = 0.5, which violates abs(error) <= 0.1
      const result = runMethodPreview(
        method,
        {
          key: "draft_fail_scenario",
          label: "Failing draft scenario",
          inputs: { indication: "10.5", reference: "10" },
        },
        { engine: fakeEngine },
      );

      expect(result.passed).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("passed is true and diagnostics empty when scenario has no errors", () => {
      // REQ-PREV-002 (complementary): a fully-passing scenario has no error
      // diagnostics, but there is still no explicit watermark field.
      const method = compileOrThrow(validDraft());

      const result = runMethodPreview(
        method,
        {
          key: "passing_scenario",
          label: "Passing scenario",
          inputs: { indication: "10.02", reference: "10" },
        },
        { engine: fakeEngine },
      );

      expect(result.passed).toBe(true);
      const errorDiagnostics = result.diagnostics.filter(
        (d) => d.severity === "error",
      );
      expect(errorDiagnostics).toHaveLength(0);
    });

    it("expectFailure scenario: passed is true when errors exist (expected failure)", () => {
      // REQ-PREV-002: expectFailure inverts the pass/fail polarity.
      // When a scenario is expected to fail and it does, passed === true,
      // but diagnostics are still populated — this is the mechanism for
      // testing invalid-input scenarios during method authoring.
      const method = compileOrThrow(validDraft());

      const result = runMethodPreview(
        method,
        {
          key: "expected_failure",
          label: "Expected failure",
          // Missing 'reference' input → causes an error
          inputs: { indication: "10.5" },
          expectFailure: true,
        },
        { engine: fakeEngine },
      );

      // Should have accumulated error diagnostics
      expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
      // With expectFailure, passed flips to true when errors exist
      expect(result.passed).toBe(true);
    });
  });

  // REQ-PREV-003 -----------------------------------------------------------------
  describe("REQ-PREV-003: acceptance-criterion outcome reflected in result", () => {
    it("acceptanceCriteriaResults reflects pass for inputs within tolerance", () => {
      // REQ-PREV-003: criterion result included and correct for a passing case.
      const method = compileOrThrow(validDraft());

      // error = 10.02 - 10 = 0.02, abs(0.02) <= 0.1 → PASS
      const result = runMethodPreview(
        method,
        {
          key: "within_tolerance",
          label: "Within tolerance",
          inputs: { indication: "10.02", reference: "10" },
        },
        { engine: fakeEngine },
      );

      expect(result.acceptanceCriteriaResults).toHaveLength(1);
      const cr = result.acceptanceCriteriaResults[0];
      if (!cr) throw new Error("Expected acceptanceCriteriaResults[0]");

      expect(cr.key).toBe("max_error");
      expect(cr.passed).toBe(true);
      expect(cr.severity).toBe("blocking");
      // message preserved from the method definition
      expect(typeof cr.message).toBe("string");
      expect(cr.message.length).toBeGreaterThan(0);
    });

    it("acceptanceCriteriaResults reflects fail for inputs outside tolerance", () => {
      // REQ-PREV-003: criterion result included and correct for a failing case.
      const method = compileOrThrow(validDraft());

      // error = 10.5 - 10 = 0.5, abs(0.5) <= 0.1 → FAIL
      const result = runMethodPreview(
        method,
        {
          key: "outside_tolerance",
          label: "Outside tolerance",
          inputs: { indication: "10.5", reference: "10" },
        },
        { engine: fakeEngine },
      );

      const cr = result.acceptanceCriteriaResults[0];
      if (!cr) throw new Error("Expected acceptanceCriteriaResults[0]");

      expect(cr.key).toBe("max_error");
      expect(cr.passed).toBe(false);
    });

    it("a failed blocking criterion produces a BLOCKING_ACCEPTANCE_CRITERION_FAILED diagnostic", () => {
      // REQ-PREV-003: the diagnostic code for a failing blocking criterion.
      const method = compileOrThrow(validDraft());

      const result = runMethodPreview(
        method,
        {
          key: "blocking_fail",
          label: "Blocking fail",
          inputs: { indication: "20", reference: "10" },
        },
        { engine: fakeEngine },
      );

      expect(
        result.diagnostics.some(
          (d) => d.code === "BLOCKING_ACCEPTANCE_CRITERION_FAILED",
        ),
      ).toBe(true);
    });

    it("a warning criterion failure does not block the overall pass", () => {
      // REQ-PREV-003: warning-severity criteria do not set overall passed to false.
      const warningDraft = validDraft({
        acceptanceCriteria: [
          {
            key: "warn_limit",
            label: "Warning limit",
            expression: "abs(error) <= 0.01",
            severity: "warning",
            message: "Error above advisory limit",
          },
        ],
      });
      const method = compileOrThrow(warningDraft);

      // error = 0.05, exceeds the 0.01 warning limit but is not blocking
      const result = runMethodPreview(
        method,
        {
          key: "warning_exceeded",
          label: "Warning exceeded",
          inputs: { indication: "10.05", reference: "10" },
        },
        { engine: fakeEngine },
      );

      const cr = result.acceptanceCriteriaResults[0];
      if (!cr) throw new Error("Expected acceptanceCriteriaResults[0]");

      expect(cr.passed).toBe(false);
      expect(cr.severity).toBe("warning");
      // No blocking error in diagnostics → overall passes
      expect(result.passed).toBe(true);
    });
  });

  // REQ-PREV-004 -----------------------------------------------------------------
  describe("REQ-PREV-004: invalid / incomplete method — guarded error state", () => {
    it("returns a non-throwing result with error diagnostic when a required scalar input is missing", () => {
      // REQ-PREV-004: missing required input → error diagnostic, no throw.
      const method = compileOrThrow(validDraft());

      // 'reference' is required but omitted
      const result = runMethodPreview(
        method,
        {
          key: "missing_required",
          label: "Missing required input",
          inputs: { indication: "10.5" },
        },
        { engine: fakeEngine },
      );

      expect(result).toBeDefined();
      expect(result.passed).toBe(false);
      expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
    });

    it("formulaResults is empty (or partial) when required inputs are missing", () => {
      // REQ-PREV-004: formula evaluation is skipped / fails when inputs absent.
      const method = compileOrThrow(validDraft());

      const result = runMethodPreview(
        method,
        {
          key: "no_inputs",
          label: "No inputs",
          inputs: {},
        },
        { engine: fakeEngine },
      );

      // The formula depends on missing inputs → must not produce a value
      // and must not throw.  The result is a failed preview with diagnostics.
      expect(result.passed).toBe(false);
      const errorCodes = result.diagnostics.map((d) => d.code);
      // At minimum a formula error is recorded
      expect(errorCodes.length).toBeGreaterThan(0);
    });

    it("returns an empty acceptanceCriteriaResults when the method has no criteria", () => {
      // REQ-PREV-004 (guard on empty state): a no-criteria method produces
      // an empty acceptanceCriteriaResults and passes cleanly.
      const noCriteriaDraft = validDraft({ acceptanceCriteria: [] });
      const method = compileOrThrow(noCriteriaDraft);

      const result = runMethodPreview(
        method,
        {
          key: "no_criteria",
          label: "No criteria",
          inputs: { indication: "10.02", reference: "10" },
        },
        { engine: fakeEngine },
      );

      expect(result.acceptanceCriteriaResults).toHaveLength(0);
      expect(result.passed).toBe(true);
    });

    it("returns empty arrays for formula and criteria results when the method has no formulas or criteria", () => {
      // REQ-PREV-004: a minimal method with no formulas or criteria still
      // returns the full result shape with empty arrays.
      const minimalDraft = validDraft({
        formulas: [],
        acceptanceCriteria: [],
      });
      const method = compileOrThrow(minimalDraft);

      const result = runMethodPreview(
        method,
        {
          key: "empty_method",
          label: "Empty method",
          inputs: { indication: "10", reference: "10" },
        },
        { engine: fakeEngine },
      );

      expect(result.formulaResults).toHaveLength(0);
      expect(result.measurementModelResults).toHaveLength(0);
      expect(result.acceptanceCriteriaResults).toHaveLength(0);
      expect(result.passed).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // REQ-PREV-005 -----------------------------------------------------------------
  describe("REQ-PREV-005: determinism — identical inputs yield deep-equal output", () => {
    it("two calls with the same method and scenario produce deep-equal results", () => {
      // REQ-PREV-005: no hidden Date.now() or Math.random() in the render path.
      const method = compileOrThrow(validDraft());
      const scenario = {
        key: "determinism_check",
        label: "Determinism check",
        inputs: { indication: "10.07", reference: "10" },
      } satisfies Parameters<typeof runMethodPreview>[1];
      const opts = { engine: fakeEngine } satisfies Parameters<
        typeof runMethodPreview
      >[2];

      const first = runMethodPreview(method, scenario, opts);
      const second = runMethodPreview(method, scenario, opts);

      expect(first).toEqual(second);
    });

    it("two calls with different input values produce different formula results", () => {
      // REQ-PREV-005 (complementary guard): confirms test is not trivially tautological.
      const method = compileOrThrow(validDraft());
      const opts = { engine: fakeEngine } satisfies Parameters<
        typeof runMethodPreview
      >[2];

      const result1 = runMethodPreview(
        method,
        {
          key: "s1",
          label: "s1",
          inputs: { indication: "10.02", reference: "10" },
        },
        opts,
      );
      const result2 = runMethodPreview(
        method,
        {
          key: "s2",
          label: "s2",
          inputs: { indication: "10.05", reference: "10" },
        },
        opts,
      );

      // The formula values must differ (0.02 vs 0.05)
      const v1 = result1.formulaResults[0]?.value;
      const v2 = result2.formulaResults[0]?.value;
      expect(v1).not.toEqual(v2);
    });

    it("determinism holds for a table-row formula method", () => {
      // REQ-PREV-005: extended to row-scoped formulas (array outputs).
      const tableRowDraft = validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "reference",
            label: "Reference",
            unit: "g",
            required: true,
          },
          {
            kind: "table",
            key: "readings",
            label: "Readings",
            required: true,
            columns: [
              { key: "indication", label: "Indication", type: "number" },
            ],
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            expression: "indication - reference",
            scope: { kind: "table_row", tableKey: "readings" },
            required: true,
          },
        ],
        acceptanceCriteria: [
          {
            key: "max_error",
            label: "Max error",
            expression: "max(error) <= 0.2",
            severity: "blocking",
            message: "Error too large",
          },
        ],
      });
      const method = compileOrThrow(tableRowDraft);
      const scenario = {
        key: "table_det",
        label: "Table determinism",
        inputs: {
          reference: 10,
          readings: [{ indication: 10.1 }, { indication: 10.15 }],
        },
      } satisfies Parameters<typeof runMethodPreview>[1];
      const opts = { engine: fakeEngine } satisfies Parameters<
        typeof runMethodPreview
      >[2];

      const first = runMethodPreview(method, scenario, opts);
      const second = runMethodPreview(method, scenario, opts);

      expect(first).toEqual(second);
    });
  });

  // Additional cross-cutting characterization -----------------------------------
  describe("additional characterization: calibrationPhases option", () => {
    it("options.calibrationPhases overrides scenario.calibrationPhases when both are provided", () => {
      // Characterization of the precedence rule:
      // options.calibrationPhases ?? scenario.calibrationPhases
      const phaseDraft = validDraft({
        inputs: [
          {
            kind: "table",
            key: "points",
            label: "Points",
            required: true,
            metadata: { phaseBlock: "indication" },
            columns: [
              { key: "nominal", label: "Nominal", type: "number" },
              {
                key: "before_reading",
                label: "Before",
                type: "number",
                phase: "before",
                required: true,
              },
              {
                key: "after_reading",
                label: "After",
                type: "number",
                phase: "after",
                required: true,
              },
            ],
          },
        ],
        formulas: [
          {
            key: "before_error",
            label: "Before error",
            scope: { kind: "table_row", tableKey: "points" },
            expression: "before_reading - nominal",
            required: true,
            metadata: { phaseBlock: "indication", phase: "before" },
          },
          {
            key: "after_error",
            label: "After error",
            scope: { kind: "table_row", tableKey: "points" },
            expression: "after_reading - nominal",
            required: true,
            metadata: { phaseBlock: "indication", phase: "after" },
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [],
      });
      const method = compileOrThrow(phaseDraft);

      // Scenario says "before_and_after" but options overrides to "after_only"
      const result = runMethodPreview(
        method,
        {
          key: "phase_override",
          label: "Phase override",
          calibrationPhases: {
            blocks: { indication: { mode: "before_and_after" } },
          },
          inputs: {
            points: [{ nominal: 10, after_reading: 10.1 }],
          },
        },
        {
          engine: fakeEngine,
          calibrationPhases: {
            blocks: { indication: { mode: "after_only" } },
          },
        },
      );

      // With "after_only" the before_error formula must be skipped
      const keys = result.formulaResults.map((r) => r.key);
      expect(keys).not.toContain("before_error");
      expect(keys).toContain("after_error");
    });
  });
});
