import { describe, it, expect } from "vitest";
import {
  flattenForExecution,
  extractReadings,
  injectEnvironmentData,
  injectInstrumentSpecs,
  getInputsUsed,
  parseUnitValue,
  normalizeToSI,
} from "./flatten";

describe("Data Flattening", () => {
  describe("flattenForExecution", () => {
    it("should flatten nested objects", () => {
      const data = {
        point1: { reading: 10.5, nominal: 10 },
        point2: { reading: 20.3, nominal: 20 },
      };

      const result = flattenForExecution(data);

      expect(result["point1_reading"]).toBe(10.5);
      expect(result["point2_reading"]).toBe(20.3);
    });

    it("should include all keys (no default exclusions)", () => {
      // EXCLUDE_KEYS is intentionally empty to allow user-defined variable names
      // like "linearity_nominal_value", "standard_ref", etc.
      const data = {
        reading: 100,
        nominal: 100,
        reference: 99.99,
        target: 100,
      };

      const result = flattenForExecution(data);

      // All keys should be included
      expect(result["reading"]).toBe(100);
      expect(result["nominal"]).toBe(100);
      expect(result["reference"]).toBe(99.99);
      expect(result["target"]).toBe(100);
    });

    it("should handle arrays with indices", () => {
      const data = {
        readings: [10.1, 10.2, 10.3],
      };

      const result = flattenForExecution(data);

      expect(result["readings_0"]).toBe(10.1);
      expect(result["readings_1"]).toBe(10.2);
      expect(result["readings_2"]).toBe(10.3);
      expect(result["readings_count"]).toBe(3);
    });

    it("should include PT-BR keys (leitura)", () => {
      const data = {
        leitura: 50.5,
        valor: 100,
      };

      const result = flattenForExecution(data);

      expect(result["leitura"]).toBe(50.5);
      expect(result["valor"]).toBe(100);
    });

    it("should respect maxDepth option", () => {
      const data = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: { value: 100 },
                },
              },
            },
          },
        },
      };

      const result = flattenForExecution(data, { maxDepth: 3 });

      // Should stop at depth 3
      expect(Object.keys(result).some((k) => k.includes("level6"))).toBe(false);
    });

    it("should apply custom include keys", () => {
      const data = {
        customKey: 42,
        anotherKey: 100,
      };

      const result = flattenForExecution(data, {
        includeKeys: ["customKey"],
      });

      expect(result["customKey"]).toBe(42);
      expect(result["anotherKey"]).toBeUndefined();
    });

    it("should apply include keys to flattened nested values", () => {
      const data = {
        point1: { reading: 10.5, nominal: 10 },
        point2: { reading: 20.5, nominal: 20 },
      };

      const result = flattenForExecution(data, {
        includeKeys: ["point1_reading", "nominal"],
      });

      expect(result["point1_reading"]).toBe(10.5);
      expect(result["point1_nominal"]).toBe(10);
      expect(result["point2_nominal"]).toBe(20);
      expect(result["point2_reading"]).toBeUndefined();
    });

    it("should apply custom exclude keys", () => {
      const data = {
        value: 100,
        secretKey: 999,
      };

      const result = flattenForExecution(data, {
        excludeKeys: ["secretKey"],
      });

      expect(result["value"]).toBe(100);
      expect(result["secretKey"]).toBeUndefined();
    });

    it("should handle boolean values", () => {
      const data = {
        isValid: true,
        hasError: false,
      };

      const result = flattenForExecution(data);

      expect(result["isValid"]).toBe(true);
      expect(result["hasError"]).toBe(false);
    });

    it("should handle string values", () => {
      const data = {
        unit: "kg",
        description: "Test measurement",
      };

      const result = flattenForExecution(data);

      expect(result["unit"]).toBe("kg");
      expect(result["description"]).toBe("Test measurement");
    });

    it("should skip array indices when option is false", () => {
      const data = {
        readings: [10.1, 10.2, 10.3],
      };

      const result = flattenForExecution(data, { includeArrayIndices: false });

      expect(result["readings_0"]).toBeUndefined();
      expect(result["readings_count"]).toBe(3);
    });
  });

  describe("extractReadings", () => {
    it("should extract numeric readings from nested structure", () => {
      const data = {
        points: [
          { reading: 10.1, nominal: 10 },
          { reading: 20.2, nominal: 20 },
          { reading: 30.3, nominal: 30 },
        ],
      };

      const readings = extractReadings(data);

      expect(readings).toContain(10.1);
      expect(readings).toContain(20.2);
      expect(readings).toContain(30.3);
    });

    it("should extract readings with PT-BR key (leitura)", () => {
      const data = {
        pontos: [{ leitura: 10.5 }, { leitura: 20.5 }],
      };

      const readings = extractReadings(data);

      expect(readings).toContain(10.5);
      expect(readings).toContain(20.5);
    });

    it("should extract array of values", () => {
      const data = {
        readings: [1, 2, 3, 4, 5],
      };

      const readings = extractReadings(data);

      expect(readings).toEqual([1, 2, 3, 4, 5]);
    });

    it("should extract values using custom keys", () => {
      const data = {
        measurements: [10, 20, 30],
      };

      const readings = extractReadings(data, ["measurement"]);

      expect(readings).toContain(10);
      expect(readings).toContain(20);
      expect(readings).toContain(30);
    });

    it("should preserve duplicate reading values", () => {
      // In metrology, repeated identical readings are valid and statistically significant
      // e.g., 4 measurements all reading 10.00 means n=4, not n=1
      const data = {
        reading1: 10,
        reading2: 10,
        value: 10,
      };

      const readings = extractReadings(data);

      // All 3 readings should be preserved (they come from different sources)
      expect(readings.filter((r) => r === 10).length).toBe(3);
    });

    it("should not extract ambiguous nominal/reference/target value fields", () => {
      const data = {
        point: {
          value: 10.1,
          nominal_value: 10,
          reference_value: 9.99,
          target_value: 10,
        },
        reference_values: [1, 2, 3],
      };

      const readings = extractReadings(data);

      expect(readings).toEqual([10.1]);
    });

    it("should extract numbered reading keys without substring matching", () => {
      const data = {
        reading1: 10,
        reading_2: 10.1,
        leitura3: 9.9,
        nominal_reading_reference: 100,
      };

      const readings = extractReadings(data);

      expect(readings).toEqual([10, 10.1, 9.9]);
    });

    it("should preserve repeated array readings", () => {
      // Common in calibration: multiple identical measurements
      const data = {
        readings: [10, 10, 10, 10],
      };

      const readings = extractReadings(data);

      // All 4 readings should be preserved for proper Type A uncertainty
      expect(readings).toEqual([10, 10, 10, 10]);
      expect(readings.length).toBe(4);
    });

    it("should handle empty data", () => {
      const readings = extractReadings({});

      expect(readings).toEqual([]);
    });
  });

  describe("injectEnvironmentData", () => {
    it("should inject environment data with prefix", () => {
      const context = { reading: 100 };
      const environment = {
        temperature: 23.5,
        humidity: 50,
      };

      const result = injectEnvironmentData(context, environment);

      expect(result["env_temperature"]).toBe(23.5);
      expect(result["env_humidity"]).toBe(50);
      expect(result["reading"]).toBe(100);
    });

    it("should skip undefined values", () => {
      const context = {};
      const environment = {
        temperature: 23.5,
        humidity: undefined,
      };

      const result = injectEnvironmentData(context, environment);

      expect(result["env_temperature"]).toBe(23.5);
      expect(result["env_humidity"]).toBeUndefined();
    });

    it("should not mutate original context", () => {
      const context = { reading: 100 };
      const environment = { temperature: 23.5 };

      injectEnvironmentData(context, environment);

      expect(context).toEqual({ reading: 100 });
    });
  });

  describe("injectInstrumentSpecs", () => {
    it("should inject instrument specs with prefix", () => {
      const context = { reading: 100 };
      const specs = {
        resolution: 0.01,
        accuracy: 0.001,
      };

      const result = injectInstrumentSpecs(context, specs);

      expect(result["inst_resolution"]).toBe(0.01);
      expect(result["inst_accuracy"]).toBe(0.001);
    });

    it("should skip undefined values", () => {
      const context = {};
      const specs = {
        resolution: 0.01,
        drift: undefined,
      };

      const result = injectInstrumentSpecs(context, specs);

      expect(result["inst_resolution"]).toBe(0.01);
      expect(result["inst_drift"]).toBeUndefined();
    });
  });

  describe("getInputsUsed", () => {
    it("should return list of non-null keys", () => {
      const context = {
        reading: 100,
        value: 50,
        empty: null,
      };

      const inputs = getInputsUsed(context);

      expect(inputs).toContain("reading");
      expect(inputs).toContain("value");
      expect(inputs).not.toContain("empty");
    });
  });

  describe("parseUnitValue", () => {
    it("should parse value with unit", () => {
      const result = parseUnitValue("10.5 kg");

      expect(result).toEqual({ value: 10.5, unit: "kg" });
    });

    it("should parse value without space", () => {
      const result = parseUnitValue("10.5kg");

      expect(result).toEqual({ value: 10.5, unit: "kg" });
    });

    it("should parse negative values", () => {
      const result = parseUnitValue("-3.2 mV");

      expect(result).toEqual({ value: -3.2, unit: "mV" });
    });

    it("should parse scientific notation", () => {
      const result = parseUnitValue("1e-6 Pa");

      expect(result).toEqual({ value: 1e-6, unit: "Pa" });
    });

    it("should return null for invalid format", () => {
      expect(parseUnitValue("invalid")).toBeNull();
      expect(parseUnitValue("")).toBeNull();
      expect(parseUnitValue("kg 10")).toBeNull();
    });
  });

  describe("normalizeToSI", () => {
    it("should convert g to kg", () => {
      const result = normalizeToSI(500, "g");

      expect(result).toEqual({ value: 0.5, baseUnit: "kg" });
    });

    it("should convert mm to m", () => {
      const result = normalizeToSI(1000, "mm");

      expect(result).toEqual({ value: 1, baseUnit: "m" });
    });

    it("should convert mbar to Pa", () => {
      const result = normalizeToSI(1, "mbar");

      expect(result).toEqual({ value: 100, baseUnit: "Pa" });
    });

    it("should convert mL to m3", () => {
      const result = normalizeToSI(1000, "mL");

      expect(result).toEqual({ value: 0.001, baseUnit: "m3" });
    });

    it("should return null for unknown unit", () => {
      const result = normalizeToSI(10, "unknown");

      expect(result).toBeNull();
    });

    it("should keep SI base units unchanged", () => {
      const result = normalizeToSI(10, "kg");

      expect(result).toEqual({ value: 10, baseUnit: "kg" });
    });
  });

  describe("Unit Normalization in Flatten", () => {
    it("should normalize unit strings when enabled", () => {
      const data = {
        mass: "500 g",
        length: "10 mm",
      };

      const result = flattenForExecution(data, { normalizeUnits: true });

      expect(result["mass"]).toBe(0.5); // 500g -> 0.5kg
      expect(result["length"]).toBe(0.01); // 10mm -> 0.01m
    });

    it("should keep raw values when normalization is disabled", () => {
      const data = {
        mass: "500 g",
      };

      const result = flattenForExecution(data, { normalizeUnits: false });

      expect(result["mass"]).toBe("500 g");
    });

    it("should preserve strings with unknown units instead of coercing to numbers", () => {
      const data = {
        mass: "10 foo",
      };

      const result = flattenForExecution(data, { normalizeUnits: true });

      expect(result["mass"]).toBe("10 foo");
    });
  });

  describe("preserveArrays option", () => {
    it("should preserve numeric arrays when enabled", () => {
      const data = {
        readings: [10, 10.1, 9.9, 10.2],
      };

      const result = flattenForExecution(data, { preserveArrays: true });

      // Array should be preserved
      expect(result["readings"]).toEqual([10, 10.1, 9.9, 10.2]);
      // Count should still be present
      expect(result["readings_count"]).toBe(4);
      // Individual indices should also be present (default includeArrayIndices: true)
      expect(result["readings_0"]).toBe(10);
      expect(result["readings_1"]).toBe(10.1);
    });

    it("should not preserve arrays by default (backward compatible)", () => {
      const data = {
        readings: [10, 10.1, 9.9],
      };

      const result = flattenForExecution(data);

      // Array should not be preserved (undefined key)
      expect(result["readings"]).toBeUndefined();
      // Individual indices should be present
      expect(result["readings_0"]).toBe(10);
      expect(result["readings_1"]).toBe(10.1);
      expect(result["readings_count"]).toBe(3);
    });

    it("should work with table-like nested structures", () => {
      // Simulates a table input with rows
      const data = {
        repeatability_test: [
          { reading: 10.0 },
          { reading: 10.1 },
          { reading: 9.9 },
        ],
      };

      const result = flattenForExecution(data, { preserveArrays: true });

      // Nested array of objects should be flattened, not preserved as array
      expect(result["repeatability_test_0_reading"]).toBe(10.0);
      expect(result["repeatability_test_1_reading"]).toBe(10.1);
      expect(result["repeatability_test_2_reading"]).toBe(9.9);
    });

    it("should preserve arrays without indices when includeArrayIndices is false", () => {
      const data = {
        readings: [10, 20, 30],
      };

      const result = flattenForExecution(data, {
        preserveArrays: true,
        includeArrayIndices: false,
      });

      // Array should be preserved
      expect(result["readings"]).toEqual([10, 20, 30]);
      // Individual indices should NOT be present
      expect(result["readings_0"]).toBeUndefined();
      expect(result["readings_1"]).toBeUndefined();
      // Count should still be present
      expect(result["readings_count"]).toBe(3);
    });

    it("should preserve empty arrays when preserveArrays is enabled", () => {
      const data = {
        readings: [],
        measurements: [],
      };

      const result = flattenForExecution(data, { preserveArrays: true });

      // Empty arrays should be preserved (variables must exist in scope)
      expect(result["readings"]).toEqual([]);
      expect(result["measurements"]).toEqual([]);
      // Count should be 0
      expect(result["readings_count"]).toBe(0);
      expect(result["measurements_count"]).toBe(0);
      // No indexed variables (nothing to index)
      expect(result["readings_0"]).toBeUndefined();
    });

    it("should discard empty arrays when preserveArrays is disabled (default)", () => {
      const data = {
        readings: [],
      };

      const result = flattenForExecution(data);

      // Empty arrays should not create any variables
      expect(result["readings"]).toBeUndefined();
      expect(result["readings_count"]).toBeUndefined();
    });
  });
});
