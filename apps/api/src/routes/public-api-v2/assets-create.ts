import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  buildPublicApiError,
  upsertResourceExternalId,
} from "../../lib/public-api";
import { stagePublicApiWebhookEvent } from "../../lib/public-api-webhooks";
import { isUniqueViolation } from "../../lib/db-errors";
import { notFound } from "../../lib/domain-errors";
import { requireApiScope } from "../../middleware/api-key-auth";
import { createLabAsset } from "../../lib/asset-writes";
import { denormalizeAssetSpecificationsForResponse } from "../../lib/asset-measurement";
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
      async (ctx) => {
        const resolvedCustomerId = await resolveCustomerId(
          {
            organizationId: apiKey.organizationId,
            customerId: input.customerId,
            customerExternalId: input.customerExternalId,
          },
          ctx.o,
        );

        if (!resolvedCustomerId) {
          throw notFound("customer_not_found", "Cliente não encontrado");
        }

        // SEC-03b: the org-scoped check inside `createLabAsset` ran first; the
        // per-org unique (asset_lab_org_tag_uidx → 23505) backstops a SAME-org
        // race. The violation rolls the transaction back and `mapError` (below)
        // answers the SAME 409 asset_tag_conflict the app check returns (never
        // 500). A cross-org duplicate no longer raises (different
        // lab_organization_id).
        //
        // The asset, its audit entry and the caller's external id commit
        // together (and with the idempotency record).
        const { created, assetType } = await createLabAsset(
          ctx,
          { ...input, customerId: resolvedCustomerId },
          {
            resolveUnitId: () =>
              resolveUnitIdForWrite(
                {
                  organizationId: apiKey.organizationId,
                  requestedUnitId: input.unitId,
                },
                ctx.o,
              ),
            // The public contract has never refused an input for the asset
            // type's required specification fields.
            enforceRequiredSpecifications: false,
          },
        );

        const externalId = input.externalId?.trim();
        if (externalId) {
          await upsertResourceExternalId(
            {
              organizationId: apiKey.organizationId,
              apiKeyId: apiKey.id,
              resourceType: "asset",
              resourceId: created.id,
              externalId,
            },
            ctx.o,
          );
        }

        const body = {
          data: {
            ...created,
            specifications:
              denormalizeAssetSpecificationsForResponse({
                specifications: created.specifications,
                definition: assetType.definition,
                baseMeasurementUnit: created.baseMeasurementUnit,
              }) ?? null,
            externalId: externalId ?? null,
          },
        };

        await stagePublicApiWebhookEvent(ctx, {
          organizationId: apiKey.organizationId,
          eventType: "asset.created",
          payload: body.data,
        });

        return {
          status: 201,
          body,
          resourceType: "asset" as const,
          resourceId: created.id,
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
