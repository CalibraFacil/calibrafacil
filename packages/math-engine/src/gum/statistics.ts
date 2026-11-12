import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { assertDenseArray, valueKind } from "../validation/shape.js";
import { correlationMatrixDefect } from "./psd.js";

// Slack for the correlation-matrix checks of the generalized Welch–Satterthwaite
// helper (bounds, unit diagonal, symmetry and positive semidefiniteness), so a
// matrix assembled from rounded coefficients is not rejected for its last bits.
const CORRELATION_MATRIX_TOLERANCE = 1e-12;

const LANCZOS_COEFFICIENTS = [
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7
] as const;

function assertFiniteStatisticNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Statistic helper input must be a finite number.", {
      path,
      value: typeof value === "number" ? String(value) : valueKind(value)
    });
  }
  return Object.is(value, -0) ? 0 : value;
}

function assertFiniteStatisticResult(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Statistic helper result is outside the finite numeric range supported by this API.", {
      path,
      value: String(value),
      suggestedRemediation: "Use inputs within a smaller operational numeric range or validate this calculation with a domain-specific numerical method."
    });
  }
  return Object.is(value, -0) ? 0 : value;
}

function assertProbability(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0 && value < 1)) {
    throw makeError(ERROR_CODES.INVALID_PROBABILITY, "Probability must be finite, greater than 0, and less than 1.", {
      path,
      value: typeof value === "number" ? String(value) : valueKind(value)
    });
  }
  return value;
}

function assertDegreesOfFreedom(value: unknown, path: string, allowInfinity: boolean): number {
  if (value === Number.POSITIVE_INFINITY && allowInfinity) return Number.POSITIVE_INFINITY;
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    throw makeError(ERROR_CODES.INVALID_DEGREES_OF_FREEDOM, "Degrees of freedom must be positive and finite unless positive Infinity is explicitly supported by this API.", {
      path,
      value: typeof value === "number" ? String(value) : valueKind(value),
      allowInfinity
    });
  }
  return value;
}

function assertFiniteNumberArray(values: unknown, path: string, minLength: number): readonly number[] {
  if (!Array.isArray(values)) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Statistic helper input must be an array of finite numbers.", { path, valueType: valueKind(values) });
  }
  assertDenseArray(values, path, ERROR_CODES.INVALID_STATISTIC_INPUT);
  if (values.length < minLength) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, `At least ${minLength} finite number(s) are required.`, { path, count: values.length, minLength });
  }
  return values.map((value, index) => assertFiniteStatisticNumber(value, `${path}[${index}]`));
}

export function mean(values: readonly number[]): number {
  const checked = assertFiniteNumberArray(values, "values", 1);
  const sum = checked.reduce((total, value) => assertFiniteStatisticResult(total + value, "mean.sum"), 0);
  return assertFiniteStatisticResult(sum / checked.length, "mean");
}

export function sampleStandardDeviation(values: readonly number[]): number {
  const checked = assertFiniteNumberArray(values, "values", 2);
  const avg = mean(checked);
  const sumOfSquares = checked.reduce((sum, value, index) => {
    const difference = assertFiniteStatisticResult(value - avg, `values[${index}]-mean`);
    const square = assertFiniteStatisticResult(difference ** 2, `values[${index}].squaredDifference`);
    return assertFiniteStatisticResult(sum + square, "sampleStandardDeviation.sumOfSquares");
  }, 0);
  const variance = assertFiniteStatisticResult(sumOfSquares / (checked.length - 1), "sampleStandardDeviation.variance");
  return assertFiniteStatisticResult(Math.sqrt(variance), "sampleStandardDeviation");
}

export function standardUncertaintyOfMean(values: readonly number[]): number {
  const checked = assertFiniteNumberArray(values, "values", 2);
  return assertFiniteStatisticResult(sampleStandardDeviation(checked) / Math.sqrt(checked.length), "standardUncertaintyOfMean");
}

const SQRT_PI = Math.sqrt(Math.PI);
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

