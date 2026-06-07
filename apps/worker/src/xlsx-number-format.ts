/**
 * pt-BR number formatting for certificate XLSX cells.
 *
 * Extracted from index.ts so it is unit-testable. The previous inline version
 * derived the decimal count with `String(value).split(".")[1]?.length`, which
 * is wrong for scientific-notation values — e.g. `5e-7` has no "." so it fell
 * back to 1 decimal and rendered as "0,0", silently dropping sub-microgram
 * metrology values (buoyancy, max error) on the certificate.
 */

/**
 * Count of fractional decimal digits, correct for scientific notation.
 * `5e-7` → 7, `1e-9` → 9, `9999.99` → 2, integers → 0.
 */
export function fractionDigitsOf(value: number): number {
  if (Number.isInteger(value)) return 0;
  // toExponential() always contains an "e"; slice avoids array-index access so
  // this stays sound under noUncheckedIndexedAccess (the API's strict build).
  const exponential = Math.abs(value).toExponential();
  const eIndex = exponential.indexOf("e");
  const mantissa = exponential.slice(0, eIndex);
  const exponent = Number(exponential.slice(eIndex + 1));
  const dotIndex = mantissa.indexOf(".");
  const fractionLength = dotIndex === -1 ? 0 : mantissa.length - dotIndex - 1;
  return Math.max(0, fractionLength - exponent);
}

export function formatNumberForXlsx(
  value: number,
  fractionDigits?: number,
): string {
  const decimals =
    fractionDigits ??
    (Number.isInteger(value)
      ? 0
      : Math.min(6, Math.max(1, fractionDigitsOf(value))));

  return value.toLocaleString("pt-BR", {
    useGrouping: false,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
