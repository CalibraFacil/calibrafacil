/**
 * Legal-metrology verification periodicity — the pure next-date derivation (Track 2).
 * Spec: `specs/legal-metrology-regime/spec.md` (REQ-MLR-020..026).
 *
 * An instrument under Inmetro / RBMLQ-I legal control has a verification periodicity FIXED
 * BY REGULATION (neither lab nor customer sets it). This derives the next legal-verification
 * date from the structured `RegulatedInterval`, INDEPENDENTLY of the customer-owned
 * calibration interval (`deriveNextCalibrationDate` / Track 1).
 *
 * Pure + deterministic: the caller supplies the anchor dates (no wall-clock here). Reuses
 * the UTC month-add + end-of-month clamp from `deriveNextCalibrationDate`.
 */

import type { RegulatedInterval } from "@calibra-facil/schemas";

import { deriveNextCalibrationDate } from "./portal-asset-interval.js";

export type RegulatedIntervalAnchors = {
  /** Date of the last legal verification (proxy: the asset's last service/calibration). */
  lastVerificationDate: Date | null;
  /** Date of the first legal verification (for the per-technology install-anchored case). */
  firstVerificationDate: Date | null;
  /** Date the instrument was installed/commissioned (for the install-year ceiling). */
  installDate: Date | null;
};

export type RegulatedNextDate = {
  /** The derived next legal-verification date, or null when the anchor is absent / N-A. */
  date: Date | null;
  /** true → present as indicative (Ipem-operationalized or no national period), not a deadline. */
  indicative: boolean;
  /** true → the date is a regulatory MAXIMUM (verify/replace BY then), not a due-point. */
  isCeiling: boolean;
};

/**
 * REQ-MLR-020..026. Derive the next legal-verification date for the asset's regulated
 * period. Never fabricates a date: if the anchor required by the `kind` is absent, returns
 * `date = null`.
 */
export function deriveRegulatedNextDate(
  regulated: RegulatedInterval,
  anchors: RegulatedIntervalAnchors,
): RegulatedNextDate {
  // REQ-MLR-025: indicative where the Ipem runs the cadence, or there is no national period.
  const indicative =
    regulated.operationalizedByDelegate ||
    regulated.kind === "not_nationally_fixed";

  switch (regulated.kind) {
    // REQ-MLR-024: no national periodic interval (e.g. energia elétrica).
    case "not_nationally_fixed":
      return { date: null, indicative: true, isCeiling: false };

    case "fixed_months": {
      // REQ-MLR-021: calendar-year validity (balanças) — válido até o fim do ano seguinte.
      if (regulated.anchor === "calendar_year") {
        const anchorDate = anchors.lastVerificationDate;
        if (!anchorDate) return { date: null, indicative, isCeiling: false };
        const date = new Date(
          Date.UTC(anchorDate.getUTCFullYear() + 1, 11, 31),
        );
        return { date, indicative, isCeiling: false };
      }
      // REQ-MLR-020: anchor=last_verification → last + valueMonths.
      return {
        date: deriveNextCalibrationDate(
          anchors.lastVerificationDate,
          regulated.valueMonths,
        ),
        indicative,
        isCeiling: false,
      };
    }

    // REQ-MLR-022: ceiling from year of installation (hidrômetros).
    case "max_months_from_install":
      return {
        date: deriveNextCalibrationDate(
          anchors.installDate,
          regulated.valueMonths,
        ),
        indicative,
        isCeiling: true,
      };

    // REQ-MLR-023: per-technology (gás) — configured anchor + resolved valueMonths.
    case "per_technology":
      return {
        date: deriveNextCalibrationDate(
          regulated.anchor === "first_verification"
            ? anchors.firstVerificationDate
            : anchors.lastVerificationDate,
          regulated.valueMonths,
        ),
        indicative,
        isCeiling: false,
      };
  }
}
