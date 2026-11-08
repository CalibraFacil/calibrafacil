import { createRouter } from "../../../../server/router";
import { orgDb } from "../../../../lib/org-db";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asset, assetType } from "@calibra-facil/db/schema";
import { UpdateAssetSchema } from "@calibra-facil/schemas";
import { and, eq, isNull } from "drizzle-orm";
import {
  buildPublicApiError,
  getResourceExternalId,
  upsertResourceExternalId,
} from "../../public-api";
import { stagePublicApiWebhookEvent } from "../../public-api-webhooks";
import { isUniqueViolation } from "../../../../lib/db-errors";
import { invalid, notFound } from "../../../../lib/domain-errors";
import { withOrg } from "../../../../lib/org-context";
import { requireApiScope } from "../../../../middleware/api-key-auth";
import {
  deriveNextCalibrationDate,
  assertAssetTagFree,
  deleteLabAsset,
  planAssetRegimeUpdate,
  normalizeAssetSpecificationsFromInput,
} from "../../../assets";
import { type PublicApiV2Env } from "./env";
import { apiKeyActor } from "./actor";
import { answeringRefusals } from "./refusals";
import { resolveExternalResourceId } from "./resolvers";
import { withIdempotentMutation } from "./idempotency";

export const assetUpdateRoutes = createRouter<PublicApiV2Env>()
  .put(
    "/assets/:id",
    requireApiScope("assets:write"),
    zValidator(
      "json",
      UpdateAssetSchema.extend({ externalId: z.string().trim().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await orgDb(apiKey.organizationId).transaction((o) =>
        resolveExternalResourceId(
          {
            organizationId: apiKey.organizationId,
            resourceType: "asset",
            value: c.req.param("id"),
          },
          o,
        ),
      );

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "asset_not_found",
            message: "Ativo não encontrado",
          }),
          404,
        );
      }

      const externalId = input.externalId?.trim();
      return answeringRefusals(c, async () => {
        let written;
        try {
          // Look-up, tag check, the update, its audit entry and the caller's
          // external id commit together; a tag collision rolls all of them back.
          written = await withOrg(
            apiKey.organizationId,
            apiKeyActor(apiKey, c),
            async (ctx) => {
              const [existing] = await ctx.o
                .select({
                  id: asset.id,
                  deletedAt: asset.deletedAt,
                  customerId: asset.customerId,
                  assetTypeId: asset.assetTypeId,
                  baseMeasurementUnit: asset.baseMeasurementUnit,
                  name: asset.name,
                  manufacturer: asset.manufacturer,
                  model: asset.model,
                  serialNumber: asset.serialNumber,
                  tag: asset.tag,
                  status: asset.status,
                  lastCalibrationDate: asset.lastCalibrationDate,
                  nextCalibrationDate: asset.nextCalibrationDate,
                  calibrationIntervalMonths: asset.calibrationIntervalMonths,
                  installedAt: asset.installedAt,
                  metrologyRegime: asset.metrologyRegime,
                  regulatedInterval: asset.regulatedInterval,
                  comments: asset.comments,
                  specifications: asset.specifications,
                  assetTypeDefinition: assetType.definition,
                })
                .from(asset)
                .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
                .where(
                  and(
                    eq(asset.id, resolvedId),
                    eq(asset.labOrganizationId, apiKey.organizationId),
                    isNull(asset.deletedAt),
                  ),
                )
                .limit(1);
              if (!existing) {
                throw notFound("asset_not_found", "Ativo não encontrado");
              }

              if (input.tag && input.tag !== existing.tag) {
                await assertAssetTagFree(
                  ctx.o,
                  apiKey.organizationId,
                  input.tag,
                );
              }

              const normalizedSpecifications =
                input.specifications !== undefined
                  ? normalizeAssetSpecificationsFromInput({
                      specifications: input.specifications ?? null,
                      definition: existing.assetTypeDefinition,
                      baseMeasurementUnit: existing.baseMeasurementUnit,
                    })
                  : null;

              // The lab does NOT set the next-calibration date / interval —
              // periodicity is the customer's decision (portal, §7.8.4.3 +
              // ILAC-G24); the field is not in the schema, so an
              // integration-sent value is stripped. When the integration moves
              // `lastCalibrationDate`, the next-cal date is re-derived from the
              // customer-owned interval — null when no interval is set
              // (REQ-INTERVAL-003), mirroring the dashboard asset-update route.
              const lastCalibrationDate =
                input.lastCalibrationDate === undefined
                  ? undefined
                  : input.lastCalibrationDate
                    ? new Date(input.lastCalibrationDate)
                    : null;
              const nextCalibrationDate =
                lastCalibrationDate === undefined
                  ? existing.nextCalibrationDate
                  : existing.calibrationIntervalMonths === null
                    ? null
                    : deriveNextCalibrationDate(
                        lastCalibrationDate,
                        existing.calibrationIntervalMonths,
                      );
              const installedAt =
                input.installedAt === undefined
                  ? undefined
                  : input.installedAt
                    ? new Date(input.installedAt)
                    : null;
              // Install anchor + legal-metrology regime: the lab's rule.
              const regimeUpdate = planAssetRegimeUpdate(existing, {
                metrologyRegime: input.metrologyRegime,
                regulatedInterval: input.regulatedInterval,
                lastCalibrationDate,
                installedAt,
              });

              const [row] = await ctx.o
                .update(asset)
                .set({
                  name: input.name ?? existing.name,
                  manufacturer: input.manufacturer ?? existing.manufacturer,
                  model: input.model ?? existing.model,
                  serialNumber: input.serialNumber ?? existing.serialNumber,
                  tag: input.tag ?? existing.tag,
                  status: input.status ?? existing.status,
                  lastCalibrationDate:
                    lastCalibrationDate === undefined
                      ? existing.lastCalibrationDate
                      : lastCalibrationDate,
                  nextCalibrationDate,
                  ...(installedAt !== undefined ? { installedAt } : {}),
                  comments: input.comments ?? existing.comments,
                  specifications:
                    normalizedSpecifications?.specifications ??
                    existing.specifications,
                  ...regimeUpdate,
                })
                .where(eq(asset.id, existing.id))
                .returning();

              await ctx.audit("asset", existing.id, {
                action: "update",
                changes: {
                  asset: { old: existing, new: row },
                  unitConversions: normalizedSpecifications?.conversions.length
                    ? normalizedSpecifications.conversions
                    : undefined,
                },
              });

              if (externalId) {
                await upsertResourceExternalId(
                  {
                    organizationId: apiKey.organizationId,
                    apiKeyId: apiKey.id,
                    resourceType: "asset",
                    resourceId: existing.id,
                    externalId,
                  },
                  ctx.o,
                );
              }

              const resolvedExternalId =
                externalId ??
                (await getResourceExternalId(
                  {
                    organizationId: apiKey.organizationId,
                    resourceType: "asset",
                    resourceId: existing.id,
                  },
                  ctx.o,
                ));
              // The event is queued with the update and goes out after it commits.
              await stagePublicApiWebhookEvent(ctx, {
                organizationId: apiKey.organizationId,
                eventType: "asset.updated",
                payload: { ...row, externalId: resolvedExternalId },
              });

              return { updated: row, externalId: resolvedExternalId };
            },
          );
        } catch (error) {
          // The org-scoped check ran first; this backstops a SAME-org
          // race that hits the per-org unique (asset_lab_org_tag_uidx → 23505).
          // Answer the SAME 409 asset_tag_conflict the app
          // check returns (never 500).
          if (isUniqueViolation(error)) {
            throw invalid("asset_tag_conflict", "Tag já está em uso");
          }
          throw error;
        }

        return c.json({
          data: {
            ...written.updated,
            externalId: written.externalId,
          },
        });
      });
    },
  )
  .delete("/assets/:id", requireApiScope("assets:write"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await orgDb(apiKey.organizationId).transaction((o) =>
      resolveExternalResourceId(
        {
          organizationId: apiKey.organizationId,
          resourceType: "asset",
          value: c.req.param("id"),
        },
        o,
      ),
    );

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "asset_not_found",
          message: "Ativo não encontrado",
        }),
        404,
      );
    }

    return withIdempotentMutation(c, { assetId: resolvedId }, async (ctx) => {
      // Look-up, soft delete and audit entry are one transaction (and the
      // idempotency record commits with them).
      const [existing] = await ctx.o
        .select()
        .from(asset)
        .where(
          and(
            eq(asset.id, resolvedId),
            eq(asset.labOrganizationId, apiKey.organizationId),
            isNull(asset.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return {
          status: 404,
          body: buildPublicApiError({
            code: "asset_not_found",
            message: "Ativo não encontrado",
          }),
        };
      }

      await deleteLabAsset(ctx, existing);

      const externalId = await getResourceExternalId(
        {
          organizationId: apiKey.organizationId,
          resourceType: "asset",
          resourceId: existing.id,
        },
        ctx.o,
      );

      await stagePublicApiWebhookEvent(ctx, {
        organizationId: apiKey.organizationId,
        eventType: "asset.deleted",
        payload: { id: existing.id, externalId },
      });

      return {
        status: 200,
        body: { data: { id: existing.id, deleted: true } },
        resourceType: "asset" as const,
        resourceId: existing.id,
      };
    });
  });
