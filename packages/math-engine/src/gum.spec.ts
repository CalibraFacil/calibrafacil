import { describe, it, expect } from "vitest";
import {
  calculateTypeA,
  calculateTypeB,
  calculateCombinedUncertainty,
} from "./gum";

describe("GUM Calculations", () => {
  describe("Type A (Statistical)", () => {
    it("should calculate standard uncertainty from readings", () => {
      const readings = [10.1, 10.2, 9.9, 10.0, 10.3];
      const result = calculateTypeA({ readings });

      expect(result.mean).toBeCloseTo(10.1, 5);
      expect(result.sampleSize).toBe(5);
      expect(result.degreesOfFreedom).toBe(4);
      // u_A = s / sqrt(n) should be less than s
      expect(result.standardUncertainty).toBeLessThan(result.standardDeviation);
    });

    it("should throw error for insufficient readings", () => {
      expect(() => calculateTypeA({ readings: [10] })).toThrow(
        "At least 2 readings",
      );
    });

    it("should throw error for empty readings", () => {
      expect(() => calculateTypeA({ readings: [] })).toThrow(
        "At least 2 readings",
      );
    });

    it("should allow custom degrees of freedom", () => {
      const readings = [10.1, 10.2, 9.9, 10.0, 10.3];
      const result = calculateTypeA({ readings, degreesOfFreedom: 10 });

      expect(result.degreesOfFreedom).toBe(10);
      expect(result.sampleSize).toBe(5);
    });

    it("should calculate standard deviation correctly", () => {
      // Known values: readings with known std dev
      const readings = [2, 4, 4, 4, 5, 5, 7, 9];
      const result = calculateTypeA({ readings });

      // Mean = 5, Std Dev ≈ 2.138
      expect(result.mean).toBe(5);
      expect(result.standardDeviation).toBeCloseTo(2.138, 2);
    });

    it("should calculate u_A = s / sqrt(n) correctly", () => {
      const readings = [100, 100, 100, 100]; // 4 identical readings
      const result = calculateTypeA({ readings });

      expect(result.mean).toBe(100);
      expect(result.standardDeviation).toBe(0);
      expect(result.standardUncertainty).toBe(0);
    });

    it("should match known verification values", () => {
      // Example: 10 repeated measurements
      const readings = [
        100.02, 99.98, 100.01, 99.99, 100.0, 100.01, 99.97, 100.03, 100.0,
        99.99,
      ];
      const result = calculateTypeA({ readings });

      expect(result.mean).toBeCloseTo(100.0, 2);
      expect(result.degreesOfFreedom).toBe(9);
      expect(result.sampleSize).toBe(10);
    });
  });

  describe("Type B (Systematic)", () => {
    it("should calculate standard uncertainty from rectangular distribution", () => {
      const components = [
        {
          name: "resolution",
          value: 0.01,
          distribution: "rectangular" as const,
        },
      ];

      const result = calculateTypeB(components);

      expect(result.components).toHaveLength(1);
      // Resolution: 0.01 / sqrt(3) ≈ 0.00577
      expect(result.components[0]?.standardUncertainty).toBeCloseTo(0.00577, 4);
    });

    it("should calculate standard uncertainty from normal distribution with k", () => {
      const components = [
        {
          name: "reference_uncertainty",
          value: 0.05,
          distribution: "normal" as const,
          coverageFactor: 2,
        },
      ];

      const result = calculateTypeB(components);

      // Reference: 0.05 / 2 = 0.025
      expect(result.components[0]?.standardUncertainty).toBeCloseTo(0.025, 5);
    });

    it("should calculate RSS of all components", () => {
      const components = [
        { name: "u1", value: 3, distribution: "normal" as const },
        { name: "u2", value: 4, distribution: "normal" as const },
      ];

      const result = calculateTypeB(components);

      // RSS: sqrt(3^2 + 4^2) = 5
      expect(result.totalTypeB).toBeCloseTo(5, 5);
    });

    it("should handle triangular distribution", () => {
      const components = [
        {
          name: "drift",
          value: 0.06, // half-width
          distribution: "triangular" as const,
        },
      ];

      const result = calculateTypeB(components);

      // Triangular: a / sqrt(6) ≈ 0.06 / 2.449 ≈ 0.0245
      expect(result.components[0]?.standardUncertainty).toBeCloseTo(0.0245, 3);
    });

    it("should handle u-shaped distribution", () => {
      const components = [
        {
          name: "hysteresis",
          value: 0.1,
          distribution: "u-shaped" as const,
        },
      ];

      const result = calculateTypeB(components);

      // U-shaped: a / sqrt(2) ≈ 0.1 / 1.414 ≈ 0.0707
      expect(result.components[0]?.standardUncertainty).toBeCloseTo(0.0707, 3);
    });

    it("should allow custom divisor override", () => {
      const components = [
        {
          name: "custom",
          value: 1,
          distribution: "rectangular" as const,
          divisor: 2, // Override sqrt(3)
        },
      ];

      const result = calculateTypeB(components);

      expect(result.components[0]?.standardUncertainty).toBe(0.5);
    });

    it("should return empty result for no components", () => {
      const result = calculateTypeB([]);

      expect(result.components).toHaveLength(0);
      expect(result.totalTypeB).toBe(0);
    });

    it("should preserve degrees of freedom", () => {
      const components = [
        {
          name: "u1",
          value: 1,
          distribution: "normal" as const,
          degreesOfFreedom: 25,
        },
      ];

      const result = calculateTypeB(components);

      expect(result.components[0]?.degreesOfFreedom).toBe(25);
    });
  });

  describe("Combined Uncertainty", () => {
    it("should calculate combined standard uncertainty", () => {
      const typeA = {
        mean: 100,
        standardDeviation: 0.1,
        standardUncertainty: 0.0316, // 0.1 / sqrt(10)
        degreesOfFreedom: 9,
        sampleSize: 10,
      };

      const typeB = {
        components: [
          {
            name: "resolution",
            standardUncertainty: 0.006,
            degreesOfFreedom: 50,
          },
          {
            name: "reference",
            standardUncertainty: 0.025,
            degreesOfFreedom: 50,
          },
        ],
        totalTypeB: 0.0257,
      };

      const result = calculateCombinedUncertainty({ typeA, typeB });

      expect(result.combinedStandardUncertainty).toBeGreaterThan(0);
      expect(result.coverageFactor).toBeGreaterThanOrEqual(2);
      expect(result.expandedUncertainty).toBeCloseTo(
        result.coverageFactor * result.combinedStandardUncertainty,
        10,
      );
    });

    it("should calculate with only Type A", () => {
      const typeA = {
        mean: 100,
        standardDeviation: 0.1,
        standardUncertainty: 0.05,
        degreesOfFreedom: 5,
        sampleSize: 6,
      };

      const result = calculateCombinedUncertainty({ typeA });

      expect(result.combinedStandardUncertainty).toBe(0.05);
      expect(result.effectiveDegreesOfFreedom).toBe(5);
    });

    it("should calculate with only Type B", () => {
      const typeB = {
        components: [
          { name: "u1", standardUncertainty: 0.03, degreesOfFreedom: 50 },
          { name: "u2", standardUncertainty: 0.04, degreesOfFreedom: 50 },
        ],
        totalTypeB: 0.05,
      };

      const result = calculateCombinedUncertainty({ typeB });

      // RSS: sqrt(0.03^2 + 0.04^2) = 0.05
      expect(result.combinedStandardUncertainty).toBeCloseTo(0.05, 5);
    });

    it("should throw error when no uncertainties provided", () => {
      expect(() => calculateCombinedUncertainty({})).toThrow(
        "At least one uncertainty component",
      );
    });

    it("should calculate Welch-Satterthwaite effective DOF", () => {
      const typeA = {
        mean: 100,
        standardDeviation: 0.1,
        standardUncertainty: 0.05,
        degreesOfFreedom: 5,
        sampleSize: 6,
      };

      const typeB = {
        components: [
          { name: "u1", standardUncertainty: 0.03, degreesOfFreedom: 10 },
        ],
        totalTypeB: 0.03,
      };

      const result = calculateCombinedUncertainty({ typeA, typeB });

      expect(result.effectiveDegreesOfFreedom).toBeGreaterThanOrEqual(1);
      expect(result.effectiveDegreesOfFreedom).toBeLessThanOrEqual(100);
    });

    it("should use appropriate coverage factor from t-table", () => {
      const typeA = {
        mean: 100,
        standardDeviation: 0.1,
        standardUncertainty: 0.05,
        degreesOfFreedom: 3, // Small DOF = larger k
        sampleSize: 4,
      };

      const result = calculateCombinedUncertainty({ typeA });

      // For DOF=3, k should be around 3.31
      expect(result.coverageFactor).toBeGreaterThan(2);
    });

    it("should apply sensitivity coefficients", () => {
      const typeA = {
        mean: 100,
        standardDeviation: 0.1,
        standardUncertainty: 0.05,
        degreesOfFreedom: 9,
        sampleSize: 10,
      };

      const result = calculateCombinedUncertainty({ typeA }, 0.9545);

      const resultWithCoeff = calculateCombinedUncertainty(
        { typeA, sensitivityCoefficients: { typeA: 2 } },
        0.9545,
      );

      // With coefficient of 2, the combined uncertainty should be doubled
      expect(resultWithCoeff.combinedStandardUncertainty).toBeCloseTo(
        result.combinedStandardUncertainty * 2,
        10,
      );
    });

    it("should preserve confidence level", () => {
      const typeA = {
        mean: 100,
        standardDeviation: 0.1,
        standardUncertainty: 0.05,
        degreesOfFreedom: 9,
        sampleSize: 10,
      };

      const result = calculateCombinedUncertainty({ typeA }, 0.99);

      expect(result.confidenceLevel).toBe(0.99);
    });

    it("should use confidence-specific normal factors for DOF >= 500", () => {
      const typeB = {
        components: [
          {
            name: "reference",
            standardUncertainty: 1,
            degreesOfFreedom: 1000,
          },
        ],
        totalTypeB: 1,
      };

      const result95 = calculateCombinedUncertainty({ typeB }, 0.95);
      const result9545 = calculateCombinedUncertainty({ typeB }, 0.9545);
      const result99 = calculateCombinedUncertainty({ typeB }, 0.99);

      expect(result95.effectiveDegreesOfFreedom).toBe(1000);
      expect(result95.coverageFactor).toBeCloseTo(1.96, 12);
      expect(result9545.coverageFactor).toBeCloseTo(2.0, 12);
      expect(result99.coverageFactor).toBeCloseTo(2.576, 12);
    });
  });
});
