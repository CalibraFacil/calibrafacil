import { createRouter } from "../../../server/router";
import { trainingRecordEndpoints } from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import {
  trainingRecord,
  personnelCompetence,
  member,
  user,
} from "@calibra-facil/db/schema";
import { isNull, eq, and, desc, count } from "drizzle-orm";
import { TRAINING_MACHINE } from "@calibra-facil/schemas/machines";
import { UpdateTrainingRecordSchema } from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import { invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

const PREFIX = "/api/training-records";

/**
 * Training Records Router - ISO 17025:2017 Clause 6.2.3 (Training Evidence)
 */
export const trainingRecordsRouter = createRouter<{
  Variables: AuthVariables;
}>();

// =========================================================================
// GET / - List training records with pagination and filtering
// =========================================================================
mount(
  trainingRecordsRouter,
  PREFIX,
  trainingRecordEndpoints.list,
  withLabPermission({ competence: ["read"] }),
  async (c, { query: { page, limit, userId, competenceId, status, type } }) => {
    const memberData = c.get("member");
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

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const [data, [totalResult]] = await Promise.all([
        tx
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
        tx.select({ total: count() }).from(trainingRecord).where(where),
      ]);

      const total = totalResult?.total ?? 0;

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  },
);

// =========================================================================
// GET /:id - Single training record
// =========================================================================
trainingRecordsRouter.get(
  "/:id",
  ...withLabPermission({ competence: ["read"] }),
  async (c) => {
    const memberData = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      throw invalid("invalid_request", "ID inválido");
    }

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const [record] = await tx
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
        throw notFound("not_found", "Registro de treinamento não encontrado");
      }

      return c.json(record);
    });
  },
);

// =========================================================================
// POST / - Create training record
// =========================================================================
mount(
  trainingRecordsRouter,
  PREFIX,
  trainingRecordEndpoints.create,
  withLabPermission({ competence: ["create"] }),
  async (c, { body: input }) => {
    const memberData = c.get("member");
    const session = c.get("session");

    // Validate user is a member of the org
    const created = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const [targetMember] = await ctx.o
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
          throw invalid(
            "invalid_request",
            "Usuário não é membro desta organização",
          );
        }

        // Validate competenceId belongs to the same org if provided
        if (input.competenceId) {
          const [comp] = await ctx.o
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
            throw invalid(
              "invalid_request",
              "Competência não encontrada nesta organização",
            );
          }
        }

        const [row] = await ctx.o
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

        if (!row) {
          throw new Error("Falha ao criar registro de treinamento");
        }

        await ctx.audit("trainingRecord", row.id, {
          action: "create",
          changes: {
            initial: {
              userId: input.userId,
              title: input.title,
              type: input.type,
              startDate: input.startDate,
            },
          },
        });

        return row;
      },
    );

    return created;
  },
);

// =========================================================================
// PUT /:id - Update training record
// =========================================================================
trainingRecordsRouter.put(
  "/:id",
  ...withLabPermission({ competence: ["update"] }),
  zValidator("json", UpdateTrainingRecordSchema),
  async (c) => {
    const memberData = c.get("member");
    const id = parseInt(c.req.param("id"), 10);
    const input = c.req.valid("json");

    if (isNaN(id)) {
      throw invalid("invalid_request", "ID inválido");
    }

    const updated = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const [existing] = await ctx.o
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
          throw notFound("not_found", "Registro de treinamento não encontrado");
        }

        const updateData: Record<string, unknown> = {};
        if (input.title !== undefined) updateData.title = input.title;
        if (input.type !== undefined) updateData.type = input.type;
        if (input.status !== undefined && input.status !== existing.status) {
          updateData.status = TRAINING_MACHINE.requireTransition(
            existing.status,
            "set_status",
            input.status,
          );
        }
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
          throw invalid(
            "invalid_request",
            "Nenhum campo para atualizar fornecido",
          );
        }

        const [row] = await ctx.o
          .update(trainingRecord)
          .set(updateData)
          .where(eq(trainingRecord.id, id))
          .returning();

        await ctx.audit("trainingRecord", id, {
          action: "update",
          changes: updateData,
        });

        return row;
      },
    );

    return c.json(updated);
  },
);

// =========================================================================
// POST /:id/complete - Mark training completed
// =========================================================================
trainingRecordsRouter.post(
  "/:id/complete",
  ...withLabPermission({ competence: ["update"] }),
  async (c) => {
    const memberData = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      throw invalid("invalid_request", "ID inválido");
    }

    const updated = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const [existing] = await ctx.o
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
          throw notFound("not_found", "Registro de treinamento não encontrado");
        }

        const [row] = await ctx.o
          .update(trainingRecord)
          .set({
            status: TRAINING_MACHINE.requireTargetOf(
              existing.status,
              "complete",
            ),
            endDate: existing.endDate ?? new Date(),
          })
          .where(eq(trainingRecord.id, id))
          .returning();

        await ctx.audit("trainingRecord", id, {
          action: "complete",
          changes: { status: { old: existing.status, new: "completed" } },
        });

        return row;
      },
    );

    return c.json(updated);
  },
);

// =========================================================================
// DELETE /:id - Delete training record
// =========================================================================
trainingRecordsRouter.delete(
  "/:id",
  ...withLabPermission({ competence: ["delete"] }),
  async (c) => {
    const memberData = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      throw invalid("invalid_request", "ID inválido");
    }

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const [existing] = await ctx.o
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
        throw notFound("not_found", "Registro de treinamento não encontrado");
      }

      await ctx.o
        .update(trainingRecord)
        .set({ deletedAt: new Date() })
        .where(eq(trainingRecord.id, id));

      await ctx.audit("trainingRecord", id, {
        action: "delete",
        changes: { deletedAt: new Date().toISOString() },
      });
    });

    return c.json({ message: "Registro de treinamento removido" });
  },
);
