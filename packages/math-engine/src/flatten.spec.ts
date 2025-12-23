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

    it("should exclude nominal/reference/target keys", () => {
      const data = {
        reading: 100,
        nominal: 100,
        reference: 99.99,
        target: 100,
      };

      const result = flattenForExecution(data);

      expect(result["reading"]).toBe(100);
      expect(result["nominal"]).toBeUndefined();
      expect(result["reference"]).toBeUndefined();
      expect(result["target"]).toBeUndefined();
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
      expect(
        Object.keys(result).some((k) => k.includes("level6"))
      ).toBe(false);
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

    it("should deduplicate readings", () => {
      const data = {
        reading1: 10,
        reading2: 10,
        value: 10,
      };

      const readings = extractReadings(data);

      // Should only have one 10
      expect(readings.filter((r) => r === 10).length).toBe(1);
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
  });
});
