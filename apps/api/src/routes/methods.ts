import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  calibrationMethod,
  methodAuditLog,
  assetType,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateMethodSchema,
  UpdateMethodSchema,
  ListMethodsQuerySchema,
  ReturnMethodToDraftSchema,
} from "@calibra-facil/schemas";
import { eq, and, ilike, or, count, desc, ne } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
  requireRole,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import { withCache, withInvalidation } from "../middleware/cache";
import { CACHE_TTL } from "../lib/cache";
import { alias } from "drizzle-orm/pg-core";
import {
  buildMethodRouteIdentifier,
  parseLegacyNumericIdentifier,
} from "../lib/route-identifiers";

const technicalReviewerUser = alias(user, "technicalReviewerUser");
const approverUser = alias(user, "approverUser");

async function resolveMethodRouteId(
  identifier: string,
  organizationId: string,
): Promise<number | null> {
  const legacyId = parseLegacyNumericIdentifier(identifier);

  if (legacyId) {
    const [method] = await db
      .select({ id: calibrationMethod.id })
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.id, legacyId),
          eq(calibrationMethod.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (method) return method.id;
  }

  const methods = await db
    .select({
      id: calibrationMethod.id,
      name: calibrationMethod.name,
      version: calibrationMethod.version,
    })
    .from(calibrationMethod)
    .where(eq(calibrationMethod.organizationId, organizationId));

  return (
    methods.find((method) => buildMethodRouteIdentifier(method) === identifier)
      ?.id ?? null
  );
}

