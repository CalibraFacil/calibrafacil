import { createRouter } from "../../../server/router";
import { serviceEndpoints } from "@calibra-facil/contracts";
import {
  service,
  serviceAuditLog,
  calibrationMethod,
  assetType,
  user,
} from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import { eq, and, or, ilike, desc, count } from "drizzle-orm";
import { buildUnitScopeCondition } from "../../../lib/units";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import { requireLabService, requireServiceRouteId } from "../service-access";

const PREFIX = "/api/services";

/**
 * Services Router - Commercial Service Catalog (Product Registry)
 *
 * Services are the "commercial wrapper" around technical Methods.
 * They define what the lab sells (pricing, turnaround time) and
 * link to the validated Method for technical execution.
 *
 * Permissions:
 * - GET /: service:read (all roles)
 * - GET /:id: service:read (all roles)
 * - POST /: service:create (admin, owner - LAB only)
 * - PUT /:id: service:update (admin, owner - LAB only)
 * - DELETE /:id: service:delete (admin, owner - LAB only) - soft delete
 */
export const servicesRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  servicesRouter,
  PREFIX,
  serviceEndpoints.list,
  async (
    c,
    { query: { page, limit, query, assetTypeId, methodId, isActive } },
  ) => {
    const member = c.get("member");
    const offset = (page - 1) * limit;

    const conditions = [
      eq(service.organizationId, member.organizationId),
      buildUnitScopeCondition(service.unitId, member),
    ];

    if (query) {
      conditions.push(
        or(
          ilike(service.name, `%${query}%`),
          ilike(service.description, `%${query}%`),
        )!,
      );
    }
    if (assetTypeId) {
      conditions.push(eq(service.assetTypeId, assetTypeId));
    }
    if (methodId) {
      conditions.push(eq(service.methodId, methodId));
    }
    if (isActive !== undefined) {
      conditions.push(eq(service.isActive, isActive));
    }

    const whereCondition = and(...conditions);

    const { countResult, services } = await orgDb(
      member.organizationId,
    ).transaction(async (o) => {
      const [total] = await o
        .select({ total: count() })
        .from(service)
        .where(whereCondition);

      const rows = await o
        .select({
          id: service.id,
          name: service.name,
          description: service.description,
          methodId: service.methodId,
          methodName: calibrationMethod.name,
          methodVersion: calibrationMethod.version,
          methodStatus: calibrationMethod.status,
          assetTypeId: service.assetTypeId,
          assetTypeName: assetType.name,
          price: service.price,
          currency: service.currency,
          tat: service.tat,
          isActive: service.isActive,
          createdAt: service.createdAt,
          updatedAt: service.updatedAt,
        })
        .from(service)
        .leftJoin(calibrationMethod, eq(service.methodId, calibrationMethod.id))
        .leftJoin(assetType, eq(service.assetTypeId, assetType.id))
        .where(whereCondition)
        .orderBy(desc(service.createdAt))
        .limit(limit)
        .offset(offset);

      return { countResult: total, services: rows };
    });

    return {
      data: services,
      pagination: {
        page,
        limit,
        total: countResult?.total ?? 0,
        totalPages: Math.ceil((countResult?.total ?? 0) / limit),
      },
    };
  },
);

// Not client-facing (the web builds a service label from `get`), so it stays a
// plain route outside the endpoint definitions.
servicesRouter.get(
  "/:id/label",
  ...withLabPermission({ service: ["read"] }),
  async (c) => {
    const member = c.get("member");

    return orgDb(member.organizationId).transaction(async (o) => {
      const id = await requireServiceRouteId(c.req.param("id"), member, o);

      const [found] = await o
        .select({
          id: service.id,
          label: service.name,
        })
        .from(service)
        .where(
          and(
            eq(service.id, id),
            eq(service.organizationId, member.organizationId),
            buildUnitScopeCondition(service.unitId, member),
          ),
        )
        .limit(1);

      if (!found) {
        throw notFound("service_not_found", "Serviço não encontrado");
      }

      return c.json(found);
    });
  },
);

