import { createRouter } from "../../../server/router";
import { HTTPException } from "hono/http-exception";
import { environmentalLimits, assetType } from "@calibra-facil/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { environmentalLimitEndpoints } from "@calibra-facil/contracts";
import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  requireUnitOperationalSettingsManager,
  resolveAccessibleUnitContext,
  selectEffectiveEnvironmentalLimits,
} from "../../org";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

const PREFIX = "/api/environmental-limits";

export const environmentalLimitsRouter = createRouter<{
  Variables: AuthVariables;
}>();

const labMiddleware = [...requireLabProtected, requireOrgType("LAB")];

// ===========================================================================
// GET / - List environmental limits for the selected unit
// ===========================================================================
mount(
  environmentalLimitsRouter,
  PREFIX,
  environmentalLimitEndpoints.list,
  labMiddleware,
  async (c) => {
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

    return { limits, unit };
  },
);

// ===========================================================================
// GET /effective/:assetTypeId - Get effective limits for an asset type
// Resolves hierarchy: unit asset-type-specific > unit default
// ===========================================================================
mount(
  environmentalLimitsRouter,
  PREFIX,
  environmentalLimitEndpoints.effective,
  labMiddleware,
  async (c, { params, query }) => {
    const memberData = c.get("member");
    const { assetTypeId } = params;

    const unit = resolveAccessibleUnitContext(
      memberData,
      query.unitId ? Number.parseInt(query.unitId, 10) : null,
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

    const { limits, source } = selectEffectiveEnvironmentalLimits([
      ...specificLimits,
      ...candidateLimits,
    ]);

    return { limits, source, unit };
  },
);
// ===========================================================================
// PUT / - Upsert environmental limits
// ===========================================================================
mount(
  environmentalLimitsRouter,
  PREFIX,
  environmentalLimitEndpoints.save,
  labMiddleware,
  async (c, { body: input }) => {
    const memberData = c.get("member");
    requireUnitOperationalSettingsManager(memberData);
    const unit = resolveAccessibleUnitContext(memberData);

    const result = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const [saved] = await ctx.o
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
            updatedBy: ctx.actor.userId,
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
              updatedBy: ctx.actor.userId,
            },
          })
          .returning();
        return saved;
      },
    );

    if (!result) {
      throw new HTTPException(500, {
        message: "Falha ao salvar limites ambientais",
      });
    }

    return {
      message: "Limites ambientais atualizados",
      data: result,
      unit,
    };
  },
);

// ===========================================================================
// DELETE /:id - Delete environmental limits configuration
// ===========================================================================
mount(
  environmentalLimitsRouter,
  PREFIX,
  environmentalLimitEndpoints.delete,
  labMiddleware,
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;
    requireUnitOperationalSettingsManager(memberData);
    const unit = resolveAccessibleUnitContext(memberData);

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const [deleted] = await ctx.o
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
        throw notFound(
          "environmental_limits_not_found",
          "Configuração não encontrada",
        );
      }
    });

    return { message: "Limites removidos" };
  },
);
