import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  asset,
  assetAuditLog,
  customer,
  customerAuditLog,
  organization,
} from "@calibra-facil/db/schema";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from "@calibra-facil/schemas";
import { and, count, eq, ilike, or } from "drizzle-orm";
import {
  buildListMeta,
  buildPublicApiError,
  getPublicApiRequestIp,
  getResourceExternalId,
  getResourceExternalIdMap,
  upsertResourceExternalId,
} from "../../lib/public-api";
import {
  stagePublicApiWebhookEvent,
  withPublicApiWebhookTransaction,
} from "../../lib/public-api-webhooks";
import { isReferencedRowViolation } from "../../lib/db-errors";
import { orgDb } from "../../lib/org-db";
import { requireApiScope } from "../../middleware/api-key-auth";
import { createClientOrganizationAsServiceOwner } from "../../lib/portal-service-account";
import { type PublicApiV2Env } from "./env";
import { ListQuerySchema } from "./schemas";
import { resolveExternalResourceId } from "./resolvers";
import {
  withIdempotentMutation,
  withPreparedIdempotentMutation,
} from "./idempotency";
import { generateUniqueSlug } from "./helpers";

export const customerRoutes = new Hono<PublicApiV2Env>()
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
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "customer",
      value: c.req.param("id"),
    });

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
        () =>
          createClientOrganizationAsServiceOwner({
            name: input.name,
            slug: generateUniqueSlug(input.name),
          }),
        async ({ o, tx, afterCommit }, orgResult) => {
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
          // together (and with the idempotency record).
          const [created] = await o
            .insert(customer)
            .values({
              name: input.name,
              taxId: input.taxId || null,
              email: input.email || null,
              phone: input.phone || null,
              address: input.address || null,
              authOrganizationId: orgResult.id,
              labOrganizationId: apiKey.organizationId,
            })
            .returning();

          await o.insert(customerAuditLog).values({
            organizationId: apiKey.organizationId,
            customerId: created!.id,
            action: "create",
            changes: { customer: { old: null, new: created } },
            performedBy: apiKey.createdBy,
            ipAddress: getPublicApiRequestIp(c),
          });

          if (externalId) {
            await upsertResourceExternalId(
              {
                organizationId: apiKey.organizationId,
                apiKeyId: apiKey.id,
                resourceType: "customer",
                resourceId: created!.id,
                externalId,
              },
              o,
            );
          }

          const body = {
            data: {
              ...created,
              externalId: externalId ?? null,
            },
          };

          await stagePublicApiWebhookEvent(
            { o, tx, afterCommit },
            {
              organizationId: apiKey.organizationId,
              eventType: "customer.created",
              payload: body.data,
            },
          );

          return {
            status: 201,
            body,
            resourceType: "customer" as const,
            resourceId: created!.id,
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
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "customer",
        value: c.req.param("id"),
      });

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
      const result = await withPublicApiWebhookTransaction(
        apiKey.organizationId,
        async (o, webhooks) => {
          const [existing] = await o
            .select()
            .from(customer)
            .where(
              and(
                eq(customer.id, resolvedId),
                eq(customer.labOrganizationId, apiKey.organizationId),
              ),
            )
            .limit(1);
          if (!existing) return null;

          const [updated] = await o
            .update(customer)
            .set({
              name: input.name ?? existing.name,
              taxId: input.taxId ?? existing.taxId,
              email: input.email ?? existing.email,
              phone: input.phone ?? existing.phone,
              address: input.address ?? existing.address,
            })
            .where(eq(customer.id, existing.id))
            .returning();

          await o.insert(customerAuditLog).values({
            organizationId: apiKey.organizationId,
            customerId: existing.id,
            action: "update",
            changes: { customer: { old: existing, new: updated } },
            performedBy: apiKey.createdBy,
            ipAddress: getPublicApiRequestIp(c),
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
              o,
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
              o,
            ));
          // The event is queued with the update and goes out after it commits.
          await stagePublicApiWebhookEvent(webhooks, {
            organizationId: apiKey.organizationId,
            eventType: "customer.updated",
            payload: { ...updated, externalId: resolvedExternalId },
          });

          return { updated, externalId: resolvedExternalId };
        },
      );

      if (!result) {
        return c.json(
          buildPublicApiError({
            code: "customer_not_found",
            message: "Cliente não encontrado",
          }),
          404,
        );
      }

      const body = {
        data: {
          ...result.updated,
          externalId: result.externalId,
        },
      };

      return c.json(body);
    },
  )
  .delete("/customers/:id", requireApiScope("customers:write"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "customer",
      value: c.req.param("id"),
    });

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
      async ({ o, tx, afterCommit }) => {
        const [existing] = await o
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

        const ipAddress = getPublicApiRequestIp(c);

        // Retention (decision Q16): a customer that still has regulated records
        // cannot be deleted (those foreign keys are RESTRICT). The audit rows
        // share the transaction, so a refused delete rolls them back and
        // leaves no "delete" entry behind (the refusal is mapped below, after
        // the rollback).
        await o.insert(customerAuditLog).values({
          organizationId: apiKey.organizationId,
          customerId: existing.id,
          action: "delete",
          changes: { customer: { old: existing, new: null } },
          performedBy: apiKey.createdBy,
          ipAddress,
        });

        // CMP-07 (#692): deleting the customer cascades its assets
        // (asset.customer_id → customer, intentional). Record a 'delete' audit row
        // for EACH asset first — the asset_audit_log.asset_id FK no longer cascades,
        // so these rows survive the delete and the ISO/IEC 17025 trail is preserved.
        const customerAssets = await o
          .select()
          .from(asset)
          .where(eq(asset.customerId, existing.id));
        if (customerAssets.length > 0) {
          await o.insert(assetAuditLog).values(
            customerAssets.map((assetRow) => ({
              organizationId: apiKey.organizationId,
              assetId: assetRow.id,
              action: "delete",
              changes: { asset: { old: assetRow, new: null } },
              performedBy: apiKey.createdBy,
              ipAddress,
              reason: "Cliente excluído",
            })),
          );
        }

        const externalId = await getResourceExternalId(
          {
            organizationId: apiKey.organizationId,
            resourceType: "customer",
            resourceId: existing.id,
          },
          o,
        );

        await o.delete(customer).where(eq(customer.id, existing.id));
        await o
          .delete(organization)
          .where(eq(organization.id, existing.authOrganizationId));

        await stagePublicApiWebhookEvent(
          { o, tx, afterCommit },
          {
            organizationId: apiKey.organizationId,
            eventType: "customer.deleted",
            payload: { id: existing.id, externalId },
          },
        );

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
