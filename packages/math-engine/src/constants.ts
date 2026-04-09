import type { DistributionType } from "./types";

export const ENGINE_VERSION = "1.0.0";

// ============================================
// Distribution divisors for Type B uncertainty
// ============================================
export const DISTRIBUTION_DIVISORS: Record<DistributionType, number> = {
  normal: 1,
  rectangular: Math.sqrt(3),
  triangular: Math.sqrt(6),
  "u-shaped": Math.sqrt(2),
};

// ============================================
// Coverage factors for common confidence levels (infinite DOF)
// ============================================
/**
 * Coverage factors for the normal distribution (DOF → ∞)
 *
 * These values are z-scores from the standard normal distribution.
 * Use these for quick estimates when DOF > 100.
 * For finite DOF, use getCoverageFactor() which interpolates from T_TABLES.
 *
 * Source: NIST/SEMATECH e-Handbook of Statistical Methods
 * URL: https://www.itl.nist.gov/div898/handbook/eda/section3/eda3671.htm
 *
 * Reference: GUM Table G.1 - Coverage factors k for different confidence levels
 */
export const COVERAGE_FACTORS = {
  "68.27": 1.0, // ~1σ coverage
  "90.00": 1.645, // 90% confidence
  "95.00": 1.96, // 95% confidence (commonly used outside metrology)
  "95.45": 2.0, // k=2, ~2σ coverage (most common in calibration)
  "99.00": 2.576, // 99% confidence
  "99.73": 3.0, // ~3σ coverage
} as const;

// ============================================
// Student's t-distribution values for coverage factor calculation
// ============================================
/**
 * Student's t-distribution values for coverage probability p = 0.9545 (95.45%)
 *
 * SOURCE: NIST/SEMATECH e-Handbook of Statistical Methods
 * URL: https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm
 *
 * VERIFICATION: Values verified against:
 * - JCGM 100:2008 (GUM), Table G.2
 * - ISO/IEC Guide 98-3:2008, Annex G
 *
 * COVERAGE PROBABILITY: 95.45% (two-sided, corresponding to k ≈ 2 at infinite DOF)
 *
 * This table provides t-values for the Welch-Satterthwaite effective degrees
 * of freedom calculation. The coverage factor k = t(νeff, p) where:
 * - νeff is the effective degrees of freedom
 * - p = 0.9545 is the coverage probability
 *
 * NOTE: Values are for two-tailed probability. For small DOF (< 10),
 * the coverage factor increases significantly to account for the
 * additional uncertainty in the variance estimate.
 */
export const T_TABLE_95_45: Record<number, number> = {
  1: 13.97, // t(1, 0.9545) - heavily penalized for low DOF
  2: 4.53, // t(2, 0.9545)
  3: 3.31, // t(3, 0.9545)
  4: 2.87, // t(4, 0.9545)
  5: 2.65, // t(5, 0.9545)
  6: 2.52, // t(6, 0.9545)
  7: 2.43, // t(7, 0.9545)
  8: 2.37, // t(8, 0.9545)
  9: 2.32, // t(9, 0.9545)
  10: 2.28, // t(10, 0.9545)
  11: 2.25,
  12: 2.23,
  13: 2.21,
  14: 2.2,
  15: 2.18,
  16: 2.17,
  17: 2.16,
  18: 2.15,
  19: 2.14,
  20: 2.13, // t(20, 0.9545)
  25: 2.11,
  30: 2.09,
  35: 2.07,
  40: 2.06,
  45: 2.06,
  50: 2.05, // t(50, 0.9545) - used as default for Type B
  60: 2.04,
  80: 2.03,
  100: 2.03,
  200: 2.01,
  500: 2.0, // Approaches T_INFINITY
};

/**
 * Student's t-distribution values for coverage probability p = 0.95 (95%)
 *
 * SOURCE: NIST/SEMATECH e-Handbook of Statistical Methods
 * URL: https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm
 */
export const T_TABLE_95: Record<number, number> = {
  1: 12.71,
  2: 4.3,
  3: 3.18,
  4: 2.78,
  5: 2.57,
  6: 2.45,
  7: 2.36,
  8: 2.31,
  9: 2.26,
  10: 2.23,
  11: 2.2,
  12: 2.18,
  13: 2.16,
  14: 2.14,
  15: 2.13,
  16: 2.12,
  17: 2.11,
  18: 2.1,
  19: 2.09,
  20: 2.09,
  25: 2.06,
  30: 2.04,
  35: 2.03,
  40: 2.02,
  45: 2.01,
  50: 2.01,
  60: 2.0,
  80: 1.99,
  100: 1.98,
  200: 1.97,
  500: 1.96,
};

/**
 * Student's t-distribution values for coverage probability p = 0.99 (99%)
 *
 * SOURCE: NIST/SEMATECH e-Handbook of Statistical Methods
 */
