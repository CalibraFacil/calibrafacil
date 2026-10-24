import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  asset,
  calibrationRequest,
  calibrationRequestItem,
  customer,
  organizationUnit,
} from "@calibra-facil/db/schema";
import { CalibrationRequestStatusSchema } from "@calibra-facil/schemas";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  buildListMeta,
  buildPublicApiError,
  getResourceExternalId,
  getResourceExternalIdMap,
} from "../../lib/public-api";
import { requireApiScope } from "../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import { ListQuerySchema } from "./schemas";
import { resolveCustomerId, resolveExternalResourceId } from "./resolvers";
import { orgDb } from "../../lib/org-db";

export const requestReadRoutes = new Hono<PublicApiV2Env>()
  .get(
    "/requests",
    requireApiScope("requests:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({
        status: z.string().optional(),
        customerExternalId: z.string().trim().optional(),
        customerId: z.coerce.number().optional(),
      }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const {
        page,
        limit,
        query,
        status,
        unitId,
        customerId,
        customerExternalId,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const resolvedCustomerId = await resolveCustomerId({
        organizationId: apiKey.organizationId,
        customerId,
        customerExternalId,
      });
      const conditions = [
        eq(calibrationRequest.organizationId, apiKey.organizationId),
        unitId ? eq(calibrationRequest.unitId, unitId) : undefined,
        CalibrationRequestStatusSchema.safeParse(status).success
          ? eq(
              calibrationRequest.status,
              CalibrationRequestStatusSchema.parse(status),
            )
          : undefined,
        resolvedCustomerId
          ? eq(calibrationRequest.customerId, resolvedCustomerId)
          : undefined,
        query
          ? sql`(${calibrationRequest.id}::text ilike ${`%${query}%`} or coalesce(${calibrationRequest.observations}, '') ilike ${`%${query}%`})`
          : undefined,
      ];

      const [countResult, rows] = await orgDb(
        apiKey.organizationId,
      ).transaction((o) =>
        Promise.all([
          o
            .select({ total: count() })
            .from(calibrationRequest)
            .where(and(...conditions)),
          o
            .select({
              id: calibrationRequest.id,
              status: calibrationRequest.status,
              observations: calibrationRequest.observations,
              requestedDueDate: calibrationRequest.requestedDueDate,
              submittedAt: calibrationRequest.submittedAt,
              customerId: calibrationRequest.customerId,
              customerName: customer.name,
              unitId: calibrationRequest.unitId,
              unitName: organizationUnit.name,
            })
            .from(calibrationRequest)
            .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
            .leftJoin(
              organizationUnit,
              eq(calibrationRequest.unitId, organizationUnit.id),
            )
            .where(and(...conditions))
            .orderBy(desc(calibrationRequest.submittedAt))
            .limit(limit)
            .offset(offset),
        ]),
      );

      const externalIds = await getResourceExternalIdMap({
        organizationId: apiKey.organizationId,
        resourceType: "request",
        resourceIds: rows.map((row) => row.id),
      });

      return c.json({
        data: rows.map((row) => ({
          ...row,
          externalId: externalIds.get(String(row.id)) ?? null,
          unit: row.unitId
            ? { id: row.unitId, name: row.unitName ?? "Unidade removida" }
            : null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: {
            query: query ?? null,
            status: status ?? null,
            unitId: unitId ?? null,
            customerId: resolvedCustomerId ?? null,
          },
        }),
      });
    },
  )
  .get("/requests/:id", requireApiScope("requests:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "request",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "request_not_found",
          message: "Solicitação não encontrada",
        }),
        404,
      );
    }

    const [found] = await orgDb(apiKey.organizationId).transaction((o) =>
      o
        .select({
          id: calibrationRequest.id,
          status: calibrationRequest.status,
          observations: calibrationRequest.observations,
          requestedDueDate: calibrationRequest.requestedDueDate,
          submittedAt: calibrationRequest.submittedAt,
          reviewedAt: calibrationRequest.reviewedAt,
          approvedAt: calibrationRequest.approvedAt,
          rejectedAt: calibrationRequest.rejectedAt,
          rejectionReason: calibrationRequest.rejectionReason,
          convertedAt: calibrationRequest.convertedAt,
          customerId: calibrationRequest.customerId,
          customerName: customer.name,
          unitId: calibrationRequest.unitId,
          unitName: organizationUnit.name,
        })
        .from(calibrationRequest)
        .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
        .leftJoin(
          organizationUnit,
          eq(calibrationRequest.unitId, organizationUnit.id),
        )
        .where(
          and(
            eq(calibrationRequest.id, resolvedId),
            eq(calibrationRequest.organizationId, apiKey.organizationId),
          ),
        )
        .limit(1),
    );

    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "request_not_found",
          message: "Solicitação não encontrada",
        }),
        404,
      );
    }

    const items = await orgDb(apiKey.organizationId).transaction((o) =>
      o
        .select({
          id: calibrationRequestItem.id,
          assetId: calibrationRequestItem.assetId,
          convertedJobId: calibrationRequestItem.convertedJobId,
          assetName: asset.name,
          assetTag: asset.tag,
        })
        .from(calibrationRequestItem)
        .innerJoin(asset, eq(calibrationRequestItem.assetId, asset.id))
        .where(eq(calibrationRequestItem.requestId, found.id)),
    );

    return c.json({
      data: {
        ...found,
        externalId: await getResourceExternalId({
          organizationId: apiKey.organizationId,
          resourceType: "request",
          resourceId: found.id,
        }),
        unit: found.unitId
          ? { id: found.unitId, name: found.unitName ?? "Unidade removida" }
          : null,
        items,
      },
    });
  });
