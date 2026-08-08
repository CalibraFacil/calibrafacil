/**
 * How a measured value and its expanded uncertainty are rounded FOR PRINTING.
 *
 * This is the correctness fix that motivated replacing the lab-authored
 * templates. The rule is normative, not cosmetic:
 *
 *   NIT-DICLA-021 Rev. 10, A.6.3 — the expanded uncertainty is reported with
 *   at most TWO significant figures, and the measured value is rounded to the
 *   same decimal place as the last significant figure of the uncertainty.
 *   ILAC-P14 carries the same requirement.
 *
 * Under the XLSX path this was a `formatter: "number:N"` string in a manifest
 * the LAB authored, cell by cell. A mandatory reporting rule was, in practice,
 * whoever typed the spreadsheet's choice — and nothing checked it. Here it is
 * computed from the uncertainty itself, so a certificate cannot be issued with
 * a value quoted to more precision than its uncertainty supports.
 *
 * Note the deliberate asymmetry with `roundToSignificantDigits` in
 * @calibra-facil/shared: that one exists to make the CMC *comparison* fair
 * (scope-compliance.ts). This one governs the printed document. They agree on
 * the uncertainty, but only this module also pins the VALUE's decimal place,
 * which is the half labs get wrong.
 */

import { roundToSignificantDigits } from "@calibra-facil/shared";

import { formatDecimalPtBr, fractionDigitsOf } from "./decimal-format.js";

/** A.6.3 says "no more than two"; two is the universal practice. */
export const UNCERTAINTY_SIGNIFICANT_FIGURES = 2;

/**
 * When there is no usable uncertainty there is no rule to apply, so the value
 * keeps its own natural precision — capped, because a float that arrived as
 * 0.30000000000000004 must not print seventeen digits on a certificate.
 */
const MAX_FALLBACK_DECIMALS = 6;

export type RoundedMeasurement = {
  /** pt-BR formatted measured value, at the uncertainty's decimal place. */
  value: string;
  /** pt-BR formatted expanded uncertainty, at most two significant figures. */
  uncertainty: string | null;
  /**
   * Decimal places both were formatted to. Exposed so sibling columns in the
   * same row (error, mean indication, reference value) can be aligned to the
   * same place — a table where the error shows three decimals and its own
   * uncertainty shows two reads as though the error were the more precise
   * number, which inverts the meaning.
   */
  decimals: number;
};

/**
 * The decimal exponent of the last significant figure of `uncertainty`.
 *
 * For U = 0,0012 (2 s.f.) that is -4, so values print with 4 decimals.
 * For U = 120 (2 s.f.) it is +1: the last significant figure sits in the tens,
 * so the value is rounded to the nearest ten and printed with 0 decimals.
 */
function lastSignificantExponent(uncertainty: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(uncertainty)));
  return magnitude - (UNCERTAINTY_SIGNIFICANT_FIGURES - 1);
}

function isUsable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Rounds a value/uncertainty pair for the results table.
 *
 * `uncertainty` null, zero or non-finite means the rule cannot be applied —
 * a legitimate case (a row that reports no uncertainty at all), not an error.
 * The value then keeps its own precision and `uncertainty` comes back null so
 * the layout renders an empty cell rather than a fabricated "0".
 */
export function roundMeasurementForReport(
  value: number | null | undefined,
  uncertainty: number | null | undefined,
): RoundedMeasurement | null {
  if (!isUsable(value)) return null;

  if (!isUsable(uncertainty) || uncertainty === 0) {
    // Round to the cap FIRST, then take the natural precision of the result.
    // Formatting straight to MAX_FALLBACK_DECIMALS would pad instead of trim,
    // printing 0,3 as "0,300000" and implying six digits of resolution the
    // measurement never had.
    const capFactor = 10 ** MAX_FALLBACK_DECIMALS;
    const capped = Math.round(value * capFactor) / capFactor;
    const decimals = fractionDigitsOf(capped);
    return {
      value: formatDecimalPtBr(capped, decimals),
      uncertainty: null,
      decimals,
    };
  }

  const roundedUncertainty = roundToSignificantDigits(
    Math.abs(uncertainty),
    UNCERTAINTY_SIGNIFICANT_FIGURES,
  );
  const exponent = lastSignificantExponent(roundedUncertainty);
  const decimals = Math.max(0, -exponent);
  // Round the value onto the uncertainty's grid. For a negative exponent this
  // is what toFixed(decimals) would do anyway; for a positive one (U in the
  // tens or hundreds) toFixed cannot express it, so do the arithmetic.
  const step = 10 ** exponent;
  const roundedValue = exponent > 0 ? Math.round(value / step) * step : value;

  return {
    value: formatDecimalPtBr(roundedValue, decimals),
    uncertainty: formatDecimalPtBr(roundedUncertainty, decimals),
    decimals,
  };
}

/**
 * Formats a sibling number onto an already-decided decimal place — for the
 * columns that share a row with a rounded measurement (reference value, mean
 * indication, error). Returns null for a missing value so the layout prints an
 * empty cell instead of "0".
 */
export function formatAtDecimals(
  value: number | null | undefined,
  decimals: number,
): string | null {
  if (!isUsable(value)) return null;
  return formatDecimalPtBr(value, decimals);
}
