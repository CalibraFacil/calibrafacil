import { DISTRIBUTION_DIVISORS, T_TABLE, T_INFINITY } from "./constants";
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
    results.reduce((acc, r) => acc + Math.pow(r.standardUncertainty, 2), 0)
  );

  return {
    components: results,
    totalTypeB,
  };
}

// ============================================
// Get coverage factor from t-table
// ============================================
function getCoverageFactor(dof: number): number {
  if (dof >= 500) return T_INFINITY;

  // Find the closest DOF in the table
  const keys = Object.keys(T_TABLE)
    .map(Number)
    .sort((a, b) => a - b);

  for (const key of keys) {
    if (dof <= key) {
      return T_TABLE[key]!;
    }
  }

  return T_INFINITY;
}

// ============================================
// Welch-Satterthwaite effective degrees of freedom
// ============================================
function calculateEffectiveDOF(
  uncertainties: Array<{ value: number; dof: number }>
): number {
  const uc4 = Math.pow(
    Math.sqrt(
      uncertainties.reduce((acc, u) => acc + Math.pow(u.value, 2), 0)
    ),
    4
  );

  const denominator = uncertainties.reduce(
    (acc, u) => acc + Math.pow(u.value, 4) / u.dof,
    0
  );

  if (denominator === 0) return Infinity;

  return Math.floor(uc4 / denominator);
}

// ============================================
// Combined Standard Uncertainty (RSS)
// u_c = √(u_A² + u_B₁² + u_B₂² + ...)
// U = k × u_c
// ============================================
export function calculateCombinedUncertainty(
  input: CombinedUncertaintyInput,
  confidenceLevel: number = 0.9545
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
    uncertainties.reduce((acc, u) => acc + Math.pow(u.value, 2), 0)
  );

  // Welch-Satterthwaite effective degrees of freedom
  const effectiveDegreesOfFreedom = calculateEffectiveDOF(uncertainties);

  // Get coverage factor from t-table
  const coverageFactor = getCoverageFactor(effectiveDegreesOfFreedom);

  // Expanded uncertainty: U = k × u_c
  const expandedUncertainty = coverageFactor * combinedStandardUncertainty;

  return {
    combinedStandardUncertainty,
    effectiveDegreesOfFreedom,
    coverageFactor,
    expandedUncertainty,
    confidenceLevel,
  };
}
