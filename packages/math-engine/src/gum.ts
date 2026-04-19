/**
 * GUM Uncertainty Calculations
 *
 * This module implements uncertainty calculations following the Guide to the
 * Expression of Uncertainty in Measurement (GUM, JCGM 100:2008).
 *
 * PRECISION ARCHITECTURE NOTE:
 * This module uses native JavaScript Math.* functions (~15 significant digits)
 * for uncertainty calculations. This is intentional and acceptable because:
 *
 * 1. Input measurement values rarely exceed 6-8 significant figures
 * 2. GUM uncertainty calculations involve operations that don't compound errors
 * 3. The coverage factor lookup (t-table) has only 2 decimal places
 * 4. Final results are typically reported to 2-3 significant figures
 *
 * For user-defined formulas where arbitrary precision is required, the
 * CalibrationEngine uses BigNumber (mathjs) with configurable precision.
 *
 * CORRELATION ASSUMPTION:
 * This implementation uses the simplified GUM formula for combining uncertainties
 * (GUM Equation 10), which assumes all input quantities are UNCORRELATED (r = 0).
 * See calculateCombinedUncertainty() documentation for details.
 *
 * Reference: JCGM 100:2008 (GUM), ISO/IEC Guide 98-3:2008
 *
 * @module gum
 */

import {
  COVERAGE_FACTORS,
  DISTRIBUTION_DIVISORS,
  T_TABLES,
  T_INFINITY,
  SUPPORTED_CONFIDENCE_LEVELS,
} from "./constants";
import type {
  TypeAInput,
  TypeAResult,
  TypeBComponent,
  TypeBResult,
  CombinedUncertaintyInput,
  CombinedUncertaintyResult,
} from "./types";

// ============================================
// Type A: Statistical Uncertainty
// u_A = s / √n
// ============================================
export function calculateTypeA(input: TypeAInput): TypeAResult {
  const { readings } = input;
  const n = readings.length;

  if (n < 2) {
    throw new Error("At least 2 readings are required for Type A evaluation");
  }

  // Calculate mean
  const sum = readings.reduce((acc, val) => acc + val, 0);
  const mean = sum / n;

  // Calculate sample standard deviation
  const squaredDiffs = readings.map((val) => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / (n - 1);
  const standardDeviation = Math.sqrt(variance);

  // Standard uncertainty of the mean: u_A = s / √n
  const standardUncertainty = standardDeviation / Math.sqrt(n);

  const degreesOfFreedom = input.degreesOfFreedom ?? n - 1;

  return {
    mean,
    standardDeviation,
    standardUncertainty,
    degreesOfFreedom,
    sampleSize: n,
  };
}

// ============================================
// Type B: Systematic Uncertainty
// ============================================
export function calculateTypeB(components: TypeBComponent[]): TypeBResult {
  if (components.length === 0) {
    return {
      components: [],
      totalTypeB: 0,
    };
  }

  const results = components.map((component) => {
    let standardUncertainty: number;
    const distribution = component.distribution ?? "rectangular";
    const degreesOfFreedom = component.degreesOfFreedom ?? 50;

    if (component.coverageFactor) {
      // Convert expanded uncertainty to standard: u = U / k
      standardUncertainty = component.value / component.coverageFactor;
    } else {
      // Use distribution divisor
      const divisor = component.divisor ?? DISTRIBUTION_DIVISORS[distribution];
      standardUncertainty = component.value / divisor;
    }

    return {
      name: component.name,
      standardUncertainty,
      degreesOfFreedom,
    };
  });

  // RSS of all Type B components
  const totalTypeB = Math.sqrt(
    results.reduce((acc, r) => acc + Math.pow(r.standardUncertainty, 2), 0),
  );

  return {
    components: results,
    totalTypeB,
  };
}

// ============================================
// Get coverage factor from t-table
// ============================================
/**
 * Get coverage factor k from t-distribution table
 *
 * @param dof - Effective degrees of freedom
 * @param confidenceLevel - Coverage probability (default: 0.9545)
 * @returns Object with coverage factor and actual confidence level used
 *
 * Supported confidence levels: 0.95, 0.9545, 0.99
 * For unsupported levels, uses the closest available table.
 */
function getCoverageFactor(
  dof: number,
  confidenceLevel: number = 0.9545,
): { factor: number; actualLevel: number } {
  // Select the appropriate t-table for the confidence level
  let actualLevel = confidenceLevel;
  const levelKey = confidenceLevel.toFixed(4);
  let table = T_TABLES[levelKey];

  if (!table) {
    // Find closest supported confidence level (silent fallback)
    actualLevel = SUPPORTED_CONFIDENCE_LEVELS.reduce((prev, curr) =>
      Math.abs(curr - confidenceLevel) < Math.abs(prev - confidenceLevel)
        ? curr
        : prev,
    );
    table = T_TABLES[actualLevel.toFixed(4)]!;
  }

  // At high DOF, the t-distribution converges to the normal distribution.
  // The limiting z-score is confidence-level specific: 95% -> 1.96,
  // 95.45% -> 2.0, 99% -> 2.576.
  if (dof >= 500) {
    return { factor: getAsymptoticCoverageFactor(actualLevel), actualLevel };
  }

  // Find the closest DOF in the table (ceiling lookup)
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);

  for (const key of keys) {
    if (dof <= key) {
      return { factor: table[key]!, actualLevel };
    }
  }

  return { factor: getAsymptoticCoverageFactor(actualLevel), actualLevel };
}