export const T_TABLE_99: Record<number, number> = {
  1: 63.66,
  2: 9.92,
  3: 5.84,
  4: 4.6,
  5: 4.03,
  6: 3.71,
  7: 3.5,
  8: 3.36,
  9: 3.25,
  10: 3.17,
  11: 3.11,
  12: 3.05,
  13: 3.01,
  14: 2.98,
  15: 2.95,
  16: 2.92,
  17: 2.9,
  18: 2.88,
  19: 2.86,
  20: 2.85,
  25: 2.79,
  30: 2.75,
  35: 2.72,
  40: 2.7,
  45: 2.69,
  50: 2.68,
  60: 2.66,
  80: 2.64,
  100: 2.63,
  200: 2.6,
  500: 2.59,
};

/**
 * Combined t-tables indexed by confidence level
 * Supported levels: 0.95, 0.9545, 0.99
 */
export const T_TABLES: Record<string, Record<number, number>> = {
  "0.9500": T_TABLE_95,
  "0.9545": T_TABLE_95_45,
  "0.9900": T_TABLE_99,
};

/**
 * Supported confidence levels for validation
 */
export const SUPPORTED_CONFIDENCE_LEVELS = [0.95, 0.9545, 0.99] as const;
export type SupportedConfidenceLevel =
  (typeof SUPPORTED_CONFIDENCE_LEVELS)[number];

// Legacy export for backward compatibility
export const T_TABLE = T_TABLE_95_45;

/**
 * Coverage factor for infinite degrees of freedom (DOF → ∞)
 *
 * At infinite DOF, the t-distribution converges to the normal distribution.
 * For p = 0.9545, this equals exactly 2.0 (k = 2).
 */
export const T_INFINITY = 2.0;

// ============================================
// Keys to INCLUDE in execution scope
// ============================================
export const INCLUDE_KEYS = new Set([
  "reading",
  "readings",
  "value",
  "values",
  "leitura",
  "leituras",
  "measured",
  "measurement",
  "result",
  "output",
]);

// ============================================
// Keys to EXCLUDE from execution scope
// NOTE: Keep this minimal - substring matching means "nominal" would exclude
// "linearity_nominal_value", "nominal_reading", etc.
// ============================================
export const EXCLUDE_KEYS = new Set([
  // Only exclude keys that are truly never needed in formulas
]);

// ============================================
// Unit conversion to SI base units
// ============================================
export const UNIT_TO_SI: Record<string, { factor: number; baseUnit: string }> =
  {
    // Mass
    kg: { factor: 1, baseUnit: "kg" },
    g: { factor: 0.001, baseUnit: "kg" },
    mg: { factor: 0.000001, baseUnit: "kg" },
    lb: { factor: 0.453592, baseUnit: "kg" },
    oz: { factor: 0.0283495, baseUnit: "kg" },

    // Length
    m: { factor: 1, baseUnit: "m" },
    cm: { factor: 0.01, baseUnit: "m" },
    mm: { factor: 0.001, baseUnit: "m" },
    um: { factor: 0.000001, baseUnit: "m" },
    nm: { factor: 0.000000001, baseUnit: "m" },
    km: { factor: 1000, baseUnit: "m" },
    in: { factor: 0.0254, baseUnit: "m" },
    ft: { factor: 0.3048, baseUnit: "m" },

    // Temperature (offset conversions handled separately)
    K: { factor: 1, baseUnit: "K" },
    C: { factor: 1, baseUnit: "C" },
    F: { factor: 1, baseUnit: "F" },

    // Pressure
    Pa: { factor: 1, baseUnit: "Pa" },
    kPa: { factor: 1000, baseUnit: "Pa" },
    MPa: { factor: 1000000, baseUnit: "Pa" },
    bar: { factor: 100000, baseUnit: "Pa" },
    mbar: { factor: 100, baseUnit: "Pa" },
    psi: { factor: 6894.76, baseUnit: "Pa" },
    atm: { factor: 101325, baseUnit: "Pa" },
    mmHg: { factor: 133.322, baseUnit: "Pa" },

    // Volume
    L: { factor: 0.001, baseUnit: "m3" },
    mL: { factor: 0.000001, baseUnit: "m3" },
    uL: { factor: 0.000000001, baseUnit: "m3" },
    m3: { factor: 1, baseUnit: "m3" },

    // Electrical
    V: { factor: 1, baseUnit: "V" },
    mV: { factor: 0.001, baseUnit: "V" },
    A: { factor: 1, baseUnit: "A" },
    mA: { factor: 0.001, baseUnit: "A" },
    uA: { factor: 0.000001, baseUnit: "A" },
    ohm: { factor: 1, baseUnit: "ohm" },
    kohm: { factor: 1000, baseUnit: "ohm" },
    Mohm: { factor: 1000000, baseUnit: "ohm" },
  };

// ============================================
// Regex pattern for parsing value with unit
// Matches: "10.5 kg", "10.5kg", "-3.2 mV", "1e-6 Pa"
// ============================================
export const UNIT_VALUE_PATTERN =
  /^([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)\s*([a-zA-Z]+\d*)$/;
