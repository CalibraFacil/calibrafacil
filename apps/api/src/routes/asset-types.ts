import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import { assetType, asset } from "@calibra-facil/db/schema";
import {
  CreateAssetTypeSchema,
  UpdateAssetTypeSchema,
  ListAssetTypesQuerySchema,
} from "@calibra-facil/schemas";
import { eq, ilike, or, count } from "drizzle-orm";
import {
  withLabPermission,
  withPermission,
  type AuthVariables,
} from "../middleware/permission";

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
  })

  // =========================================================================
  // POST / - Create a new asset type (Lab admin only)
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ equipment: ["create"] }),
    zValidator("json", CreateAssetTypeSchema),
    async (c) => {
      const input = c.req.valid("json");

      try {
        // Check if slug is unique
        const [existingType] = await db
          .select()
          .from(assetType)
          .where(eq(assetType.slug, input.slug))
          .limit(1);

        if (existingType) {
          return c.json({ error: "Slug já está em uso" }, 400);
        }

        // Create asset type
        const [newType] = await db
          .insert(assetType)
          .values({
            name: input.name,
            slug: input.slug,
            description: input.description || null,
            definition: input.definition,
          })
          .returning();

        if (!newType) {
          return c.json({ error: "Erro ao criar tipo de ativo" }, 500);
        }

        return c.json(newType, 201);
      } catch (error) {
        console.error("Error creating asset type:", error);
        return c.json({ error: "Erro ao criar tipo de ativo" }, 500);
      }
    },
  )

  // =========================================================================
  // PUT /:id - Update an asset type
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ equipment: ["update"] }),
    zValidator("json", UpdateAssetTypeSchema),
    async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      try {
        // Check if asset type exists
        const [existingType] = await db
          .select()
          .from(assetType)
          .where(eq(assetType.id, id))
          .limit(1);

        if (!existingType) {
          return c.json({ error: "Tipo de ativo não encontrado" }, 404);
        }

        // Check if slug is being changed and if it's unique
        if (input.slug && input.slug !== existingType.slug) {
          const [duplicateSlug] = await db
            .select()
            .from(assetType)
            .where(eq(assetType.slug, input.slug))
            .limit(1);

          if (duplicateSlug) {
            return c.json({ error: "Slug já está em uso" }, 400);
          }
        }

        // Build update object
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (input.name !== undefined) updateData.name = input.name;
        if (input.slug !== undefined) updateData.slug = input.slug;
        if (input.description !== undefined)
          updateData.description = input.description || null;
        if (input.definition !== undefined)
          updateData.definition = input.definition;

        // Update asset type
        const [updatedType] = await db
          .update(assetType)
          .set(updateData)
          .where(eq(assetType.id, id))
          .returning();

        return c.json(updatedType);
      } catch (error) {
        console.error("Error updating asset type:", error);
        return c.json({ error: "Erro ao atualizar tipo de ativo" }, 500);
      }
    },
  )

  // =========================================================================
  // DELETE /:id - Delete an asset type (only if no assets are linked)
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ equipment: ["delete"] }),
    async (c) => {
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      try {
        // Check if asset type exists
        const [existingType] = await db
          .select()
          .from(assetType)
          .where(eq(assetType.id, id))
          .limit(1);

        if (!existingType) {
          return c.json({ error: "Tipo de ativo não encontrado" }, 404);
        }

        // Check if any assets are using this type
        const [linkedAssets] = await db
          .select({ count: count() })
          .from(asset)
          .where(eq(asset.assetTypeId, id));

        if (linkedAssets && linkedAssets.count > 0) {
          return c.json(
            {
              error: `Não é possível excluir: ${linkedAssets.count} ativo(s) estão usando este tipo`,
            },
            400,
          );
        }

        // Delete asset type
        await db.delete(assetType).where(eq(assetType.id, id));

        return c.json({ success: true });
      } catch (error) {
        console.error("Error deleting asset type:", error);
        return c.json({ error: "Erro ao excluir tipo de ativo" }, 500);
      }
    },
  );