// Below this the series for erf is used and erfc is 1 - erf; from here on erfc
// comes from its continued fraction, which keeps the relative accuracy of the
// tail (57 terms at 2, fewer beyond).
const ERFC_CONTINUED_FRACTION_FROM = 2;

/**
 * erf(x) for 0 <= x < 2 by the series with positive terms (Abramowitz and
 * Stegun 7.1.6): erf(x) = (2/√π) e^(-x²) Σ 2ⁿ x^(2n+1) / (1·3·…·(2n+1)).
 * No cancellation, so it is exact to the last bits and erf(0) is exactly 0.
 */
function erfSeries(x: number): number {
  const twoXSquared = 2 * x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 200; n += 1) {
    term *= twoXSquared / (2 * n + 1);
    const next = sum + term;
    if (next === sum) break;
    sum = next;
  }
  return (2 / SQRT_PI) * Math.exp(-x * x) * sum;
}

/**
 * erfc(x) for x >= 2 by the continued fraction (Abramowitz and Stegun 7.1.14)
 * erfc(x) = e^(-x²) / (√π (x + (1/2)/(x + 1/(x + (3/2)/(x + …))))), evaluated
 * with the modified Lentz method. Every term is positive.
 */
function erfcContinuedFraction(x: number): number {
  let fraction = x;
  let c = x;
  let d = 0;
  for (let n = 1; n <= 200; n += 1) {
    const numerator = n / 2;
    d = 1 / (x + numerator * d);
    c = x + numerator / c;
    const delta = c * d;
    fraction *= delta;
    if (Math.abs(delta - 1) <= Number.EPSILON) break;
  }
  return Math.exp(-x * x) / (SQRT_PI * fraction);
}

function erfcUnchecked(x: number): number {
  if (x < 0) return 2 - erfcUnchecked(-x);
  if (x < ERFC_CONTINUED_FRACTION_FROM) return 1 - erfSeries(x);
  return erfcContinuedFraction(x);
}

/** Φ(t), the standard normal distribution function, with a relatively accurate lower tail. */
function standardNormalCdf(t: number): number {
  return 0.5 * erfcUnchecked(-t / Math.SQRT2);
}

// Acklam's rational approximation of the normal quantile for 0 < p <= 0.5
// (relative error below 1.15e-9), before refinement.
function acklamLowerQuantile(probability: number): number {
  const a = [
    -3.969683028665376e+1,
    2.209460984245205e+2,
    -2.759285104469687e+2,
    1.383577518672690e+2,
    -3.066479806614716e+1,
    2.506628277459239
  ] as const;
  const b = [
    -5.447609879822406e+1,
    1.615858368580409e+2,
    -1.556989798598866e+2,
    6.680131188771972e+1,
    -1.328068155288572e+1
  ] as const;
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783
  ] as const;
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416
  ] as const;

  if (probability < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// The refinement divides by the normal density; below this probability the
// density and Φ are subnormal and the step would add noise instead of digits.
const NORMAL_QUANTILE_REFINEMENT_FROM = 1e-300;

/** Normal quantile for 0 < p <= 0.5: Acklam's approximation and one step of Halley's method on Φ(x) - p. */
function normalLowerQuantile(probability: number): number {
  const x = acklamLowerQuantile(probability);
  if (probability < NORMAL_QUANTILE_REFINEMENT_FROM) return x;
  const error = standardNormalCdf(x) - probability;
  const step = error * SQRT_TWO_PI * Math.exp((x * x) / 2);
  return x - step / (1 + (x * step) / 2);
}

export function normalQuantile(p: number): number {
  const probability = assertProbability(p, "p");
  // The upper half is the mirror of the lower one: 1 - p is exact for
  // p >= 0.5, and the lower tail is the one Φ resolves.
  const quantile = probability > 0.5 ? -normalLowerQuantile(1 - probability) : normalLowerQuantile(probability);
  return assertFiniteStatisticResult(quantile, "normalQuantile");
}

export function logGamma(z: number): number {
  const value = assertFiniteStatisticNumber(z, "z");
  if (!(value > 0)) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "logGamma currently supports positive finite arguments only.", { path: "z", value });
  }
  if (value < 0.5) {
    return assertFiniteStatisticResult(Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value), "logGamma");
  }
  let x = 0.99999999999980993;
  const adjusted = value - 1;
  for (let i = 0; i < LANCZOS_COEFFICIENTS.length; i += 1) {
    x += (LANCZOS_COEFFICIENTS[i] as number) / (adjusted + i + 1);
  }
  const t = adjusted + LANCZOS_COEFFICIENTS.length - 0.5;
  return assertFiniteStatisticResult(0.5 * Math.log(2 * Math.PI) + (adjusted + 0.5) * Math.log(t) - t + Math.log(x), "logGamma");
}

