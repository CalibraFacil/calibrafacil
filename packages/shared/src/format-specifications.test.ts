import { describe, expect, it } from "vitest";

import { formatSpecificationsForDisplay } from "./format-specifications";

describe("formatSpecificationsForDisplay", () => {
  it("pairs number fields with their unit, in definition order (balança)", () => {
    const out = formatSpecificationsForDisplay(
      [
        { key: "capacity", label: "Capacidade Máxima", type: "number", unit: "g" },
        { key: "resolution", label: "Resolução (d)", type: "number", unit: "g" },
        { key: "portaria", label: "Portaria", type: "text" },
      ],
      { capacity: 220, resolution: 0.001, portaria: "Portaria Inmetro nº 157/2022" },
    );
    expect(out).toEqual([
      { label: "Capacidade Máxima", value: "220 g" },
      { label: "Resolução (d)", value: "0.001 g" },
      { label: "Portaria", value: "Portaria Inmetro nº 157/2022" },
    ]);
  });

  it("renders non-weighing instruments generically (manômetro)", () => {
    const out = formatSpecificationsForDisplay(
      [
        { key: "rangeMin", label: "Faixa mínima", type: "number", unit: "bar" },
        { key: "rangeMax", label: "Faixa máxima", type: "number", unit: "bar" },
        { key: "pressureUnit", label: "Unidade de pressão", type: "select" },
      ],
      { rangeMin: 0, rangeMax: 10, pressureUnit: "bar" },
    );
    expect(out).toEqual([
      { label: "Faixa mínima", value: "0 bar" },
      { label: "Faixa máxima", value: "10 bar" },
      { label: "Unidade de pressão", value: "bar" },
    ]);
  });

  it("skips empty values and weighing_ranges fields", () => {
    const out = formatSpecificationsForDisplay(
      [
        { key: "capacity", label: "Capacidade", type: "number", unit: "g" },
        { key: "weighingRanges", label: "Faixas de pesagem", type: "weighing_ranges" },
        { key: "linearity", label: "Linearidade", type: "number", unit: "g" },
      ],
      { capacity: 500, weighingRanges: [{ min: 0, max: 500 }], linearity: "" },
    );
    expect(out).toEqual([{ label: "Capacidade", value: "500 g" }]);
  });

  it("returns [] for missing definition or specifications", () => {
    expect(formatSpecificationsForDisplay(null, { a: 1 })).toEqual([]);
    expect(
      formatSpecificationsForDisplay([{ key: "a", label: "A", type: "text" }], null),
    ).toEqual([]);
  });
});
