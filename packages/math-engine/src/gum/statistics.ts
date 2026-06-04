import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { assertDenseArray, valueKind } from "../validation/shape.js";

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

export function normalQuantile(p: number): number {
  const probability = assertProbability(p, "p");

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

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (probability < pLow) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return assertFiniteStatisticResult(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1),
      "normalQuantile"
    );
  }

  if (probability <= pHigh) {
    const q = probability - 0.5;
    const r = q * q;
    return assertFiniteStatisticResult(
      (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1),
      "normalQuantile"
    );
  }

  const q = Math.sqrt(-2 * Math.log(1 - probability));
  return assertFiniteStatisticResult(
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1),
    "normalQuantile"
  );
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

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
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

  for (let m = 1; m <= maxIterations; m += 1) {
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
    if (Math.abs(del - 1) <= epsilon) break;
  }

  return h;
}

export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  const checkedX = assertFiniteStatisticNumber(x, "x");
  const checkedA = assertFiniteStatisticNumber(a, "a");
  const checkedB = assertFiniteStatisticNumber(b, "b");
  if (!(checkedX >= 0 && checkedX <= 1) || !(checkedA > 0) || !(checkedB > 0)) {
    throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Invalid parameters for regularized incomplete beta.", { x: checkedX, a: checkedA, b: checkedB });
  }
  if (checkedX === 0 || checkedX === 1) return checkedX;

  const bt = Math.exp(logGamma(checkedA + checkedB) - logGamma(checkedA) - logGamma(checkedB) + checkedA * Math.log(checkedX) + checkedB * Math.log(1 - checkedX));
  if (checkedX < (checkedA + 1) / (checkedA + checkedB + 2)) {
    return assertFiniteStatisticResult(bt * betaContinuedFraction(checkedX, checkedA, checkedB) / checkedA, "regularizedIncompleteBeta");
  }
  return assertFiniteStatisticResult(1 - bt * betaContinuedFraction(1 - checkedX, checkedB, checkedA) / checkedB, "regularizedIncompleteBeta");
}

export function studentTCdf(t: number, degreesOfFreedom: number): number {
  const checkedT = assertFiniteStatisticNumber(t, "t");
  const checkedDof = assertDegreesOfFreedom(degreesOfFreedom, "degreesOfFreedom", true);
  if (!Number.isFinite(checkedDof) || checkedDof > 1e7) {
    return assertFiniteStatisticResult(0.5 * (1 + erf(checkedT / Math.SQRT2)), "studentTCdf");
  }
  const x = checkedDof / (checkedDof + checkedT * checkedT);
  const ib = regularizedIncompleteBeta(x, checkedDof / 2, 0.5);
  return assertFiniteStatisticResult(checkedT >= 0 ? 1 - 0.5 * ib : 0.5 * ib, "studentTCdf");
}

export function erf(x: number): number {
  const checkedX = assertFiniteStatisticNumber(x, "x");
  // Abramowitz and Stegun 7.1.26. Sufficient for coverage-factor diagnostics and large-df fallback.
  const sign = checkedX < 0 ? -1 : 1;
  const absX = Math.abs(checkedX);
  const t = 1 / (1 + 0.3275911 * absX);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-absX * absX);
  return assertFiniteStatisticResult(sign * y, "erf");
}

export function studentTQuantile(p: number, degreesOfFreedom: number): number {
  const probability = assertProbability(p, "p");
  const checkedDof = assertDegreesOfFreedom(degreesOfFreedom, "degreesOfFreedom", true);
  if (!Number.isFinite(checkedDof) || checkedDof > 1e7) {
    return normalQuantile(probability);
  }

  let low = -1;
  let high = 1;
  while (studentTCdf(low, checkedDof) > probability) low *= 2;
  while (studentTCdf(high, checkedDof) < probability) high *= 2;

  for (let i = 0; i < 90; i += 1) {
    const mid = (low + high) / 2;
    if (studentTCdf(mid, checkedDof) < probability) low = mid;
    else high = mid;
  }
  return assertFiniteStatisticResult((low + high) / 2, "studentTQuantile");
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
  let denominator = 0;
  for (let index = 0; index < diagonalVarianceContributions.length; index += 1) {
    const contribution = assertFiniteStatisticNumber(diagonalVarianceContributions[index], `diagonalVarianceContributions[${index}]`);
    if (contribution < 0) {
      throw makeError(ERROR_CODES.INVALID_STATISTIC_INPUT, "Diagonal variance contributions must be non-negative.", { index, contribution });
    }
    const dof = assertDegreesOfFreedom(degreesOfFreedom[index], `degreesOfFreedom[${index}]`, true);
    if (contribution === 0 || !Number.isFinite(dof)) continue;
    const contributionTerm = assertFiniteStatisticResult((contribution * contribution) / dof, `diagonalVarianceContributions[${index}].term`);
    denominator = assertFiniteStatisticResult(denominator + contributionTerm, "welchSatterthwaite.denominator");
  }
  if (denominator === 0) return Number.POSITIVE_INFINITY;
  const numerator = assertFiniteStatisticResult(variance * variance, "welchSatterthwaite.numerator");
  return assertFiniteStatisticResult(numerator / denominator, "welchSatterthwaiteDegreesOfFreedom");
}
