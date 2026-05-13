import { describe, expect, it } from "vitest";
import {
  compileMethodDraft,
  compileCriterionExpression,
  executeCompiledMethod,
  evaluateCompiledCriterion,
  type CalculationEngineLike,
  type MethodDraft,
  type NumericInput,
} from "../src";

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
    ].sort();
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
    throw new Error("Measurement model tests must provide a dedicated fake");
  },
};

const fakeGumEngine: CalculationEngineLike = {
  ...fakeEngine,
  evaluateMeasurementModel(input) {
    const firstQuantity = Object.values(input.quantities)[0];
    const value = firstQuantity?.estimate ?? firstQuantity?.value ?? 0;
    const repeatedObservations = firstQuantity?.repeatedObservations ?? [];
    const combinedStandardUncertainty =
      repeatedObservations.length > 1
        ? 0.1
        : (firstQuantity?.standardUncertainty ?? 0);
    return {
      value,
      combinedStandardUncertainty,
      expandedUncertainty: Number(combinedStandardUncertainty) * 2,
      coverageFactor: 2,
      coverageProbability: input.coverageProbability ?? 0.9545,
      effectiveDegreesOfFreedom: firstQuantity?.degreesOfFreedom ?? "Infinity",
      sensitivityCoefficients: { x: 1 },
      uncertaintyBudget: [],
      diagnostics: [],
      formulaFingerprint: `model:${input.formula}`,
      calculationFingerprint: `calculation:${input.formula}:${value}`,
      canonicalResultJson: JSON.stringify({ formula: input.formula, value }),
      normalizedFormula: input.formula,
      normalizedAst: input.formula,
    };
  },
};