mount(servicesRouter, PREFIX, serviceEndpoints.get, async (c, { params }) => {
  const member = c.get("member");

  return orgDb(member.organizationId).transaction(async (o) => {
    const id = await requireServiceRouteId(params.id, member, o);

    const [found] = await o
      .select({
        id: service.id,
        name: service.name,
        description: service.description,
        methodId: service.methodId,
        methodName: calibrationMethod.name,
        methodVersion: calibrationMethod.version,
        methodStatus: calibrationMethod.status,
        assetTypeId: service.assetTypeId,
        assetTypeName: assetType.name,
        price: service.price,
        currency: service.currency,
        tat: service.tat,
        isActive: service.isActive,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
      })
      .from(service)
      .leftJoin(calibrationMethod, eq(service.methodId, calibrationMethod.id))
      .leftJoin(assetType, eq(service.assetTypeId, assetType.id))
      .where(
        and(
          eq(service.id, id),
          eq(service.organizationId, member.organizationId),
          buildUnitScopeCondition(service.unitId, member),
        ),
      )
      .limit(1);

    if (!found) {
      throw notFound("service_not_found", "Serviço não encontrado");
    }

    return found;
  });
});

mount(
  servicesRouter,
  PREFIX,
  serviceEndpoints.create,
  async (c, { body: input }) => {
    const member = c.get("member");

    if (!member.activeUnitId) {
      throw invalid(
        "invalid_request",
        "Selecione uma unidade específica para criar serviços",
      );
    }
    const { activeUnitId } = member;

    const newService = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        // If methodId is provided, validate it belongs to same organization
        // and auto-fill assetTypeId from method
        let finalAssetTypeId = input.assetTypeId;

        if (input.methodId) {
          const [method] = await ctx.o
            .select({
              id: calibrationMethod.id,
              assetTypeId: calibrationMethod.assetTypeId,
              status: calibrationMethod.status,
            })
            .from(calibrationMethod)
            .where(
              and(
                eq(calibrationMethod.id, input.methodId),
                eq(calibrationMethod.organizationId, member.organizationId),
              ),
            )
            .limit(1);

          if (!method) {
            throw invalid("method_not_found", "Método não encontrado");
          }

          // A draft method may be linked (the service should stay inactive
          // until the method is published), so its status is not checked.

          // Auto-fill assetTypeId from method if not provided
          // If method has assetTypeId, it MUST match (enforced at API level)
          if (method.assetTypeId) {
            if (input.assetTypeId && input.assetTypeId !== method.assetTypeId) {
              throw invalid(
                "method_asset_type_mismatch",
                "Tipo de instrumento deve corresponder ao método selecionado",
              );
            }
            finalAssetTypeId = method.assetTypeId;
          }
        }

        const [created] = await ctx.o
          .insert(service)
          .values({
            unitId: activeUnitId,
            organizationId: member.organizationId,
            name: input.name,
            description: input.description || null,
            methodId: input.methodId || null,
            assetTypeId: finalAssetTypeId || null,
            price: input.price ?? null,
            currency: input.currency || "BRL",
            tat: input.tat ?? null,
            isActive: input.isActive ?? true,
          })
          .returning();

        if (!created) throw new Error("Falha ao criar serviço");

        await ctx.audit("service", created.id, {
          action: "create",
          changes: { initial: input },
        });

        return created;
      },
    );

    return newService;
  },
);

