import { z } from "zod";

import { nullableNumber, nullableString, unitContextSchema } from "./common";

/**
 * Response contracts for the environmental-limits endpoints
 * (`/api/environmental-limits/*`). Wire schemas (see `jobs.ts` for the rules).
 * The desktop local-server answers `GET /effective/:assetTypeId` from the
 * offline mirror with the same shape, so `source` uses one vocabulary on both.
 */

/** One configured limit row (a unit default, or an asset-type override). */
export const environmentalLimitRowSchema = z.object({
  id: z.number(),
  unitId: z.number(),
  /** `null` = the unit default; otherwise the override for that asset type. */
  assetTypeId: nullableNumber,
  temperatureMin: nullableNumber,
  temperatureMax: nullableNumber,
  humidityMin: nullableNumber,
  humidityMax: nullableNumber,
  pressureMin: nullableNumber,
  pressureMax: nullableNumber,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EnvironmentalLimitRow = z.infer<typeof environmentalLimitRowSchema>;

/** A row as the settings list shows it, with the asset type's name joined in. */
export const environmentalLimitSchema = environmentalLimitRowSchema.extend({
  assetTypeName: nullableString,
});
export type EnvironmentalLimit = z.infer<typeof environmentalLimitSchema>;

/** GET /api/environmental-limits */
export const environmentalLimitsResponseSchema = z.object({
  limits: z.array(environmentalLimitSchema),
  unit: unitContextSchema,
});
export type EnvironmentalLimitsResponse = z.infer<
  typeof environmentalLimitsResponseSchema
>;

/** Which row won the lookup: the asset-type override or the unit default. */
export const effectiveLimitsSourceSchema = z.enum([
  "asset_type",
  "unit_default",
]);
export type EffectiveLimitsSource = z.infer<typeof effectiveLimitsSourceSchema>;

/**
 * GET /api/environmental-limits/effective/:assetTypeId. `limits` and `source`
 * are both `null` when nothing is configured.
 */
export const effectiveEnvironmentalLimitsResponseSchema = z.object({
  limits: environmentalLimitRowSchema.nullable(),
  source: effectiveLimitsSourceSchema.nullable(),
});
export type EffectiveEnvironmentalLimitsResponse = z.infer<
  typeof effectiveEnvironmentalLimitsResponseSchema
>;

/** PUT /api/environmental-limits (upsert; the row is `.returning()`, no join). */
export const saveEnvironmentalLimitResponseSchema = z.object({
  message: z.string(),
  data: environmentalLimitRowSchema,
  unit: unitContextSchema,
});
export type SaveEnvironmentalLimitResponse = z.infer<
  typeof saveEnvironmentalLimitResponseSchema
>;

/** DELETE /api/environmental-limits/:id */
export const deleteEnvironmentalLimitResponseSchema = z.object({
  message: z.string(),
});
export type DeleteEnvironmentalLimitResponse = z.infer<
  typeof deleteEnvironmentalLimitResponseSchema
>;
