import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationRequest,
  calibrationRequestAuditLog,
  calibrationRequestItem,
  customer,
} from "@calibra-facil/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  buildPublicApiError,
  emitPublicApiWebhookEvent,
  getPublicApiRequestIp,
  getResourceExternalId,
  upsertResourceExternalId,
} from "../../lib/public-api";
import { requireApiScope } from "../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import {
  CancelRequestPublicSchema,
  PublicCreateRequestSchema,
  UpdateRequestPublicSchema,
} from "./schemas";
import { withIdempotentMutation } from "./idempotency";
import {
  resolveAssetId,
  resolveCustomerId,
  resolveExternalResourceId,
} from "./resolvers";

export const requestWriteRoutes = new Hono<PublicApiV2Env>()
  .post(
    "/requests",
    requireApiScope("requests:write"),
    zValidator("json", PublicCreateRequestSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      return withIdempotentMutation(c, input, async () => {
        const resolvedCustomerId = await resolveCustomerId({
          organizationId: apiKey.organizationId,
          customerId: input.customerId,
          customerExternalId: input.customerExternalId,
        });

        if (!resolvedCustomerId) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        const assetIds = Array.from(
          new Set([
            ...(input.assetIds ?? []),
            ...(
              await Promise.all(
                (input.assetExternalIds ?? []).map((externalId) =>
                  resolveAssetId({
                    organizationId: apiKey.organizationId,
                    assetExternalId: externalId,
                  }),
                ),
              )
            ).filter((value): value is number => !!value),
          ]),
        );

        if (assetIds.length === 0) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "invalid_assets",
              message: "Informe ativos válidos",
            }),
          };
        }

        const foundCustomer = await db.query.customer.findFirst({
          where: and(
            eq(customer.id, resolvedCustomerId),
            eq(customer.labOrganizationId, apiKey.organizationId),
          ),
        });

        if (!foundCustomer) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        const assetsInScope = await db
          .select({
            id: asset.id,
            unitId: asset.unitId,
          })
          .from(asset)
          .where(
            and(
              inArray(asset.id, assetIds),
              eq(asset.customerId, foundCustomer.id),
              isNull(asset.deletedAt),
              eq(asset.status, "ACTIVE"),
            ),
          );

        if (assetsInScope.length !== assetIds.length) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "invalid_assets",
              message: "Um ou mais ativos não pertencem ao cliente",
            }),
          };
        }

        const unitIds = [...new Set(assetsInScope.map((item) => item.unitId))];
        if (input.unitId && !unitIds.includes(input.unitId)) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "unit_asset_mismatch",
              message: "Os ativos não pertencem à unidade informada",
            }),
          };
        }

        if (unitIds.length !== 1) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "multi_unit_request_not_allowed",
              message:
                "Selecione ativos da mesma unidade para criar a solicitação",
            }),
          };
        }

        const requestedDueDate = input.requestedDueDate
          ? new Date(input.requestedDueDate)
          : null;

        const created = await db.transaction(async (tx) => {
          const [request] = await tx
            .insert(calibrationRequest)
            .values({
              organizationId: apiKey.organizationId,
              unitId: input.unitId ?? unitIds[0]!,
              customerId: foundCustomer.id,
              authOrganizationId: foundCustomer.authOrganizationId,
              observations: input.observations || null,
              requestedDueDate,
              submittedBy: apiKey.createdBy,
            })
            .returning();

          await tx.insert(calibrationRequestItem).values(
            assetIds.map((assetId) => ({
              organizationId: apiKey.organizationId,
              requestId: request!.id,
              assetId,
            })),
          );

          await tx.insert(calibrationRequestAuditLog).values({
            organizationId: apiKey.organizationId,
            requestId: request!.id,
            action: "create",
            changes: {
              initial: {
                assetIds,
                observations: input.observations || null,
                requestedDueDate: requestedDueDate?.toISOString() ?? null,
              },
            },
            performedBy: apiKey.createdBy,
            ipAddress: getPublicApiRequestIp(c.req.raw.headers),
          });

          return request!;
        });

        const externalId = input.externalId?.trim();
        if (externalId) {
          await upsertResourceExternalId({
            organizationId: apiKey.organizationId,
            apiKeyId: apiKey.id,
            resourceType: "request",
            resourceId: created.id,
            externalId,
          });
        }

        const body = {
          data: {
            id: created.id,
            status: created.status,
            externalId: externalId ?? null,
          },
        };

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "request.created",
          payload: body.data,
          env: c.env,
        });

        return {
          status: 201,
          body,
          resourceType: "request" as const,
          resourceId: created.id,
        };
      });
    },
  )
  .patch(
    "/requests/:id",
    requireApiScope("requests:write"),
    zValidator("json", UpdateRequestPublicSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
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

      const [existing] = await db
        .select()
        .from(calibrationRequest)
        .where(
          and(
            eq(calibrationRequest.id, resolvedId),
            eq(calibrationRequest.organizationId, apiKey.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json(
          buildPublicApiError({
            code: "request_not_found",
            message: "Solicitação não encontrada",
          }),
          404,
        );
      }

      if (!["PENDING", "UNDER_REVIEW"].includes(existing.status)) {
        return c.json(
          buildPublicApiError({
            code: "request_not_editable",
            message:
              "Somente solicitações pendentes ou em revisão podem ser atualizadas",
          }),
          409,
        );
      }

      const [updated] = await db
        .update(calibrationRequest)
        .set({
          observations: input.observations ?? existing.observations,
          requestedDueDate:
            input.requestedDueDate === undefined
              ? existing.requestedDueDate
              : input.requestedDueDate
                ? new Date(input.requestedDueDate)
                : null,
        })
        .where(eq(calibrationRequest.id, existing.id))
        .returning();

      await db.insert(calibrationRequestAuditLog).values({
        organizationId: apiKey.organizationId,
        requestId: existing.id,
        action: "update",
        changes: { request: { old: existing, new: updated } },
        performedBy: apiKey.createdBy,
        ipAddress: getPublicApiRequestIp(c.req.raw.headers),
      });

      const body = {
        data: {
          ...updated,
          externalId: await getResourceExternalId({
            organizationId: apiKey.organizationId,
            resourceType: "request",
            resourceId: existing.id,
          }),
        },
      };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "request.updated",
        payload: body.data,
        env: c.env,
      });

      return c.json(body);
    },
  )
  .post(
    "/requests/:id/cancel",
    requireApiScope("requests:write"),
    zValidator("json", CancelRequestPublicSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
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

      return withIdempotentMutation(c, input, async () => {
        const [existing] = await db
          .select()
          .from(calibrationRequest)
          .where(
            and(
              eq(calibrationRequest.id, resolvedId),
              eq(calibrationRequest.organizationId, apiKey.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "request_not_found",
              message: "Solicitação não encontrada",
            }),
          };
        }

        if (
          !["PENDING", "UNDER_REVIEW", "APPROVED"].includes(existing.status)
        ) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "request_not_cancelable",
              message: "A solicitação não pode ser cancelada neste status",
            }),
          };
        }

        const [updated] = await db
          .update(calibrationRequest)
          .set({
            status: "REJECTED",
            rejectedBy: apiKey.createdBy,
            rejectedAt: new Date(),
            rejectionReason: input.reason,
          })
          .where(eq(calibrationRequest.id, existing.id))
          .returning();

        await db.insert(calibrationRequestAuditLog).values({
          organizationId: apiKey.organizationId,
          requestId: existing.id,
          action: "reject",
          changes: { status: { old: existing.status, new: "REJECTED" } },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
          reason: input.reason,
        });

        const body = { data: updated! };

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "request.canceled",
          payload: {
            id: updated!.id,
            status: updated!.status,
            rejectionReason: updated!.rejectionReason,
          },
          env: c.env,
        });

        return {
          status: 200,
          body,
          resourceType: "request" as const,
          resourceId: updated!.id,
        };
      });
    },
  );
