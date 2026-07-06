import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import { assetType, asset } from "@calibra-facil/db/schema";
import {
  CreateAssetTypeSchema,
  UpdateAssetTypeSchema,
} from "@calibra-facil/schemas";
import { eq, count } from "drizzle-orm";
import {
  requirePlatformAdmin,
  type AuthVariables,
} from "../middleware/permission";
import { logPlatformEvent } from "./backoffice-platform-log";

/**
 * Platform-curated writes to the GLOBAL asset-type catalog (#637).
 *
 * `asset_type` is shared by every tenant (no organization_id, globally unique
 * slug), so mutations are a PLATFORM operation: they moved here from the lab
 * router, where any tenant admin could rename, corrupt the field-definition
 * blueprint, or delete a type in use by other tenants. Labs keep read-only
 * access via `asset-types.ts`. Every mutation lands in the platform event log.
 */
export const backofficeAssetTypesRouter = new Hono<{
  Variables: AuthVariables;
}>()
  // ===========================================================================
  // GET / - Full catalog for the ops console
  // ===========================================================================
  .get("/", requirePlatformAdmin, async (c) => {
    const types = await db.select().from(assetType).orderBy(assetType.name);
    return c.json({ data: types });
  })

  // ===========================================================================
  // POST / - Create a new global asset type
  // ===========================================================================
  .post(
    "/",
    requirePlatformAdmin,
    zValidator("json", CreateAssetTypeSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("json");

      const [existingType] = await db
        .select({ id: assetType.id })
        .from(assetType)
        .where(eq(assetType.slug, input.slug))
        .limit(1);
      if (existingType) {
        return c.json({ error: "Slug já está em uso" }, 400);
      }

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

      await logPlatformEvent({
        actorUserId: session?.user?.id,
        action: "asset_type.create",
        entityType: "asset_type",
        entityId: String(newType.id),
        details: { name: newType.name, slug: newType.slug },
      });

      return c.json(newType, 201);
    },
  )

  // ===========================================================================
  // PUT /:id - Update a global asset type
  // ===========================================================================
  .put(
    "/:id",
    requirePlatformAdmin,
    zValidator("json", UpdateAssetTypeSchema),
    async (c) => {
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existingType] = await db
        .select()
        .from(assetType)
        .where(eq(assetType.id, id))
        .limit(1);
      if (!existingType) {
        return c.json({ error: "Tipo de ativo não encontrado" }, 404);
      }

      if (input.slug && input.slug !== existingType.slug) {
        const [duplicateSlug] = await db
          .select({ id: assetType.id })
          .from(assetType)
          .where(eq(assetType.slug, input.slug))
          .limit(1);
        if (duplicateSlug) {
          return c.json({ error: "Slug já está em uso" }, 400);
        }
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.slug !== undefined) updateData.slug = input.slug;
      if (input.description !== undefined)
        updateData.description = input.description || null;
      if (input.definition !== undefined)
        updateData.definition = input.definition;

      const [updatedType] = await db
        .update(assetType)
        .set(updateData)
        .where(eq(assetType.id, id))
        .returning();

      await logPlatformEvent({
        actorUserId: session?.user?.id,
        action: "asset_type.update",
        entityType: "asset_type",
        entityId: String(id),
        details: { changed: Object.keys(input) },
      });

      return c.json(updatedType);
    },
  )

  // ===========================================================================
  // DELETE /:id - Delete a global asset type (only if NO tenant's assets use it)
  // ===========================================================================
  .delete("/:id", requirePlatformAdmin, async (c) => {
    const session = c.get("session");
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json({ error: "ID inválido" }, 400);
    }

    const [existingType] = await db
      .select()
      .from(assetType)
      .where(eq(assetType.id, id))
      .limit(1);
    if (!existingType) {
      return c.json({ error: "Tipo de ativo não encontrado" }, 404);
    }

    // The cross-tenant in-use guard: the catalog is global, so ANY org's asset
    // referencing the type blocks deletion.
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

    await db.delete(assetType).where(eq(assetType.id, id));

    await logPlatformEvent({
      actorUserId: session?.user?.id,
      action: "asset_type.delete",
      entityType: "asset_type",
      entityId: String(id),
      details: { name: existingType.name, slug: existingType.slug },
    });

    return c.json({ success: true });
  });
