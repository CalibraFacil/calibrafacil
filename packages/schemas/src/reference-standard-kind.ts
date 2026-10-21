import { z } from "zod";

/**
 * How a reference standard instrument is classified. Lives in its own module so
 * `reference-standard-kind-map.ts` can depend on it without importing the
 * package barrel (`index.ts` re-exports both, which made an import cycle).
 */
export const ReferenceStandardKindSchema = z.enum([
  "mass_single",
  "mass_set",
  "thermohygrometer",
  "thermometer",
  "hygrometer",
  "barometer",
  "manometer",
  "dimensional",
  "electrical",
  "time_frequency",
  "volume",
  "force_torque",
  "rpm",
  "generic_scalar",
  "generic_multi_channel",
]);

export type ReferenceStandardKind = z.infer<typeof ReferenceStandardKindSchema>;
