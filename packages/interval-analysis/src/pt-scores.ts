/**
 * Proficiency-testing performance scores per ISO 13528:2022 §9 (issue #60,
 * ISO/IEC 17025 §7.7.2). Pure + deterministic.
 *
 * - z  = (x − x_pt) / σ_pt                       (§9.4)
 * - z′ = (x − x_pt) / √(σ_pt² + u(x_pt)²)        (§9.5)
 * - ζ  = (x − x_pt) / √(u(x)² + u(x_pt)²)        (§9.6, standard uncertainties)
 * - En = (x − x_ref) / √(U(x)² + U(x_ref)²)      (§9.7, EXPANDED uncertainties)
 *
 * Classification (§9.4.1 / §9.7.1): z-family uses the ±2 warning / ±3 action
 * bands; En is a pass/fail criterion at ±1 with no warning band. En is the
 * norm for calibration PT rounds.
 */

export type PtScoreType = "en" | "z" | "z_prime" | "zeta";

export type PtScoreVerdict = "satisfactory" | "questionable" | "unsatisfactory";

/** z = (x − x_pt) / σ_pt. Returns null when σ_pt is not positive. */
export function zScore(
  labValue: number,
  assignedValue: number,
  sigmaPt: number,
): number | null {
  if (!(sigmaPt > 0)) return null;
  return (labValue - assignedValue) / sigmaPt;
}

/** z′ = (x − x_pt) / √(σ_pt² + u(x_pt)²) — σ_pt inflated by the assigned-value uncertainty. */
export function zPrimeScore(
  labValue: number,
  assignedValue: number,
  sigmaPt: number,
  assignedValueUncertainty: number,
): number | null {
  const denom = Math.sqrt(
    sigmaPt * sigmaPt + assignedValueUncertainty * assignedValueUncertainty,
  );
  if (!(denom > 0)) return null;
  return (labValue - assignedValue) / denom;
}

/** ζ = (x − x_pt) / √(u(x)² + u(x_pt)²), with STANDARD uncertainties. */
export function zetaScore(
  labValue: number,
  assignedValue: number,
  labStandardUncertainty: number,
  assignedStandardUncertainty: number,
): number | null {
  const denom = Math.sqrt(
    labStandardUncertainty * labStandardUncertainty +
      assignedStandardUncertainty * assignedStandardUncertainty,
  );
  if (!(denom > 0)) return null;
  return (labValue - assignedValue) / denom;
}

/** En = (x − x_ref) / √(U(x)² + U(x_ref)²), with EXPANDED (k=2) uncertainties. */
export function enScore(
  labValue: number,
  referenceValue: number,
  labExpandedUncertainty: number,
  referenceExpandedUncertainty: number,
): number | null {
  const denom = Math.sqrt(
    labExpandedUncertainty * labExpandedUncertainty +
      referenceExpandedUncertainty * referenceExpandedUncertainty,
  );
  if (!(denom > 0)) return null;
  return (labValue - referenceValue) / denom;
}

/**
 * ISO 13528 acceptance criteria. z-family: |z| ≤ 2 satisfactory, 2 < |z| < 3
 * questionable, |z| ≥ 3 unsatisfactory. En: |En| ≤ 1 satisfactory, otherwise
 * unsatisfactory (no warning band). Non-finite scores are unsatisfactory —
 * an uncomputable score must never read as a pass.
 */
export function classifyScore(
  type: PtScoreType,
  score: number,
): PtScoreVerdict {
  if (!Number.isFinite(score)) return "unsatisfactory";
  const abs = Math.abs(score);
  if (type === "en") {
    return abs <= 1 ? "satisfactory" : "unsatisfactory";
  }
  if (abs <= 2) return "satisfactory";
  if (abs < 3) return "questionable";
  return "unsatisfactory";
}
