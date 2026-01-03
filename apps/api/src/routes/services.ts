import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  service,
  serviceAuditLog,
  calibrationMethod,
  assetType,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateServiceSchema,
  UpdateServiceSchema,
  ListServicesQuerySchema,
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { eq, and, or, ilike, desc, count } from "drizzle-orm";

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
export const servicesRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List services with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ service: ["read"] }),
    zValidator("query", ListServicesQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, query, assetTypeId, methodId, isActive } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      // Build conditions - always scope to organization
      const conditions = [eq(service.organizationId, member.organizationId)];

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

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(service)
        .where(whereCondition);

      // Get paginated data with joins
      const services = await db
        .select({
          id: service.id,
          name: service.name,
          description: service.description,
          methodId: service.methodId,
          methodName: calibrationMethod.name,
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

      return c.json({
        data: services,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      });
    },
  )

  // =========================================================================
  // GET /:id - Get single service by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ service: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID inválido" }, 400);
    }

    const [found] = await db
      .select({
        id: service.id,
        name: service.name,
        description: service.description,
        methodId: service.methodId,
        methodName: calibrationMethod.name,
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
        ),
      )
      .limit(1);

    if (!found) {
      return c.json({ error: "Serviço não encontrado" }, 404);
    }

    return c.json(found);
  })

  // =========================================================================
  // POST / - Create new service
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ service: ["create"] }),
    zValidator("json", CreateServiceSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      // If methodId is provided, validate it belongs to same organization
      // and auto-fill assetTypeId from method
      let finalAssetTypeId = input.assetTypeId;

      if (input.methodId) {
        const [method] = await db
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
          return c.json({ error: "Método não encontrado" }, 400);
        }

        // Warn if method is not published (but allow it)
        if (method.status !== "PUBLISHED") {
          // We allow linking to draft methods but the service should be inactive
          // until the method is published
        }

        // Auto-fill assetTypeId from method if not provided
        // If method has assetTypeId, it MUST match (enforced at API level)
        if (method.assetTypeId) {
          if (input.assetTypeId && input.assetTypeId !== method.assetTypeId) {
            return c.json(
              {
                error:
                  "Tipo de instrumento deve corresponder ao método selecionado",
              },
              400,
            );
          }
          finalAssetTypeId = method.assetTypeId;
        }
      }

      // Create the service
      const [newService] = await db
        .insert(service)
        .values({
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

      if (!newService) {
        return c.json({ error: "Falha ao criar serviço" }, 500);
      }

      // Audit log
      await db.insert(serviceAuditLog).values({
        serviceId: newService.id,
        action: "create",
        changes: { initial: input },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(newService, 201);
    },
  )

  // =========================================================================
  // PUT /:id - Update existing service
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ service: ["update"] }),
    zValidator("json", UpdateServiceSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      // Get existing service
      const [existing] = await db
        .select()
        .from(service)
        .where(
          and(
            eq(service.id, id),
            eq(service.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Serviço não encontrado" }, 404);
      }

      // If methodId is being changed, validate it
      let finalAssetTypeId = input.assetTypeId;

      if (input.methodId !== undefined) {
        if (input.methodId === null) {
          // Method is being removed, allow assetTypeId to be freely changed
          if (input.assetTypeId !== undefined) {
            finalAssetTypeId = input.assetTypeId;
          }
        } else {
          // Method is being set or changed
          const [method] = await db
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
            return c.json({ error: "Método não encontrado" }, 400);
          }

          // Enforce method's assetTypeId constraint
          if (method.assetTypeId) {
            if (input.assetTypeId && input.assetTypeId !== method.assetTypeId) {
              return c.json(
                {
                  error:
                    "Tipo de instrumento deve corresponder ao método selecionado",
                },
                400,
              );
            }
            finalAssetTypeId = method.assetTypeId;
          }
        }
      }

      // Build changes object for audit log
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      const updateData: Record<string, unknown> = {};

      // Check each field for changes
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
        changes.currency = { old: existing.currency, new: input.currency };
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
        changes.isActive = { old: existing.isActive, new: input.isActive };
        updateData.isActive = input.isActive;
      }

      // If no changes, return existing
      if (Object.keys(updateData).length === 0) {
        return c.json(existing);
      }

      // Update the service
      const [updated] = await db
        .update(service)
        .set(updateData)
        .where(eq(service.id, id))
        .returning();

      // Audit log
      await db.insert(serviceAuditLog).values({
        serviceId: id,
        action: "update",
        changes,
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // DELETE /:id - Deactivate service (soft delete)
  // =========================================================================
  .delete("/:id", ...withLabPermission({ service: ["delete"] }), async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID inválido" }, 400);
    }

    const [existing] = await db
      .select()
      .from(service)
      .where(
        and(
          eq(service.id, id),
          eq(service.organizationId, member.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json({ error: "Serviço não encontrado" }, 404);
    }

    // Soft delete - just deactivate
    // Never hard delete commercial data for financial audit trail
    const [updated] = await db
      .update(service)
      .set({ isActive: false })
      .where(eq(service.id, id))
      .returning();

    // Audit log
    await db.insert(serviceAuditLog).values({
      serviceId: id,
      action: "deactivate",
      changes: { isActive: { old: true, new: false } },
      performedBy: session.user.id,
      ipAddress: c.req.header("x-forwarded-for") || null,
    });

    return c.json({ message: "Serviço desativado com sucesso", data: updated });
  })

  // =========================================================================
  // GET /:id/audit-log - Get audit log for a service (ISO 17025 Clause 8.4)
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ service: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      // Verify service exists and belongs to organization
      const [existing] = await db
        .select({ id: service.id })
        .from(service)
        .where(
          and(
            eq(service.id, id),
            eq(service.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Serviço não encontrado" }, 404);
      }

      // Get audit logs with performer details
      const logs = await db
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

      return c.json({ data: logs });
    },
  );
