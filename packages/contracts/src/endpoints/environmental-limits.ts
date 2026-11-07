import { z } from "zod";

import { EnvironmentalLimitsSchema } from "@calibra-facil/schemas";

import { nullableNumber, nullableString, unitContextSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * The unit's environmental limits (`/api/environmental-limits/*`). Response
 * schemas are wire schemas written from what
 * `apps/api/src/routes/environmental-limits.ts` returns (see `jobs.ts` for the
 * rules). The desktop local-server answers `GET /effective/:assetTypeId` from
 * the offline mirror with the same shape, so `source` uses one vocabulary on
 * both.
 */

/** One configured limit row (a unit default, or an asset-type override). */
const environmentalLimitRowSchema = z.object({
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
const environmentalLimitSchema = environmentalLimitRowSchema.extend({
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
const effectiveLimitsSourceSchema = z.enum(["asset_type", "unit_default"]);

/**
 * GET /api/environmental-limits/effective/:assetTypeId. `limits` and `source`
 * are both `null` when nothing is configured.
 */
export const effectiveEnvironmentalLimitsResponseSchema = z.object({
  limits: environmentalLimitRowSchema.nullable(),
  source: effectiveLimitsSourceSchema.nullable(),
  /** The unit the lookup ran for; the cloud sends it, the desktop local server has no unit lookup. */
  unit: unitContextSchema.optional(),
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

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Limites ambientais";

export const environmentalLimitEndpoints = {
  // The desktop reads the limits of the active unit from its session snapshot
  // (`desktop-client.ts`), not from the local server.
  list: endpoint({
    method: "get",
    path: "/api/environmental-limits",
    response: environmentalLimitsResponseSchema,
    failure: "Falha ao carregar limites",
    policy: "local-first-read-through-sync",
  }),
  // The limits that apply to an asset type in the unit (its override, else the
  // unit default). The job execution page reads it; the SDK method answers "no
  // limits" for an HTTP error (`modules/environmental-limits.ts`). `unitId` is
  // kept a string: the handler parses it and falls back like it always did.
  effective: endpoint({
    method: "get",
    path: "/api/environmental-limits/effective/:assetTypeId",
    params: z.object({ assetTypeId: routeId }),
    query: z.object({ unitId: z.string().optional() }),
    response: effectiveEnvironmentalLimitsResponseSchema,
    failure: "Falha ao carregar limites efetivos",
    policy: "local-first-read-through-sync",
  }),
  save: endpoint({
    method: "put",
    path: "/api/environmental-limits",
    body: EnvironmentalLimitsSchema,
    response: saveEnvironmentalLimitResponseSchema,
    failure: "Falha ao salvar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  delete: endpoint({
    method: "delete",
    path: "/api/environmental-limits/:id",
    params: z.object({ id: routeId }),
    response: deleteEnvironmentalLimitResponseSchema,
    failure: "Falha ao remover",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
