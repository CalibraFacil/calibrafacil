import type { QuantityKind } from "@calibra-facil/shared/units";

import type { ReferenceStandardKind } from "./index";

/**
 * Reconciles the two parallel metrology vocabularies that exist in the codebase:
 *
 *  - `ReferenceStandardKind` (this package) — how a *reference standard*
 *    instrument is classified (e.g. `force_torque`, `electrical`, `rpm`).
 *  - `QuantityKind` (`@calibra-facil/shared/units`) — the dimensional kind a
 *    *unit* belongs to (e.g. `force`, `torque`, `voltage`).
 *
 * The two were never mapped, and a reference-standard kind can span several
 * dimensions (a thermohygrometer carries both temperature and humidity;
 * `electrical` carries the three independent electrical dimensions). This map
 * is the single, non-destructive bridge — it leaves the stored `kind` text and
 * the duplicated enum untouched.
 *
 * The `satisfies Record<ReferenceStandardKind, …>` guard makes this total: add a
 * new reference-standard kind to {@link ReferenceStandardKindSchema} and this
 * map fails to compile until it is mapped.
 */
export const REFERENCE_STANDARD_QUANTITY_KINDS = {
  mass_single: ["mass"],
  mass_set: ["mass"],
  thermohygrometer: ["temperature", "humidity"],
  thermometer: ["temperature"],
  hygrometer: ["humidity"],
  barometer: ["pressure"],
  manometer: ["pressure"],
  dimensional: ["length"],
  // Volt, ampere and ohm are independent dimensions — never inter-convertible.
  electrical: ["voltage", "current", "resistance"],
  time_frequency: ["time", "frequency"],
  volume: ["volume"],
  force_torque: ["force", "torque"],
  // Rotation is modelled as frequency (1 rpm = 1/60 Hz).
  rpm: ["frequency"],
  // Generic kinds carry no fixed dimension.
  generic_scalar: [],
  generic_multi_channel: [],
} as const satisfies Record<ReferenceStandardKind, readonly QuantityKind[]>;

/**
 * The dimensional {@link QuantityKind}s a reference standard of this kind can
 * carry. Empty for the generic kinds (dimension is configured per channel).
 */
export function quantityKindForReferenceStandardKind(
  kind: ReferenceStandardKind,
): readonly QuantityKind[] {
  return REFERENCE_STANDARD_QUANTITY_KINDS[kind];
}
