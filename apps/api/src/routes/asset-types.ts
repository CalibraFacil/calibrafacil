import { Hono } from "hono";
import type { AssetTypesResponse, ServerShape } from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import { ListAssetTypesQuerySchema } from "@calibra-facil/schemas";
import { withPermission, type AuthVariables } from "../middleware/permission";
import { findAssetTypeById, listAssetTypes } from "../lib/asset-types";
import { invalid, notFound } from "../lib/domain-errors";

/**
 * READ-ONLY lab-facing view of the GLOBAL asset-type catalog (#637).
 *
 * `asset_type` has no organization_id — it is a platform-wide shared catalog,
 * so tenant RBAC must never gate writes to it (any lab admin could corrupt or
 * delete types used by every other tenant). Per Pedro's decision (2026-07-05)
 * the catalog is curated centrally: it is seeded by
 * `packages/db/src/seed-asset-types.ts` and is read-only through the API.
 *
 * The reads live in `lib/asset-types.ts`: the catalog has no tenant column and
 * no row-level-security policy, so there is no laboratory to bind them to.
 */
export const assetTypesRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List all asset types (for dropdown/selection)
  // =========================================================================
  .get(
    "/",
    ...withPermission({ equipment: ["read"] }),
    zValidator("query", ListAssetTypesQuerySchema),
    async (c) => {
      const { query } = c.req.valid("query");

      const types = await listAssetTypes(query);

      return c.json({
        data: types,
      } satisfies ServerShape<AssetTypesResponse>);
    },
  )

  // =========================================================================
  // GET /:id - Get a single asset type by ID
  // =========================================================================
  .get("/:id", ...withPermission({ equipment: ["read"] }), async (c) => {
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      throw invalid("invalid_request", "ID inválido");
    }

    const foundType = await findAssetTypeById(id);

    if (!foundType) {
      throw notFound("asset_type_not_found", "Tipo de ativo não encontrado");
    }

    return c.json(foundType);
  });
