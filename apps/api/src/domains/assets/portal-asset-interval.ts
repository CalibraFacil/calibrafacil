/**
 * Portal asset-interval write — the pure authorization & derivation core.
 * Spec: `specs/calibration-interval-customer-owned/spec.md`
 * (REQ-ACCESS-INT-002, REQ-ACCESS-INT-005, REQ-INTERVAL-003).
 *
 * The customer owns their asset's calibration interval (ISO/IEC 17025:2017
 * §7.8.4.3 + ILAC-G24 / OIML D 10); the lab no longer attributes periodicity.
 *
 * `decidePortalIntervalWrite` decides, for an ALREADY-AUTHENTICATED and
 * ALREADY-PERMISSIONED portal caller, whether a specific asset may have its
 * CALIBRATION interval (Track 1) changed. It enforces exactly one regulated guard:
 *  - tenant scope: the asset must belong to one of the caller's in-scope
 *    customers; otherwise 404 (we return not-found, never 403, so a portal user
 *    cannot probe which asset ids exist in another tenant).
 *
 * The customer owns the calibration interval for EVERY instrument — including
 * legal-metrology ones (REQ-MLR-040) — so there is NO legal-metrology lock here.
 * A legal instrument's regulation-fixed verification periodicity is a SEPARATE
 * track (`metrologyRegime` + `regulatedInterval`) the lab records; it is not
 * editable through this endpoint.
 *
 * It deliberately does NOT grant access (the route's RBAC guard does that) and
 * does NOT validate the body (`SetCalibrationIntervalSchema` does that). Keeping
 * it pure makes the HIGH-RISK tenant decision testable without a DB.
 */

export type PortalIntervalWriteInput = {
  /** The target asset row, or null when no row matched the requested id. */
  asset: { customerId: number } | null;
  /** Customer ids the caller may access (from `resolvePortalCustomerScope`). */
  scopedCustomerIds: readonly number[];
};

export type PortalIntervalWriteDecision =
  | { allowed: true }
  | { allowed: false; status: 404; reason: "asset_not_found" };

export function decidePortalIntervalWrite(
  input: PortalIntervalWriteInput,
): PortalIntervalWriteDecision {
  const { asset, scopedCustomerIds } = input;

  // Tenant scope is the only guard: a not-found OR out-of-scope asset is 404.
  if (!asset || !scopedCustomerIds.includes(asset.customerId)) {
    return { allowed: false, status: 404, reason: "asset_not_found" };
  }

  return { allowed: true };
}

/**
 * Derive `next_calibration_date` = `last_calibration_date` + `intervalMonths`,
 * deterministically in UTC, clamping the day to the last day of the target month
 * (so 31 Jan + 1 month → 28/29 Feb, matching date-fns `addMonths`). Returns null
 * when there is no last-calibration date yet (REQ-INTERVAL-003).
 */
export function deriveNextCalibrationDate(
  lastCalibrationDate: Date | null,
  intervalMonths: number,
): Date | null {
  if (!lastCalibrationDate) return null;

  const year = lastCalibrationDate.getUTCFullYear();
  const month = lastCalibrationDate.getUTCMonth();
  const day = lastCalibrationDate.getUTCDate();

  const absoluteMonth = month + intervalMonths;
  const targetYear = year + Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;

  // Day 0 of (targetMonth + 1) is the last day of targetMonth.
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      lastCalibrationDate.getUTCHours(),
      lastCalibrationDate.getUTCMinutes(),
      lastCalibrationDate.getUTCSeconds(),
      lastCalibrationDate.getUTCMilliseconds(),
    ),
  );
}
