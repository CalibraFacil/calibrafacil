/**
 * Test Tolerance Standards
 *
 * This file documents the rationale for test tolerances used throughout
 * the math-engine test suite.
 *
 * PRINCIPLE: Tolerance should be 2-3 orders of magnitude smaller than
 * the smallest significant digit in the expected value, while accounting
 * for IEEE 754 floating-point limitations.
 */

/**
 * Tolerance for GUM calculations (5 decimal places = 1e-5)
 *
 * Input values typically have 2-4 decimal places.
 * We verify to 5 decimal places, which provides:
 * - Margin for IEEE 754 floating-point operations
 * - Avoids over-specification of intermediate results
 * - Matches typical calibration certificate reporting precision
 *
 * Reference: GUM recommends reporting uncertainty to at most 2 significant
 * figures, so 5 decimal places provides adequate verification.
 */
export const GUM_TOLERANCE_DECIMALS = 5;

/**
 * Tolerance for BigNumber precision tests (14 decimal places)
 *
 * These tests verify that BigNumber maintains precision beyond
 * native JavaScript numbers (~15 digits). We use 14 to allow
 * for minor floating-point conversion artifacts.
 */
export const BIGNUMBER_TOLERANCE_DECIMALS = 14;

/**
 * Tolerance for reference value verification (from published standards)
 *
 * When comparing against published GUM/NIST values, use the same
 * number of decimal places as the reference document to avoid
 * over-specification.
 */
export const REFERENCE_TOLERANCE_DECIMALS = 3;

/**
 * Helper to get expected tolerance for a given decimal places
 */
export function getTolerance(decimals: number): number {
  return Math.pow(10, -decimals);
}
