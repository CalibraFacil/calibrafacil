import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
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
  getPublicApiRequestIp,
  getResourceExternalId,
  upsertResourceExternalId,
} from "../../lib/public-api";
import {
  stagePublicApiWebhookEvent,
  withPublicApiWebhookTransaction,
} from "../../lib/public-api-webhooks";
import { requireApiScope } from "../../middleware/api-key-auth";
import { orgDb } from "../../lib/org-db";
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

          const assetIds = Array.from(
            new Set([
              ...(input.assetIds ?? []),
              ...(
                await Promise.all(
                  (input.assetExternalIds ?? []).map((externalId) =>
                    resolveAssetId(
                      {
                        organizationId: apiKey.organizationId,
                        assetExternalId: externalId,
                      },
                      o,
                    ),
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
          const assetsInScope = foundCustomer
            ? await o
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
                )
            : [];

          if (!foundCustomer) {
            return {
              status: 404,
              body: buildPublicApiError({
                code: "customer_not_found",
                message: "Cliente não encontrado",
              }),
            };
          }

          if (assetsInScope.length !== assetIds.length) {
            return {
              status: 400,
              body: buildPublicApiError({
                code: "invalid_assets",
                message: "Um ou mais ativos não pertencem ao cliente",
              }),
            };
          }

          const unitIds = [
            ...new Set(assetsInScope.map((item) => item.unitId)),
          ];
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

          const externalId = input.externalId?.trim();
          const [created] = await o
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

          await o.insert(calibrationRequestItem).values(
            assetIds.map((assetId) => ({
              organizationId: apiKey.organizationId,
              requestId: created!.id,
              assetId,
            })),
          );

          await o.insert(calibrationRequestAuditLog).values({
            organizationId: apiKey.organizationId,
            requestId: created!.id,
            action: "create",
            changes: {
              initial: {
                assetIds,
                observations: input.observations || null,
                requestedDueDate: requestedDueDate?.toISOString() ?? null,
              },
            },
            performedBy: apiKey.createdBy,
            ipAddress: getPublicApiRequestIp(c),
          });

          if (externalId) {
            await upsertResourceExternalId(
              {
                organizationId: apiKey.organizationId,
                apiKeyId: apiKey.id,
                resourceType: "request",
                resourceId: created!.id,
                externalId,
              },
              o,
            );
          }

          const body = {
            data: {
              id: created!.id,
              status: created!.status,
              externalId: externalId ?? null,
            },
          };

          await stagePublicApiWebhookEvent(
            { o, tx, afterCommit },
            {
              organizationId: apiKey.organizationId,
              eventType: "request.created",
              payload: body.data,
            },
          );

          return {
            status: 201,
            body,
            resourceType: "request" as const,
            resourceId: created!.id,
          };
        },
      );
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

      // Look-up, update and audit entry are one transaction.
      const outcome = await withPublicApiWebhookTransaction(
        apiKey.organizationId,
        async (o, webhooks) => {
          const [existing] = await o
            .select()
            .from(calibrationRequest)
            .where(
              and(
                eq(calibrationRequest.id, resolvedId),
                eq(calibrationRequest.organizationId, apiKey.organizationId),
              ),
            )
            .limit(1);

          if (!existing) return { kind: "missing" as const };

          if (!["PENDING", "UNDER_REVIEW"].includes(existing.status)) {
            return { kind: "not_editable" as const };
          }

          const [updated] = await o
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

          await o.insert(calibrationRequestAuditLog).values({
            organizationId: apiKey.organizationId,
            requestId: existing.id,
            action: "update",
            changes: { request: { old: existing, new: updated } },
            performedBy: apiKey.createdBy,
            ipAddress: getPublicApiRequestIp(c),
          });

          const externalId = await getResourceExternalId(
            {
              organizationId: apiKey.organizationId,
              resourceType: "request",
              resourceId: existing.id,
            },
            o,
          );
          // The event is queued with the update and goes out after it commits.
          await stagePublicApiWebhookEvent(webhooks, {
            organizationId: apiKey.organizationId,
            eventType: "request.updated",
            payload: { ...updated, externalId },
          });

          return { kind: "updated" as const, existing, updated, externalId };
        },
      );

      if (outcome.kind === "missing") {
        return c.json(
          buildPublicApiError({
            code: "request_not_found",
            message: "Solicitação não encontrada",
          }),
          404,
        );
      }

      if (outcome.kind === "not_editable") {
        return c.json(
          buildPublicApiError({
            code: "request_not_editable",
            message:
              "Somente solicitações pendentes ou em revisão podem ser atualizadas",
          }),
          409,
        );
      }

      const { updated } = outcome;

      const body = {
        data: {
          ...updated,
          externalId: outcome.externalId,
        },
      };

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

      return withIdempotentMutation(
        c,
        input,
        async ({ o, tx, afterCommit }) => {
          // Look-up, rejection and audit entry are one transaction (and the
          // idempotency record commits with them).
          const [existing] = await o
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

          const [updated] = await o
            .update(calibrationRequest)
            .set({
              status: "REJECTED",
              rejectedBy: apiKey.createdBy,
              rejectedAt: new Date(),
              rejectionReason: input.reason,
            })
            .where(eq(calibrationRequest.id, existing.id))
            .returning();

          await o.insert(calibrationRequestAuditLog).values({
            organizationId: apiKey.organizationId,
            requestId: existing.id,
            action: "reject",
            changes: { status: { old: existing.status, new: "REJECTED" } },
            performedBy: apiKey.createdBy,
            ipAddress: getPublicApiRequestIp(c),
            reason: input.reason,
          });

          const body = { data: updated! };

          await stagePublicApiWebhookEvent(
            { o, tx, afterCommit },
            {
              organizationId: apiKey.organizationId,
              eventType: "request.canceled",
              payload: {
                id: updated!.id,
                status: updated!.status,
                rejectionReason: updated!.rejectionReason,
              },
            },
          );

          return {
            status: 200,
            body,
            resourceType: "request" as const,
            resourceId: updated!.id,
          };
        },
      );
    },
  );
