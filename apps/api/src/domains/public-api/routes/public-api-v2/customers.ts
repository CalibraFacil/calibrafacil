import { createRouter } from "../../../../server/router";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { customer } from "@calibra-facil/db/schema";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from "@calibra-facil/schemas";
import { and, count, eq, ilike, or } from "drizzle-orm";
import {
  buildListMeta,
  buildPublicApiError,
  getResourceExternalId,
  getResourceExternalIdMap,
  upsertResourceExternalId,
} from "../../public-api";
import { stagePublicApiWebhookEvent } from "../../public-api-webhooks";
import { isReferencedRowViolation } from "../../../../lib/db-errors";
import { notFound } from "../../../../lib/domain-errors";
import { orgDb } from "../../../../lib/org-db";
import { requireApiScope } from "../../../../middleware/api-key-auth";
import {
  createLabCustomer,
  deleteLabCustomer,
  provisionCustomerOrganization,
  updateLabCustomer,
} from "../../../customers";
import { withOrg } from "../../../../lib/org-context";
import { type PublicApiV2Env } from "./env";
import { ListQuerySchema } from "./schemas";
import { resolveExternalResourceId } from "./resolvers";
import {
  withIdempotentMutation,
  withPreparedIdempotentMutation,
} from "./idempotency";
import { apiKeyActor } from "./actor";
import { answeringRefusals } from "./refusals";

