import { describe, expect, test } from "vitest";

import {
  checkMethodRecordDimensions,
  dimensionalInputFromMethodRecord,
} from "../src/dimensional";

// The record adapter feeds BOTH the API write-gate and the read-only audit
// script, so it must map the untyped persisted/payload shape (dataFields /
// formulas / measurementModels) to the checker input without throwing on
// partial rows.

describe("dimensionalInputFromMethodRecord", () => {
  test("flattens scalar fields, table columns and formulas (with units)", () => {
    const input = dimensionalInputFromMethodRecord({
      dataFields: [
        { key: "massa", type: "number", unit: "g" },
        {
          key: "leituras",
          type: "table",
          columns: [{ key: "valor", type: "number", unit: "mm" }],
        },
      ],
      formulas: [{ outputKey: "erro", expression: "massa", unit: "g" }],
    });

    expect(input.fields).toEqual([
      { symbol: "massa", unit: "g" },
      { symbol: "valor", unit: "mm" },
    ]);
    expect(input.formulas).toEqual([
      { id: "erro", expression: "massa", resultUnit: "g" },
    ]);
  });

  test("tolerates missing units (→ null) and undefined arrays without throwing", () => {
    const input = dimensionalInputFromMethodRecord({
      dataFields: [{ key: "x", type: "number" }],
    });
    expect(input.fields).toEqual([{ symbol: "x", unit: null }]);
    expect(input.formulas).toEqual([]);
    expect(input.quantities).toEqual([]);
  });

  test("collects measurement-model quantities and formulas", () => {
    const input = dimensionalInputFromMethodRecord({
      measurementModels: [
        {
          key: "erro",
          measurand: "E",
          expression: "ind - ref",
          outputUnit: "mm",
          quantities: [
            { symbol: "ind", unit: "mm" },
            { symbol: "ref", unit: "mm" },
          ],
        },
      ],
    });
    expect(input.quantities).toEqual([
      { symbol: "ind", unit: "mm" },
      { symbol: "ref", unit: "mm" },
    ]);
    expect(input.formulas).toEqual([
      {
        id: "erro",
        expression: "ind - ref",
        resultUnit: "mm",
        resultSymbol: "E",
      },
    ]);
  });
});

describe("checkMethodRecordDimensions", () => {
  test("flags massa[g] + tensao[V] on the raw record shape", () => {
    const diags = checkMethodRecordDimensions({
      dataFields: [
        { key: "massa", type: "number", unit: "g" },
        { key: "tensao", type: "number", unit: "V" },
      ],
      formulas: [
        { outputKey: "erro", expression: "massa + tensao", unit: "g" },
      ],
    });
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0]?.code).toBe("DIMENSIONAL_MISMATCH");
    expect(diags[0]?.formulaId).toBe("erro");
  });

  test("passes a Magnus-style empirical formula (t[°C] → hPa)", () => {
    const diags = checkMethodRecordDimensions({
      dataFields: [{ key: "t", type: "number", unit: "°C" }],
      formulas: [
        {
          outputKey: "es",
          expression: "6.112 * exp(17.62 * t / (243.12 + t))",
          unit: "hPa",
        },
      ],
    });
    expect(diags).toEqual([]);
  });
});
