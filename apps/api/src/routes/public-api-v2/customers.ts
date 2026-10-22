import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
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
  emitPublicApiWebhookEvent,
  getPublicApiRequestIp,
  getResourceExternalId,
  getResourceExternalIdMap,
  upsertResourceExternalId,
} from "../../lib/public-api";
import { isReferencedRowViolation } from "../../lib/db-errors";
import { requireApiScope } from "../../middleware/api-key-auth";
import { createClientOrganizationAsServiceOwner } from "../../lib/portal-service-account";
import { type PublicApiV2Env } from "./env";
import { ListQuerySchema } from "./schemas";
import { resolveExternalResourceId } from "./resolvers";
import { withIdempotentMutation } from "./idempotency";
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

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(customer)
          .where(and(...conditions)),
        db
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

      const externalIds = await getResourceExternalIdMap({
        organizationId: apiKey.organizationId,
        resourceType: "customer",
        resourceIds: rows.map((row) => row.id),
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

    const [found] = await db
      .select()
      .from(customer)
      .where(
        and(
          eq(customer.id, resolvedId),
          eq(customer.labOrganizationId, apiKey.organizationId),
        ),
      )
      .limit(1);

    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "customer_not_found",
          message: "Cliente não encontrado",
        }),
        404,
      );
    }

    return c.json({
      data: {
        ...found,
        externalId: await getResourceExternalId({
          organizationId: apiKey.organizationId,
          resourceType: "customer",
          resourceId: found.id,
        }),
      },
    });
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

      return withIdempotentMutation(c, input, async () => {
        const slug = generateUniqueSlug(input.name);
        const orgResult = await createClientOrganizationAsServiceOwner({
          name: input.name,
          slug,
        });

        if (!orgResult?.id) {
          return {
            status: 500,
            body: buildPublicApiError({
              code: "customer_create_failed",
              message: "Falha ao criar organização do cliente",
            }),
          };
        }

        const [created] = await db
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

        await db.insert(customerAuditLog).values({
          organizationId: apiKey.organizationId,
          customerId: created!.id,
          action: "create",
          changes: { customer: { old: null, new: created } },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
        });

        const externalId = input.externalId?.trim();
        if (externalId) {
          await upsertResourceExternalId({
            organizationId: apiKey.organizationId,
            apiKeyId: apiKey.id,
            resourceType: "customer",
            resourceId: created!.id,
            externalId,
          });
        }

        const body = {
          data: {
            ...created,
            externalId: externalId ?? null,
          },
        };

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "customer.created",
          payload: body.data,
          env: c.env,
        });

        return {
          status: 201,
          body,
          resourceType: "customer" as const,
          resourceId: created!.id,
        };
      });
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

      const [existing] = await db
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
        return c.json(
          buildPublicApiError({
            code: "customer_not_found",
            message: "Cliente não encontrado",
          }),
          404,
        );
      }

      const [updated] = await db
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

      await db.insert(customerAuditLog).values({
        organizationId: apiKey.organizationId,
        customerId: existing.id,
        action: "update",
        changes: { customer: { old: existing, new: updated } },
        performedBy: apiKey.createdBy,
        ipAddress: getPublicApiRequestIp(c.req.raw.headers),
      });

      const externalId = input.externalId?.trim();
      if (externalId) {
        await upsertResourceExternalId({
          organizationId: apiKey.organizationId,
          apiKeyId: apiKey.id,
          resourceType: "customer",
          resourceId: existing.id,
          externalId,
        });
      }

      const body = {
        data: {
          ...updated,
          externalId:
            externalId ??
            (await getResourceExternalId({
              organizationId: apiKey.organizationId,
              resourceType: "customer",
              resourceId: existing.id,
            })),
        },
      };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "customer.updated",
        payload: body.data,
        env: c.env,
      });

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

    return withIdempotentMutation(c, { customerId: resolvedId }, async () => {
      const [existing] = await db
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

      const ipAddress = getPublicApiRequestIp(c.req.raw.headers);

      // Retention (decision Q16): a customer that still has regulated records
      // cannot be deleted (those foreign keys are RESTRICT). The audit rows share
      // the transaction, so a refused delete leaves no "delete" entry behind.
      try {
        await db.transaction(async (tx) => {
          await tx.insert(customerAuditLog).values({
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
          const customerAssets = await tx
            .select()
            .from(asset)
            .where(eq(asset.customerId, existing.id));
          if (customerAssets.length > 0) {
            await tx.insert(assetAuditLog).values(
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

          await tx.delete(customer).where(eq(customer.id, existing.id));
          await tx
            .delete(organization)
            .where(eq(organization.id, existing.authOrganizationId));
        });
      } catch (error) {
        if (isReferencedRowViolation(error)) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "customer_has_retained_records",
              message:
                "Cliente possui registros regulados retidos e não pode ser excluído",
            }),
          };
        }
        throw error;
      }

      const body = { data: { id: existing.id, deleted: true } };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "customer.deleted",
        payload: {
          id: existing.id,
          externalId: await getResourceExternalId({
            organizationId: apiKey.organizationId,
            resourceType: "customer",
            resourceId: existing.id,
          }),
        },
        env: c.env,
      });

      return {
        status: 200,
        body,
        resourceType: "customer" as const,
        resourceId: existing.id,
      };
    });
  });
