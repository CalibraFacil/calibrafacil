import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  trainingRecord,
  trainingRecordAuditLog,
  personnelCompetence,
  member,
  user,
} from "@calibra-facil/db/schema";
import { isNull } from "drizzle-orm";
import {
  CreateTrainingRecordSchema,
  UpdateTrainingRecordSchema,
  ListTrainingRecordsQuerySchema,
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { eq, and, desc, count } from "drizzle-orm";

/**
 * Training Records Router - ISO 17025:2017 Clause 6.2.3 (Training Evidence)
 */
export const trainingRecordsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List training records with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ competence: ["read"] }),
    zValidator("query", ListTrainingRecordsQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const { page, limit, userId, competenceId, status, type } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      const conditions = [
        eq(trainingRecord.organizationId, memberData.organizationId),
        isNull(trainingRecord.deletedAt),
      ];

      if (userId) {
        conditions.push(eq(trainingRecord.userId, userId));
      }
      if (competenceId) {
        conditions.push(eq(trainingRecord.competenceId, competenceId));
      }
      if (status) {
        conditions.push(eq(trainingRecord.status, status));
      }
      if (type) {
        conditions.push(eq(trainingRecord.type, type));
      }

      const where = and(...conditions);

      const [data, [totalResult]] = await Promise.all([
        db
          .select({
            id: trainingRecord.id,
            userId: trainingRecord.userId,
            userName: user.name,
            competenceId: trainingRecord.competenceId,
            title: trainingRecord.title,
            type: trainingRecord.type,
            status: trainingRecord.status,
            provider: trainingRecord.provider,
            startDate: trainingRecord.startDate,
            endDate: trainingRecord.endDate,
            hoursCompleted: trainingRecord.hoursCompleted,
            score: trainingRecord.score,
            passingScore: trainingRecord.passingScore,
            passed: trainingRecord.passed,
            createdAt: trainingRecord.createdAt,
          })
          .from(trainingRecord)
          .innerJoin(user, eq(trainingRecord.userId, user.id))
          .where(where)
          .orderBy(desc(trainingRecord.startDate))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(trainingRecord).where(where),
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
  // GET /:id - Single training record
  // =========================================================================
  .get(
    "/:id",
    ...withLabPermission({ competence: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [record] = await db
        .select({
          id: trainingRecord.id,
          organizationId: trainingRecord.organizationId,
          userId: trainingRecord.userId,
          userName: user.name,
          competenceId: trainingRecord.competenceId,
          title: trainingRecord.title,
          type: trainingRecord.type,
          status: trainingRecord.status,
          provider: trainingRecord.provider,
          description: trainingRecord.description,
          startDate: trainingRecord.startDate,
          endDate: trainingRecord.endDate,
          hoursCompleted: trainingRecord.hoursCompleted,
          certificateR2Key: trainingRecord.certificateR2Key,
          certificateFileName: trainingRecord.certificateFileName,
          score: trainingRecord.score,
          passingScore: trainingRecord.passingScore,
          passed: trainingRecord.passed,
          createdAt: trainingRecord.createdAt,
          updatedAt: trainingRecord.updatedAt,
        })
        .from(trainingRecord)
        .innerJoin(user, eq(trainingRecord.userId, user.id))
        .where(
          and(
            eq(trainingRecord.id, id),
            eq(trainingRecord.organizationId, memberData.organizationId),
            isNull(trainingRecord.deletedAt),
          ),
        )
        .limit(1);

      if (!record) {
        return c.json({ error: "Registro de treinamento não encontrado" }, 404);
      }

      return c.json(record);
    },
  )

  // =========================================================================
  // POST / - Create training record
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ competence: ["create"] }),
    zValidator("json", CreateTrainingRecordSchema),
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
        return c.json(
          { error: "Usuário não é membro desta organização" },
          400,
        );
      }

      // Validate competenceId belongs to the same org if provided
      if (input.competenceId) {
        const [comp] = await db
          .select({ id: personnelCompetence.id })
          .from(personnelCompetence)
          .where(
            and(
              eq(personnelCompetence.id, input.competenceId),
              eq(
                personnelCompetence.organizationId,
                memberData.organizationId,
              ),
              isNull(personnelCompetence.deletedAt),
            ),
          )
          .limit(1);

        if (!comp) {
          return c.json(
            { error: "Competência não encontrada nesta organização" },
            400,
          );
        }
      }

      const [created] = await db
        .insert(trainingRecord)
        .values({
          organizationId: memberData.organizationId,
          userId: input.userId,
          competenceId: input.competenceId ?? null,
          title: input.title,
          type: input.type,
          status: "planned",
          provider: input.provider ?? null,
          description: input.description ?? null,
          startDate: new Date(input.startDate),
          endDate: input.endDate ? new Date(input.endDate) : null,
          hoursCompleted: input.hoursCompleted ?? null,
          score: input.score ?? null,
          passingScore: input.passingScore ?? null,
          passed: input.passed ?? null,
          createdBy: session.user.id,
        })
        .returning();

      if (!created) {
        return c.json({ error: "Falha ao criar registro de treinamento" }, 500);
      }

      await db.insert(trainingRecordAuditLog).values({
        trainingRecordId: created.id,
        action: "create",
        changes: {
          initial: {
            userId: input.userId,
            title: input.title,
            type: input.type,
            startDate: input.startDate,
          },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(created, 201);
    },
  )

  // =========================================================================
  // PUT /:id - Update training record
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ competence: ["update"] }),
    zValidator("json", UpdateTrainingRecordSchema),
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
        .from(trainingRecord)
        .where(
          and(
            eq(trainingRecord.id, id),
            eq(trainingRecord.organizationId, memberData.organizationId),
            isNull(trainingRecord.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Registro de treinamento não encontrado" }, 404);
      }

      const updateData: Record<string, unknown> = {};
      if (input.title !== undefined) updateData.title = input.title;
      if (input.type !== undefined) updateData.type = input.type;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.provider !== undefined) updateData.provider = input.provider;
      if (input.description !== undefined)
        updateData.description = input.description;
      if (input.startDate !== undefined)
        updateData.startDate = new Date(input.startDate);
      if (input.endDate !== undefined)
        updateData.endDate = input.endDate ? new Date(input.endDate) : null;
      if (input.hoursCompleted !== undefined)
        updateData.hoursCompleted = input.hoursCompleted;
      if (input.score !== undefined) updateData.score = input.score;
      if (input.passingScore !== undefined)
        updateData.passingScore = input.passingScore;
      if (input.passed !== undefined) updateData.passed = input.passed;

      if (Object.keys(updateData).length === 0) {
        return c.json(
          { error: "Nenhum campo para atualizar fornecido" },
          400,
        );
      }

      const [updated] = await db
        .update(trainingRecord)
        .set(updateData)
        .where(eq(trainingRecord.id, id))
        .returning();

      await db.insert(trainingRecordAuditLog).values({
        trainingRecordId: id,
        action: "update",
        changes: updateData,
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/complete - Mark training completed
  // =========================================================================
  .post(
    "/:id/complete",
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
        .from(trainingRecord)
        .where(
          and(
            eq(trainingRecord.id, id),
            eq(trainingRecord.organizationId, memberData.organizationId),
            isNull(trainingRecord.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Registro de treinamento não encontrado" }, 404);
      }

      const [updated] = await db
        .update(trainingRecord)
        .set({
          status: "completed",
          endDate: existing.endDate ?? new Date(),
        })
        .where(eq(trainingRecord.id, id))
        .returning();

      await db.insert(trainingRecordAuditLog).values({
        trainingRecordId: id,
        action: "complete",
        changes: { status: { old: existing.status, new: "completed" } },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // DELETE /:id - Delete training record
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ competence: ["delete"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(trainingRecord)
        .where(
          and(
            eq(trainingRecord.id, id),
            eq(trainingRecord.organizationId, memberData.organizationId),
            isNull(trainingRecord.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Registro de treinamento não encontrado" }, 404);
      }

      const session = c.get("session");

      await db
        .update(trainingRecord)
        .set({ deletedAt: new Date() })
        .where(eq(trainingRecord.id, id));

      await db.insert(trainingRecordAuditLog).values({
        trainingRecordId: id,
        action: "delete",
        changes: { deletedAt: new Date().toISOString() },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json({ message: "Registro de treinamento removido" });
    },
  );
