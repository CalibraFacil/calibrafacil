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
          ?.filter((token) => token !== "abs") ?? [],
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
  if (absMatch?.[1]) return Math.abs(evaluateTestExpression(absMatch[1], inputs));

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
    expect(result.diagnostics.some((item) => item.code === "FORMULA_CYCLE")).toBe(true);
  });

  it("rejects publishable methods without preview scenarios", () => {
    const result = compileMethodDraft(
      validDraft({ previewScenarios: [] }),
      { engine: fakeEngine, requirePublishable: true },
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "PREVIEW_REQUIRED")).toBe(true);
  });
});
