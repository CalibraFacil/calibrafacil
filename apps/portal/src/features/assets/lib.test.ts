import { describe, expect, it } from "vitest";

import { formatSpecificationLabel, formatSpecificationValue } from "./lib";

describe("formatSpecificationLabel", () => {
  it("uses the curated pt-BR label when the key is known", () => {
    expect(formatSpecificationLabel("scaleDivision")).toBe("Divisão de escala");
    expect(formatSpecificationLabel("weighingRanges")).toBe(
      "Faixas de pesagem",
    );
  });

  it("humanizes unknown camelCase and snake_case keys", () => {
    expect(formatSpecificationLabel("maxOperatingPressure")).toBe(
      "Max Operating Pressure",
    );
    expect(formatSpecificationLabel("probe_length")).toBe("Probe length");
  });
});

describe("formatSpecificationValue", () => {
  it("renders a dash for empty values", () => {
    expect(formatSpecificationValue(null)).toBe("-");
    expect(formatSpecificationValue(undefined)).toBe("-");
    expect(formatSpecificationValue("")).toBe("-");
  });

  it("joins arrays and stringifies objects", () => {
    expect(formatSpecificationValue(["0-150 g", "0-220 g"])).toBe(
      "0-150 g, 0-220 g",
    );
    expect(formatSpecificationValue({ min: 0, max: 220 })).toBe(
      '{"min":0,"max":220}',
    );
  });

  it("passes scalars through as strings", () => {
    expect(formatSpecificationValue(0.001)).toBe("0.001");
    expect(formatSpecificationValue("220 g")).toBe("220 g");
  });
});
