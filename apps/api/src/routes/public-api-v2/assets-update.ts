import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  asset,
  assetAuditLog,
  assetType,
  customer,
} from "@calibra-facil/db/schema";
import {
  RegulatedIntervalSchema,
  UpdateAssetSchema,
} from "@calibra-facil/schemas";
import { and, eq, isNull } from "drizzle-orm";
import {
  buildPublicApiError,
  emitPublicApiWebhookEvent,
  getPublicApiRequestIp,
  getResourceExternalId,
  upsertResourceExternalId,
} from "../../lib/public-api";
import { isUniqueViolation } from "../../lib/db-errors";
import { orgDb } from "../../lib/org-db";
import { requireApiScope } from "../../middleware/api-key-auth";
import { deriveNextCalibrationDate } from "../../lib/portal-asset-interval";
import { resolveAssetRegimeWrite } from "../../lib/asset-regime";
import { deriveRegulatedNextDate } from "../../lib/regulated-interval";
import { normalizeAssetSpecificationsFromInput } from "../../lib/asset-measurement";
import { type PublicApiV2Env } from "./env";
import { resolveExternalResourceId } from "./resolvers";
import { withIdempotentMutation } from "./idempotency";

export const assetUpdateRoutes = new Hono<PublicApiV2Env>()
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
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "asset",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "asset_not_found",
            message: "Ativo não encontrado",
          }),
          404,
        );
      }

      const { existing, tagConflict } = await orgDb(
        apiKey.organizationId,
      ).transaction(async (o) => {
        const [row] = await o
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
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
          .where(
            and(
              eq(asset.id, resolvedId),
              eq(customer.labOrganizationId, apiKey.organizationId),
              isNull(asset.deletedAt),
            ),
          )
          .limit(1);

        if (!row || !input.tag || input.tag === row.tag) {
          return { existing: row, tagConflict: undefined };
        }

        // SEC-03a: scope the tag-collision check to the caller's org (join
        // asset → customer) so it cannot read another tenant's assets. The
        // residual GLOBAL DB unique is caught at the update below.
        const [conflict] = await o
          .select({ id: asset.id })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .where(
            and(
              eq(asset.tag, input.tag),
              eq(customer.labOrganizationId, apiKey.organizationId),
              isNull(asset.deletedAt),
            ),
          )
          .limit(1);
        return { existing: row, tagConflict: conflict };
      });

      if (!existing) {
        return c.json(
          buildPublicApiError({
            code: "asset_not_found",
            message: "Ativo não encontrado",
          }),
          404,
        );
      }

      if (tagConflict) {
        return c.json(
          buildPublicApiError({
            code: "asset_tag_conflict",
            message: "Tag já está em uso",
          }),
          409,
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

      // The lab does NOT set the next-calibration date / interval — periodicity is
      // the customer's decision (portal, §7.8.4.3 + ILAC-G24); the field is not in
      // the schema, so an integration-sent value is stripped. When the integration
      // moves `lastCalibrationDate`, the next-cal date is re-derived from the
      // customer-owned interval — null when no interval is set (REQ-INTERVAL-003),
      // mirroring the dashboard asset-update route.
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
      // Track-2 install anchor + legal-metrology regime — mirrors the dashboard
      // asset-update route: recompute next_legal_verification_date when the
      // integration touches the regime, the regulated interval, the install
      // anchor, or the last-calibration date (the last-verification proxy).
      const installedAt =
        input.installedAt === undefined
          ? undefined
          : input.installedAt
            ? new Date(input.installedAt)
            : null;
      const regimeTouched =
        input.metrologyRegime !== undefined ||
        input.regulatedInterval !== undefined ||
        installedAt !== undefined ||
        lastCalibrationDate !== undefined;
      const regimeUpdate = (() => {
        if (!regimeTouched) return null;
        const parsedCurrent = RegulatedIntervalSchema.safeParse(
          existing.regulatedInterval,
        );
        const regimeWrite = resolveAssetRegimeWrite({
          metrologyRegime: input.metrologyRegime,
          regulatedInterval: input.regulatedInterval,
          current: {
            metrologyRegime: existing.metrologyRegime,
            regulatedInterval: parsedCurrent.success
              ? parsedCurrent.data
              : null,
          },
        });
        const anchorDate =
          (lastCalibrationDate !== undefined
            ? lastCalibrationDate
            : existing.lastCalibrationDate) ?? null;
        const installAnchor =
          (installedAt !== undefined ? installedAt : existing.installedAt) ??
          null;
        return {
          metrologyRegime: regimeWrite.metrologyRegime,
          regulatedInterval: regimeWrite.regulatedInterval,
          nextLegalVerificationDate: regimeWrite.regulatedInterval
            ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
                lastVerificationDate: anchorDate,
                firstVerificationDate: anchorDate,
                installDate: installAnchor,
              }).date
            : null,
        };
      })();

      // SEC-03b: the org-scoped check above ran first; this catch backstops a
      // SAME-org race that hits the per-org unique (asset_lab_org_tag_uidx →
      // 23505). A cross-org duplicate no longer raises (different
      // lab_organization_id). Return the SAME 409 asset_tag_conflict the app
      // check returns (never 500).
      const externalId = input.externalId?.trim();
      let written:
        | {
            updated: typeof asset.$inferSelect | undefined;
            externalId: string | null;
          }
        | undefined;
      try {
        // The update, its audit entry and the caller's external id commit
        // together; a tag collision rolls all of them back.
        written = await orgDb(apiKey.organizationId).transaction(async (o) => {
          const [row] = await o
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

          await o.insert(assetAuditLog).values({
            organizationId: apiKey.organizationId,
            assetId: existing.id,
            action: "update",
            changes: {
              asset: { old: existing, new: row },
              unitConversions: normalizedSpecifications?.conversions.length
                ? normalizedSpecifications.conversions
                : undefined,
            },
            performedBy: apiKey.createdBy,
            ipAddress: getPublicApiRequestIp(c.req.raw.headers),
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
              o,
            );
          }

          return {
            updated: row,
            externalId:
              externalId ??
              (await getResourceExternalId(
                {
                  organizationId: apiKey.organizationId,
                  resourceType: "asset",
                  resourceId: existing.id,
                },
                o,
              )),
          };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return c.json(
            buildPublicApiError({
              code: "asset_tag_conflict",
              message: "Tag já está em uso",
            }),
            409,
          );
        }
        throw error;
      }

      const body = {
        data: {
          ...written?.updated,
          externalId: written?.externalId ?? null,
        },
      };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "asset.updated",
        payload: body.data,
        env: c.env,
      });

      return c.json(body);
    },
  )
  .delete("/assets/:id", requireApiScope("assets:write"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "asset",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "asset_not_found",
          message: "Ativo não encontrado",
        }),
        404,
      );
    }

    return withIdempotentMutation(
      c,
      { assetId: resolvedId },
      async ({ o, afterCommit }) => {
        // Look-up, audit entry and soft delete are one transaction (and the
        // idempotency record commits with them).
        const [existing] = await o
          .select({
            id: asset.id,
            deletedAt: asset.deletedAt,
            name: asset.name,
            tag: asset.tag,
            unitId: asset.unitId,
            customerId: asset.customerId,
            assetTypeId: asset.assetTypeId,
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .where(
            and(
              eq(asset.id, resolvedId),
              eq(customer.labOrganizationId, apiKey.organizationId),
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

        await o.insert(assetAuditLog).values({
          organizationId: apiKey.organizationId,
          assetId: existing.id,
          action: "delete",
          changes: { asset: { old: existing, new: null } },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
        });

        await o
          .update(asset)
          .set({ deletedAt: new Date() })
          .where(eq(asset.id, existing.id));

        const externalId = await getResourceExternalId(
          {
            organizationId: apiKey.organizationId,
            resourceType: "asset",
            resourceId: existing.id,
          },
          o,
        );

        afterCommit(() =>
          emitPublicApiWebhookEvent({
            organizationId: apiKey.organizationId,
            eventType: "asset.deleted",
            payload: { id: existing.id, externalId },
            env: c.env,
          }),
        );

        return {
          status: 200,
          body: { data: { id: existing.id, deleted: true } },
          resourceType: "asset" as const,
          resourceId: existing.id,
        };
      },
    );
  });
