import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asset, assetType, customer } from "@calibra-facil/db/schema";
import { AssetStatusSchema } from "@calibra-facil/schemas";
import { and, count, eq, ilike, isNull, or } from "drizzle-orm";
import {
  buildListMeta,
  buildPublicApiError,
  getResourceExternalId,
  getResourceExternalIdMap,
} from "../../lib/public-api";
import { requireApiScope } from "../../middleware/api-key-auth";
import { denormalizeAssetSpecificationsForResponse } from "../../lib/asset-measurement";
import { type PublicApiV2Env } from "./env";
import { ListQuerySchema } from "./schemas";
import { resolveCustomerId, resolveExternalResourceId } from "./resolvers";
import { orgDb } from "../../lib/org-db";

export const assetReadRoutes = new Hono<PublicApiV2Env>()
  .get(
    "/assets",
    requireApiScope("assets:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({
        customerId: z.coerce.number().optional(),
        customerExternalId: z.string().trim().optional(),
        status: z.string().trim().optional(),
      }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const {
        page,
        limit,
        query,
        unitId,
        customerId,
        customerExternalId,
        status,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const resolvedCustomerId = await resolveCustomerId({
        organizationId: apiKey.organizationId,
        customerId,
        customerExternalId,
      });

      const conditions = [
        eq(customer.labOrganizationId, apiKey.organizationId),
        isNull(asset.deletedAt),
        unitId ? eq(asset.unitId, unitId) : undefined,
        resolvedCustomerId
          ? eq(asset.customerId, resolvedCustomerId)
          : undefined,
        AssetStatusSchema.safeParse(status).success
          ? eq(asset.status, AssetStatusSchema.parse(status))
          : undefined,
        query
          ? or(
              ilike(asset.name, `%${query}%`),
              ilike(asset.tag, `%${query}%`),
              ilike(asset.serialNumber, `%${query}%`),
            )
          : undefined,
      ];

      const [countResult, rows] = await orgDb(
        apiKey.organizationId,
      ).transaction((o) =>
        Promise.all([
          o
            .select({ total: count() })
            .from(asset)
            .innerJoin(customer, eq(asset.customerId, customer.id))
            .where(and(...conditions)),
          o
            .select({
              id: asset.id,
              unitId: asset.unitId,
              customerId: asset.customerId,
              customerName: customer.name,
              assetTypeId: asset.assetTypeId,
              assetTypeDefinition: assetType.definition,
              name: asset.name,
              tag: asset.tag,
              serialNumber: asset.serialNumber,
              manufacturer: asset.manufacturer,
              model: asset.model,
              status: asset.status,
              baseMeasurementUnit: asset.baseMeasurementUnit,
              lastCalibrationDate: asset.lastCalibrationDate,
              nextCalibrationDate: asset.nextCalibrationDate,
              specifications: asset.specifications,
              createdAt: asset.createdAt,
              updatedAt: asset.updatedAt,
            })
            .from(asset)
            .innerJoin(customer, eq(asset.customerId, customer.id))
            .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
            .where(and(...conditions))
            .orderBy(asset.name)
            .limit(limit)
            .offset(offset),
        ]),
      );

      const externalIds = await getResourceExternalIdMap({
        organizationId: apiKey.organizationId,
        resourceType: "asset",
        resourceIds: rows.map((row) => row.id),
      });

      return c.json({
        data: rows.map((row) => ({
          ...row,
          specifications:
            denormalizeAssetSpecificationsForResponse({
              specifications: row.specifications,
              definition: row.assetTypeDefinition,
              baseMeasurementUnit: row.baseMeasurementUnit,
            }) ?? null,
          externalId: externalIds.get(String(row.id)) ?? null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: {
            query: query ?? null,
            unitId: unitId ?? null,
            customerId: resolvedCustomerId ?? null,
            status: status ?? null,
          },
        }),
      });
    },
  )
  .get("/assets/:id", requireApiScope("assets:read"), async (c) => {
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

    const [found] = await orgDb(apiKey.organizationId).transaction((o) =>
      o
        .select({
          id: asset.id,
          unitId: asset.unitId,
          customerId: asset.customerId,
          customerName: customer.name,
          assetTypeId: asset.assetTypeId,
          assetTypeDefinition: assetType.definition,
          name: asset.name,
          tag: asset.tag,
          serialNumber: asset.serialNumber,
          manufacturer: asset.manufacturer,
          model: asset.model,
          status: asset.status,
          baseMeasurementUnit: asset.baseMeasurementUnit,
          lastCalibrationDate: asset.lastCalibrationDate,
          nextCalibrationDate: asset.nextCalibrationDate,
          comments: asset.comments,
          specifications: asset.specifications,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
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
        .limit(1),
    );

    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "asset_not_found",
          message: "Ativo não encontrado",
        }),
        404,
      );
    }

    return c.json({
      data: {
        ...found,
        specifications:
          denormalizeAssetSpecificationsForResponse({
            specifications: found.specifications,
            definition: found.assetTypeDefinition,
            baseMeasurementUnit: found.baseMeasurementUnit,
          }) ?? null,
        externalId: await getResourceExternalId({
          organizationId: apiKey.organizationId,
          resourceType: "asset",
          resourceId: found.id,
        }),
      },
    });
  });
