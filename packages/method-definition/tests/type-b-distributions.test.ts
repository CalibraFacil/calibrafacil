import { describe, expect, it } from "vitest";

import { GUM_TYPE_B_DISTRIBUTIONS } from "@calibra-facil/shared";
import {
  compileMethodDraft,
  createMethodExecutionEngine,
  executeCompiledMethod,
  type MethodDraft,
} from "../src";

/**
 * A measurement model stores its Type B distribution snake_case (`u_shaped`),
 * the engine knows `u-shaped`; `buildMeasurementModelInput` is the one place
 * that maps. Every stored value (GUM_TYPE_B_DISTRIBUTIONS, the list the schema
 * and the web builder share) must reach the real engine as a distribution it
 * accepts, so a value added to the list cannot be selectable but unexecutable.
 */
function draftWith(
  distribution: (typeof GUM_TYPE_B_DISTRIBUTIONS)[number],
): MethodDraft {
  return {
    id: `type_b_${distribution}`,
    version: 1,
    status: "draft",
    name: `Type B ${distribution}`,
    inputs: [{ kind: "scalar", key: "x1", label: "x1", required: true }],
    formulas: [],
    measurementModels: [
      {
        key: "y",
        label: "y",
        measurand: "y",
        expression: "x1",
        coverageProbability: 0.9545,
        quantities: [
          {
            symbol: "x1",
            source: { kind: "input", key: "x1" },
            degreesOfFreedom: "Infinity",
            uncertainty: {
              kind: "type_b",
              distribution,
              // A normal source is given as a standard uncertainty; the others
              // as a half width (custom with its documented divisor).
              ...(distribution === "normal"
                ? { standardUncertainty: "0.3" }
                : { halfWidth: "0.3" }),
              ...(distribution === "custom" ? { divisor: "2" } : {}),
            },
          },
        ],
      },
    ],
    acceptanceCriteria: [],
    previewScenarios: [{ key: "n", label: "n", inputs: { x1: "10.0" } }],
    metadata: {},
  };
}

describe("Type B distributions of a measurement model", () => {
  it.each([...GUM_TYPE_B_DISTRIBUTIONS])(
    "%s compiles and executes through the real engine",
    (distribution) => {
      const engine = createMethodExecutionEngine();
      const compiled = compileMethodDraft(draftWith(distribution), { engine });
      expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
      if (!compiled.ok) return;

      const execution = executeCompiledMethod(
        compiled.method,
        { inputs: { x1: "10.0" } },
        { engine },
      );
      expect(execution.ok, JSON.stringify(execution.diagnostics)).toBe(true);
    },
  );

  it("u_shaped divides the half width by sqrt(2)", () => {
    const engine = createMethodExecutionEngine();
    const compiled = compileMethodDraft(draftWith("u_shaped"), { engine });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const execution = executeCompiledMethod(
      compiled.method,
      { inputs: { x1: "10.0" } },
      { engine },
    );
    const result = execution.measurementModelResults[0]?.result;
    if (result === undefined || Array.isArray(result)) {
      throw new Error("Expected a scalar result");
    }
    expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(
      0.3 / Math.SQRT2,
      10,
    );
  });
});
