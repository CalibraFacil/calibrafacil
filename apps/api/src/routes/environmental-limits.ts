import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { environmentalLimits, assetType } from "@calibra-facil/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { EnvironmentalLimitsSchema } from "@calibra-facil/schemas";
import type {
  DeleteEnvironmentalLimitResponse,
  EffectiveEnvironmentalLimitsResponse,
  EnvironmentalLimitsResponse,
  SaveEnvironmentalLimitResponse,
  ServerShape,
} from "@calibra-facil/contracts";
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
import { orgDb } from "../lib/org-db";

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

    const limits = await orgDb(memberData.organizationId).transaction((o) =>
      o
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
        .orderBy(desc(environmentalLimits.assetTypeId)),
    );

    return c.json({
      limits,
      unit,
    } satisfies ServerShape<EnvironmentalLimitsResponse>);
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

      const { candidateLimits, specificLimits } = await orgDb(
        memberData.organizationId,
      ).transaction(async (o) => {
        const candidates = await o
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

        const specifics = await o
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

        return { candidateLimits: candidates, specificLimits: specifics };
      });

      const { limits: resolvedLimits, source } =
        selectEffectiveEnvironmentalLimits([
          ...specificLimits,
          ...candidateLimits,
        ]);

      // `unit` rides along for the cloud caller; the contract (shared with the
      // desktop local-server, which has no unit lookup) is `limits` + `source`.
      const body = { limits: resolvedLimits, source, unit };
      return c.json(
        body satisfies ServerShape<EffectiveEnvironmentalLimitsResponse>,
      );
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

      const [result] = await orgDb(memberData.organizationId).transaction((o) =>
        o
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
          .returning(),
      );

      if (!result) {
        throw new HTTPException(500, {
          message: "Falha ao salvar limites ambientais",
        });
      }

      return c.json({
        message: "Limites ambientais atualizados",
        data: result,
        unit,
      } satisfies ServerShape<SaveEnvironmentalLimitResponse>);
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

    const [deleted] = await orgDb(memberData.organizationId).transaction((o) =>
      o
        .delete(environmentalLimits)
        .where(
          and(
            eq(environmentalLimits.id, id),
            eq(environmentalLimits.organizationId, memberData.organizationId),
            eq(environmentalLimits.unitId, unit.unitId),
          ),
        )
        .returning(),
    );

    if (!deleted) {
      return c.json({ error: "Configuração não encontrada" }, 404);
    }

    return c.json({
      message: "Limites removidos",
    } satisfies ServerShape<DeleteEnvironmentalLimitResponse>);
  });
