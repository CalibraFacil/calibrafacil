/**
 * Legal-metrology regime write resolution (Track 2) — the pure invariant logic for a lab
 * asset create/update. Spec: `specs/legal-metrology-regime/spec.md` (REQ-MLR-003/030/031).
 *
 * Resolves the trio that must stay mutually consistent when the lab sets an instrument's
 * regime: the regime itself, the DEPRECATED `subjectToLegalMetrology` boolean (kept in
 * lock-step during the transition), and the structured `regulatedInterval` (which exists
 * ONLY for a LEGAL instrument). It deliberately does NOT touch the customer-owned
 * calibration interval (Track 1) — that is the customer's and independent of regime.
 *
 * Pure + deterministic so the regulated invariants are testable without a DB.
 */

import type { MetrologyRegime, RegulatedInterval } from "@calibra-facil/schemas";

export type AssetRegimeWriteInput = {
  /** Explicit regime from the client (preferred), or undefined to keep/derive. */
  metrologyRegime: MetrologyRegime | undefined;
  /** Legacy boolean from older clients; used only when no explicit regime is given. */
  subjectToLegalMetrology: boolean | undefined;
  /**
   * The validated regulated interval from the client: a value to set, `null` to clear, or
   * `undefined` to keep whatever the asset currently has.
   */
  regulatedInterval: RegulatedInterval | null | undefined;
  /** The asset's current persisted regime + regulated interval (defaults on create). */
  current: {
    metrologyRegime: MetrologyRegime;
    regulatedInterval: RegulatedInterval | null;
  };
};

export type AssetRegimeWriteResult = {
  metrologyRegime: MetrologyRegime;
  subjectToLegalMetrology: boolean;
  regulatedInterval: RegulatedInterval | null;
};

export function resolveAssetRegimeWrite(
  input: AssetRegimeWriteInput,
): AssetRegimeWriteResult {
  // Prefer the explicit regime; else map the legacy boolean; else keep the current regime.
  const metrologyRegime: MetrologyRegime =
    input.metrologyRegime ??
    (input.subjectToLegalMetrology !== undefined
      ? input.subjectToLegalMetrology
        ? "LEGAL"
        : "INDUSTRIAL"
      : input.current.metrologyRegime);

  // REQ-MLR-003: the deprecated boolean stays consistent with the regime.
  const subjectToLegalMetrology = metrologyRegime === "LEGAL";

  // REQ-MLR-030/031: the regulated interval exists ONLY for a LEGAL instrument and is
  // cleared for any other regime; for LEGAL, a provided value overrides, `null` clears,
  // and `undefined` keeps the current one.
  const regulatedInterval: RegulatedInterval | null =
    metrologyRegime !== "LEGAL"
      ? null
      : input.regulatedInterval !== undefined
        ? input.regulatedInterval
        : input.current.regulatedInterval;

  return { metrologyRegime, subjectToLegalMetrology, regulatedInterval };
}
