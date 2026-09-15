import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  personnelCompetence,
  personnelCompetenceAuditLog,
  trainingRecord,
  user,
  member,
  assetType,
} from "@calibra-facil/db/schema";
import {
  CreateCompetenceRequestSchema,
  UpdatePersonnelCompetenceSchema,
  AssignTrainingSchema,
  EvaluateCompetenceSchema,
  CancelCompetenceSchema,
  ListPersonnelCompetenceQuerySchema,
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import {
  notifyCompetenceRequested,
  notifyCompetenceApproved,
} from "@calibra-facil/notifications";
import {
  eq,
  and,
  isNull,
  desc,
  count,
  sql,
  lte,
  gte,
  inArray,
} from "drizzle-orm";

/**
 * Competences Router - ISO 17025:2017 Clause 6.2.3 (Personnel Competence)
 *
 * Full workflow: REQUESTED → TRAINING_ASSIGNED → IN_TRAINING → PENDING_EVALUATION → ACTIVE
 * REQUESTED/TRAINING_ASSIGNED/IN_TRAINING/PENDING_EVALUATION → CANCELLED
 * ACTIVE → SUSPENDED (manual) / EXPIRED (auto) → ACTIVE (renew)
 */
export const competencesRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List competences with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ competence: ["read"] }),
    zValidator("query", ListPersonnelCompetenceQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const { page, limit, userId, assetTypeId, status, expiringWithinDays } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      const conditions = [
        eq(personnelCompetence.organizationId, memberData.organizationId),
        isNull(personnelCompetence.deletedAt),
      ];

      if (userId) {
        conditions.push(eq(personnelCompetence.userId, userId));
      }
      if (assetTypeId) {
        conditions.push(eq(personnelCompetence.assetTypeId, assetTypeId));
      }
      if (status) {
        conditions.push(eq(personnelCompetence.status, status));
      }
      if (expiringWithinDays) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + expiringWithinDays);
        conditions.push(
          and(
            eq(personnelCompetence.status, "ACTIVE"),
            lte(personnelCompetence.expiresAt, futureDate),
            gte(personnelCompetence.expiresAt, new Date()),
          )!,
        );
      }

      const where = and(...conditions);

      const [data, [totalResult]] = await Promise.all([
        db
          .select({
            id: personnelCompetence.id,
            userId: personnelCompetence.userId,
            userName: user.name,
            assetTypeId: personnelCompetence.assetTypeId,
            assetTypeName: assetType.name,
            scopeDescription: personnelCompetence.scopeDescription,
            status: personnelCompetence.status,
            qualifiedAt: personnelCompetence.qualifiedAt,
            expiresAt: personnelCompetence.expiresAt,
            notes: personnelCompetence.notes,
            createdAt: personnelCompetence.createdAt,
          })
          .from(personnelCompetence)
          .innerJoin(user, eq(personnelCompetence.userId, user.id))
          .leftJoin(
            assetType,
            eq(personnelCompetence.assetTypeId, assetType.id),
          )
          .where(where)
          .orderBy(desc(personnelCompetence.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(personnelCompetence).where(where),
      ]);

      const total = totalResult?.total ?? 0;

      return c.json({
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  )

  // =========================================================================
  // GET /matrix - Competence matrix view (technicians × asset types)
  // =========================================================================
  .get("/matrix", ...withLabPermission({ competence: ["read"] }), async (c) => {
    const memberData = c.get("member");

    // Get all technician/admin/owner members
    const technicians = await db
      .select({
        userId: member.userId,
        userName: user.name,
        role: member.role,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(member.organizationId, memberData.organizationId),
          inArray(member.role, ["technician", "admin", "owner"]),
        ),
      );

    // Get all asset types
    const assetTypes = await db
      .select({ id: assetType.id, name: assetType.name })
      .from(assetType)
      .orderBy(assetType.name);

    // Get all competence records for this org
    const competences = await db
      .select({
        id: personnelCompetence.id,
        userId: personnelCompetence.userId,
        assetTypeId: personnelCompetence.assetTypeId,
        status: personnelCompetence.status,
        expiresAt: personnelCompetence.expiresAt,
      })
      .from(personnelCompetence)
      .where(
        and(
          eq(personnelCompetence.organizationId, memberData.organizationId),
          isNull(personnelCompetence.deletedAt),
        ),
      );

    return c.json({ technicians, assetTypes, competences });
  })

  // =========================================================================
  // GET /:id/label - Get competence label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ competence: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [comp] = await db
        .select({
          id: personnelCompetence.id,
          label: user.name,
        })
        .from(personnelCompetence)
        .innerJoin(user, eq(personnelCompetence.userId, user.id))
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!comp) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      return c.json(comp);
    },
  )

  // =========================================================================
  // GET /:id - Single competence with training records
  // =========================================================================
  .get("/:id", ...withLabPermission({ competence: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID inválido" }, 400);
    }

    const [comp] = await db
      .select({
        id: personnelCompetence.id,
        organizationId: personnelCompetence.organizationId,
        userId: personnelCompetence.userId,
        assetTypeId: personnelCompetence.assetTypeId,
        scopeDescription: personnelCompetence.scopeDescription,
        status: personnelCompetence.status,
        qualifiedAt: personnelCompetence.qualifiedAt,
        expiresAt: personnelCompetence.expiresAt,
        certificateR2Key: personnelCompetence.certificateR2Key,
        certificateFileName: personnelCompetence.certificateFileName,
        notes: personnelCompetence.notes,
        requestedBy: personnelCompetence.requestedBy,
        evaluatedBy: personnelCompetence.evaluatedBy,
        approvedBy: personnelCompetence.approvedBy,
        createdAt: personnelCompetence.createdAt,
        updatedAt: personnelCompetence.updatedAt,
      })
      .from(personnelCompetence)
      .where(
        and(
          eq(personnelCompetence.id, id),
          eq(personnelCompetence.organizationId, memberData.organizationId),
          isNull(personnelCompetence.deletedAt),
        ),
      )
      .limit(1);

    if (!comp) {
      return c.json({ error: "Competência não encontrada" }, 404);
    }

    // Get user details. userId is nullable since migration 0083 (the owning
    // user may have been deleted, leaving user_id NULL); skip the lookup then.
    const [userData] = comp.userId
      ? await db
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, comp.userId))
          .limit(1)
      : [];

    // Get asset type name
    let assetTypeName: string | null = null;
    if (comp.assetTypeId) {
      const [at] = await db
        .select({ name: assetType.name })
        .from(assetType)
        .where(eq(assetType.id, comp.assetTypeId))
        .limit(1);
      assetTypeName = at?.name ?? null;
    }

    // Get related training records (scoped to same org)
    const trainings = await db
      .select()
      .from(trainingRecord)
      .where(
        and(
          eq(trainingRecord.competenceId, id),
          eq(trainingRecord.organizationId, memberData.organizationId),
          isNull(trainingRecord.deletedAt),
        ),
      )
      .orderBy(desc(trainingRecord.startDate));

    // Get requestedBy, evaluatedBy, approvedBy names
    const userIds = [
      comp.requestedBy,
      comp.evaluatedBy,
      comp.approvedBy,
    ].filter((userId): userId is string => Boolean(userId));
    const userNames: Record<string, string> = {};
    if (userIds.length > 0) {
      const users = await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, userIds));
      for (const u of users) {
        userNames[u.id] = u.name;
      }
    }

    return c.json({
      ...comp,
      userName: userData?.name ?? null,
      userEmail: userData?.email ?? null,
      assetTypeName,
      requestedByName: userNames[comp.requestedBy] ?? null,
      evaluatedByName: comp.evaluatedBy
        ? (userNames[comp.evaluatedBy] ?? null)
        : null,
      approvedByName: comp.approvedBy
        ? (userNames[comp.approvedBy] ?? null)
        : null,
      trainingRecords: trainings,
    });
  })

  // =========================================================================
  // POST / - Create competence request (status=REQUESTED)
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ competence: ["create"] }),
    zValidator("json", CreateCompetenceRequestSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      // Validate user is a member of the org
      const [targetMember] = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.userId, input.userId),
            eq(member.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!targetMember) {
        return c.json({ error: "Usuário não é membro desta organização" }, 400);
      }

      const [created] = await db
        .insert(personnelCompetence)
        .values({
          organizationId: memberData.organizationId,
          userId: input.userId,
          assetTypeId: input.assetTypeId ?? null,
          scopeDescription: input.scopeDescription,
          status: "REQUESTED",
          requestedBy: session.user.id,
          createdBy: session.user.id,
        })
        .returning();

      if (!created) {
        return c.json({ error: "Falha ao criar solicitação" }, 500);
      }

      // Audit log
      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: created.id,
        action: "create",
        changes: {
          initial: {
            userId: input.userId,
            assetTypeId: input.assetTypeId,
            scopeDescription: input.scopeDescription,
          },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Notify admins
      try {
        await notifyCompetenceRequested(
          created.id,
          memberData.organizationId,
          session.user.id,
        );
      } catch (err) {
        console.error(
          "[Competences] Failed to send request notification:",
          err,
        );
      }

      return c.json(created, 201);
    },
  )

  // =========================================================================
  // PUT /:id - Update competence details
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ competence: ["update"] }),
    zValidator("json", UpdatePersonnelCompetenceSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      const updateData: Record<string, unknown> = {};
      if (input.scopeDescription !== undefined)
        updateData.scopeDescription = input.scopeDescription;
      if (input.notes !== undefined) updateData.notes = input.notes;
      if (input.expiresAt !== undefined)
        updateData.expiresAt = input.expiresAt
          ? new Date(input.expiresAt)
          : null;

      const [updated] = await db
        .update(personnelCompetence)
        .set(updateData)
        .where(eq(personnelCompetence.id, id))
        .returning();

      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: id,
        action: "update",
        changes: updateData,
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/assign-training - REQUESTED → TRAINING_ASSIGNED
  // =========================================================================
  .post(
    "/:id/assign-training",
    ...withLabPermission({ competence: ["update"] }),
    zValidator("json", AssignTrainingSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      if (
        existing.status !== "REQUESTED" &&
        existing.status !== "PENDING_EVALUATION"
      ) {
        return c.json(
          {
            error:
              "Treinamento só pode ser atribuído no status REQUESTED ou PENDING_EVALUATION",
          },
          400,
        );
      }

      // userId is nullable since migration 0083. A live (non-soft-deleted)
      // competence always has an owning user, but guard the type: a competence
      // whose user was deleted cannot receive training assignments.
      if (!existing.userId) {
        return c.json({ error: "Competência sem usuário associado" }, 400);
      }

      const existingUserId = existing.userId;

      // Link training records to this competence (must be same org + same user)
      for (const trId of input.trainingRecordIds) {
        const result = await db
          .update(trainingRecord)
          .set({ competenceId: id })
          .where(
            and(
              eq(trainingRecord.id, trId),
              eq(trainingRecord.organizationId, memberData.organizationId),
              eq(trainingRecord.userId, existingUserId),
              isNull(trainingRecord.deletedAt),
            ),
          )
          .returning();

        if (result.length === 0) {
          return c.json(
            {
              error: `Registro de treinamento ${trId} não encontrado ou não pertence ao mesmo técnico`,
            },
            400,
          );
        }
      }

      const [updated] = await db
        .update(personnelCompetence)
        .set({ status: "TRAINING_ASSIGNED" })
        .where(eq(personnelCompetence.id, id))
        .returning();

      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: id,
        action: "assign_training",
        changes: {
          status: { old: existing.status, new: "TRAINING_ASSIGNED" },
          trainingRecordIds: input.trainingRecordIds,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/start-training - TRAINING_ASSIGNED → IN_TRAINING
  // =========================================================================
  .post(
    "/:id/start-training",
    ...withLabPermission({ competence: ["update"] }),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      if (existing.status !== "TRAINING_ASSIGNED") {
        return c.json(
          {
            error:
              "Treinamento só pode ser iniciado no status TRAINING_ASSIGNED",
          },
          400,
        );
      }

      const [updated] = await db
        .update(personnelCompetence)
        .set({ status: "IN_TRAINING" })
        .where(eq(personnelCompetence.id, id))
        .returning();

      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: id,
        action: "start_training",
        changes: {
          status: { old: "TRAINING_ASSIGNED", new: "IN_TRAINING" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/complete-training - IN_TRAINING → PENDING_EVALUATION
  // =========================================================================
  .post(
    "/:id/complete-training",
    ...withLabPermission({ competence: ["update"] }),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      if (existing.status !== "IN_TRAINING") {
        return c.json(
          {
            error: "Treinamento só pode ser concluído no status IN_TRAINING",
          },
          400,
        );
      }

      const [updated] = await db
        .update(personnelCompetence)
        .set({ status: "PENDING_EVALUATION" })
        .where(eq(personnelCompetence.id, id))
        .returning();

      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: id,
        action: "complete_training",
        changes: {
          status: { old: "IN_TRAINING", new: "PENDING_EVALUATION" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/evaluate - PENDING_EVALUATION → ACTIVE or back to TRAINING_ASSIGNED
  // =========================================================================
  .post(
    "/:id/evaluate",
    ...withLabPermission({ competence: ["evaluate"] }),
    zValidator("json", EvaluateCompetenceSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      if (existing.status !== "PENDING_EVALUATION") {
        return c.json(
          {
            error: "Avaliação só pode ser feita no status PENDING_EVALUATION",
          },
          400,
        );
      }

      if (input.passed) {
        // Approve → ACTIVE
        const qualifiedAt = input.qualifiedAt
          ? new Date(input.qualifiedAt)
          : new Date();
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

        const [updated] = await db
          .update(personnelCompetence)
          .set({
            status: "ACTIVE",
            qualifiedAt,
            expiresAt,
            notes: input.notes ?? existing.notes,
            evaluatedBy: session.user.id,
            approvedBy: session.user.id,
          })
          .where(eq(personnelCompetence.id, id))
          .returning();

        await db.insert(personnelCompetenceAuditLog).values({
          competenceId: id,
          action: "approve",
          changes: {
            status: { old: "PENDING_EVALUATION", new: "ACTIVE" },
            passed: true,
            qualifiedAt: qualifiedAt.toISOString(),
            expiresAt: expiresAt?.toISOString() ?? null,
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
          reason: input.notes ?? null,
        });

        // Notify technician
        try {
          await notifyCompetenceApproved(
            id,
            memberData.organizationId,
            session.user.id,
          );
        } catch (err) {
          console.error(
            "[Competences] Failed to send approval notification:",
            err,
          );
        }

        return c.json(updated);
      } else {
        // Reject → back to TRAINING_ASSIGNED (needs more training)
        const [updated] = await db
          .update(personnelCompetence)
          .set({
            status: "TRAINING_ASSIGNED",
            notes: input.notes ?? existing.notes,
            evaluatedBy: session.user.id,
          })
          .where(eq(personnelCompetence.id, id))
          .returning();

        await db.insert(personnelCompetenceAuditLog).values({
          competenceId: id,
          action: "reject",
          changes: {
            status: {
              old: "PENDING_EVALUATION",
              new: "TRAINING_ASSIGNED",
            },
            passed: false,
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
          reason: input.notes ?? null,
        });

        return c.json(updated);
      }
    },
  )

  // =========================================================================
  // POST /:id/cancel - pre-active states → CANCELLED
  // =========================================================================
  .post(
    "/:id/cancel",
    ...withLabPermission({ competence: ["update"] }),
    zValidator("json", CancelCompetenceSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      if (
        existing.status !== "REQUESTED" &&
        existing.status !== "TRAINING_ASSIGNED" &&
        existing.status !== "IN_TRAINING" &&
        existing.status !== "PENDING_EVALUATION"
      ) {
        return c.json(
          {
            error:
              "Só é possível cancelar competências em andamento antes da ativação",
          },
          400,
        );
      }

      const [updated] = await db
        .update(personnelCompetence)
        .set({
          status: "CANCELLED",
          notes: input.notes ?? existing.notes,
        })
        .where(eq(personnelCompetence.id, id))
        .returning();

      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: id,
        action: "cancel",
        changes: {
          status: { old: existing.status, new: "CANCELLED" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.notes ?? null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/suspend - ACTIVE → SUSPENDED
  // =========================================================================
  .post(
    "/:id/suspend",
    ...withLabPermission({ competence: ["update"] }),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      if (existing.status !== "ACTIVE") {
        return c.json(
          { error: "Só é possível suspender competências ACTIVE" },
          400,
        );
      }

      const [updated] = await db
        .update(personnelCompetence)
        .set({ status: "SUSPENDED" })
        .where(eq(personnelCompetence.id, id))
        .returning();

      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: id,
        action: "suspend",
        changes: { status: { old: "ACTIVE", new: "SUSPENDED" } },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/renew - EXPIRED/SUSPENDED → ACTIVE (with new dates)
  // =========================================================================
  .post(
    "/:id/renew",
    ...withLabPermission({ competence: ["update"] }),
    zValidator("json", EvaluateCompetenceSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      if (existing.status !== "EXPIRED" && existing.status !== "SUSPENDED") {
        return c.json(
          { error: "Só é possível renovar competências EXPIRED ou SUSPENDED" },
          400,
        );
      }

      const qualifiedAt = input.qualifiedAt
        ? new Date(input.qualifiedAt)
        : new Date();
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

      const [updated] = await db
        .update(personnelCompetence)
        .set({
          status: "ACTIVE",
          qualifiedAt,
          expiresAt,
          notes: input.notes ?? existing.notes,
          approvedBy: session.user.id,
        })
        .where(eq(personnelCompetence.id, id))
        .returning();

      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: id,
        action: "renew",
        changes: {
          status: { old: existing.status, new: "ACTIVE" },
          qualifiedAt: qualifiedAt.toISOString(),
          expiresAt: expiresAt?.toISOString() ?? null,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.notes ?? null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // DELETE /:id - Soft delete
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ competence: ["delete"] }),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      await db
        .update(personnelCompetence)
        .set({ deletedAt: new Date() })
        .where(eq(personnelCompetence.id, id));

      await db.insert(personnelCompetenceAuditLog).values({
        competenceId: id,
        action: "delete",
        changes: { deletedAt: new Date().toISOString() },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json({ message: "Competência removida" });
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Audit log for a competence
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ competence: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      // Verify competence belongs to org
      const [comp] = await db
        .select({ id: personnelCompetence.id })
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, id),
            eq(personnelCompetence.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!comp) {
        return c.json({ error: "Competência não encontrada" }, 404);
      }

      const logs = await db
        .select({
          id: personnelCompetenceAuditLog.id,
          action: personnelCompetenceAuditLog.action,
          changes: personnelCompetenceAuditLog.changes,
          performedBy: personnelCompetenceAuditLog.performedBy,
          performedByName: user.name,
          performedAt: personnelCompetenceAuditLog.performedAt,
          reason: personnelCompetenceAuditLog.reason,
        })
        .from(personnelCompetenceAuditLog)
        .leftJoin(user, eq(personnelCompetenceAuditLog.performedBy, user.id))
        .where(eq(personnelCompetenceAuditLog.competenceId, id))
        .orderBy(desc(personnelCompetenceAuditLog.performedAt));

      return c.json(
        logs.map((log) => ({
          ...log,
          performedByName: log.performedByName ?? log.performedBy,
        })),
      );
    },
  );
