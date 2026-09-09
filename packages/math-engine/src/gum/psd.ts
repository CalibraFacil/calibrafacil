/**
 * Positive-semidefiniteness test for a correlation matrix, shared by the
 * measurement-model covariance validation and the generalized
 * Welch–Satterthwaite helper so both reject the same matrices.
 *
 * The test is a Cholesky factorization run in dimensionless correlation space
 * (unit diagonal), so a large variance elsewhere in the model cannot relax the
 * bound for a small-uncertainty pair. It reports the defect instead of
 * throwing: each caller raises its own domain error code.
 */
export type CorrelationMatrixDefect =
  | { readonly kind: "negative_pivot"; readonly pivot: number; readonly value: number }
  | { readonly kind: "singular_residual"; readonly row: number; readonly column: number; readonly residual: number };

export function correlationMatrixDefect(
  normalized: readonly (readonly number[])[],
  tolerance: number
): CorrelationMatrixDefect | null {
  const size = normalized.length;
  const l: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = normalized[i]![j]!;
      for (let k = 0; k < j; k += 1) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (sum < -tolerance) return { kind: "negative_pivot", pivot: i, value: sum };
        l[i]![j] = sum <= 0 ? 0 : Math.sqrt(sum);
      } else if (l[j]![j]! > 0) {
        // Any positive pivot is factored, however small: a nearly singular but
        // positive-definite block (e.g. r = 1 - 5e-15 next to r = 5e-8) is
        // legitimate, and an inconsistent residual still surfaces as a negative
        // diagonal on a later row. Only an exactly collapsed pivot needs the
        // residual test below.
        l[i]![j] = sum / l[j]![j]!;
      } else if (Math.abs(sum) > tolerance) {
        return { kind: "singular_residual", row: i, column: j, residual: sum };
      } else {
        l[i]![j] = 0;
      }
    }
  }
  return null;
}