mount(
  servicesRouter,
  PREFIX,
  serviceEndpoints.update,
  async (c, { params, body: input }) => {
    const member = c.get("member");

    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabService(params.id, member, ctx.o);
        const id = existing.id;

        let finalAssetTypeId = input.assetTypeId;

        if (input.methodId !== undefined) {
          if (input.methodId === null) {
            // Method is being removed, allow assetTypeId to be freely changed
            if (input.assetTypeId !== undefined) {
              finalAssetTypeId = input.assetTypeId;
            }
          } else {
            const [method] = await ctx.o
              .select({
                id: calibrationMethod.id,
                assetTypeId: calibrationMethod.assetTypeId,
                status: calibrationMethod.status,
              })
              .from(calibrationMethod)
              .where(
                and(
                  eq(calibrationMethod.id, input.methodId),
                  eq(calibrationMethod.organizationId, member.organizationId),
                ),
              )
              .limit(1);

            if (!method) {
              throw invalid("method_not_found", "Método não encontrado");
            }

            if (method.assetTypeId) {
              if (
                input.assetTypeId &&
                input.assetTypeId !== method.assetTypeId
              ) {
                throw invalid(
                  "method_asset_type_mismatch",
                  "Tipo de instrumento deve corresponder ao método selecionado",
                );
              }
              finalAssetTypeId = method.assetTypeId;
            }
          }
        }

        const changes: Record<string, { old: unknown; new: unknown }> = {};
        const updateData: Record<string, unknown> = {};

        if (input.name !== undefined && input.name !== existing.name) {
          changes.name = { old: existing.name, new: input.name };
          updateData.name = input.name;
        }
        if (
          input.description !== undefined &&
          input.description !== existing.description
        ) {
          changes.description = {
            old: existing.description,
            new: input.description,
          };
          updateData.description = input.description;
        }
        if (
          input.methodId !== undefined &&
          input.methodId !== existing.methodId
        ) {
          changes.methodId = { old: existing.methodId, new: input.methodId };
          updateData.methodId = input.methodId;
        }
        if (
          finalAssetTypeId !== undefined &&
          finalAssetTypeId !== existing.assetTypeId
        ) {
          changes.assetTypeId = {
            old: existing.assetTypeId,
            new: finalAssetTypeId,
          };
          updateData.assetTypeId = finalAssetTypeId;
        }
        if (input.price !== undefined && input.price !== existing.price) {
          changes.price = { old: existing.price, new: input.price };
          updateData.price = input.price;
        }
        if (
          input.currency !== undefined &&
          input.currency !== existing.currency
        ) {
          changes.currency = {
            old: existing.currency,
            new: input.currency,
          };
          updateData.currency = input.currency;
        }
        if (input.tat !== undefined && input.tat !== existing.tat) {
          changes.tat = { old: existing.tat, new: input.tat };
          updateData.tat = input.tat;
        }
        if (
          input.isActive !== undefined &&
          input.isActive !== existing.isActive
        ) {
          changes.isActive = {
            old: existing.isActive,
            new: input.isActive,
          };
          updateData.isActive = input.isActive;
        }

        if (Object.keys(updateData).length === 0) {
          return existing;
        }

        const [updated] = await ctx.o
          .update(service)
          .set(updateData)
          .where(eq(service.id, id))
          .returning();

        await ctx.audit("service", id, { action: "update", changes });

        if (!updated)
          throw notFound("service_not_found", "Serviço não encontrado");
        return updated;
      },
    );

    return result;
  },
);

mount(
  servicesRouter,
  PREFIX,
  serviceEndpoints.deactivate,
  async (c, { params }) => {
    const member = c.get("member");

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabService(params.id, member, ctx.o);
        const id = existing.id;

        // Soft delete - just deactivate
        // Never hard delete commercial data for financial audit trail
        const [deactivated] = await ctx.o
          .update(service)
          .set({ isActive: false })
          .where(eq(service.id, id))
          .returning();

        await ctx.audit("service", id, {
          action: "deactivate",
          changes: { isActive: { old: true, new: false } },
        });

        if (!deactivated)
          throw notFound("service_not_found", "Serviço não encontrado");
        return deactivated;
      },
    );

    return {
      message: "Serviço desativado com sucesso",
      data: updated,
    };
  },
);

mount(
  servicesRouter,
  PREFIX,
  serviceEndpoints.auditLog,
  async (c, { params }) => {
    const member = c.get("member");
    return orgDb(member.organizationId).transaction(async (o) => {
      const id = await requireServiceRouteId(params.id, member, o);

      const [existing] = await o
        .select({ id: service.id })
        .from(service)
        .where(
          and(
            eq(service.id, id),
            eq(service.organizationId, member.organizationId),
            buildUnitScopeCondition(service.unitId, member),
          ),
        )
        .limit(1);

      if (!existing) {
        throw notFound("service_not_found", "Serviço não encontrado");
      }

      const logs = await o
        .select({
          id: serviceAuditLog.id,
          action: serviceAuditLog.action,
          changes: serviceAuditLog.changes,
          performedAt: serviceAuditLog.performedAt,
          performedBy: serviceAuditLog.performedBy,
          performerName: user.name,
          ipAddress: serviceAuditLog.ipAddress,
          reason: serviceAuditLog.reason,
        })
        .from(serviceAuditLog)
        .leftJoin(user, eq(serviceAuditLog.performedBy, user.id))
        .where(eq(serviceAuditLog.serviceId, id))
        .orderBy(desc(serviceAuditLog.performedAt));

      return { data: logs };
    });
  },
);
