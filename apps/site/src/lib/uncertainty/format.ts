/**
 * pt-BR number rendering for the public uncertainty calculator.
 *
 * Uncertainties are shown to two significant figures, which is what a
 * calibration certificate declares (GUM 7.2.6); the underlying value is never
 * rounded, only its presentation.
 */

const SMALL = 1e-4;
const LARGE = 1e7;

/** Formats to a fixed number of significant figures, pt-BR separators. */
export function formatSignificant(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";

  const magnitude = Math.abs(value);
  if (magnitude < SMALL || magnitude >= LARGE) {
    // Below a ten-thousandth the decimal form is a row of zeros nobody can
    // read at a glance; scientific notation is what the budget table uses.
    return value
      .toExponential(digits - 1)
      .replace(".", ",")
      .replace("e", " × 10^");
  }

  return new Intl.NumberFormat("pt-BR", {
    minimumSignificantDigits: digits,
    maximumSignificantDigits: digits,
  }).format(value);
}

/** Formats an ordinary quantity (mean, sensitivity) rather than an uncertainty. */
export function formatQuantity(value: number, maxDigits = 6): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    maximumSignificantDigits: maxDigits,
  }).format(value);
}

/** Degrees of freedom: infinite is the ordinary case for a Type B estimate. */
export function formatDegreesOfFreedom(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(value);
}

/** Percent share of the combined variance, for the index column. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} %`;
}