// The continued fraction of the incomplete beta function converges in about
// √max(a, b) terms at its slowest point. Student's t (b = 1/2) needs fewer than
// 150 for every ν; the cap only bounds the exported helper for very large a and b.
const BETA_CONTINUED_FRACTION_MAX_ITERATIONS = 10000;

function betaContinuedFraction(x: number, a: number, b: number): number {
  const epsilon = 3e-14;
  const fpMin = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= BETA_CONTINUED_FRACTION_MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;

    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) <= epsilon) return h;
  }

  // A truncated fraction is a wrong value, not an approximate one (a = b = 1e6
  // at x = 0.5 read 0.4997 with the 200 terms of up to 0.4.0): refuse it.
  throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Incomplete beta continued fraction did not converge for these parameters.", {
    x,
    a,
    b,
    maxIterations: BETA_CONTINUED_FRACTION_MAX_ITERATIONS,
    suggestedRemediation: "Use parameters within a smaller operational range or validate this calculation with a domain-specific numerical method."
  });
}

// From here on ln Γ comes from Stirling's series, whose terms can be subtracted
// analytically; the first neglected term is below 3e-17 at 10.
const STIRLING_SERIES_FROM = 10;

/** ln Γ(z) - [(z - ½) ln z - z + ½ ln 2π] for z >= 10: Stirling's series (Abramowitz and Stegun 6.1.40). */
function stirlingCorrection(z: number): number {
  const w = 1 / (z * z);
  return (1 / 12 - (1 / 360 - (1 / 1260 - (1 / 1680 - (1 / 1188 - (691 / 360360 - w / 156) * w) * w) * w) * w) * w) / z;
}

/**
 * ln B(a, b) = ln Γ(a) + ln Γ(b) - ln Γ(a + b). With one argument large the
 * last two are huge and nearly equal (ν = 1e7 lost eight digits to that
 * subtraction up to 0.4.0), so their difference is taken analytically:
 * ln Γ(L) - ln Γ(L + s) = -(L - ½) ln(1 + s/L) - s ln(L + s) + s + δ(L) - δ(L + s),
 * δ being Stirling's correction.
 */
function logBeta(a: number, b: number): number {
  const small = Math.min(a, b);
  const large = Math.max(a, b);
  if (large < STIRLING_SERIES_FROM) return logGamma(a) + logGamma(b) - logGamma(a + b);
  const sum = large + small;
  return logGamma(small)
    - (large - 0.5) * Math.log1p(small / large)
    - small * Math.log(sum)
    + small
    + stirlingCorrection(large)
    - stirlingCorrection(sum);
}

/**
 * I_x(a, b) from x, y = 1 - x and their logarithms. The caller gives all four
 * because each can carry what the others lost: near x = 1 the information is
 * in y, and an x too small for a double still has a usable logarithm.
 */
function regularizedIncompleteBetaCore(x: number, y: number, logX: number, logY: number, a: number, b: number): number {
  const bt = Math.exp(a * logX + b * logY - logBeta(a, b));
  const value = x < (a + 1) / (a + b + 2)
    ? bt * betaContinuedFraction(x, a, b) / a
    : 1 - bt * betaContinuedFraction(y, b, a) / b;
  // Rounding can leave the value a few units in the last place outside [0, 1].
  return Math.min(1, Math.max(0, value));
}

