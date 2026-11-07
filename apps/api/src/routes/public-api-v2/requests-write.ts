import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { asset, calibrationRequest, customer } from "@calibra-facil/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { CALIBRATION_REQUEST_MACHINE } from "@calibra-facil/schemas/machines";
import {
  buildPublicApiError,
  getResourceExternalId,
  upsertResourceExternalId,
} from "../../lib/public-api";
import { stagePublicApiWebhookEvent } from "../../lib/public-api-webhooks";
import { requireApiScope } from "../../middleware/api-key-auth";
import { submitCalibrationRequest } from "../../lib/calibration-request-submission";
import { withOrg } from "../../lib/org-context";
import { type PublicApiV2Env } from "./env";
import { apiKeyActor } from "./actor";
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

      return withIdempotentMutation(c, input, async (ctx) => {
        const resolvedCustomerId = await resolveCustomerId(
          {
            organizationId: apiKey.organizationId,
            customerId: input.customerId,
            customerExternalId: input.customerExternalId,
          },
          ctx.o,
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
                    ctx.o,
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

        const [foundCustomer] = await ctx.o
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
          ? await ctx.o
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

        const externalId = input.externalId?.trim();
        const created = await submitCalibrationRequest(ctx, {
          unitId: input.unitId ?? unitIds[0]!,
          customerId: foundCustomer.id,
          authOrganizationId: foundCustomer.authOrganizationId,
          assetIds,
          observations: input.observations,
          requestedDueDate,
        });

        if (externalId) {
          await upsertResourceExternalId(
            {
              organizationId: apiKey.organizationId,
              apiKeyId: apiKey.id,
              resourceType: "request",
              resourceId: created.id,
              externalId,
            },
            ctx.o,
          );
        }

        const body = {
          data: {
            id: created.id,
            status: created.status,
            externalId: externalId ?? null,
          },
        };

        await stagePublicApiWebhookEvent(ctx, {
          organizationId: apiKey.organizationId,
          eventType: "request.created",
          payload: body.data,
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

      // Look-up, update and audit entry are one transaction.
      const outcome = await withOrg(
        apiKey.organizationId,
        apiKeyActor(apiKey, c),
        async (ctx) => {
          const [existing] = await ctx.o
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

          if (
            !CALIBRATION_REQUEST_MACHINE.canTransition(existing.status, "edit")
          ) {
            return { kind: "not_editable" as const };
          }

          const [updated] = await ctx.o
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
            // Only while the request is still editable (CAS on the status read).
            .where(
              and(
                eq(calibrationRequest.id, existing.id),
                eq(calibrationRequest.status, existing.status),
              ),
            )
            .returning();
          if (!updated) return { kind: "not_editable" as const };

          await ctx.audit("calibrationRequest", existing.id, {
            action: "update",
            changes: { request: { old: existing, new: updated } },
          });

          const externalId = await getResourceExternalId(
            {
              organizationId: apiKey.organizationId,
              resourceType: "request",
              resourceId: existing.id,
            },
            ctx.o,
          );
          // The event is queued with the update and goes out after it commits.
          await stagePublicApiWebhookEvent(ctx, {
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

      return withIdempotentMutation(c, input, async (ctx) => {
        // Look-up, rejection and audit entry are one transaction (and the
        // idempotency record commits with them).
        const [existing] = await ctx.o
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
          !CALIBRATION_REQUEST_MACHINE.canTransition(existing.status, "reject")
        ) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "request_not_cancelable",
              message: "A solicitação não pode ser cancelada neste status",
            }),
          };
        }

        const [updated] = await ctx.o
          .update(calibrationRequest)
          .set({
            status: CALIBRATION_REQUEST_MACHINE.requireTargetOf(
              existing.status,
              "reject",
            ),
            rejectedBy: apiKey.createdBy,
            rejectedAt: new Date(),
            rejectionReason: input.reason,
            // As the lab's reject: a rejected request carries no approval.
            approvedBy: null,
            approvedAt: null,
          })
          .where(
            and(
              eq(calibrationRequest.id, existing.id),
              eq(calibrationRequest.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "request_not_cancelable",
              message: "A solicitação mudou de status durante a operação",
            }),
          };
        }

        await ctx.audit("calibrationRequest", existing.id, {
          action: "reject",
          changes: { status: { old: existing.status, new: "REJECTED" } },
          reason: input.reason,
        });

        const body = { data: updated };

        await stagePublicApiWebhookEvent(ctx, {
          organizationId: apiKey.organizationId,
          eventType: "request.canceled",
          payload: {
            id: updated.id,
            status: updated.status,
            rejectionReason: updated.rejectionReason,
          },
        });

        return {
          status: 200,
          body,
          resourceType: "request" as const,
          resourceId: updated.id,
        };
      });
    },
  );
