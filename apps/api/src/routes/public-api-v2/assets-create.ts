import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { asset, assetAuditLog, customer } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import {
  buildPublicApiError,
  getPublicApiRequestIp,
  upsertResourceExternalId,
} from "../../lib/public-api";
import { stagePublicApiWebhookEvent } from "../../lib/public-api-webhooks";
import { isUniqueViolation } from "../../lib/db-errors";
import { findAssetTypeById } from "../../lib/asset-types";
import { requireApiScope } from "../../middleware/api-key-auth";
import { resolveAssetRegimeWrite } from "../../lib/asset-regime";
import { deriveRegulatedNextDate } from "../../lib/regulated-interval";
import {
  denormalizeAssetSpecificationsForResponse,
  normalizeAssetSpecificationsFromInput,
  resolveAssetBaseMeasurementUnit,
} from "../../lib/asset-measurement";
import { type PublicApiV2Env } from "./env";
import { AssetCreatePublicSchema } from "./schemas";
import { withIdempotentMutation } from "./idempotency";
import { resolveCustomerId, resolveUnitIdForWrite } from "./resolvers";

export const assetCreateRoutes = new Hono<PublicApiV2Env>().post(
  "/assets",
  requireApiScope("assets:write"),
  zValidator("json", AssetCreatePublicSchema),
  async (c) => {
    const apiKey = c.get("apiKey");
    const input = c.req.valid("json");

    return withIdempotentMutation(
      c,
      input,
      async ({ o, tx, afterCommit }) => {
        const resolvedCustomerId = await resolveCustomerId(
          {
            organizationId: apiKey.organizationId,
            customerId: input.customerId,
            customerExternalId: input.customerExternalId,
          },
          o,
        );

        if (!resolvedCustomerId) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        const [foundCustomer] = await o
          .select()
          .from(customer)
          .where(
            and(
              eq(customer.id, resolvedCustomerId),
              eq(customer.labOrganizationId, apiKey.organizationId),
            ),
          )
          .limit(1);
        // SEC-03a: scope the tag-collision check to the caller's org (join
        // asset → customer) so it cannot read another tenant's assets. The
        // residual GLOBAL DB unique is caught at the insert below.
        const existingTag = await o
          .select({ id: asset.id })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .where(
            and(
              eq(asset.tag, input.tag),
              eq(customer.labOrganizationId, apiKey.organizationId),
            ),
          )
          .limit(1);
        // Global catalog (no organization column).
        const foundType = await findAssetTypeById(input.assetTypeId, o);

        if (!foundCustomer) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        if (!foundType) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "asset_type_not_found",
              message: "Tipo de instrumento não encontrado",
            }),
          };
        }

        if (existingTag.length > 0) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "asset_tag_conflict",
              message: "Tag já está em uso",
            }),
          };
        }

        const unitId = await resolveUnitIdForWrite(
          {
            organizationId: apiKey.organizationId,
            requestedUnitId: input.unitId,
          },
          o,
        );
        const baseMeasurementUnitResult = resolveAssetBaseMeasurementUnit(
          foundType,
          input.baseMeasurementUnit,
        );

        if (!baseMeasurementUnitResult.ok) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "asset_base_measurement_unit_required",
              message: baseMeasurementUnitResult.error,
            }),
          };
        }
        const normalizedSpecifications = normalizeAssetSpecificationsFromInput({
          specifications: input.specifications || null,
          definition: foundType.definition,
          baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
        });

        // The lab does NOT set the next-calibration date / interval — that
        // periodicity is the customer's decision, set in the portal
        // (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24); the field is not part of
        // the schema, so an integration-sent value is stripped, never persisted.
        const lastCalibrationDate = input.lastCalibrationDate
          ? new Date(input.lastCalibrationDate)
          : null;
        // Legal-metrology regime (Track 2) + install anchor — mirrors the
        // dashboard asset-create route so an integration-created LEGAL
        // instrument lands consistent, not as a half-set state.
        const installedAt = input.installedAt
          ? new Date(input.installedAt)
          : null;
        const regimeWrite = resolveAssetRegimeWrite({
          metrologyRegime: input.metrologyRegime,
          regulatedInterval: input.regulatedInterval,
          current: { metrologyRegime: "INDUSTRIAL", regulatedInterval: null },
        });
        const nextLegalVerificationDate = regimeWrite.regulatedInterval
          ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
              lastVerificationDate: lastCalibrationDate,
              firstVerificationDate: lastCalibrationDate,
              installDate: installedAt,
            }).date
          : null;

        // SEC-03b: the org-scoped check above ran first; the per-org unique
        // (asset_lab_org_tag_uidx → 23505) backstops a SAME-org race. The
        // violation rolls the transaction back and `mapError` (below) answers
        // the SAME 409 asset_tag_conflict the app check returns (never 500). A
        // cross-org duplicate no longer raises (different lab_organization_id).
        //
        // The asset, its audit entry and the caller's external id commit
        // together (and with the idempotency record).
        const externalId = input.externalId?.trim();
        const [created] = await o
          .insert(asset)
          .values({
            unitId,
            customerId: foundCustomer.id,
            // SEC-03b (#638): denormalize the lab org from the (already
            // org-scoped) customer so UNIQUE(lab_organization_id, tag) is
            // per org. foundCustomer was fetched WHERE labOrganizationId =
            // apiKey.organizationId, so this is the caller's own lab org.
            labOrganizationId: foundCustomer.labOrganizationId,
            assetTypeId: input.assetTypeId,
            name: input.name,
            manufacturer: input.manufacturer || null,
            model: input.model || null,
            serialNumber: input.serialNumber,
            tag: input.tag,
            status: input.status || "ACTIVE",
            baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
            lastCalibrationDate,
            installedAt,
            comments: input.comments || null,
            specifications: normalizedSpecifications.specifications || null,
            metrologyRegime: regimeWrite.metrologyRegime,
            regulatedInterval: regimeWrite.regulatedInterval,
            nextLegalVerificationDate,
          })
          .returning();

        await o.insert(assetAuditLog).values({
          organizationId: apiKey.organizationId,
          assetId: created!.id,
          action: "create",
          changes: {
            asset: { old: null, new: created },
            unitConversions:
              normalizedSpecifications.conversions.length > 0
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
              resourceId: created!.id,
              externalId,
            },
            o,
          );
        }

        const body = {
          data: {
            ...created,
            specifications:
              denormalizeAssetSpecificationsForResponse({
                specifications: created!.specifications,
                definition: foundType.definition,
                baseMeasurementUnit: created!.baseMeasurementUnit,
              }) ?? null,
            externalId: externalId ?? null,
          },
        };

        await stagePublicApiWebhookEvent(
          { o, tx, afterCommit },
          {
            organizationId: apiKey.organizationId,
            eventType: "asset.created",
            payload: body.data,
          },
        );

        return {
          status: 201,
          body,
          resourceType: "asset" as const,
          resourceId: created!.id,
        };
      },
      {
        mapError: (error) =>
          isUniqueViolation(error)
            ? {
                status: 409,
                body: buildPublicApiError({
                  code: "asset_tag_conflict",
                  message: "Tag já está em uso",
                }),
              }
            : null,
      },
    );
  },
);