/**
 * I_x(a, b) with y = 1 - x given by the caller: Student's t passes
 * y = t²/(ν + t²) exactly, which is what keeps the distribution function from
 * going flat around t = 0 (1 - x computed here would have lost it).
 */
function regularizedIncompleteBetaWithComplement(x: number, y: number, a: number, b: number): number {
  if (x === 0) return 0;
  if (y === 0) return 1;
  const logX = x > 0.5 ? Math.log1p(-y) : Math.log(x);
  const logY = y > 0.5 ? Math.log1p(-x) : Math.log(y);
  return regularizedIncompleteBetaCore(x, y, logX, logY, a, b);
}

export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  const checkedX = assertFiniteStatisticNumber(x, "x");
  const checkedA = assertFiniteStatisticNumber(a, "a");
  const checkedB = assertFiniteStatisticNumber(b, "b");
  if (!(checkedX >= 0 && checkedX <= 1) || !(checkedA > 0) || !(checkedB > 0)) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Invalid parameters for regularized incomplete beta.", { x: checkedX, a: checkedA, b: checkedB });
  }
  return assertFiniteStatisticResult(regularizedIncompleteBetaWithComplement(checkedX, 1 - checkedX, checkedA, checkedB), "regularizedIncompleteBeta");
}

// From here on the continued fraction in x = ν/(ν + t²) loses too much (about
// ν·1e-17 near x = 1) and Student's t is read off the normal distribution
// through the series below. At 1e5 the two agree to 1e-12, so there is no step
// (up to 0.5.0 the normal distribution itself took over at 1e7, 1.25e-7 off).
const STUDENT_T_SERIES_FROM = 1e5;

// Past this |t| the tail of a t with ν > 1e5 is below the smallest double.
const STUDENT_T_SERIES_TAIL_END = 40;

/**
 * The normal deviate z with Φ(z) = F_ν(t), for large ν:
 *
 *   z = t - t(t² + 1)/(4ν) + t(13t⁴ + 8t² + 3)/(96ν²)
 *         - t(35t⁶ + 19t⁴ + t² - 15)/(384ν³)
 *         + t(6271t⁸ + 3224t⁶ - 102t⁴ - 1680t² - 945)/(92160ν⁴)
 *
 * This is the Cornish–Fisher expansion of the t quantile (Abramowitz and Stegun
 * 26.7.5) reverted term by term. The first neglected term is about
 * 0.05·(t²/ν)⁵ relative: under 1e-15 for |t| <= 12 at ν = 1e5, 5e-11 at the end
 * of the range, |t| = 40. With ν = ∞ it is z = t.
 */
function studentTNormalDeviate(absT: number, degreesOfFreedom: number): number {
  const t2 = absT * absT;
  const e = 1 / degreesOfFreedom;
  const h1 = -(t2 + 1) / 4;
  const h2 = ((13 * t2 + 8) * t2 + 3) / 96;
  const h3 = -(((35 * t2 + 19) * t2 + 1) * t2 - 15) / 384;
  const h4 = ((((6271 * t2 + 3224) * t2 - 102) * t2 - 1680) * t2 - 945) / 92160;
  return absT * (1 + e * (h1 + e * (h2 + e * (h3 + e * h4))));
}

/**
 * P(T > |t|) for Student's t with ν degrees of freedom.
 *
 * Up to ν = 1e5: ½ I_x(ν/2, ½) with x = ν/(ν + t²). x and its complement are
 * both formed from t², so neither end loses digits. When t² overflows or x
 * underflows, x^(ν/2) can still be an ordinary number (ν = 1 at t = 1e200 has a
 * tail of 3e-201): x is then carried by its logarithm.
 *
 * Above 1e5, ν = ∞ included: the normal tail at the deviate of the series.
 */