function getAsymptoticCoverageFactor(confidenceLevel: number): number {
  switch (confidenceLevel.toFixed(4)) {
    case "0.9500":
      return COVERAGE_FACTORS["95.00"];
    case "0.9545":
      return COVERAGE_FACTORS["95.45"];
    case "0.9900":
      return COVERAGE_FACTORS["99.00"];
    default:
      return T_INFINITY;
  }
}

// ============================================
// Welch-Satterthwaite effective degrees of freedom
// ============================================
function calculateEffectiveDOF(
  uncertainties: Array<{ value: number; dof: number }>,
): number {
  const uc4 = Math.pow(
    Math.sqrt(uncertainties.reduce((acc, u) => acc + Math.pow(u.value, 2), 0)),
    4,
  );

  const denominator = uncertainties.reduce(
    (acc, u) => acc + Math.pow(u.value, 4) / u.dof,
    0,
  );

  if (denominator === 0) return Infinity;

  return Math.floor(uc4 / denominator);
}

// ============================================
// Combined Standard Uncertainty (RSS)
// u_c = √(u_A² + u_B₁² + u_B₂² + ...)
// U = k × u_c
// ============================================
/**
 * Calculate combined standard uncertainty using RSS (root sum of squares)
 *
 * @param input - Type A and/or Type B uncertainty components
 * @param confidenceLevel - Coverage probability (default: 0.9545 = 95.45%)
 * @returns Combined uncertainty result with expanded uncertainty
 *
 * @warning ASSUMES UNCORRELATED INPUTS
 *
 * This function implements GUM Equation 10:
 *   u_c = √(∑ cᵢ²uᵢ²)
 *
 * This formula ASSUMES all input quantities are UNCORRELATED (r = 0).
 *
 * For correlated inputs, the full formula (GUM Equation 13) requires:
 *   u_c² = ∑∑ cᵢcⱼu(xᵢ)u(xⱼ)r(xᵢ,xⱼ)
 *
 * If your calibration involves correlated quantities (e.g., temperature
 * affecting multiple components, or measurements from the same reference),
 * this function may underestimate or overestimate the true combined uncertainty.
 *
 * For correlated inputs, you should:
 * 1. Use a Monte Carlo method (GUM Supplement 1), OR
 * 2. Document the correlation assumption in your uncertainty budget
 *
 * Reference: GUM Section 5.2, Equations 10-16
 */
export function calculateCombinedUncertainty(
  input: CombinedUncertaintyInput,
  confidenceLevel: number = 0.9545,
): CombinedUncertaintyResult {
  const uncertainties: Array<{ value: number; dof: number }> = [];

  // Add Type A if present
  if (input.typeA) {
    const coeff = input.sensitivityCoefficients?.typeA ?? 1;
    uncertainties.push({
      value: coeff * input.typeA.standardUncertainty,
      dof: input.typeA.degreesOfFreedom,
    });
  }

  // Add Type B components if present
  if (input.typeB) {
    for (const comp of input.typeB.components) {
      const coeff = input.sensitivityCoefficients?.[comp.name] ?? 1;
      uncertainties.push({
        value: coeff * comp.standardUncertainty,
        dof: comp.degreesOfFreedom,
      });
    }
  }

  if (uncertainties.length === 0) {
    throw new Error("At least one uncertainty component is required");
  }

  // Combined standard uncertainty: u_c = √(∑u_i²)
  const combinedStandardUncertainty = Math.sqrt(
    uncertainties.reduce((acc, u) => acc + Math.pow(u.value, 2), 0),
  );

  // Welch-Satterthwaite effective degrees of freedom
  const effectiveDegreesOfFreedom = calculateEffectiveDOF(uncertainties);

  // Get coverage factor from t-table for the specified confidence level
  const { factor: coverageFactor, actualLevel: actualConfidenceLevel } =
    getCoverageFactor(effectiveDegreesOfFreedom, confidenceLevel);

  // Expanded uncertainty: U = k × u_c
  const expandedUncertainty = coverageFactor * combinedStandardUncertainty;

  return {
    combinedStandardUncertainty,
    effectiveDegreesOfFreedom,
    coverageFactor,
    expandedUncertainty,
    confidenceLevel,
    actualConfidenceLevel,
  };
}
