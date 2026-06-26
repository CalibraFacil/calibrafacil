/**
 * Pure special functions for the interval-analysis engine. No DB, no network, no
 * wall-clock — deterministic given the inputs. These power the Clopper–Pearson exact
 * binomial CI (REQ-ENGINE-FAMILY-002/003), the Method-2 drift slope test
 * (REQ-ENGINE-006, Student-t), and the M5 delta-method CI (REQ-ENGINE-004b, normal).
 *
 * `regularizedIncompleteBeta` is the Numerical-Recipes `betai` (Lentz continued
 * fraction); its inverse is a robust bisection. The Student-t critical value is derived
 * from the inverse incomplete beta via the identity P(|T| ≤ t) = I_{t²/(ν+t²)}(½, ν/2).
 */

const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of the gamma function (Lanczos approximation, g=7). */
export function logGamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  let shifted = x - 1;
  let a = LANCZOS_C[0] ?? 0;
  const t = shifted + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i += 1) {
    a += (LANCZOS_C[i] ?? 0) / (shifted + i);
  }
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(a)
  );
}

const FPMIN = 1e-300;

/** Lentz's continued fraction for the incomplete beta (Numerical Recipes `betacf`). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-13) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b) ∈ [0, 1]. */
export function regularizedIncompleteBeta(
  x: number,
  a: number,
  b: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logFront =
    logGamma(a + b) -
    logGamma(a) -
    logGamma(b) +
    a * Math.log(x) +
    b * Math.log(1 - x);
  const front = Math.exp(logFront);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Inverse of the regularized incomplete beta: find x with I_x(a, b) = p. */
export function inverseRegularizedIncompleteBeta(
  p: number,
  a: number,
  b: number,
): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 128; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-13) break;
  }
  return 0.5 * (lo + hi);
}

/**
 * Two-sided Student-t critical value t* with P(|T| ≤ t*) = confidence, for `df`
 * degrees of freedom — via the inverse incomplete beta.
 */
export function tCriticalTwoSided(confidence: number, df: number): number {
  if (df <= 0) return Number.POSITIVE_INFINITY;
  const z = inverseRegularizedIncompleteBeta(confidence, 0.5, df / 2);
  return Math.sqrt((df * z) / (1 - z));
}

const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
];
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
];
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
];
const ACKLAM_D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
  3.754408661907416,
];

/** Horner polynomial evaluation: c[0]·x^(n-1) + … + c[n-1]. */
function horner(coeffs: readonly number[], x: number): number {
  return coeffs.reduce((acc, c) => acc * x + c, 0);
}

/** Standard-normal quantile Φ⁻¹(p) (Acklam's rational approximation, ~1e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return horner(ACKLAM_C, q) / (horner(ACKLAM_D, q) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (horner(ACKLAM_A, r) * q) / (horner(ACKLAM_B, r) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(horner(ACKLAM_C, q) / (horner(ACKLAM_D, q) * q + 1));
}