function studentTUpperTail(absT: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom > STUDENT_T_SERIES_FROM) {
    if (absT > STUDENT_T_SERIES_TAIL_END) return 0;
    return 0.5 * erfcUnchecked(studentTNormalDeviate(absT, degreesOfFreedom) / Math.SQRT2);
  }
  const a = degreesOfFreedom / 2;
  const tSquared = absT * absT;
  if (Number.isFinite(tSquared)) {
    const denominator = degreesOfFreedom + tSquared;
    const x = degreesOfFreedom / denominator;
    if (x > 0) return 0.5 * regularizedIncompleteBetaWithComplement(x, tSquared / denominator, a, 0.5);
  }
  const logX = Math.log(degreesOfFreedom) - 2 * Math.log(absT);
  return 0.5 * regularizedIncompleteBetaCore(Math.exp(logX), 1, logX, 0, a, 0.5);
}

export function studentTCdf(t: number, degreesOfFreedom: number): number {
  const checkedT = assertFiniteStatisticNumber(t, "t");
  const checkedDof = assertDegreesOfFreedom(degreesOfFreedom, "degreesOfFreedom", true);
  const tail = studentTUpperTail(Math.abs(checkedT), checkedDof);
  return assertFiniteStatisticResult(checkedT >= 0 ? 1 - tail : tail, "studentTCdf");
}

export function erf(x: number): number {
  const checkedX = assertFiniteStatisticNumber(x, "x");
  const absX = Math.abs(checkedX);
  const value = absX < ERFC_CONTINUED_FRACTION_FROM ? erfSeries(absX) : 1 - erfcContinuedFraction(absX);
  return assertFiniteStatisticResult(checkedX < 0 ? -value : value, "erf");
}

export function studentTQuantile(p: number, degreesOfFreedom: number): number {
  const probability = assertProbability(p, "p");
  const checkedDof = assertDegreesOfFreedom(degreesOfFreedom, "degreesOfFreedom", true);
  if (!Number.isFinite(checkedDof)) {
    return normalQuantile(probability);
  }
  if (probability === 0.5) return 0;

  // Solve on the tail, where the distribution function has its digits: find
  // a > 0 with P(T > a) = min(p, 1 - p) and give it the sign of p - 0.5.
  // 1 - p is exact for p > 0.5.
  const tailProbability = probability < 0.5 ? probability : 1 - probability;
  let low = 0;
  let high = 1;
  while (studentTUpperTail(high, checkedDof) > tailProbability) {
    low = high;
    high *= 2;
    if (!Number.isFinite(high)) {
      throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Student t quantile is outside the finite numeric range supported by this API.", {
        path: "studentTQuantile",
        p: String(probability),
        degreesOfFreedom: String(checkedDof)
      });
    }
  }
  // Bisect until the two ends are neighbouring doubles. The bound is far above
  // what any bracket needs (1075 halvings span every double) and only keeps the
  // loop finite by construction.
  for (let i = 0; i < 2200; i += 1) {
    const mid = low + (high - low) / 2;
    if (!(mid > low && mid < high)) break;
    if (studentTUpperTail(mid, checkedDof) > tailProbability) low = mid;
    else high = mid;
  }
  // `high` is the smallest double whose tail does not exceed the target.
  return assertFiniteStatisticResult(probability < 0.5 ? -high : high, "studentTQuantile");
}

export function coverageFactorForProbability(coverageProbability: number, effectiveDegreesOfFreedom: number): number {
  const probability = assertProbability(coverageProbability, "coverageProbability");
  const dof = assertDegreesOfFreedom(effectiveDegreesOfFreedom, "effectiveDegreesOfFreedom", true);
  const cumulativeProbability = 0.5 + probability / 2;
  if (!(cumulativeProbability > 0.5 && cumulativeProbability < 1)) {
    throw makeError(ERROR_CODES.INVALID_PROBABILITY, "Coverage probability is outside the numerically supported open interval for this helper.", {
      path: "coverageProbability",
      coverageProbability: String(coverageProbability)
    });
  }
  const coverageFactor = studentTQuantile(cumulativeProbability, dof);
  if (!(coverageFactor > 0)) {
    throw makeError(ERROR_CODES.INVALID_PROBABILITY, "Coverage probability is too small to produce a positive coverage factor with this numeric backend.", {
      path: "coverageProbability",
      coverageProbability: String(coverageProbability)
    });
  }
  return coverageFactor;
}

