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
