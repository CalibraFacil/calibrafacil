import { z } from "zod";
import { ListAssetTypesQuerySchema } from "@calibra-facil/schemas";

import { jsonRecordSchema, nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The platform-wide asset-type catalog, read-only for laboratories. The desktop
 * local-server answers `list` from its offline mirror with the same response
 * schema (`apps/local-server/src/contract.test.ts`).
 *
 * Not client-facing, so not defined here: `GET /api/asset-types/:id`.
 */

const assetTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: nullableString,
  /** The field definitions of the specification form (opaque list of records). */
  definition: z.array(jsonRecordSchema).nullable(),
});
export type AssetTypeListItem = z.infer<typeof assetTypeSchema>;

/** GET /api/asset-types */
export const assetTypesResponseSchema = z.object({
  data: z.array(assetTypeSchema),
});
export type AssetTypesResponse = z.infer<typeof assetTypesResponseSchema>;

export const assetTypeEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/asset-types",
    query: ListAssetTypesQuerySchema,
    response: assetTypesResponseSchema,
    failure: "Falha ao carregar tipos de instrumento",
    policy: "local-first-read-through-sync",
  }),
} as const satisfies EndpointGroup;