export function welchSatterthwaiteDegreesOfFreedom(
  combinedVariance: number,
  diagonalVarianceContributions: readonly number[],
  degreesOfFreedom: readonly number[]
): number {
  const variance = assertFiniteStatisticNumber(combinedVariance, "combinedVariance");
  if (variance < 0) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Combined variance must be non-negative.", { path: "combinedVariance", combinedVariance: variance });
  }
  if (!Array.isArray(diagonalVarianceContributions) || !Array.isArray(degreesOfFreedom)) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Welch-Satterthwaite inputs must be arrays.", {
      diagonalVarianceContributionsType: valueKind(diagonalVarianceContributions),
      degreesOfFreedomType: valueKind(degreesOfFreedom)
    });
  }
  assertDenseArray(diagonalVarianceContributions, "diagonalVarianceContributions", ERROR_CODES.INVALID_STATISTIC_INPUT);
  assertDenseArray(degreesOfFreedom, "degreesOfFreedom", ERROR_CODES.INVALID_STATISTIC_INPUT);
  if (diagonalVarianceContributions.length !== degreesOfFreedom.length) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Welch-Satterthwaite input arrays must have matching lengths.", {
      contributions: diagonalVarianceContributions.length,
      degreesOfFreedom: degreesOfFreedom.length
    });
  }
  if (variance === 0) return Number.POSITIVE_INFINITY;
  const checked: Array<{ contribution: number; dof: number }> = [];
  for (let index = 0; index < diagonalVarianceContributions.length; index += 1) {
    const contribution = assertFiniteStatisticNumber(diagonalVarianceContributions[index], `diagonalVarianceContributions[${index}]`);
    if (contribution < 0) {
      throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Diagonal variance contributions must be non-negative.", { index, contribution });
    }
    const dof = assertDegreesOfFreedom(degreesOfFreedom[index], `degreesOfFreedom[${index}]`, true);
    checked.push({ contribution, dof });
  }
  // Normalize by the largest variance before squaring: the identity is scale
  // invariant, so u^4 neither underflows below ~1e-154 (read as infinite
  // information up to 0.3.0, audit) nor overflows above ~1e154.
  let scale = variance;
  for (const { contribution } of checked) if (contribution > scale) scale = contribution;
  let denominator = 0;
  for (const [index, { contribution, dof }] of checked.entries()) {
    if (contribution === 0 || !Number.isFinite(dof)) continue;
    const scaledContribution = contribution / scale;
    // Scaling bounds the squared term by 1, but a tiny positive dof can still
    // overflow it; an infinite denominator would otherwise read as 0 dof (review).
    const contributionTerm = assertFiniteStatisticResult((scaledContribution * scaledContribution) / dof, `diagonalVarianceContributions[${index}].term`);
    denominator = assertFiniteStatisticResult(denominator + contributionTerm, "welchSatterthwaite.denominator");
  }
  if (denominator === 0) return Number.POSITIVE_INFINITY;
  const scaledVariance = variance / scale;
  const numerator = scaledVariance * scaledVariance;
  if (numerator === 0) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Combined variance is too small relative to its contributions for a finite Welch-Satterthwaite evaluation.", {
      combinedVariance: variance,
      scale
    });
  }
  return assertFiniteStatisticResult(numerator / denominator, "welchSatterthwaiteDegreesOfFreedom");
}

