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
// Coverage factors for common confidence levels
// ============================================
export const COVERAGE_FACTORS = {
  "68.27": 1.0,
  "90.00": 1.645,
  "95.00": 1.96,
  "95.45": 2.0,
  "99.00": 2.576,
  "99.73": 3.0,
} as const;

// ============================================
// t-distribution values for effective degrees of freedom
// (95.45% confidence level, k ≈ 2)
// ============================================
export const T_TABLE: Record<number, number> = {
  1: 13.97,
  2: 4.53,
  3: 3.31,
  4: 2.87,
  5: 2.65,
  6: 2.52,
  7: 2.43,
  8: 2.37,
  9: 2.32,
  10: 2.28,
  11: 2.25,
  12: 2.23,
  13: 2.21,
  14: 2.2,
  15: 2.18,
  16: 2.17,
  17: 2.16,
  18: 2.15,
  19: 2.14,
  20: 2.13,
  25: 2.11,
  30: 2.09,
  35: 2.07,
  40: 2.06,
  45: 2.06,
  50: 2.05,
  60: 2.04,
  80: 2.03,
  100: 2.03,
  200: 2.01,
  500: 2.0,
};

// Infinity case (large DOF)
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
