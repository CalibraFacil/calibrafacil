import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  environmentalLimits,
  assetType,
} from "@calibra-facil/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { EnvironmentalLimitsSchema } from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";

export const environmentalLimitsRouter = new Hono<{
  Variables: AuthVariables;
}>()
  // ===========================================================================
  // GET / - List all environmental limits for the organization
  // ===========================================================================
  .get("/", ...withLabPermission({ organization: ["update"] }), async (c) => {
    const memberData = c.get("member");

    const limits = await db
      .select({
        id: environmentalLimits.id,
        assetTypeId: environmentalLimits.assetTypeId,
        assetTypeName: assetType.name,
        temperatureMin: environmentalLimits.temperatureMin,
        temperatureMax: environmentalLimits.temperatureMax,
        humidityMin: environmentalLimits.humidityMin,
        humidityMax: environmentalLimits.humidityMax,
        pressureMin: environmentalLimits.pressureMin,
        pressureMax: environmentalLimits.pressureMax,
        createdAt: environmentalLimits.createdAt,
        updatedAt: environmentalLimits.updatedAt,
      })
      .from(environmentalLimits)
      .leftJoin(assetType, eq(environmentalLimits.assetTypeId, assetType.id))
      .where(
        eq(environmentalLimits.organizationId, memberData.organizationId),
      )
      .orderBy(desc(environmentalLimits.assetTypeId));

    return c.json({ limits });
  })

  // ===========================================================================
  // GET /effective/:assetTypeId - Get effective limits for an asset type
  // Resolves hierarchy: asset-type-specific > org default
  // ===========================================================================
  .get(
    "/effective/:assetTypeId",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const assetTypeId = parseInt(c.req.param("assetTypeId"), 10);

      if (isNaN(assetTypeId)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      // Try asset-type-specific first
      const [specific] = await db
        .select()
        .from(environmentalLimits)
        .where(
          and(
            eq(
              environmentalLimits.organizationId,
              memberData.organizationId,
            ),
            eq(environmentalLimits.assetTypeId, assetTypeId),
          ),
        )
        .limit(1);

      if (specific) {
        return c.json({ limits: specific, source: "asset_type" });
      }

      // Fall back to org default
      const [orgDefault] = await db
        .select()
        .from(environmentalLimits)
        .where(
          and(
            eq(
              environmentalLimits.organizationId,
              memberData.organizationId,
            ),
            isNull(environmentalLimits.assetTypeId),
          ),
        )
        .limit(1);

      if (orgDefault) {
        return c.json({ limits: orgDefault, source: "organization" });
      }

      return c.json({ limits: null, source: null });
    },
  )

  // ===========================================================================
  // PUT / - Upsert environmental limits
  // ===========================================================================
  .put(
    "/",
    ...withLabPermission({ organization: ["update"] }),
    zValidator("json", EnvironmentalLimitsSchema),
    async (c) => {
      const input = c.req.valid("json");
      const memberData = c.get("member");
      const session = c.get("session");

      // Upsert using the unique constraint on (organization_id, asset_type_id)
      const [result] = await db
        .insert(environmentalLimits)
        .values({
          organizationId: memberData.organizationId,
          assetTypeId: input.assetTypeId,
          temperatureMin: input.temperatureMin,
          temperatureMax: input.temperatureMax,
          humidityMin: input.humidityMin,
          humidityMax: input.humidityMax,
          pressureMin: input.pressureMin,
          pressureMax: input.pressureMax,
          updatedBy: session.user.id,
        })
        .onConflictDoUpdate({
          target: [
            environmentalLimits.organizationId,
            environmentalLimits.assetTypeId,
          ],
          set: {
            temperatureMin: input.temperatureMin,
            temperatureMax: input.temperatureMax,
            humidityMin: input.humidityMin,
            humidityMax: input.humidityMax,
            pressureMin: input.pressureMin,
            pressureMax: input.pressureMax,
            updatedBy: session.user.id,
          },
        })
        .returning();

      return c.json({
        message: "Limites ambientais atualizados",
        data: result,
      });
    },
  )

  // ===========================================================================
  // DELETE /:id - Delete environmental limits configuration
  // ===========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ organization: ["update"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [deleted] = await db
        .delete(environmentalLimits)
        .where(
          and(
            eq(environmentalLimits.id, id),
            eq(
              environmentalLimits.organizationId,
              memberData.organizationId,
            ),
          ),
        )
        .returning();

      if (!deleted) {
        return c.json({ error: "Configuração não encontrada" }, 404);
      }

      return c.json({ message: "Limites removidos" });
    },
  );