/**
 * Welch–Satterthwaite generalized to correlated input quantities (Castrup, H.,
 * "A Welch-Satterthwaite Relation for Correlated Errors", Proc. Meas. Sci.
 * Conf. 2010, rev. 2020, Eq. 46; cf. Willink, R., Metrologia 44 (2007) 340).
 * With b_i = c_i·u_i (signed) and ρ_ij the correlation coefficients,
 *
 *   ν_eff = u_c⁴ / [ Σ_i b_i⁴/ν_i
 *                    + Σ_{i<j} ρ_ij² b_i² b_j² (1/ν_i + 1/ν_j + 1/(2 ν_i ν_j))
 *                    + 2 Σ_{i<j} ρ_ij b_i b_j (b_i²/ν_i + b_j²/ν_j)
 *                    + 2 Σ_i (1/ν_i) Σ_{j<k, j≠i, k≠i} ρ_ij ρ_ik b_i² b_j b_k ]
 *
 * The last sum carries the components that share an index: with three or more
 * correlated quantities, u_i appears in more than one relationship and its
 * estimate contributes a cross-product for every pair it links (the term is
 * absent from the two-component form, and omitting it overstates ν_eff — three
 * equal components with ν = 10 and every ρ = 0.5 give 29.91, not 34.16;
 * review). Writing B_i = Σ_j ρ_ij b_j (ρ_ii = 1), the whole denominator is the
 * first-order propagation Σ_i (b_i B_i)²/ν_i plus the second-order pair terms
 * 1/(2 ν_i ν_j), which is how it is grouped above.
 *
 * It reduces to GUM Eq. G.2b when every ρ_ij = 0; every term of an input with
 * ν = ∞ vanishes. Inputs are normalized by the largest |b_i| (or u_c) before
 * squaring, as in `welchSatterthwaiteDegreesOfFreedom`.
 */
