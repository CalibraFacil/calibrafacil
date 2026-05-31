import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import { environmentalLimits, assetType } from "@calibra-facil/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { EnvironmentalLimitsSchema } from "@calibra-facil/schemas";
import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../middleware/permission";
import {
  requireUnitOperationalSettingsManager,
  resolveAccessibleUnitContext,
  selectEffectiveEnvironmentalLimits,
} from "../lib/unit-operational-settings";

export const environmentalLimitsRouter = new Hono<{
  Variables: AuthVariables;
}>()
  // ===========================================================================
  // GET / - List environmental limits for the selected unit
  // ===========================================================================
  .get("/", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const memberData = c.get("member");
    requireUnitOperationalSettingsManager(memberData);
    const unit = resolveAccessibleUnitContext(memberData);

    const limits = await db
      .select({
        id: environmentalLimits.id,
        unitId: environmentalLimits.unitId,
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
        and(
          eq(environmentalLimits.organizationId, memberData.organizationId),
          eq(environmentalLimits.unitId, unit.unitId),
        ),
      )
      .orderBy(desc(environmentalLimits.assetTypeId));

    return c.json({
      limits,
      unit,
    });
  })

  // ===========================================================================
  // GET /effective/:assetTypeId - Get effective limits for an asset type
  // Resolves hierarchy: unit asset-type-specific > unit default
  // ===========================================================================
  .get(
    "/effective/:assetTypeId",
    ...requireLabProtected,
    requireOrgType("LAB"),
    async (c) => {
      const memberData = c.get("member");
      const assetTypeId = parseInt(c.req.param("assetTypeId"), 10);
      const queryUnitId = c.req.query("unitId");

      if (isNaN(assetTypeId)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const unit = resolveAccessibleUnitContext(
        memberData,
        queryUnitId ? Number.parseInt(queryUnitId, 10) : null,
      );

      const candidateLimits = await db
        .select()
        .from(environmentalLimits)
        .where(
          and(
            eq(environmentalLimits.organizationId, memberData.organizationId),
            eq(environmentalLimits.unitId, unit.unitId),
            isNull(environmentalLimits.assetTypeId),
          ),
        )
        .limit(1);

      const specificLimits = await db
        .select()
        .from(environmentalLimits)
        .where(
          and(
            eq(environmentalLimits.organizationId, memberData.organizationId),
            eq(environmentalLimits.unitId, unit.unitId),
            eq(environmentalLimits.assetTypeId, assetTypeId),
          ),
        )
        .limit(1);

      const { limits: resolvedLimits, source } =
        selectEffectiveEnvironmentalLimits([
          ...specificLimits,
          ...candidateLimits,
        ]);

      return c.json({
        limits: resolvedLimits,
        source,
        unit,
      });
    },
  )

  // ===========================================================================
  // PUT / - Upsert environmental limits
  // ===========================================================================
  .put(
    "/",
    ...requireLabProtected,
    requireOrgType("LAB"),
    zValidator("json", EnvironmentalLimitsSchema),
    async (c) => {
      const input = c.req.valid("json");
      const memberData = c.get("member");
      const session = c.get("session");
      requireUnitOperationalSettingsManager(memberData);
      const unit = resolveAccessibleUnitContext(memberData);

      const [result] = await db
        .insert(environmentalLimits)
        .values({
          organizationId: memberData.organizationId,
          unitId: unit.unitId,
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
            environmentalLimits.unitId,
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
        unit,
      });
    },
  )

  // ===========================================================================
  // DELETE /:id - Delete environmental limits configuration
  // ===========================================================================
  .delete("/:id", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const memberData = c.get("member");
    const id = parseInt(c.req.param("id"), 10);
    requireUnitOperationalSettingsManager(memberData);
    const unit = resolveAccessibleUnitContext(memberData);

    if (isNaN(id)) {
      return c.json({ error: "ID inválido" }, 400);
    }

    const [deleted] = await db
      .delete(environmentalLimits)
      .where(
        and(
          eq(environmentalLimits.id, id),
          eq(environmentalLimits.organizationId, memberData.organizationId),
          eq(environmentalLimits.unitId, unit.unitId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json({ error: "Configuração não encontrada" }, 404);
    }

    return c.json({ message: "Limites removidos" });
  });
