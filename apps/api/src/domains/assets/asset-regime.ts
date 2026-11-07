/**
 * Legal-metrology regime write resolution (Track 2) — the pure invariant logic for a lab
 * asset create/update. Spec: `specs/legal-metrology-regime/spec.md` (REQ-MLR-003/030/031).
 *
 * Resolves the pair that must stay mutually consistent when the lab sets an instrument's
 * regime: the regime itself and the structured `regulatedInterval` (which exists ONLY for a
 * LEGAL instrument). It deliberately does NOT touch the customer-owned calibration interval
 * (Track 1) — that is the customer's and independent of regime.
 *
 * Pure + deterministic so the regulated invariants are testable without a DB.
 */

import type {
  MetrologyRegime,
  RegulatedInterval,
} from "@calibra-facil/schemas";

export type AssetRegimeWriteInput = {
  /** Explicit regime from the client (preferred), or undefined to keep the current one. */
  metrologyRegime: MetrologyRegime | undefined;
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
  regulatedInterval: RegulatedInterval | null;
};

export function resolveAssetRegimeWrite(
  input: AssetRegimeWriteInput,
): AssetRegimeWriteResult {
  // Prefer the explicit regime; else keep the current regime.
  const metrologyRegime: MetrologyRegime =
    input.metrologyRegime ?? input.current.metrologyRegime;

  // REQ-MLR-030/031: the regulated interval exists ONLY for a LEGAL instrument and is
  // cleared for any other regime; for LEGAL, a provided value overrides, `null` clears,
  // and `undefined` keeps the current one.
  const regulatedInterval: RegulatedInterval | null =
    metrologyRegime !== "LEGAL"
      ? null
      : input.regulatedInterval !== undefined
        ? input.regulatedInterval
        : input.current.regulatedInterval;

  return { metrologyRegime, regulatedInterval };
}