function evaluateTestExpression(
  expression: string,
  inputs: Readonly<Record<string, NumericInput>>,
): number {
  const trimmed = expression.trim();
  const absMatch = trimmed.match(/^abs\(([^)]+)\)$/);
  if (absMatch?.[1])
    return Math.abs(evaluateTestExpression(absMatch[1], inputs));

  const aggregateMatch = trimmed.match(/^(mean|std|min|max)\(([^)]+)\)$/);
  if (aggregateMatch?.[1] && aggregateMatch[2]) {
    const value = (inputs as Readonly<Record<string, unknown>>)[
      aggregateMatch[2]
    ];
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

describe("compileMethodDraft", () => {
  it("compiles, previews, fingerprints, and freezes a valid method", () => {
    const result = compileMethodDraft(validDraft(), {
      engine: fakeEngine,
      engineMetadata: {
        packageName: "@calibra-facil/math-engine",
        version: "fake-test",
        optionsFingerprint: "fake-options",
      },
      requirePublishable: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.method.methodFingerprint).toMatch(/^method:/);
    expect(result.method.formulas[0]?.normalizedFormula).toContain("-");
    expect(result.previewResults[0]?.passed).toBe(true);
    expect(Object.isFrozen(result.method)).toBe(true);
  });

  it("keeps the technical method fingerprint stable across workflow status changes", () => {
    const draftResult = compileMethodDraft(validDraft({ status: "draft" }), {
      engine: fakeEngine,
    });
    const publishedResult = compileMethodDraft(
      validDraft({ status: "published" }),
      { engine: fakeEngine },
    );

    expect(draftResult.ok).toBe(true);
    expect(publishedResult.ok).toBe(true);
    if (!draftResult.ok || !publishedResult.ok) return;

    expect(publishedResult.method.methodFingerprint).toBe(
      draftResult.method.methodFingerprint,
    );
    expect(publishedResult.method.normalizedMethodJson).toBe(
      draftResult.method.normalizedMethodJson,
    );
  });

  it("skips inactive phase columns, formulas, and criteria during execution", () => {
    const draft = validDraft({
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
      acceptanceCriteria: [
        {
          key: "before_limit",
          label: "Before limit",
          expression: "max(before_error) <= 1",
          severity: "blocking",
          message: "Before failed",
          metadata: { phaseBlock: "indication", phase: "before" },
        },
        {
          key: "after_limit",
          label: "After limit",
          expression: "max(after_error) <= 1",
          severity: "blocking",
          message: "After failed",
          metadata: { phaseBlock: "indication", phase: "after" },
        },
      ],
      previewScenarios: [
        {
          key: "after_only",
          label: "After only",
          calibrationPhases: {
            blocks: { indication: { mode: "after_only" } },
          },
          inputs: {
            points: [{ nominal: 10, after_reading: 10.1 }],
          },
        },
      ],
    });
    const compiled = compileMethodDraft(draft, {
      engine: fakeEngine,
      requirePublishable: true,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const execution = executeCompiledMethod(
      compiled.method,
      {
        inputs: { points: [{ nominal: 10, after_reading: 10.1 }] },
        calibrationPhases: {
          blocks: { indication: { mode: "after_only" } },
        },
      },
      { engine: fakeEngine },
    );

    expect(execution.ok).toBe(true);
    expect(execution.outputs.before_error).toBeUndefined();
    expect(execution.outputs.after_error).toEqual([expect.any(Number)]);
    expect(Number((execution.outputs.after_error as number[])[0])).toBeCloseTo(
      0.1,
    );
    expect(execution.acceptanceCriteriaResults.map((item) => item.key)).toEqual(
      ["after_limit"],
    );
  });

  it("skips an entire not-performed phase block", () => {
    const draft = validDraft({
      inputs: [
        {
          kind: "table",
          key: "repeatability",
          label: "Repeatability",
          required: true,
          metadata: { phaseBlock: "repeatability" },
          columns: [
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
          key: "before_repeatability",
          label: "Before repeatability",
          scope: { kind: "table_row", tableKey: "repeatability" },
          expression: "before_reading",
          required: true,
          metadata: { phaseBlock: "repeatability", phase: "before" },
        },
        {
          key: "after_repeatability",
          label: "After repeatability",
          scope: { kind: "table_row", tableKey: "repeatability" },
          expression: "after_reading",
          required: true,
          metadata: { phaseBlock: "repeatability", phase: "after" },
        },
      ],
      acceptanceCriteria: [
        {
          key: "before_repeatability_limit",
          label: "Before repeatability limit",
          expression: "max(before_repeatability) <= 1",
          severity: "blocking",
          message: "Before repeatability failed",
          metadata: { phaseBlock: "repeatability", phase: "before" },
        },
        {
          key: "after_repeatability_limit",
          label: "After repeatability limit",
          expression: "max(after_repeatability) <= 1",
          severity: "blocking",
          message: "After repeatability failed",
          metadata: { phaseBlock: "repeatability", phase: "after" },
        },
      ],
      previewScenarios: [
        {
          key: "not_performed",
          label: "Not performed",
          calibrationPhases: {
            blocks: {
              repeatability: {
                mode: "not_performed",
                reason: "Instrument under repair",
              },
            },
          },
          inputs: {},
        },
      ],
    });

    const compiled = compileMethodDraft(draft, {
      engine: fakeEngine,
      requirePublishable: true,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.previewResults[0]?.passed).toBe(true);
    expect(compiled.previewResults[0]?.formulaResults).toEqual([]);
    expect(compiled.previewResults[0]?.acceptanceCriteriaResults).toEqual([]);

    const execution = executeCompiledMethod(
      compiled.method,
      {
        inputs: {},
        calibrationPhases: {
          blocks: {
            repeatability: {
              mode: "not_performed",
              reason: "Instrument under repair",
            },
          },
        },
      },
      { engine: fakeEngine },
    );

    expect(execution.ok).toBe(true);
    expect(execution.outputs.before_repeatability).toBeUndefined();
    expect(execution.outputs.after_repeatability).toBeUndefined();
    expect(execution.acceptanceCriteriaResults).toEqual([]);
  });

  it("allows formulas to aggregate repeated observation inputs", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "repeated_observation",
            key: "readings",
            label: "Readings",
            required: true,
            minCount: 2,
          },
        ],
        formulas: [
          {
            key: "average",
            label: "Average",
            expression: "mean(readings)",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { readings: [10, 12] },
            expected: { formulas: { average: 11 } },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewResults[0]?.formulaResults[0]?.value).toBe(11);
  });

  it("uses scalar default values when preview inputs omit them", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "indication",
            label: "Indication",
            required: true,
          },
          {
            kind: "scalar",
            key: "offset",
            label: "Offset",
            required: false,
            defaultValue: 0.5,
          },
        ],
        formulas: [
          {
            key: "corrected",
            label: "Corrected",
            expression: "indication + offset",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "default_offset",
            label: "Default offset",
            inputs: { indication: 10 },
            expected: { formulas: { corrected: 10.5 } },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewResults[0]?.formulaResults[0]?.value).toBe(10.5);
  });

  it("executes a compiled method as the official calculation artifact", () => {
    const compileResult = compileMethodDraft(validDraft(), {
      engine: fakeEngine,
      requirePublishable: true,
    });

    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;

    const execution = executeCompiledMethod(
      compileResult.method,
      { inputs: { indication: "10.03", reference: "10" } },
      { engine: fakeEngine },
    );

    expect(execution.ok).toBe(true);
    expect(execution.outputs.error).toBeCloseTo(0.03);
    expect(execution.methodFingerprint).toBe(
      compileResult.method.methodFingerprint,
    );
    expect(execution.calculationFingerprint).toMatch(/^calculation:/);
    expect(execution.resultFingerprint).toMatch(/^result:/);
    expect(execution.inputFingerprint).toMatch(/^execution-input:/);
    expect(execution.canonicalResultJson).toContain("formulaResults");
    expect(execution.canonicalResultJson).toContain("inputFingerprint");
    expect(execution.canonicalResultJson).toContain("calculationFingerprint");
  });

  it("rejects official execution when a blocking criterion fails", () => {
    const compileResult = compileMethodDraft(validDraft(), {
      engine: fakeEngine,
      requirePublishable: true,
    });

    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;

    const execution = executeCompiledMethod(
      compileResult.method,
      { inputs: { indication: "11", reference: "10" } },
      { engine: fakeEngine },
    );

    expect(execution.ok).toBe(false);
    expect(
      execution.diagnostics.some(
        (item) => item.code === "BLOCKING_ACCEPTANCE_CRITERION_FAILED",
      ),
    ).toBe(true);
  });

  it("rejects unknown fields before compilation", () => {
    const result = compileMethodDraft(
      {
        ...validDraft(),
        coverageProbablity: 0.95,
      },
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("METHOD_SHAPE_INVALID");
  });

  it("rejects dangerous metadata keys", () => {
    const result = compileMethodDraft(
      {
        ...validDraft(),
        metadata: { constructor: "bad" },
      },
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
  });

  it("rejects accessors in arrays without invoking them", () => {
    const inputs = [...validDraft().inputs];
    Object.defineProperty(inputs, "0", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("array getter executed");
      },
    });

    const result = compileMethodDraft(
      {
        ...validDraft(),
        inputs,
      },
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("must not be an accessor");
  });

  it("detects formula cycles", () => {
    const result = compileMethodDraft(
      validDraft({
        formulas: [
          {
            key: "a",
            label: "A",
            expression: "b + 1",
            required: true,
          },
          {
            key: "b",
            label: "B",
            expression: "a + 1",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.code === "FORMULA_CYCLE"),
    ).toBe(true);
  });

  it("rejects publishable methods without preview scenarios", () => {
    const result = compileMethodDraft(validDraft({ previewScenarios: [] }), {
      engine: fakeEngine,
      requirePublishable: true,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.code === "PREVIEW_REQUIRED"),
    ).toBe(true);
  });

  it("lets expected-failure previews pass publication compilation", () => {
    const result = compileMethodDraft(
      validDraft({
        previewScenarios: [
          {
            key: "missing_input",
            label: "Missing input",
            inputs: { indication: "10" },
            expectFailure: true,
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "POSITIVE_PREVIEW_REQUIRED",
      ),
    ).toBe(true);
  });

  it("rejects preview inputs outside scalar constraints", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "indication",
            label: "Indicação",
            required: true,
            constraints: { min: 0, max: 5 },
          },
          {
            kind: "scalar",
            key: "reference",
            label: "Referência",
            required: true,
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.code === "PREVIEW_FAILED"),
    ).toBe(true);
  });

  it("rejects non-numeric method inputs referenced by formulas", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "select",
            key: "selected_option",
            label: "Option",
            required: true,
            options: ["A", "B"],
          },
        ],
        formulas: [
          {
            key: "bad_formula",
            label: "Bad formula",
            expression: "selected_option + 1",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "NON_NUMERIC_FORMULA_VARIABLE",
      ),
    ).toBe(true);
  });

  it("rejects non-numeric method inputs referenced by acceptance criteria", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "select",
            key: "selected_option",
            label: "Option",
            required: true,
            options: ["A", "B"],
          },
        ],
        formulas: [],
        acceptanceCriteria: [
          {
            key: "bad_criterion",
            label: "Bad criterion",
            expression: "selected_option == 1",
            severity: "blocking",
            message: "Invalid option",
          },
        ],
        previewScenarios: [],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "NON_NUMERIC_ACCEPTANCE_CRITERION_VARIABLE",
      ),
    ).toBe(true);
  });

  it("compares acceptance criteria with decimal precision", () => {
    const decimalEngine: CalculationEngineLike = {
      ...fakeEngine,
      compileFormula(expression) {
        const variable = expression.trim();
        return {
          normalizedFormula: variable,
          formulaFingerprint: `formula:${variable}`,
          variables: [variable],
          evaluate(inputs) {
            const value = inputs[variable];
            if (value === undefined) throw new Error(`Missing ${variable}`);
            return {
              value,
              variables: [variable],
              normalizedFormula: variable,
              formulaFingerprint: `formula:${variable}`,
            };
          },
        };
      },
    };

    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "large_left",
            label: "Large left",
            required: true,
          },
          {
            kind: "scalar",
            key: "large_right",
            label: "Large right",
            required: true,
          },
        ],
        formulas: [],
        acceptanceCriteria: [
          {
            key: "decimal",
            label: "Decimal",
            expression: "large_left < large_right",
            severity: "blocking",
            message: "Decimal comparison failed",
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              large_left: "100000000000000000000.1",
              large_right: "100000000000000000000.2",
            },
          },
        ],
      }),
      { engine: decimalEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("rejects invalid select values in publishable previews", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "select",
            key: "selected_option",
            label: "Option",
            required: true,
            options: ["A", "B"],
          },
        ],
        formulas: [],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { selected_option: "C" },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.code === "PREVIEW_FAILED"),
    ).toBe(true);
  });

  it("derives variable-binding preview values from source sample data", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            required: true,
            columns: [{ key: "value", label: "Value", type: "number" }],
          },
          {
            kind: "scalar",
            key: "measurements_value_mean",
            label: "Mean",
            required: false,
            metadata: {
              source: "variable_binding",
              bindingSource: "table_statistic",
              fieldKey: "measurements",
              columnKey: "value",
              statistic: "mean",
            },
          },
          {
            kind: "scalar",
            key: "reference",
            label: "Reference",
            required: true,
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            expression: "measurements_value_mean - reference",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              measurements: [{ value: 10 }, { value: 12 }],
              reference: 10,
            },
            expected: { formulas: { error: 1 } },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewResults[0]?.formulaResults[0]?.value).toBe(1);
  });

  it("does not accept arbitrary synthetic variable-binding preview values", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "measurements_value_mean",
            label: "Mean",
            required: false,
            metadata: {
              source: "variable_binding",
              bindingSource: "table_statistic",
              fieldKey: "measurements",
              columnKey: "value",
              statistic: "mean",
            },
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            expression: "measurements_value_mean",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements_value_mean: 99 },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.code === "PREVIEW_FAILED"),
    ).toBe(true);
  });

  it("rejects direct table-column binding use without an aggregate", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            required: true,
            columns: [{ key: "value", label: "Value", type: "number" }],
          },
          {
            kind: "scalar",
            key: "measurements_value",
            label: "Measurement values",
            required: false,
            metadata: {
              source: "variable_binding",
              bindingSource: "table_column",
              fieldKey: "measurements",
              columnKey: "value",
            },
          },
        ],
        formulas: [
          {
            key: "bad",
            label: "Bad",
            expression: "measurements_value + 1",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "TABLE_COLUMN_BINDING_REQUIRES_AGGREGATE",
      ),
    ).toBe(true);
  });

  it("previews table-column bindings through runtime-supported aggregators", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            required: true,
            columns: [{ key: "value", label: "Value", type: "number" }],
          },
          {
            kind: "scalar",
            key: "measurements_value",
            label: "Measurement values",
            required: false,
            metadata: {
              source: "variable_binding",
              bindingSource: "table_column",
              fieldKey: "measurements",
              columnKey: "value",
            },
          },
        ],
        formulas: [
          {
            key: "average",
            label: "Average",
            expression: "mean(measurements_value)",
            required: true,
          },
        ],
        acceptanceCriteria: [
          {
            key: "average_ok",
            label: "Average OK",
            expression: "mean(measurements_value) == 11",
            severity: "blocking",
            message: "Average mismatch",
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements: [{ value: 10 }, { value: 12 }] },
            expected: { formulas: { average: 11 } },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewResults[0]?.formulaResults[0]?.value).toBe(11);
  });

  it("does not pass aggregate-consumed variables as unused engine inputs", () => {
    const strictEngine: CalculationEngineLike = {
      ...fakeEngine,
      evaluateFormula(expression, inputs) {
        if (String(expression).includes("cf_internal_preview_0")) {
          expect(Object.keys(inputs).sort()).toEqual(["cf_internal_preview_0"]);
        }
        return fakeEngine.evaluateFormula(expression, inputs);
      },
    };
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "a",
            label: "A",
            required: true,
          },
          {
            kind: "scalar",
            key: "b",
            label: "B",
            required: true,
          },
        ],
        formulas: [
          {
            key: "average",
            label: "Average",
            expression: "mean([a, b])",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { a: 10, b: 12 },
            expected: { formulas: { average: 11 } },
          },
        ],
      }),
      { engine: strictEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("evaluates compiled criteria with aggregate expressions", () => {
    const compiled = compileCriterionExpression(
      {
        key: "max_error",
        label: "Max error",
        expression: "max(error) <= limit",
        severity: "blocking",
        message: "Bad",
      },
      fakeEngine,
      ["error", "limit"],
      (value) => JSON.stringify(value),
    );

    expect(
      evaluateCompiledCriterion(compiled, {
        error: [0.1, 0.2, 0.3],
        limit: 0.3,
      }),
    ).toBe(true);
  });

  it("rejects table statistics when bound cells are invalid", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            required: true,
            columns: [{ key: "value", label: "Value", type: "number" }],
          },
          {
            kind: "scalar",
            key: "measurements_value_mean",
            label: "Measurement mean",
            required: false,
            metadata: {
              source: "variable_binding",
              bindingSource: "table_statistic",
              fieldKey: "measurements",
              columnKey: "value",
              statistic: "mean",
            },
          },
        ],
        formulas: [
          {
            key: "average",
            label: "Average",
            expression: "measurements_value_mean + 0",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements: [{ value: 10 }, {}] },
          },
        ],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.diagnostics.some(
        (item) => item.code === "PREVIEW_TABLE_BINDING_CELL_MISSING",
      ),
    ).toBe(true);
    expect(result.previewResults[0]?.passed).toBe(false);
  });

  it("preserves formula labels, output kind, and reporting metadata", () => {
    const result = compileMethodDraft(
      validDraft({
        formulas: [
          {
            key: "error",
            label: "Erro de indicação",
            expression: "indication - reference",
            outputUnit: "g",
            outputKind: "error",
            required: true,
            reporting: {
              includeInCertificate: true,
              group: "calibration_result",
              role: "primary_result",
            },
          },
        ],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method.formulas[0]).toMatchObject({
      label: "Erro de indicação",
      outputKind: "error",
      reporting: {
        includeInCertificate: true,
        group: "calibration_result",
        role: "primary_result",
      },
    });
  });

  it("executes table-row formulas in row order", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "reference",
            label: "Reference",
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
          {
            key: "shifted_error",
            label: "Shifted error",
            expression: "error + 1",
            scope: { kind: "table_row", tableKey: "readings" },
            required: true,
          },
        ],
        acceptanceCriteria: [
          {
            key: "max_error",
            label: "Max error",
            expression: "max(error) <= 2",
            severity: "blocking",
            message: "Error too high",
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              reference: 10,
              readings: [{ indication: 10.1 }, { indication: 10.2 }],
            },
            expected: {
              formulas: {
                error: [0.1, 0.2],
                shifted_error: [1.1, 1.2],
              },
            },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewResults[0]?.formulaResults[0]?.value).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
    ]);
    expect(result.previewResults[0]?.passed).toBe(true);
  });

  it("rejects scalar formulas that directly reference row formula outputs", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
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
            expression: "indication",
            scope: { kind: "table_row", tableKey: "readings" },
            required: true,
          },
          {
            key: "bad",
            label: "Bad",
            expression: "error + 1",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "ROW_FORMULA_OUTPUT_REQUIRES_AGGREGATE",
      ),
    ).toBe(true);
  });

  it("reports row-indexed diagnostics for invalid row formula inputs", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
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
            key: "copy",
            label: "Copy",
            expression: "indication + 0",
            scope: { kind: "table_row", tableKey: "readings" },
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "bad_row",
            label: "Bad row",
            inputs: { readings: [{ indication: 10 }, {}] },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.path?.includes("formulas.copy.1")),
    ).toBe(true);
  });

  it("preserves table column role and mass composition metadata", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "composition",
            label: "Composition",
            required: false,
            columns: [
              {
                key: "standard",
                label: "Standard",
                type: "text",
                role: "mass_standard_composition",
                massComposition: {
                  targetUnit: "g",
                  optionSource: "composition_profiles",
                  targetColumns: {
                    compositionLabel: "standard",
                    expandedUncertainty: "u",
                  },
                  uncertaintyMode: "expanded_rss",
                  quantityMode: "profile_linear",
                },
              },
              { key: "u", label: "U", type: "number" },
            ],
          },
          {
            kind: "scalar",
            key: "reference",
            label: "Reference",
            required: true,
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            expression: "reference",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method.inputs[0]).toMatchObject({
      kind: "table",
      columns: [
        {
          key: "standard",
          role: "mass_standard_composition",
          massComposition: {
            targetUnit: "g",
            optionSource: "composition_profiles",
            targetColumns: {
              compositionLabel: "standard",
              expandedUncertainty: "u",
            },
            quantityMode: "profile_linear",
          },
        },
        { key: "u" },
      ],
    });
  });

  it("rejects publishable previews with too few repeated observations", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "repeated_observation",
            key: "readings",
            label: "Readings",
            required: true,
            minCount: 3,
          },
          {
            kind: "scalar",
            key: "reference",
            label: "Reference",
            required: true,
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            expression: "reference",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { readings: [1, 2], reference: 10 },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.code === "PREVIEW_FAILED"),
    ).toBe(true);
  });

  it("rejects publishable previews with empty required tables", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            required: true,
            columns: [{ key: "value", label: "Value", type: "number" }],
          },
          {
            kind: "scalar",
            key: "reference",
            label: "Reference",
            required: true,
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            expression: "reference",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements: [], reference: 10 },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.code === "PREVIEW_FAILED"),
    ).toBe(true);
  });

  it("rejects unknown acceptance criterion variables", () => {
    const result = compileMethodDraft(
      validDraft({
        acceptanceCriteria: [
          {
            key: "bad",
            label: "Bad",
            expression: "missing <= 1",
            severity: "blocking",
            message: "Bad criterion",
          },
        ],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "ACCEPTANCE_CRITERION_COMPILE_FAILED",
      ),
    ).toBe(true);
  });

  it("rejects unknown measurement model variables", () => {
    const result = compileMethodDraft(
      validDraft({
        formulas: [],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "model",
            label: "Model",
            measurand: "y",
            expression: "x + typo",
            quantities: [
              {
                symbol: "x",
                source: { kind: "input", key: "indication" },
                uncertainty: {
                  kind: "direct_standard_uncertainty",
                  standardUncertainty: 0.1,
                },
              },
            ],
          },
        ],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "MEASUREMENT_MODEL_COMPILE_FAILED",
      ),
    ).toBe(true);
  });

  it("validates Type A observation inputs at compile time", () => {
    const result = compileMethodDraft(
      validDraft({
        formulas: [],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "model",
            label: "Model",
            measurand: "y",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: { kind: "input", key: "indication" },
                uncertainty: {
                  kind: "type_a",
                  observationsInputKey: "indication",
                },
              },
            ],
          },
        ],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "MEASUREMENT_MODEL_COMPILE_FAILED",
      ),
    ).toBe(true);
  });

  it("executes table-row measurement models with row quantity sources", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [
              { key: "indication", label: "Indication", type: "number" },
              { key: "repeat_1", label: "Repeat 1", type: "number" },
              { key: "repeat_2", label: "Repeat 2", type: "number" },
            ],
          },
        ],
        formulas: [],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "row_gum",
            label: "Row GUM",
            scope: { kind: "table_row", tableKey: "measurements" },
            measurand: "x",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: {
                  kind: "table_column",
                  tableKey: "measurements",
                  columnKey: "indication",
                },
                uncertainty: {
                  kind: "type_a",
                  observations: [
                    {
                      kind: "table_column",
                      tableKey: "measurements",
                      columnKey: "repeat_1",
                    },
                    {
                      kind: "table_column",
                      tableKey: "measurements",
                      columnKey: "repeat_2",
                    },
                  ],
                },
              },
            ],
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              measurements: [
                { indication: 10, repeat_1: 9.9, repeat_2: 10.1 },
                { indication: 20, repeat_1: 19.9, repeat_2: 20.1 },
              ],
            },
          },
        ],
      }),
      { engine: fakeGumEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const execution = executeCompiledMethod(
      result.method,
      {
        inputs: {
          measurements: [
            { indication: 10, repeat_1: 9.9, repeat_2: 10.1 },
            { indication: 20, repeat_1: 19.9, repeat_2: 20.1 },
          ],
        },
      },
      { engine: fakeGumEngine },
    );

    expect(execution.ok).toBe(true);
    expect(execution.outputs.row_gum).toEqual([10, 20]);
    expect(execution.measurementModelResults[0]?.result).toHaveLength(2);
  });

  it("rejects table-column quantity sources outside table-row measurement models", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [
              { key: "indication", label: "Indication", type: "number" },
            ],
          },
        ],
        formulas: [],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "bad_model",
            label: "Bad model",
            measurand: "x",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: {
                  kind: "table_column",
                  tableKey: "measurements",
                  columnKey: "indication",
                },
                uncertainty: {
                  kind: "direct_standard_uncertainty",
                  standardUncertainty: 0.1,
                },
              },
            ],
          },
        ],
      }),
      { engine: fakeGumEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "MEASUREMENT_MODEL_COMPILE_FAILED",
      ),
    ).toBe(true);
  });

  it("rejects row formulas that directly bind columns from another table", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "table_a",
            label: "Table A",
            columns: [{ key: "value", label: "Value", type: "number" }],
          },
          {
            kind: "table",
            key: "table_b",
            label: "Table B",
            columns: [{ key: "value", label: "Value", type: "number" }],
          },
          {
            kind: "scalar",
            key: "b_value",
            label: "B value",
            required: false,
            metadata: {
              source: "variable_binding",
              bindingSource: "table_column",
              fieldKey: "table_b",
              columnKey: "value",
            },
          },
        ],
        formulas: [
          {
            key: "row_value",
            label: "Row value",
            scope: { kind: "table_row", tableKey: "table_a" },
            expression: "b_value + 1",
            required: true,
          },
        ],
        acceptanceCriteria: [],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "ROW_FORMULA_CROSS_TABLE_BINDING",
      ),
    ).toBe(true);
  });

  it("rejects ambiguous row column and formula output name collisions", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [
              { key: "reading", label: "Reading", type: "number" },
              { key: "error", label: "Error column", type: "number" },
            ],
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error formula",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "reading",
            required: true,
          },
          {
            key: "shifted_error",
            label: "Shifted error",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "error + 1",
            required: true,
          },
        ],
        acceptanceCriteria: [],
      }),
      { engine: fakeEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "ROW_FORMULA_VARIABLE_COLLISION",
      ),
    ).toBe(true);
  });

  it("does not shift dependent row formula outputs after a row failure", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [
          {
            key: "row_reading",
            label: "Row reading",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "reading",
            required: true,
          },
          {
            key: "shifted",
            label: "Shifted",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "row_reading + 1",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements: [{}, { reading: 10 }] },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) =>
          item.code === "ROW_FORMULA_PREVIEW_FAILED" &&
          item.path === "formulas.shifted.0",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (item) =>
          item.code === "ROW_FORMULA_PREVIEW_FAILED" &&
          item.path === "formulas.shifted.1",
      ),
    ).toBe(true);
  });

  it("rejects scalar measurement models sourced from row formulas", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [
          {
            key: "row_reading",
            label: "Row reading",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "reading",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "scalar_model",
            label: "Scalar model",
            measurand: "x",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: { kind: "formula", key: "row_reading" },
                uncertainty: {
                  kind: "direct_standard_uncertainty",
                  standardUncertainty: 0.1,
                },
              },
            ],
          },
        ],
      }),
      { engine: fakeGumEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "MEASUREMENT_MODEL_COMPILE_FAILED",
      ),
    ).toBe(true);
  });

  it("requires aggregates for row measurement model acceptance criteria", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [],
        measurementModels: [
          {
            key: "row_gum",
            label: "Row GUM",
            scope: { kind: "table_row", tableKey: "measurements" },
            measurand: "x",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: {
                  kind: "table_column",
                  tableKey: "measurements",
                  columnKey: "reading",
                },
                uncertainty: {
                  kind: "direct_standard_uncertainty",
                  standardUncertainty: 0.1,
                },
              },
            ],
          },
        ],
        acceptanceCriteria: [
          {
            key: "direct_row_model",
            label: "Direct row model",
            expression: "row_gum <= 10",
            severity: "blocking",
            message: "Bad",
          },
        ],
      }),
      { engine: fakeGumEngine },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) =>
          item.code === "ROW_MEASUREMENT_MODEL_OUTPUT_REQUIRES_AGGREGATE",
      ),
    ).toBe(true);
  });

  it("preserves global repeated observations in row measurement models", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "repeated_observation",
            key: "repeatability",
            label: "Repeatability",
            minCount: 2,
            required: true,
          },
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "row_gum",
            label: "Row GUM",
            scope: { kind: "table_row", tableKey: "measurements" },
            measurand: "x",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: {
                  kind: "table_column",
                  tableKey: "measurements",
                  columnKey: "reading",
                },
                uncertainty: {
                  kind: "type_a",
                  observationsInputKey: "repeatability",
                },
              },
            ],
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              repeatability: [1, 2, 3],
              measurements: [{ reading: 10 }, { reading: 20 }],
            },
            expected: {
              measurementModels: { row_gum: { estimate: [10, 20] } },
            },
          },
        ],
      }),
      { engine: fakeGumEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("validates expected values for row measurement models", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "row_gum",
            label: "Row GUM",
            scope: { kind: "table_row", tableKey: "measurements" },
            measurand: "x",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: {
                  kind: "table_column",
                  tableKey: "measurements",
                  columnKey: "reading",
                },
                uncertainty: {
                  kind: "direct_standard_uncertainty",
                  standardUncertainty: 0.1,
                },
              },
            ],
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements: [{ reading: 10 }, { reading: 20 }] },
            expected: {
              measurementModels: { row_gum: { estimate: [10, 21] } },
            },
          },
        ],
      }),
      { engine: fakeGumEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "PREVIEW_EXPECTED_VALUE_MISMATCH",
      ),
    ).toBe(true);
  });

  it("keeps row arrays available for aggregates inside row formulas", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "reading",
            required: true,
          },
          {
            key: "deviation",
            label: "Deviation",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "error - mean(error)",
            required: true,
          },
        ],
        measurementModels: [],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements: [{ reading: 10 }, { reading: 20 }] },
            expected: { formulas: { deviation: [-5, 5] } },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("evaluates inline-list aggregates from the current row in row formulas", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [
              { key: "reading_1", label: "Reading 1", type: "number" },
              { key: "reading_2", label: "Reading 2", type: "number" },
              { key: "reading_3", label: "Reading 3", type: "number" },
            ],
          },
        ],
        formulas: [
          {
            key: "row_stddev",
            label: "Row standard deviation",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "std([reading_1, reading_2, reading_3], 1)",
            required: true,
          },
        ],
        measurementModels: [],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              measurements: [
                { reading_1: 10, reading_2: 10, reading_3: 10 },
                { reading_1: 20, reading_2: 21, reading_3: 22 },
                { reading_1: 1000.73, reading_2: 1000.73, reading_3: 1000.73 },
              ],
            },
            expected: { formulas: { row_stddev: [0, 1, 0] } },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewResults[0]?.formulaResults[0]?.value).toEqual([
      0, 1, 0,
    ]);
  });

  it("allows row formulas to aggregate cross-table bindings", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
          {
            kind: "table",
            key: "references",
            label: "References",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
          {
            kind: "scalar",
            key: "reference_reading",
            label: "Reference reading",
            required: false,
            metadata: {
              source: "variable_binding",
              bindingSource: "table_column",
              fieldKey: "references",
              columnKey: "reading",
            },
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "reading - mean(reference_reading)",
            required: true,
          },
        ],
        measurementModels: [],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              measurements: [{ reading: 10 }, { reading: 20 }],
              references: [{ reading: 100 }, { reading: 110 }],
            },
            expected: { formulas: { error: [-95, -85] } },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("allows row formulas to aggregate repeated observations", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "repeated_observation",
            key: "reference_runs",
            label: "Reference runs",
            minCount: 2,
            required: true,
          },
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "reading - mean(reference_runs)",
            required: true,
          },
        ],
        measurementModels: [],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              reference_runs: [1, 3],
              measurements: [{ reading: 10 }, { reading: 20 }],
            },
            expected: { formulas: { error: [8, 18] } },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("allows inline-list aggregates over row outputs in criteria", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [
          {
            key: "error",
            label: "Error",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "reading",
            required: true,
          },
          {
            key: "shifted_error",
            label: "Shifted error",
            scope: { kind: "table_row", tableKey: "measurements" },
            expression: "reading + 1",
            required: true,
          },
        ],
        measurementModels: [],
        acceptanceCriteria: [
          {
            key: "mean_error",
            label: "Mean error",
            expression: "mean([error, shifted_error]) <= 10",
            severity: "blocking",
            message: "Mean error too high",
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements: [{ reading: 1 }, { reading: 2 }] },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("uses explicit row table-column sources over global name collisions", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "x",
            label: "Global x",
            required: true,
          },
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "x", label: "X", type: "number" }],
          },
        ],
        formulas: [],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "row_gum",
            label: "Row GUM",
            scope: { kind: "table_row", tableKey: "measurements" },
            measurand: "q",
            expression: "q",
            quantities: [
              {
                symbol: "q",
                source: {
                  kind: "table_column",
                  tableKey: "measurements",
                  columnKey: "x",
                },
                uncertainty: {
                  kind: "direct_standard_uncertainty",
                  standardUncertainty: 0.1,
                },
              },
            ],
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              x: 999,
              measurements: [{ x: 10 }, { x: 20 }],
            },
            expected: {
              measurementModels: { row_gum: { estimate: [10, 20] } },
            },
          },
        ],
      }),
      { engine: fakeGumEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("does not reject unrelated row arrays while evaluating row models", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "table_a",
            label: "Table A",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
          {
            kind: "table",
            key: "table_b",
            label: "Table B",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [
          {
            key: "row_a",
            label: "Row A",
            scope: { kind: "table_row", tableKey: "table_a" },
            expression: "reading",
            required: true,
          },
        ],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "row_b_gum",
            label: "Row B GUM",
            scope: { kind: "table_row", tableKey: "table_b" },
            measurand: "x",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: {
                  kind: "table_column",
                  tableKey: "table_b",
                  columnKey: "reading",
                },
                uncertainty: {
                  kind: "direct_standard_uncertainty",
                  standardUncertainty: 0.1,
                },
              },
            ],
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              table_a: [{ reading: 1 }, { reading: 2 }],
              table_b: [{ reading: 10 }, { reading: 20 }],
            },
            expected: {
              measurementModels: { row_b_gum: { estimate: [10, 20] } },
            },
          },
        ],
      }),
      { engine: fakeGumEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });

  it("validates expected uncertainty arrays for row measurement models", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "table",
            key: "measurements",
            label: "Measurements",
            columns: [{ key: "reading", label: "Reading", type: "number" }],
          },
        ],
        formulas: [],
        acceptanceCriteria: [],
        measurementModels: [
          {
            key: "row_gum",
            label: "Row GUM",
            scope: { kind: "table_row", tableKey: "measurements" },
            measurand: "x",
            expression: "x",
            quantities: [
              {
                symbol: "x",
                source: {
                  kind: "table_column",
                  tableKey: "measurements",
                  columnKey: "reading",
                },
                uncertainty: {
                  kind: "direct_standard_uncertainty",
                  standardUncertainty: 0.1,
                },
              },
            ],
          },
        ],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: { measurements: [{ reading: 10 }, { reading: 20 }] },
            expected: {
              measurementModels: {
                row_gum: {
                  estimate: [10, 20],
                  standardUncertainty: [0.2, 0.2],
                },
              },
            },
          },
        ],
      }),
      { engine: fakeGumEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "PREVIEW_EXPECTED_VALUE_MISMATCH",
      ),
    ).toBe(true);
  });

  it("avoids aggregate placeholder collisions with user variables", () => {
    const result = compileMethodDraft(
      validDraft({
        inputs: [
          {
            kind: "scalar",
            key: "cf_internal_agg_0",
            label: "Compile placeholder-shaped input",
            required: true,
          },
          {
            kind: "scalar",
            key: "cf_internal_preview_0",
            label: "Preview placeholder-shaped input",
            required: true,
          },
          {
            kind: "repeated_observation",
            key: "observations",
            label: "Observations",
            minCount: 2,
            required: true,
          },
        ],
        formulas: [
          {
            key: "compile_safe",
            label: "Compile safe",
            expression: "cf_internal_agg_0 + mean(observations)",
            required: true,
          },
          {
            key: "preview_safe",
            label: "Preview safe",
            expression: "cf_internal_preview_0 + mean(observations)",
            required: true,
          },
        ],
        measurementModels: [],
        acceptanceCriteria: [],
        previewScenarios: [
          {
            key: "nominal",
            label: "Nominal",
            inputs: {
              cf_internal_agg_0: 1,
              cf_internal_preview_0: 2,
              observations: [3, 3],
            },
            expected: {
              formulas: {
                compile_safe: 4,
                preview_safe: 5,
              },
            },
          },
        ],
      }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(true);
  });
});
