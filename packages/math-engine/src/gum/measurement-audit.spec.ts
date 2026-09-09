import { describe, expect, it } from "vitest";
import {
  createCalculationEngine,
  ERROR_CODES,
  type InputQuantity,
  type MeasurementModelInput,
} from "../index.js";

describe.each(["decimal", "number"] as const)(
  "measurement audit (%s)",
  (numericMode) => {
    const engine = createCalculationEngine({ numericMode });

    it("rejects an automatic sensitivity at an if_zero discontinuity", () => {
      expect(() =>
        engine.evaluateMeasurementModel({
          formula: "if_zero(x, 0, 1)",
          quantities: { x: { estimate: 0, standardUncertainty: 1 } },
        }),
      ).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.NON_DIFFERENTIABLE_MODEL }),
      );
    });

    it("requires both the non-smooth override and explicit sensitivities", () => {
      const input = {
        formula: "if_zero(x, 0, 1)",
        quantities: { x: { estimate: 0, standardUncertainty: 1 } },
      };
      expect(() =>
        engine.evaluateMeasurementModel({
          ...input,
          allowNonSmoothWithExplicitSensitivities: true,
        }),
      ).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.NON_DIFFERENTIABLE_MODEL }),
      );
      const quantities = {
        x: { ...input.quantities.x, sensitivityCoefficient: 2 },
      };
      expect(() =>
        engine.evaluateMeasurementModel({ ...input, quantities }),
      ).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.NON_DIFFERENTIABLE_MODEL }),
      );
      const result = engine.evaluateMeasurementModel({
        ...input,
        quantities,
        allowNonSmoothWithExplicitSensitivities: true,
      });
      expect(Number(result.sensitivityCoefficients.x)).toBe(2);
      expect(Number(result.combinedStandardUncertainty)).toBe(2);
    });

    it("preserves lazy if_zero evaluation for ordinary formulas", () => {
      expect(
        Number(
          engine.compileFormula("if_zero(x, 1, log(x))").evaluate({ x: 0 })
            .value,
        ),
      ).toBe(1);
      expect(
        Number(
          engine.compileFormula("if_zero(x, 1, log(x))").evaluate({ x: 1 })
            .value,
        ),
      ).toBe(0);
    });

    const quantities = {
      a: { estimate: 0, standardUncertainty: 1e6 },
      b: { estimate: 0, standardUncertainty: 0.001 },
      c: { estimate: 0, standardUncertainty: 0.001 },
    };

    it.each(["b+c", "a+b+c"])(
      "rejects impossible small-pair covariance in %s",
      (formula) => {
        expect(() =>
          engine.evaluateMeasurementModel({
            formula,
            quantities,
            covariances: [["b", "c", 0.001]],
          }),
        ).toThrowError(
          expect.objectContaining({
            code: ERROR_CODES.INVALID_COVARIANCE_MATRIX,
          }),
        );
      },
    );

    it("rejects covariance with a zero-uncertainty quantity", () => {
      expect(() =>
        engine.evaluateMeasurementModel({
          formula: "b+c",
          quantities: {
            ...quantities,
            b: { estimate: 0, standardUncertainty: 0 },
          },
          covariances: [["b", "c", 1e-9]],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: ERROR_CODES.INVALID_COVARIANCE_MATRIX,
        }),
      );
    });

    it("rejects a non-PSD small block even when every correlation is bounded", () => {
      expect(() =>
        engine.evaluateMeasurementModel({
          formula: "b+c+d",
          quantities: { ...quantities, d: quantities.b },
          correlations: [
            ["b", "c", -0.9],
            ["b", "d", -0.9],
            ["c", "d", -0.9],
          ],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: ERROR_CODES.INVALID_COVARIANCE_MATRIX,
        }),
      );
    });

    it.each(["correlations", "covariances"] as const)(
      "preserves valid mixed-scale %s",
      (source) => {
        const input: MeasurementModelInput = {
          formula: "a/1000000 + 1000*b + 1000*c",
          quantities,
          [source]: [["a", "b", source === "correlations" ? 0.5 : 500]],
        };
        // Scaled individual variances are 1 each, plus 2 * 0.5 covariance.
        expect(
          Number(
            engine.evaluateMeasurementModel(input).combinedStandardUncertainty,
          ),
        ).toBeCloseTo(2, 12);
      },
    );

    it.each([-1, 1])(
      "accepts singular PSD covariance (correlation %s)",
      (correlation) => {
        const result = engine.evaluateMeasurementModel({
          formula: "b+c",
          quantities,
          correlations: [["b", "c", correlation]],
        });
        expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(
          correlation === -1 ? 0 : 0.002,
          12,
        );
      },
    );

    it("accepts a zero-uncertainty quantity with zero covariance", () => {
      const result = engine.evaluateMeasurementModel({
        formula: "b+c",
        quantities: {
          ...quantities,
          b: { estimate: 0, standardUncertainty: 0 },
        },
        covariances: [["b", "c", 0]],
      });
      expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(0.001, 12);
    });

    const competingSources: InputQuantity[] = [
      { standardUncertainty: 0.003 },
      { typeB: { distribution: "rectangular", halfWidth: 0.003 } },
      { typeB: { distribution: "normal", standardUncertainty: 0.003 } },
      { distribution: "rectangular", halfWidth: 0.003 },
      { distribution: "rectangular", lowerLimit: -0.003, upperLimit: 0.003 },
      { distribution: "normal", expandedUncertainty: 0.006, coverageFactor: 2 },
    ];
    it.each(competingSources)(
      "rejects observations combined with another uncertainty source: %j",
      (source) => {
        expect(() =>
          engine.evaluateMeasurementModel({
            formula: "x",
            quantities: {
              x: { repeatedObservations: [9.8, 10, 10.2], ...source },
            },
          }),
        ).toThrowError(
          expect.objectContaining({ code: ERROR_CODES.INVALID_UNCERTAINTY }),
        );
      },
    );

    it("preserves explicit estimates with observations and distribution metadata", () => {
      const result = engine.evaluateMeasurementModel({
        formula: "x",
        quantities: {
          x: {
            estimate: 11,
            repeatedObservations: [9.8, 10, 10.2],
            typeB: { distribution: "normal" },
          },
        },
      });
      expect(Number(result.value)).toBe(11);
      expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(
        0.2 / Math.sqrt(3),
        12,
      );
      expect(Number(result.effectiveDegreesOfFreedom)).toBeCloseTo(2, 12);
    });

    it("combines separate repeatability and Type B quantities with their own degrees of freedom", () => {
      const result = engine.evaluateMeasurementModel({
        formula: "x+correction",
        quantities: {
          x: { repeatedObservations: [9.8, 10, 10.2] },
          correction: {
            estimate: 0,
            typeB: { distribution: "rectangular", halfWidth: 0.003 },
          },
        },
      });
      const typeAVariance = 0.2 ** 2 / 3;
      const combinedVariance = typeAVariance + 0.003 ** 2 / 3;
      expect(Number(result.value)).toBe(10);
      expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(
        Math.sqrt(combinedVariance),
        12,
      );
      expect(Number(result.effectiveDegreesOfFreedom)).toBeCloseTo(
        combinedVariance ** 2 / (typeAVariance ** 2 / 2),
        12,
      );
      expect(
        result.uncertaintyBudget.find((entry) => entry.symbol === "correction")
          ?.degreesOfFreedom,
      ).toBe("Infinity");
    });
  },
);
