import { describe, expect, it } from "vitest";

import {
  createCalculationEngine,
  METHOD_ENGINE_OPTIONS,
} from "@calibra-facil/math-engine";
import {
  compileMethodDraft,
  executeCompiledMethod,
  type CalculationEngineLike,
  type MethodDraft,
} from "../src";

/**
 * Golden fixture through the REAL math-engine — every other method-definition
 * test injects a fake engine, so this is the only coverage of the seam that
 * produces actual certificate uncertainty budgets: compileMethodDraft →
 * executeCompiledMethod → evaluateMeasurementModel, with the canonical
 * METHOD_ENGINE_OPTIONS used by the cloud API and the local desktop server.
 *
 * The model is multi-variable with a non-unit sensitivity coefficient, so the
 * symbolic differentiation path (math-engine formula/derivative.ts) is
 * exercised and asserted against hand-computed GUM values.
 */

function realMethodEngine(): CalculationEngineLike {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- same adapter apps/api and apps/local-server use: math-engine exposes a narrower concrete type than the method-definition execution seam.
  return createCalculationEngine(
    METHOD_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;
}

function budgetEntry(entry: unknown): {
  symbol: string;
  contributionPercent: number;
} {
  if (entry === null || typeof entry !== "object") {
    throw new Error("Invalid uncertainty budget entry");
  }

  const symbol: unknown = Reflect.get(entry, "symbol");
  const contributionPercent = Number(
    Reflect.get(entry, "contributionPercent"),
  );

  if (typeof symbol !== "string" || !Number.isFinite(contributionPercent)) {
    throw new Error("Invalid uncertainty budget entry");
  }

  return { symbol, contributionPercent };
}

// y = x1 + 2·x2 with x1 = 10, u(x1) = 0.10 and x2 = 5, u(x2) = 0.05.
// Hand-computed per JCGM 100:2008:
//   c1 = ∂y/∂x1 = 1, c2 = ∂y/∂x2 = 2
//   y   = 10 + 2·5 = 20
//   u_c = √((1·0.10)² + (2·0.05)²) = √0.02 = 0.14142135…
//   ν_eff = ∞ (both components with infinite dof) → k(p = 95,45 %) = 2.000
//   U   = k·u_c = 0.28284271…
//   contributions: 0.01/0.02 each → 50 % / 50 %
const goldenDraft: MethodDraft = {
  id: "golden_linear_model",
  version: 1,
  status: "draft",
  name: "Golden: y = x1 + 2*x2",
  inputs: [
    { kind: "scalar", key: "x1", label: "Leitura", required: true },
    { kind: "scalar", key: "x2", label: "Correção", required: true },
  ],
  formulas: [],
  measurementModels: [
    {
      key: "y",
      label: "Saída",
      measurand: "y",
      expression: "x1 + 2 * x2",
      coverageProbability: 0.9545,
      quantities: [
        {
          symbol: "x1",
          source: { kind: "input", key: "x1" },
          degreesOfFreedom: "Infinity",
          uncertainty: {
            kind: "type_b",
            distribution: "normal",
            standardUncertainty: "0.10",
          },
        },
        {
          symbol: "x2",
          source: { kind: "input", key: "x2" },
          degreesOfFreedom: "Infinity",
          uncertainty: {
            kind: "direct_standard_uncertainty",
            standardUncertainty: "0.05",
          },
        },
      ],
    },
  ],
  acceptanceCriteria: [],
  previewScenarios: [
    { key: "nominal", label: "Nominal", inputs: { x1: "10.0", x2: "5.0" } },
  ],
  metadata: {},
};

describe("real-engine golden uncertainty budget", () => {
  it("compiles and executes y = x1 + 2·x2 to the hand-computed GUM budget", () => {
    const engine = realMethodEngine();

    const compiled = compileMethodDraft(goldenDraft, { engine });
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;

    const execution = executeCompiledMethod(
      compiled.method,
      { inputs: { x1: "10.0", x2: "5.0" } },
      { engine },
    );

    expect(execution.ok, JSON.stringify(execution.diagnostics)).toBe(true);

    const modelResult = execution.measurementModelResults[0]?.result;
    if (modelResult === undefined || Array.isArray(modelResult)) {
      throw new Error("Expected a scalar measurement model result");
    }

    // Measurand value
    expect(Number(modelResult.value)).toBeCloseTo(20, 12);

    // Combined standard uncertainty u_c = √0.02
    const expectedUc = Math.sqrt(0.02);
    expect(Number(modelResult.combinedStandardUncertainty)).toBeCloseTo(
      expectedUc,
      10,
    );

    // Sensitivity coefficients from symbolic differentiation
    expect(Number(modelResult.sensitivityCoefficients.x1)).toBeCloseTo(1, 10);
    expect(Number(modelResult.sensitivityCoefficients.x2)).toBeCloseTo(2, 10);

    // ν_eff = ∞ → k(95,45 %) ≈ 2.000, U = k·u_c
    expect(Number(modelResult.effectiveDegreesOfFreedom)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(Number(modelResult.coverageFactor)).toBeCloseTo(2.0, 3);
    expect(Number(modelResult.expandedUncertainty)).toBeCloseTo(
      2.0 * expectedUc,
      3,
    );
    expect(modelResult.coverageProbability).toBe(0.9545);

    // Budget: two entries at 50 % contribution each
    const budget = modelResult.uncertaintyBudget.map(budgetEntry);
    expect(budget).toHaveLength(2);
    for (const symbol of ["x1", "x2"]) {
      const entry = budget.find((candidate) => candidate.symbol === symbol);
      expect(entry, symbol).toBeDefined();
      expect(entry?.contributionPercent, symbol).toBeCloseTo(50, 6);
    }

    // The execution output carries the measurand value for the certificate
    expect(Number(execution.outputs.y)).toBeCloseTo(20, 12);
  });
});
