import { describe, expect, it } from "vitest";
import {
  compileMethodDraft,
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
          ?.filter((token) => !["abs", "mean", "std"].includes(token)) ?? [],
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

function evaluateTestExpression(
  expression: string,
  inputs: Readonly<Record<string, NumericInput>>,
): number {
  const trimmed = expression.trim();
  const absMatch = trimmed.match(/^abs\(([^)]+)\)$/);
  if (absMatch?.[1])
    return Math.abs(evaluateTestExpression(absMatch[1], inputs));

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
                  quantityMode: "linear_per_item_then_rss",
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
});
