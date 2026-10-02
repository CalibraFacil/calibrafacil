import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import { assetType } from "@calibra-facil/db/schema";
import { ListAssetTypesQuerySchema } from "@calibra-facil/schemas";
import { eq, ilike, or } from "drizzle-orm";
import { withPermission, type AuthVariables } from "../middleware/permission";

/**
 * READ-ONLY lab-facing view of the GLOBAL asset-type catalog (#637).
 *
 * `asset_type` has no organization_id — it is a platform-wide shared catalog,
 * so tenant RBAC must never gate writes to it (any lab admin could corrupt or
 * delete types used by every other tenant). Per Pedro's decision (2026-07-05)
 * the catalog is curated centrally: it is seeded by
 * `packages/db/src/seed-asset-types.ts` and is read-only through the API.
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

      try {
        // Build conditions
        let whereCondition;
        if (query) {
          whereCondition = or(
            ilike(assetType.name, `%${query}%`),
            ilike(assetType.slug, `%${query}%`),
            ilike(assetType.description, `%${query}%`),
          );
        }

        const types = await db
          .select({
            id: assetType.id,
            name: assetType.name,
            slug: assetType.slug,
            description: assetType.description,
            definition: assetType.definition,
            createdAt: assetType.createdAt,
            updatedAt: assetType.updatedAt,
          })
          .from(assetType)
          .where(whereCondition)
          .orderBy(assetType.name);

        return c.json({ data: types });
      } catch (error) {
        console.error("Error listing asset types:", error);
        return c.json({ error: "Erro ao listar tipos de ativo" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id - Get a single asset type by ID
  // =========================================================================
  .get("/:id", ...withPermission({ equipment: ["read"] }), async (c) => {
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID inválido" }, 400);
    }

    try {
      const [foundType] = await db
        .select()
        .from(assetType)
        .where(eq(assetType.id, id))
        .limit(1);

      if (!foundType) {
        return c.json({ error: "Tipo de ativo não encontrado" }, 404);
      }

      return c.json(foundType);
    } catch (error) {
      console.error("Error getting asset type:", error);
      return c.json({ error: "Erro ao buscar tipo de ativo" }, 500);
    }
  });
