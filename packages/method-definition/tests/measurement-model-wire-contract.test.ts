import { describe, expect, it } from "vitest";

import type { MethodMeasurementModel as WireMethodMeasurementModel } from "@calibra-facil/schemas";
import type { MethodMeasurementModel } from "../src/types";

// Compile-time contract: the compiled (strongly typed) measurement model must
// stay assignable to the wire shape owned by @calibra-facil/schemas — the
// shape validated at the API boundary and persisted in the method jsonb
// columns (packages/db re-exports it). If either side drifts, this function
// stops compiling and check-types fails.
function asWireModel(
  model: MethodMeasurementModel,
): WireMethodMeasurementModel {
  return model;
}

describe("measurement model wire contract", () => {
  it("keeps the compiled model assignable to the schemas wire shape", () => {
    const model: MethodMeasurementModel = {
      key: "y",
      label: "Saída",
      measurand: "y",
      expression: "x1 + 2 * x2",
      quantities: [
        {
          symbol: "x1",
          source: { kind: "input", key: "x1" },
          uncertainty: {
            kind: "type_b",
            distribution: "normal",
            standardUncertainty: "0.1",
          },
        },
      ],
      coverageProbability: 0.9545,
    };

    expect(asWireModel(model)).toBe(model);
  });
});