export const customerRoutes = createRouter<PublicApiV2Env>()
  .get(
    "/customers",
    requireApiScope("customers:read"),
    zValidator("query", ListQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const conditions = [
        eq(customer.labOrganizationId, apiKey.organizationId),
      ];
      if (query) {
        conditions.push(
          or(
            ilike(customer.name, `%${query}%`),
            ilike(customer.taxId, `%${query}%`),
            ilike(customer.email, `%${query}%`),
          )!,
        );
      }

      const { countResult, rows, externalIds } = await orgDb(
        apiKey.organizationId,
      ).transaction(async (o) => {
        const [countResult, rows] = await Promise.all([
          o
            .select({ total: count() })
            .from(customer)
            .where(and(...conditions)),
          o
            .select({
              id: customer.id,
              name: customer.name,
              taxId: customer.taxId,
              email: customer.email,
              phone: customer.phone,
              address: customer.address,
              createdAt: customer.createdAt,
              updatedAt: customer.updatedAt,
            })
            .from(customer)
            .where(and(...conditions))
            .orderBy(customer.name)
            .limit(limit)
            .offset(offset),
        ]);

        const externalIds = await getResourceExternalIdMap(
          {
            organizationId: apiKey.organizationId,
            resourceType: "customer",
            resourceIds: rows.map((row) => row.id),
          },
          o,
        );
        return { countResult, rows, externalIds };
      });

      return c.json({
        data: rows.map((row) => ({
          ...row,
          externalId: externalIds.get(String(row.id)) ?? null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: { query: query ?? null },
        }),
      });
    },
  )
  .get("/customers/:id", requireApiScope("customers:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await orgDb(apiKey.organizationId).transaction((o) =>
      resolveExternalResourceId(
        {
          organizationId: apiKey.organizationId,
          resourceType: "customer",
          value: c.req.param("id"),
        },
        o,
      ),
    );

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "customer_not_found",
          message: "Cliente não encontrado",
        }),
        404,
      );
    }

    const loaded = await orgDb(apiKey.organizationId).transaction(async (o) => {
      const [row] = await o
        .select()
        .from(customer)
        .where(
          and(
            eq(customer.id, resolvedId),
            eq(customer.labOrganizationId, apiKey.organizationId),
          ),
        )
        .limit(1);
      if (!row) return null;

      return {
        ...row,
        externalId: await getResourceExternalId(
          {
            organizationId: apiKey.organizationId,
            resourceType: "customer",
            resourceId: row.id,
          },
          o,
        ),
      };
    });

    if (!loaded) {
      return c.json(
        buildPublicApiError({
          code: "customer_not_found",
          message: "Cliente não encontrado",
        }),
        404,
      );
    }

    return c.json({ data: loaded });
  })
  .post(
    "/customers",
    requireApiScope("customers:write"),
    zValidator(
      "json",
      CreateCustomerSchema.extend({ externalId: z.string().trim().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      // The client organization is an identity-table write on the system path
      // (its own connection): it runs before the transaction the customer and
      // its idempotency record commit in, not inside it.
      return withPreparedIdempotentMutation(
        c,
        input,
        () => provisionCustomerOrganization(input.name),
        async (ctx, orgResult) => {
          if (!orgResult?.id) {
            return {
              status: 500,
              body: buildPublicApiError({
                code: "customer_create_failed",
                message: "Falha ao criar organização do cliente",
              }),
            };
          }

          const externalId = input.externalId?.trim();
          // The customer, its audit entry and the caller's external id commit
          // together (and with the idempotency record). The public contract
          // carries the identity and contact fields: the trade name and the
          // group are the lab's.
          const created = await createLabCustomer(
            ctx,
            {
              name: input.name,
              taxId: input.taxId,
              email: input.email,
              phone: input.phone,
              address: input.address,
            },
            orgResult.id,
          );

          if (externalId) {
            await upsertResourceExternalId(
              {
                organizationId: apiKey.organizationId,
                apiKeyId: apiKey.id,
                resourceType: "customer",
                resourceId: created.id,
                externalId,
              },
              ctx.o,
            );
          }

          const body = {
            data: {
              ...created,
              externalId: externalId ?? null,
            },
          };

          await stagePublicApiWebhookEvent(ctx, {
            organizationId: apiKey.organizationId,
            eventType: "customer.created",
            payload: body.data,
          });

          return {
            status: 201,
            body,
            resourceType: "customer" as const,
            resourceId: created.id,
          };
        },
      );
    },
  )
  .put(
    "/customers/:id",
    requireApiScope("customers:write"),
    zValidator(
      "json",
      UpdateCustomerSchema.extend({ externalId: z.string().trim().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await orgDb(apiKey.organizationId).transaction((o) =>
        resolveExternalResourceId(
          {
            organizationId: apiKey.organizationId,
            resourceType: "customer",
            value: c.req.param("id"),
          },
          o,
        ),
      );

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "customer_not_found",
            message: "Cliente não encontrado",
          }),
          404,
        );
      }

      const externalId = input.externalId?.trim();
      return answeringRefusals(c, async () => {
        const result = await withOrg(
          apiKey.organizationId,
          apiKeyActor(apiKey, c),
          async (ctx) => {
            const [existing] = await ctx.o
              .select()
              .from(customer)
              .where(
                and(
                  eq(customer.id, resolvedId),
                  eq(customer.labOrganizationId, apiKey.organizationId),
                ),
              )
              .limit(1);
            if (!existing) {
              throw notFound("customer_not_found", "Cliente não encontrado");
            }

            // The public contract carries the identity and contact fields.
            const updated = await updateLabCustomer(ctx, existing, {
              name: input.name,
              taxId: input.taxId,
              email: input.email,
              phone: input.phone,
              address: input.address,
            });

            if (externalId) {
              await upsertResourceExternalId(
                {
                  organizationId: apiKey.organizationId,
                  apiKeyId: apiKey.id,
                  resourceType: "customer",
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
                  resourceType: "customer",
                  resourceId: existing.id,
                },
                ctx.o,
              ));
            // The event is queued with the update and goes out after it commits.
            await stagePublicApiWebhookEvent(ctx, {
              organizationId: apiKey.organizationId,
              eventType: "customer.updated",
              payload: { ...updated, externalId: resolvedExternalId },
            });

            return { updated, externalId: resolvedExternalId };
          },
        );

        return c.json({
          data: {
            ...result.updated,
            externalId: result.externalId,
          },
        });
      });
    },
  )
  .delete("/customers/:id", requireApiScope("customers:write"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await orgDb(apiKey.organizationId).transaction((o) =>
      resolveExternalResourceId(
        {
          organizationId: apiKey.organizationId,
          resourceType: "customer",
          value: c.req.param("id"),
        },
        o,
      ),
    );

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "customer_not_found",
          message: "Cliente não encontrado",
        }),
        404,
      );
    }

    return withIdempotentMutation(
      c,
      { customerId: resolvedId },
      async (ctx) => {
        const [existing] = await ctx.o
          .select()
          .from(customer)
          .where(
            and(
              eq(customer.id, resolvedId),
              eq(customer.labOrganizationId, apiKey.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        const externalId = await getResourceExternalId(
          {
            organizationId: apiKey.organizationId,
            resourceType: "customer",
            resourceId: existing.id,
          },
          ctx.o,
        );

        // Retention (decision Q16): a customer that still has regulated records
        // cannot be deleted (those foreign keys are RESTRICT); the refusal is
        // mapped below, after the rollback.
        await deleteLabCustomer(ctx, existing);

        await stagePublicApiWebhookEvent(ctx, {
          organizationId: apiKey.organizationId,
          eventType: "customer.deleted",
          payload: { id: existing.id, externalId },
        });

        return {
          status: 200,
          body: { data: { id: existing.id, deleted: true } },
          resourceType: "customer" as const,
          resourceId: existing.id,
        };
      },
      {
        mapError: (error) =>
          isReferencedRowViolation(error)
            ? {
                status: 409,
                body: buildPublicApiError({
                  code: "customer_has_retained_records",
                  message:
                    "Cliente possui registros regulados retidos e não pode ser excluído",
                }),
              }
            : null,
      },
    );
  });