export function generalizedWelchSatterthwaiteDegreesOfFreedom(
  combinedVariance: number,
  scaledUncertainties: readonly number[],
  correlationMatrix: readonly (readonly number[])[],
  degreesOfFreedom: readonly number[]
): number {
  const variance = assertFiniteStatisticNumber(combinedVariance, "combinedVariance");
  if (variance < 0) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Combined variance must be non-negative.", { path: "combinedVariance", combinedVariance: variance });
  }
  if (!Array.isArray(scaledUncertainties) || !Array.isArray(correlationMatrix) || !Array.isArray(degreesOfFreedom)) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Generalized Welch-Satterthwaite inputs must be arrays.", {
      scaledUncertaintiesType: valueKind(scaledUncertainties),
      correlationMatrixType: valueKind(correlationMatrix),
      degreesOfFreedomType: valueKind(degreesOfFreedom)
    });
  }
  assertDenseArray(scaledUncertainties, "scaledUncertainties", ERROR_CODES.INVALID_STATISTIC_INPUT);
  assertDenseArray(degreesOfFreedom, "degreesOfFreedom", ERROR_CODES.INVALID_STATISTIC_INPUT);
  const size = scaledUncertainties.length;
  if (degreesOfFreedom.length !== size || correlationMatrix.length !== size) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Generalized Welch-Satterthwaite input dimensions must agree.", {
      scaledUncertainties: size,
      degreesOfFreedom: degreesOfFreedom.length,
      correlationMatrixRows: correlationMatrix.length
    });
  }
  if (variance === 0) return Number.POSITIVE_INFINITY;
  const b: number[] = [];
  const inverseDof: number[] = [];
  for (let index = 0; index < size; index += 1) {
    b.push(assertFiniteStatisticNumber(scaledUncertainties[index], `scaledUncertainties[${index}]`));
    const dof = assertDegreesOfFreedom(degreesOfFreedom[index], `degreesOfFreedom[${index}]`, true);
    inverseDof.push(Number.isFinite(dof) ? 1 / dof : 0);
  }
  const rho: number[][] = [];
  for (let i = 0; i < size; i += 1) {
    const row = correlationMatrix[i];
    if (!Array.isArray(row) || row.length !== size) {
      throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Correlation matrix must be square.", { row: i, columns: Array.isArray(row) ? row.length : valueKind(row) });
    }
    assertDenseArray(row, `correlationMatrix[${i}]`, ERROR_CODES.INVALID_STATISTIC_INPUT);
    const checkedRow: number[] = [];
    for (let j = 0; j < size; j += 1) {
      const value = assertFiniteStatisticNumber(row[j], `correlationMatrix[${i}][${j}]`);
      if (Math.abs(value) > 1 + 1e-12 || (i === j && Math.abs(value - 1) > 1e-12)) {
        throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Correlation coefficients must lie in [-1, 1] with a unit diagonal.", { row: i, column: j, value });
      }
      checkedRow.push(value);
    }
    rho.push(checkedRow);
  }
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      if (Math.abs(rho[i]![j]! - rho[j]![i]!) > 1e-12) {
        throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Correlation matrix must be symmetric.", { row: i, column: j });
      }
    }
  }
  // Bounds, unit diagonal and symmetry do not make a correlation matrix
  // admissible: every off-diagonal entry of -0.9 in a 3x3 passes all three and
  // still has a negative eigenvalue. evaluateMeasurementModel validates this
  // before calling, but the helper is exported and must not return a plausible
  // ν_eff for an impossible model (review).
  const defect = correlationMatrixDefect(rho, CORRELATION_MATRIX_TOLERANCE);
  if (defect !== null) {
    throw makeError(
      ERROR_CODES.INVALID_STATISTIC_INPUT,
      "Correlation matrix is not positive semidefinite.",
      defect.kind === "negative_pivot"
        ? { pivot: defect.pivot, value: defect.value }
        : { row: defect.row, column: defect.column, residual: defect.residual }
    );
  }
  let scale = Math.sqrt(variance);
  for (const value of b) if (Math.abs(value) > scale) scale = Math.abs(value);
  const s = b.map((value) => value / scale);
  let denominator = 0;
  for (let i = 0; i < size; i += 1) {
    const si2 = s[i]! * s[i]!;
    denominator = assertFiniteStatisticResult(denominator + si2 * si2 * inverseDof[i]!, "generalizedWelchSatterthwaite.denominator");
    for (let j = i + 1; j < size; j += 1) {
      const r = rho[i]![j]!;
      if (r === 0 || (inverseDof[i] === 0 && inverseDof[j] === 0)) continue;
      const sj2 = s[j]! * s[j]!;
      const squaredTerm = r * r * si2 * sj2 * (inverseDof[i]! + inverseDof[j]! + 0.5 * inverseDof[i]! * inverseDof[j]!);
      const crossTerm = 2 * r * s[i]! * s[j]! * (si2 * inverseDof[i]! + sj2 * inverseDof[j]!);
      denominator = assertFiniteStatisticResult(denominator + squaredTerm + crossTerm, "generalizedWelchSatterthwaite.denominator");
    }
  }
  // Shared-index cross-products: quantity i's uncertainty estimate enters both
  // ρ_ij and ρ_ik, so every pair of relationships it takes part in contributes
  // 2 ρ_ij ρ_ik b_i² b_j b_k / ν_i. Only reachable with three or more
  // correlated quantities (review).
  for (let i = 0; i < size; i += 1) {
    const inverse = inverseDof[i]!;
    if (inverse === 0) continue;
    const si2 = s[i]! * s[i]!;
    if (si2 === 0) continue;
    for (let j = 0; j < size; j += 1) {
      if (j === i) continue;
      const rij = rho[i]![j]!;
      if (rij === 0) continue;
      for (let k = j + 1; k < size; k += 1) {
        if (k === i) continue;
        const rik = rho[i]![k]!;
        if (rik === 0) continue;
        denominator = assertFiniteStatisticResult(
          denominator + 2 * rij * rik * si2 * s[j]! * s[k]! * inverse,
          "generalizedWelchSatterthwaite.denominator"
        );
      }
    }
  }
  if (denominator === 0) return Number.POSITIVE_INFINITY;
  if (denominator < 0) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Generalized Welch-Satterthwaite denominator is negative; the correlation matrix is not consistent with the declared uncertainties.", { denominator });
  }
  const scaledVariance = variance / (scale * scale);
  const numerator = scaledVariance * scaledVariance;
  if (numerator === 0) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Combined variance is too small relative to its contributions for a finite Welch-Satterthwaite evaluation.", {
      combinedVariance: variance,
      scale
    });
  }
  return assertFiniteStatisticResult(numerator / denominator, "generalizedWelchSatterthwaiteDegreesOfFreedom");
}
