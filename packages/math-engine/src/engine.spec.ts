import { describe, it, expect, beforeEach } from "vitest";
import { CalibrationEngine, createEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";

describe("CalibrationEngine", () => {
  let engine: CalibrationEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  describe("Factory", () => {
    it("should create engine with default config", () => {
      const engine = createEngine();
      expect(engine).toBeInstanceOf(CalibrationEngine);
    });

    it("should create engine with custom precision", () => {
      const engine = createEngine({ precision: 64 });
      expect(engine.getVersion()).toBe(ENGINE_VERSION);
    });
  });

  describe("Formula Execution", () => {
    it("should evaluate simple formula", () => {
      const result = engine.evaluateFormula({
        formula: "2 + 3",
        context: {},
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resultAsNumber).toBe(5);
      }
    });

    it("should evaluate formula with context", () => {
      const result = engine.evaluateFormula({
        formula: "reading * calibrationFactor + offset",
        context: {
          reading: 100,
          calibrationFactor: 1.001,
          offset: 0.5,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resultAsNumber).toBeCloseTo(100.6, 5);
      }
    });

    it("should return error for invalid formula", () => {
      const result = engine.evaluateFormula({
        formula: "invalid syntax +++",
        context: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("FORMULA_ERROR");
      }
    });

    it("should return error for security violation", () => {
      // Test with a dangerous pattern in the formula itself
      // Note: Objects in context are rejected by Zod (which is also a security feature)
      const result = engine.evaluateFormula({
        formula: "Function('return 1')()",
        context: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("SECURITY_VIOLATION");
      }
    });

    it("should track execution time", () => {
      const result = engine.evaluateFormula({
        formula: "sqrt(16)",
        context: {},
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.executionTimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should preserve formula in result", () => {
      const formula = "pi * r^2";
      const result = engine.evaluateFormula({
        formula,
        context: { r: 5 },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.formula).toBe(formula);
      }
    });
  });

  describe("BigNumber Precision", () => {
    it("should correctly calculate 0.1 + 0.2", () => {
      const result = engine.evaluateFormula({
        formula: "0.1 + 0.2",
        context: {},
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.result).toBe("0.3");
        expect(result.data.resultAsNumber).toBeCloseTo(0.3, 15);
      }
    });

    it("should handle very small numbers", () => {
      const engine = createEngine({ precision: 64 });
      const result = engine.evaluateFormula({
        formula: "1e-20 + 2e-20",
        context: {},
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resultAsNumber).toBeCloseTo(3e-20, 30);
      }
    });

    it("should handle very large numbers", () => {
      const engine = createEngine({ precision: 64 });
      const result = engine.evaluateFormula({
        formula: "1e20 * 2",
        context: {},
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resultAsNumber).toBeCloseTo(2e20, 10);
      }
    });
  });

  describe("Type A Calculation", () => {
    it("should calculate Type A uncertainty", () => {
      const result = engine.calculateTypeA({
        readings: [10.1, 10.2, 9.9, 10.0, 10.3],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mean).toBeCloseTo(10.1, 5);
        expect(result.data.sampleSize).toBe(5);
        expect(result.data.degreesOfFreedom).toBe(4);
      }
    });

    it("should return error for invalid input", () => {
      const result = engine.calculateTypeA({
        readings: [10], // Only 1 reading
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("CALCULATION_ERROR");
      }
    });
  });

  describe("Type B Calculation", () => {
    it("should calculate Type B uncertainty", () => {
      const result = engine.calculateTypeB([
        { name: "resolution", value: 0.01, distribution: "rectangular" },
        {
          name: "reference",
          value: 0.05,
          distribution: "normal",
          coverageFactor: 2,
        },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.components).toHaveLength(2);
        expect(result.data.totalTypeB).toBeGreaterThan(0);
      }
    });

    it("should handle empty components", () => {
      const result = engine.calculateTypeB([]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.components).toHaveLength(0);
        expect(result.data.totalTypeB).toBe(0);
      }
    });
  });

  describe("Combined Uncertainty", () => {
    it("should calculate combined uncertainty", () => {
      const typeA = {
        mean: 100,
        standardDeviation: 0.1,
        standardUncertainty: 0.0316,
        degreesOfFreedom: 9,
        sampleSize: 10,
      };

      const typeB = {
        components: [
          { name: "resolution", standardUncertainty: 0.006, degreesOfFreedom: 50 },
        ],
        totalTypeB: 0.006,
      };

      const result = engine.calculateCombined(typeA, typeB);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.combinedStandardUncertainty).toBeGreaterThan(0);
        expect(result.data.expandedUncertainty).toBeGreaterThan(0);
        expect(result.data.coverageFactor).toBeGreaterThanOrEqual(2);
      }
    });

    it("should return error when no uncertainties provided", () => {
      const result = engine.calculateCombined();

      expect(result.success).toBe(false);
    });
  });

  describe("Full Calibration", () => {
    it("should perform full calibration with readings", () => {
      const result = engine.performCalibration({
        readings: [
          { value: 10.1 },
          { value: 10.2 },
          { value: 9.9 },
          { value: 10.0 },
          { value: 10.3 },
        ],
        environment: {
          temperature: 23.5,
          humidity: 50,
        },
        instrument: {
          resolution: 0.01,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.typeA).toBeDefined();
        expect(result.data.combined).toBeDefined();
        expect(result.data.meta.engineVersion).toBe(ENGINE_VERSION);
        expect(result.data.meta.timestamp).toBeDefined();
        expect(result.data.meta.inputsUsed.length).toBeGreaterThan(0);
      }
    });

    it("should include Type B components", () => {
      const result = engine.performCalibration(
        {
          readings: [{ value: 10.1 }, { value: 10.2 }],
        },
        [
          { name: "resolution", value: 0.01, distribution: "rectangular" },
          { name: "reference", value: 0.05, distribution: "normal", coverageFactor: 2 },
        ]
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.typeB).toBeDefined();
        expect(result.data.typeB?.components).toHaveLength(2);
      }
    });

    it("should execute custom formulas", () => {
      const result = engine.performCalibration(
        {
          readings: [{ value: 10.1 }, { value: 10.2 }],
        },
        [],
        ["mean * 2", "u_combined * 2"]
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.formulaResults).toBeDefined();
        expect(result.data.formulaResults!.length).toBeGreaterThanOrEqual(1);
        // Check first formula result
        expect(result.data.formulaResults![0]?.resultAsNumber).toBeCloseTo(20.3, 1);
      }
    });

    it("should track all inputs used for traceability", () => {
      const result = engine.performCalibration({
        readings: [{ value: 10.1 }, { value: 10.2 }],
        environment: { temperature: 23.5 },
        instrument: { resolution: 0.01 },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const inputs = result.data.meta.inputsUsed;
        expect(inputs).toContain("env_temperature");
        expect(inputs).toContain("inst_resolution");
      }
    });

    it("should include ISO 17025 traceability metadata", () => {
      const result = engine.performCalibration({
        readings: [{ value: 10.1 }, { value: 10.2 }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta).toBeDefined();
        expect(result.data.meta.engineVersion).toBe(ENGINE_VERSION);
        expect(result.data.meta.timestamp).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
        );
        expect(Array.isArray(result.data.meta.inputsUsed)).toBe(true);
      }
    });
  });

  describe("Context Preparation", () => {
    it("should prepare context from data", () => {
      const context = engine.prepareContext({
        point1: { reading: 10.5 },
        point2: { reading: 20.3 },
      });

      expect(context["point1_reading"]).toBe(10.5);
      expect(context["point2_reading"]).toBe(20.3);
    });

    it("should accept flatten options", () => {
      const context = engine.prepareContext(
        {
          reading: 100,
          secretValue: 999,
        },
        { excludeKeys: ["secretValue"] }
      );

      expect(context["reading"]).toBe(100);
      expect(context["secretValue"]).toBeUndefined();
    });
  });

  describe("Version", () => {
    it("should return engine version", () => {
      expect(engine.getVersion()).toBe(ENGINE_VERSION);
    });
  });
});