export const methodsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List methods with filtering and pagination
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ template: ["read"] }),
    withCache("methods", CACHE_TTL.referenceData),
    zValidator("query", ListMethodsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, status, assetTypeId, query, includeArchived } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      try {
        // Build where conditions
        const conditions = [
          eq(calibrationMethod.organizationId, member.organizationId),
        ];

        if (status) {
          conditions.push(eq(calibrationMethod.status, status));
        } else if (!includeArchived) {
          conditions.push(ne(calibrationMethod.status, "ARCHIVED"));
        }

        if (assetTypeId) {
          conditions.push(eq(calibrationMethod.assetTypeId, assetTypeId));
        }

        if (query) {
          conditions.push(
            or(
              ilike(calibrationMethod.name, `%${query}%`),
              ilike(calibrationMethod.description, `%${query}%`),
            )!,
          );
        }

        const whereCondition = and(...conditions);

        // Get total count
        const [countResult] = await db
          .select({ total: count() })
          .from(calibrationMethod)
          .where(whereCondition);

        const total = countResult?.total ?? 0;

        // Get methods with related data
        const methods = await db
          .select({
            id: calibrationMethod.id,
            name: calibrationMethod.name,
            description: calibrationMethod.description,
            version: calibrationMethod.version,
            status: calibrationMethod.status,
            assetTypeId: calibrationMethod.assetTypeId,
            assetTypeName: assetType.name,
            dataFields: calibrationMethod.dataFields,
            formulas: calibrationMethod.formulas,
            validations: calibrationMethod.validations,
            certificateContent: calibrationMethod.certificateContent,
            createdAt: calibrationMethod.createdAt,
            publishedAt: calibrationMethod.publishedAt,
            parentId: calibrationMethod.parentId,
          })
          .from(calibrationMethod)
          .leftJoin(assetType, eq(calibrationMethod.assetTypeId, assetType.id))
          .where(whereCondition)
          .orderBy(desc(calibrationMethod.createdAt))
          .limit(limit)
          .offset(offset);

        return c.json({
          data: methods,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        console.error("Error listing methods:", error);
        return c.json({ error: "Erro ao listar métodos" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/label - Get method label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ template: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      const [method] = await db
        .select({
          id: calibrationMethod.id,
          label: calibrationMethod.name,
        })
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!method) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      return c.json(method);
    },
  )

  // =========================================================================
  // GET /:id - Get a single method by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ template: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = await resolveMethodRouteId(
      c.req.param("id"),
      member.organizationId,
    );

    if (id === null) {
      return c.json({ error: "Método nao encontrado" }, 404);
    }

    try {
      const [method] = await db
        .select({
          id: calibrationMethod.id,
          organizationId: calibrationMethod.organizationId,
          name: calibrationMethod.name,
          description: calibrationMethod.description,
          version: calibrationMethod.version,
          status: calibrationMethod.status,
          assetTypeId: calibrationMethod.assetTypeId,
          assetTypeName: assetType.name,
          dataFields: calibrationMethod.dataFields,
          formulas: calibrationMethod.formulas,
          validations: calibrationMethod.validations,
          uncertaintyParams: calibrationMethod.uncertaintyParams,
          certificateContent: calibrationMethod.certificateContent,
          parentId: calibrationMethod.parentId,
          createdAt: calibrationMethod.createdAt,
          createdByName: user.name,
          technicalReviewedBy: calibrationMethod.technicalReviewedBy,
          technicalReviewedByName: technicalReviewerUser.name,
          publishedAt: calibrationMethod.publishedAt,
          approvedBy: calibrationMethod.approvedBy,
          approvedByName: approverUser.name,
          archivedAt: calibrationMethod.archivedAt,
        })
        .from(calibrationMethod)
        .leftJoin(assetType, eq(calibrationMethod.assetTypeId, assetType.id))
        .leftJoin(user, eq(calibrationMethod.createdBy, user.id))
        .leftJoin(
          technicalReviewerUser,
          eq(calibrationMethod.technicalReviewedBy, technicalReviewerUser.id),
        )
        .leftJoin(
          approverUser,
          eq(calibrationMethod.approvedBy, approverUser.id),
        )
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!method) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      return c.json(method);
    } catch (error) {
      console.error("Error getting method:", error);
      return c.json({ error: "Erro ao buscar método" }, 500);
    }
  })

  // =========================================================================
  // POST / - Create a new method (always DRAFT)
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ template: ["create"] }),
    withInvalidation("methods"),
    zValidator("json", CreateMethodSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      try {
        // Check for duplicate name in same org (version 1)
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, input.name),
              eq(calibrationMethod.version, 1),
            ),
          )
          .limit(1);

        if (existing) {
          return c.json({ error: "Ja existe um método com este nome" }, 400);
        }

        // Create method
        const [newMethod] = await db
          .insert(calibrationMethod)
          .values({
            organizationId: member.organizationId,
            assetTypeId: input.assetTypeId || null,
            name: input.name,
            description: input.description || null,
            version: 1,
            status: "DRAFT",
            dataFields: input.dataFields,
            variableBindings: input.variableBindings,
            formulas: input.formulas,
            validations: input.validations,
            uncertaintyParams: input.uncertaintyParams,
            certificateContent: input.certificateContent ?? null,
            createdBy: session.user.id,
          })
          .returning();

        if (!newMethod) {
          return c.json({ error: "Erro ao criar método" }, 500);
        }

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: newMethod.id,
          action: "create",
          changes: { initial: input },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(newMethod, 201);
      } catch (error) {
        console.error("Error creating method:", error);
        return c.json({ error: "Erro ao criar método" }, 500);
      }
    },
  )

  // =========================================================================
  // PUT /:id - Update a DRAFT method
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ template: ["update"] }),
    withInvalidation("methods"),
    zValidator("json", UpdateMethodSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        // Get existing method
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        // Only DRAFT can be updated
        if (existing.status !== "DRAFT") {
          return c.json(
            { error: "Apenas métodos em rascunho podem ser editados" },
            400,
          );
        }

        // Check for name conflict if name is being changed
        // Check against all versions to prevent naming conflicts
        if (input.name && input.name !== existing.name) {
          const [duplicate] = await db
            .select()
            .from(calibrationMethod)
            .where(
              and(
                eq(calibrationMethod.organizationId, member.organizationId),
                eq(calibrationMethod.name, input.name),
                ne(calibrationMethod.id, id),
              ),
            )
            .limit(1);

          if (duplicate) {
            return c.json({ error: "Ja existe um método com este nome" }, 400);
          }
        }

        // Build update object
        const updateData: Record<string, unknown> = {};
        const changes: Record<string, { old: unknown; new: unknown }> = {};

        if (input.name !== undefined && input.name !== existing.name) {
          updateData.name = input.name;
          changes.name = { old: existing.name, new: input.name };
        }
        if (input.description !== undefined) {
          updateData.description = input.description || null;
          changes.description = {
            old: existing.description,
            new: input.description,
          };
        }
        if (input.assetTypeId !== undefined) {
          updateData.assetTypeId = input.assetTypeId || null;
          changes.assetTypeId = {
            old: existing.assetTypeId,
            new: input.assetTypeId,
          };
        }
        if (input.dataFields !== undefined) {
          updateData.dataFields = input.dataFields;
          changes.dataFields = {
            old: existing.dataFields,
            new: input.dataFields,
          };
        }
        if (input.variableBindings !== undefined) {
          updateData.variableBindings = input.variableBindings;
          changes.variableBindings = {
            old: existing.variableBindings,
            new: input.variableBindings,
          };
        }
        if (input.formulas !== undefined) {
          updateData.formulas = input.formulas;
          changes.formulas = { old: existing.formulas, new: input.formulas };
        }
        if (input.validations !== undefined) {
          updateData.validations = input.validations;
          changes.validations = {
            old: existing.validations,
            new: input.validations,
          };
        }
        if (input.uncertaintyParams !== undefined) {
          updateData.uncertaintyParams = input.uncertaintyParams;
          changes.uncertaintyParams = {
            old: existing.uncertaintyParams,
            new: input.uncertaintyParams,
          };
        }
        if (input.certificateContent !== undefined) {
          updateData.certificateContent = input.certificateContent;
          changes.certificateContent = {
            old: existing.certificateContent,
            new: input.certificateContent,
          };
        }

        if (Object.keys(updateData).length === 0) {
          return c.json(existing);
        }

        // Update method
        const [updated] = await db
          .update(calibrationMethod)
          .set(updateData)
          .where(eq(calibrationMethod.id, id))
          .returning();

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "update",
          changes,
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(updated);
      } catch (error) {
        console.error("Error updating method:", error);
        return c.json({ error: "Erro ao atualizar método" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/request-approval - Submit method for approval
  // =========================================================================
  .post(
    "/:id/request-approval",
    ...withLabPermission({ template: ["update"] }),
    requireFeature("approval_workflow"),
    withInvalidation("methods"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "DRAFT") {
          return c.json(
            { error: "Apenas rascunhos podem ser enviados para aprovacao" },
            400,
          );
        }

        // Validate method has required fields
        if (!existing.dataFields || existing.dataFields.length === 0) {
          return c.json(
            { error: "Método deve ter pelo menos um campo de entrada" },
            400,
          );
        }

        const [updated] = await db
          .update(calibrationMethod)
          .set({
            status: "PENDING_APPROVAL",
            technicalReviewedBy: null,
            approvedBy: null,
            publishedAt: null,
            publishedBy: null,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "request_approval",
          changes: { status: { old: "DRAFT", new: "PENDING_APPROVAL" } },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(updated);
      } catch (error) {
        console.error("Error requesting method approval:", error);
        return c.json({ error: "Erro ao solicitar aprovacao" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/technical-review - Technical review (admin only)
  // =========================================================================
  .post(
    "/:id/technical-review",
    ...withLabPermission({ template: ["publish"] }),
    requireFeature("approval_workflow"),
    requireRole(["admin"]),
    withInvalidation("methods"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "PENDING_APPROVAL") {
          return c.json(
            { error: "Apenas métodos pendentes podem ser revisados" },
            400,
          );
        }

        const [updated] = await db
          .update(calibrationMethod)
          .set({
            status: "TECHNICAL_REVIEWED",
            technicalReviewedBy: session.user.id,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "technical_review",
          changes: {
            status: { old: "PENDING_APPROVAL", new: "TECHNICAL_REVIEWED" },
            technicalReviewedBy: { old: null, new: session.user.id },
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(updated);
      } catch (error) {
        console.error("Error technical reviewing method:", error);
        return c.json({ error: "Erro ao revisar tecnicamente" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/quality-approve - Quality approval (owner only)
  // =========================================================================
  .post(
    "/:id/quality-approve",
    ...withLabPermission({ template: ["publish"] }),
    requireFeature("approval_workflow"),
    requireRole(["owner"]),
    withInvalidation("methods"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "TECHNICAL_REVIEWED") {
          return c.json(
            { error: "Apenas métodos revisados podem ser aprovados" },
            400,
          );
        }

        if (!existing.technicalReviewedBy) {
          return c.json(
            { error: "Revisao tecnica obrigatoria antes da aprovacao" },
            400,
          );
        }

        if (existing.technicalReviewedBy === session.user.id) {
          return c.json(
            {
              error:
                "Revisao tecnica e aprovacao de qualidade devem ser feitas por usuarios diferentes",
            },
            400,
          );
        }

        // Validate method has required fields
        if (!existing.dataFields || existing.dataFields.length === 0) {
          return c.json(
            { error: "Método deve ter pelo menos um campo de entrada" },
            400,
          );
        }

        // Archive any previously published version with same name
        await db
          .update(calibrationMethod)
          .set({
            status: "ARCHIVED",
            archivedAt: new Date(),
          })
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              eq(calibrationMethod.status, "PUBLISHED"),
              ne(calibrationMethod.id, id),
            ),
          );

        const [published] = await db
          .update(calibrationMethod)
          .set({
            status: "PUBLISHED",
            publishedAt: new Date(),
            publishedBy: session.user.id,
            approvedBy: session.user.id,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "quality_approve",
          changes: { status: { old: "TECHNICAL_REVIEWED", new: "PUBLISHED" } },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(published);
      } catch (error) {
        console.error("Error quality approving method:", error);
        return c.json({ error: "Erro ao aprovar qualidade" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/return-to-draft - Return method to draft (admin/owner)
  // =========================================================================
  .post(
    "/:id/return-to-draft",
    ...withLabPermission({ template: ["update"] }),
    requireFeature("approval_workflow"),
    requireRole(["admin", "owner"]),
    withInvalidation("methods"),
    zValidator("json", ReturnMethodToDraftSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );
      const { reason } = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (
          existing.status !== "PENDING_APPROVAL" &&
          existing.status !== "TECHNICAL_REVIEWED"
        ) {
          return c.json(
            { error: "Apenas métodos em aprovacao podem retornar ao rascunho" },
            400,
          );
        }

        const [updated] = await db
          .update(calibrationMethod)
          .set({
            status: "DRAFT",
            technicalReviewedBy: null,
            approvedBy: null,
            publishedAt: null,
            publishedBy: null,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "return_to_draft",
          changes: { status: { old: existing.status, new: "DRAFT" } },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
          reason,
        });

        return c.json(updated);
      } catch (error) {
        console.error("Error returning method to draft:", error);
        return c.json({ error: "Erro ao retornar para rascunho" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/publish - Publish a TECHNICAL_REVIEWED method (compat)
  // =========================================================================
  .post(
    "/:id/publish",
    ...withLabPermission({ template: ["publish"] }),
    requireFeature("approval_workflow"),
    requireRole(["owner"]),
    withInvalidation("methods"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "TECHNICAL_REVIEWED") {
          return c.json(
            { error: "Apenas métodos revisados podem ser publicados" },
            400,
          );
        }

        if (!existing.technicalReviewedBy) {
          return c.json(
            { error: "Revisao tecnica obrigatoria antes da publicacao" },
            400,
          );
        }

        if (existing.technicalReviewedBy === session.user.id) {
          return c.json(
            {
              error:
                "Revisao tecnica e publicacao devem ser feitas por usuarios diferentes",
            },
            400,
          );
        }

        // Validate method has required fields
        if (!existing.dataFields || existing.dataFields.length === 0) {
          return c.json(
            { error: "Método deve ter pelo menos um campo de entrada" },
            400,
          );
        }

        // Archive any previously published version with same name
        await db
          .update(calibrationMethod)
          .set({
            status: "ARCHIVED",
            archivedAt: new Date(),
          })
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              eq(calibrationMethod.status, "PUBLISHED"),
              ne(calibrationMethod.id, id),
            ),
          );

        // Publish
        const [published] = await db
          .update(calibrationMethod)
          .set({
            status: "PUBLISHED",
            publishedAt: new Date(),
            publishedBy: session.user.id,
            approvedBy: session.user.id,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "publish",
          changes: { status: { old: "TECHNICAL_REVIEWED", new: "PUBLISHED" } },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(published);
      } catch (error) {
        console.error("Error publishing method:", error);
        return c.json({ error: "Erro ao publicar método" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/archive - Archive a PUBLISHED method
  // =========================================================================
  .post(
    "/:id/archive",
    ...withLabPermission({ template: ["update"] }),
    withInvalidation("methods"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "PUBLISHED") {
          return c.json(
            { error: "Apenas métodos publicados podem ser arquivados" },
            400,
          );
        }

        const [archived] = await db
          .update(calibrationMethod)
          .set({
            status: "ARCHIVED",
            archivedAt: new Date(),
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "archive",
          changes: { status: { old: "PUBLISHED", new: "ARCHIVED" } },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(archived);
      } catch (error) {
        console.error("Error archiving method:", error);
        return c.json({ error: "Erro ao arquivar método" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/new-version - Create new DRAFT from PUBLISHED (versioning)
  // =========================================================================
  .post(
    "/:id/new-version",
    ...withLabPermission({ template: ["create"] }),
    withInvalidation("methods"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "PUBLISHED") {
          return c.json(
            {
              error:
                "Novas versoes so podem ser criadas a partir de métodos publicados",
            },
            400,
          );
        }

        // Check if there's already a draft for this method
        const [existingDraft] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              eq(calibrationMethod.status, "DRAFT"),
            ),
          )
          .limit(1);

        if (existingDraft) {
          return c.json(
            {
              error:
                "Ja existe um rascunho para este método. Edite o rascunho existente ou exclua-o antes de criar uma nova versão.",
              existingDraftId: existingDraft.id,
            },
            400,
          );
        }

        // Find the highest version number
        const [maxVersion] = await db
          .select({ maxVersion: calibrationMethod.version })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
            ),
          )
          .orderBy(desc(calibrationMethod.version))
          .limit(1);

        const newVersion = (maxVersion?.maxVersion || existing.version) + 1;

        // Clone the method
        const [newMethod] = await db
          .insert(calibrationMethod)
          .values({
            organizationId: member.organizationId,
            assetTypeId: existing.assetTypeId,
            name: existing.name,
            description: existing.description,
            version: newVersion,
            status: "DRAFT",
            dataFields: existing.dataFields,
            formulas: existing.formulas,
            validations: existing.validations,
            uncertaintyParams: existing.uncertaintyParams,
            certificateContent: existing.certificateContent,
            parentId: existing.id,
            createdBy: session.user.id,
          })
          .returning();

        if (!newMethod) {
          return c.json({ error: "Erro ao criar nova versão" }, 500);
        }

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: newMethod.id,
          action: "new_version",
          changes: {
            parentId: existing.id,
            parentVersion: existing.version,
            newVersion,
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(newMethod, 201);
      } catch (error) {
        console.error("Error creating new version:", error);
        return c.json({ error: "Erro ao criar nova versão" }, 500);
      }
    },
  )

  // =========================================================================
  // DELETE /:id - Delete a DRAFT method only
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ template: ["delete"] }),
    withInvalidation("methods"),
    async (c) => {
      const member = c.get("member");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "DRAFT") {
          return c.json(
            {
              error:
                "Apenas rascunhos podem ser excluidos. métodos publicados devem ser arquivados.",
            },
            400,
          );
        }

        // Delete (audit logs will cascade)
        await db.delete(calibrationMethod).where(eq(calibrationMethod.id, id));

        return c.json({ success: true });
      } catch (error) {
        console.error("Error deleting method:", error);
        return c.json({ error: "Erro ao excluir método" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/versions - Get version history for a method
  // =========================================================================
  .get(
    "/:id/versions",
    ...withLabPermission({ template: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        // Get the method to find its name
        const [method] = await db
          .select({ name: calibrationMethod.name })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!method) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        // Get all versions with this name
        const versions = await db
          .select({
            id: calibrationMethod.id,
            version: calibrationMethod.version,
            status: calibrationMethod.status,
            createdAt: calibrationMethod.createdAt,
            publishedAt: calibrationMethod.publishedAt,
            archivedAt: calibrationMethod.archivedAt,
          })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, method.name),
            ),
          )
          .orderBy(desc(calibrationMethod.version));

        return c.json({ data: versions });
      } catch (error) {
        console.error("Error getting versions:", error);
        return c.json({ error: "Erro ao buscar versoes" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/audit - Get audit log for a method
  // =========================================================================
  .get(
    "/:id/audit",
    ...withLabPermission({ template: ["read"] }),
    requireFeature("advanced_audit_trail"),
    async (c) => {
      const member = c.get("member");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        // Verify method belongs to org
        const [method] = await db
          .select({ id: calibrationMethod.id })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!method) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        const logs = await db
          .select({
            id: methodAuditLog.id,
            action: methodAuditLog.action,
            changes: methodAuditLog.changes,
            performedAt: methodAuditLog.performedAt,
            performedByName: user.name,
            reason: methodAuditLog.reason,
          })
          .from(methodAuditLog)
          .leftJoin(user, eq(methodAuditLog.performedBy, user.id))
          .where(eq(methodAuditLog.methodId, id))
          .orderBy(desc(methodAuditLog.performedAt));

        return c.json({ data: logs });
      } catch (error) {
        console.error("Error getting audit log:", error);
        return c.json({ error: "Erro ao buscar historico" }, 500);
      }
    },
  );
