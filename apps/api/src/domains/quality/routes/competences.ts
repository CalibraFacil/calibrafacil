import { createRouter } from "../../../server/router";
import {
  competenceEndpoints,
  entityLabelEndpoints,
} from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import {
  conflict,
  forbidden,
  invalid,
  notFound,
} from "../../../lib/domain-errors";
import { requireLabCompetence } from "../competence-access";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import {
  personnelCompetence,
  personnelCompetenceAuditLog,
  trainingRecord,
  user,
  member,
  assetType,
} from "@calibra-facil/db/schema";
import { UpdatePersonnelCompetenceSchema } from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  notifyCompetenceRequested,
  notifyCompetenceApproved,
} from "@calibra-facil/notifications";
import { eq, and, isNull, desc, count, lte, gte, inArray } from "drizzle-orm";
import { COMPETENCE_MACHINE } from "@calibra-facil/schemas/machines";

const PREFIX = "/api/competences";

/**
 * Competences Router - ISO 17025:2017 Clause 6.2.3 (Personnel Competence)
 *
 * Full workflow: REQUESTED → TRAINING_ASSIGNED → IN_TRAINING → PENDING_EVALUATION → ACTIVE
 * REQUESTED/TRAINING_ASSIGNED/IN_TRAINING/PENDING_EVALUATION → CANCELLED
 * ACTIVE → SUSPENDED (manual) / EXPIRED (auto) → ACTIVE (renew)
 */
export const competencesRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.list,
  withLabPermission({ competence: ["read"] }),
  async (
    c,
    { query: { page, limit, userId, assetTypeId, status, expiringWithinDays } },
  ) => {
    const memberData = c.get("member");
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

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const [data, [totalResult]] = await Promise.all([
        tx
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
        tx.select({ total: count() }).from(personnelCompetence).where(where),
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
// GET /matrix - Competence matrix view (technicians × asset types)
// =========================================================================
mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.matrix,
  withLabPermission({ competence: ["read"] }),
  async (c) => {
    const memberData = c.get("member");

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const technicians = await tx
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

      const assetTypes = await tx
        .select({ id: assetType.id, name: assetType.name })
        .from(assetType)
        .orderBy(assetType.name);

      const competences = await tx
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

      return { technicians, assetTypes, competences };
    });
  },
);

mount(
  competencesRouter,
  PREFIX,
  entityLabelEndpoints.getCompetence,
  withLabPermission({ competence: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const [comp] = await tx
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
        throw notFound("not_found", "Competência não encontrada");
      }

      return comp;
    });
  },
);

mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.get,
  withLabPermission({ competence: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const [comp] = await tx
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
        throw notFound("not_found", "Competência não encontrada");
      }

      // Get user details. userId is nullable since migration 0083 (the owning
      // user may have been deleted, leaving user_id NULL); skip the lookup then.
      const [userData] = comp.userId
        ? await tx
            .select({ name: user.name, email: user.email })
            .from(user)
            .where(eq(user.id, comp.userId))
            .limit(1)
        : [];

      let assetTypeName: string | null = null;
      if (comp.assetTypeId) {
        const [at] = await tx
          .select({ name: assetType.name })
          .from(assetType)
          .where(eq(assetType.id, comp.assetTypeId))
          .limit(1);
        assetTypeName = at?.name ?? null;
      }

      const trainings = await tx
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

      const userIds = [
        comp.requestedBy,
        comp.evaluatedBy,
        comp.approvedBy,
      ].filter((userId): userId is string => Boolean(userId));
      const userNames: Record<string, string> = {};
      if (userIds.length > 0) {
        const users = await tx
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, userIds));
        for (const u of users) {
          userNames[u.id] = u.name;
        }
      }

      return {
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
      };
    });
  },
);

mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.create,
  withLabPermission({ competence: ["create"] }),
  async (c, { body: input }) => {
    const memberData = c.get("member");
    const session = c.get("session");

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

        const [row] = await ctx.o
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

        if (!row) {
          throw new Error("Falha ao criar solicitação");
        }

        await ctx.audit("competence", row.id, {
          action: "create",
          changes: {
            initial: {
              userId: input.userId,
              assetTypeId: input.assetTypeId,
              scopeDescription: input.scopeDescription,
            },
          },
        });

        // Notify admins, once the request is committed (the notification reads it).
        ctx.afterCommit(() =>
          notifyCompetenceRequested(
            row.id,
            memberData.organizationId,
            session.user.id,
          ),
        );

        return row;
      },
    );
    return created;
  },
);

competencesRouter.put(
  "/:id",
  ...withLabPermission({ competence: ["update"] }),
  zValidator("json", UpdatePersonnelCompetenceSchema),
  async (c) => {
    const memberData = c.get("member");
    const id = parseInt(c.req.param("id"), 10);
    const input = c.req.valid("json");

    if (isNaN(id)) {
      throw invalid("invalid_request", "ID inválido");
    }

    const result = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        await requireLabCompetence(id, memberData.organizationId, ctx.o);

        const updateData: Record<string, unknown> = {};
        if (input.scopeDescription !== undefined)
          updateData.scopeDescription = input.scopeDescription;
        if (input.notes !== undefined) updateData.notes = input.notes;
        if (input.expiresAt !== undefined)
          updateData.expiresAt = input.expiresAt
            ? new Date(input.expiresAt)
            : null;

        const [updated] = await ctx.o
          .update(personnelCompetence)
          .set(updateData)
          .where(eq(personnelCompetence.id, id))
          .returning();

        await ctx.audit("competence", id, {
          action: "update",
          changes: updateData,
        });

        return updated;
      },
    );

    return c.json(result);
  },
);

// =========================================================================
// POST /:id/assign-training - REQUESTED → TRAINING_ASSIGNED
// =========================================================================
mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.assignTraining,
  withLabPermission({ competence: ["update"] }),
  async (c, { params, body: input }) => {
    const memberData = c.get("member");
    const { id } = params;

    const assigned = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCompetence(
          id,
          memberData.organizationId,
          ctx.o,
        );

        if (
          !COMPETENCE_MACHINE.canTransition(existing.status, "assign_training")
        ) {
          throw invalid(
            "invalid_request",
            "Treinamento só pode ser atribuído no status REQUESTED ou PENDING_EVALUATION",
          );
        }

        // userId is nullable since migration 0083. A live (non-soft-deleted)
        // competence always has an owning user, but guard the type: a competence
        // whose user was deleted cannot receive training assignments.
        if (!existing.userId) {
          throw invalid("invalid_request", "Competência sem usuário associado");
        }

        const existingUserId = existing.userId;

        // Link training records to this competence (must be same org + same user)
        for (const trId of input.trainingRecordIds) {
          const result = await ctx.o
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
            // Thrown, not returned: a return would commit the records linked
            // in the earlier iterations.
            throw invalid(
              "training_record_mismatch",
              `Registro de treinamento ${trId} não encontrado ou não pertence ao mesmo técnico`,
            );
          }
        }

        const [updated] = await ctx.o
          .update(personnelCompetence)
          .set({
            status: COMPETENCE_MACHINE.requireTargetOf(
              existing.status,
              "assign_training",
            ),
          })
          .where(
            and(
              eq(personnelCompetence.id, id),
              eq(personnelCompetence.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row (COMPETENCE_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A competência mudou de situação durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("competence", id, {
          action: "assign_training",
          changes: {
            status: { old: existing.status, new: "TRAINING_ASSIGNED" },
            trainingRecordIds: input.trainingRecordIds,
          },
        });

        return updated;
      },
    );
    return assigned;
  },
);

// =========================================================================
// POST /:id/start-training - TRAINING_ASSIGNED → IN_TRAINING
// =========================================================================
mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.startTraining,
  withLabPermission({ competence: ["update"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;

    const result = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCompetence(
          id,
          memberData.organizationId,
          ctx.o,
        );

        if (
          !COMPETENCE_MACHINE.canTransition(existing.status, "start_training")
        ) {
          throw invalid(
            "invalid_request",
            "Treinamento só pode ser iniciado no status TRAINING_ASSIGNED",
          );
        }

        const [updated] = await ctx.o
          .update(personnelCompetence)
          .set({
            status: COMPETENCE_MACHINE.requireTargetOf(
              existing.status,
              "start_training",
            ),
          })
          .where(
            and(
              eq(personnelCompetence.id, id),
              eq(personnelCompetence.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row (COMPETENCE_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A competência mudou de situação durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("competence", id, {
          action: "start_training",
          changes: {
            status: { old: "TRAINING_ASSIGNED", new: "IN_TRAINING" },
          },
        });

        return updated;
      },
    );

    return result;
  },
);

// =========================================================================
// POST /:id/complete-training - IN_TRAINING → PENDING_EVALUATION
// =========================================================================
mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.completeTraining,
  withLabPermission({ competence: ["update"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;

    const result = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCompetence(
          id,
          memberData.organizationId,
          ctx.o,
        );

        if (
          !COMPETENCE_MACHINE.canTransition(
            existing.status,
            "complete_training",
          )
        ) {
          throw invalid(
            "invalid_request",
            "Treinamento só pode ser concluído no status IN_TRAINING",
          );
        }

        const [updated] = await ctx.o
          .update(personnelCompetence)
          .set({
            status: COMPETENCE_MACHINE.requireTargetOf(
              existing.status,
              "complete_training",
            ),
          })
          .where(
            and(
              eq(personnelCompetence.id, id),
              eq(personnelCompetence.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row (COMPETENCE_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A competência mudou de situação durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("competence", id, {
          action: "complete_training",
          changes: {
            status: { old: "IN_TRAINING", new: "PENDING_EVALUATION" },
          },
        });

        return updated;
      },
    );

    return result;
  },
);

// =========================================================================
// POST /:id/evaluate - PENDING_EVALUATION → ACTIVE or back to TRAINING_ASSIGNED
// =========================================================================
mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.evaluate,
  withLabPermission({ competence: ["evaluate"] }),
  async (c, { params, body: input }) => {
    const memberData = c.get("member");
    const session = c.get("session");
    const { id } = params;

    const updated = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCompetence(
          id,
          memberData.organizationId,
          ctx.o,
        );

        if (!COMPETENCE_MACHINE.canTransition(existing.status, "evaluate")) {
          throw invalid(
            "invalid_request",
            "Avaliação só pode ser feita no status PENDING_EVALUATION",
          );
        }

        // Separation of duties (ISO/IEC 17025 §6.2): nobody evaluates,
        // approves or rejects their own competence. `userId` is the person
        // being qualified; the evaluator must be someone else.
        if (existing.userId === session.user.id) {
          throw forbidden(
            "self_approval_blocked",
            "Separação de responsabilidades (ISO/IEC 17025): ninguém pode avaliar a própria competência. Solicite a avaliação a outro membro autorizado.",
          );
        }

        if (input.passed) {
          // Approve → ACTIVE
          const qualifiedAt = input.qualifiedAt
            ? new Date(input.qualifiedAt)
            : new Date();
          const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

          const [approved] = await ctx.o
            .update(personnelCompetence)
            .set({
              status: COMPETENCE_MACHINE.requireTransition(
                existing.status,
                "evaluate",
                "ACTIVE",
              ),
              qualifiedAt,
              expiresAt,
              notes: input.notes ?? existing.notes,
              evaluatedBy: session.user.id,
              approvedBy: session.user.id,
            })
            .where(
              and(
                eq(personnelCompetence.id, id),
                eq(personnelCompetence.status, existing.status),
              ),
            )
            .returning();
          if (!approved) {
            // The compare-and-set on the status matched no row (COMPETENCE_MACHINE).
            throw conflict(
              "status_transition_conflict",
              "A competência mudou de situação durante a operação. Recarregue e tente novamente.",
            );
          }

          await ctx.audit("competence", id, {
            action: "approve",
            changes: {
              status: { old: "PENDING_EVALUATION", new: "ACTIVE" },
              passed: true,
              qualifiedAt: qualifiedAt.toISOString(),
              expiresAt: expiresAt?.toISOString() ?? null,
            },
            reason: input.notes ?? null,
          });

          // Notify technician, once the approval is committed (the notification reads it).
          ctx.afterCommit(() =>
            notifyCompetenceApproved(
              id,
              memberData.organizationId,
              session.user.id,
            ),
          );

          return approved;
        } else {
          const [rejected] = await ctx.o
            .update(personnelCompetence)
            .set({
              status: COMPETENCE_MACHINE.requireTransition(
                existing.status,
                "evaluate",
                "TRAINING_ASSIGNED",
              ),
              notes: input.notes ?? existing.notes,
              evaluatedBy: session.user.id,
            })
            .where(
              and(
                eq(personnelCompetence.id, id),
                eq(personnelCompetence.status, existing.status),
              ),
            )
            .returning();
          if (!rejected) {
            // The compare-and-set on the status matched no row (COMPETENCE_MACHINE).
            throw conflict(
              "status_transition_conflict",
              "A competência mudou de situação durante a operação. Recarregue e tente novamente.",
            );
          }

          await ctx.audit("competence", id, {
            action: "reject",
            changes: {
              status: {
                old: "PENDING_EVALUATION",
                new: "TRAINING_ASSIGNED",
              },
              passed: false,
            },
            reason: input.notes ?? null,
          });

          return rejected;
        }
      },
    );
    return updated;
  },
);

// =========================================================================
// POST /:id/cancel - pre-active states → CANCELLED
// =========================================================================
mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.cancel,
  withLabPermission({ competence: ["update"] }),
  async (c, { params, body: input }) => {
    const memberData = c.get("member");
    const { id } = params;

    const result = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCompetence(
          id,
          memberData.organizationId,
          ctx.o,
        );

        if (!COMPETENCE_MACHINE.canTransition(existing.status, "cancel")) {
          throw invalid(
            "invalid_request",
            "Só é possível cancelar competências em andamento antes da ativação",
          );
        }

        const [updated] = await ctx.o
          .update(personnelCompetence)
          .set({
            status: COMPETENCE_MACHINE.requireTargetOf(
              existing.status,
              "cancel",
            ),
            notes: input.notes ?? existing.notes,
          })
          .where(
            and(
              eq(personnelCompetence.id, id),
              eq(personnelCompetence.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row (COMPETENCE_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A competência mudou de situação durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("competence", id, {
          action: "cancel",
          changes: {
            status: { old: existing.status, new: "CANCELLED" },
          },
          reason: input.notes ?? null,
        });

        return updated;
      },
    );

    return result;
  },
);

// =========================================================================
// POST /:id/suspend - ACTIVE → SUSPENDED
// =========================================================================
mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.suspend,
  withLabPermission({ competence: ["update"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;

    const result = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCompetence(
          id,
          memberData.organizationId,
          ctx.o,
        );

        if (!COMPETENCE_MACHINE.canTransition(existing.status, "suspend")) {
          throw invalid(
            "invalid_request",
            "Só é possível suspender competências ACTIVE",
          );
        }

        const [updated] = await ctx.o
          .update(personnelCompetence)
          .set({
            status: COMPETENCE_MACHINE.requireTargetOf(
              existing.status,
              "suspend",
            ),
          })
          .where(
            and(
              eq(personnelCompetence.id, id),
              eq(personnelCompetence.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row (COMPETENCE_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A competência mudou de situação durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("competence", id, {
          action: "suspend",
          changes: { status: { old: "ACTIVE", new: "SUSPENDED" } },
        });

        return updated;
      },
    );

    return result;
  },
);

// =========================================================================
// POST /:id/renew - EXPIRED/SUSPENDED → ACTIVE (with new dates)
// =========================================================================
mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.renew,
  withLabPermission({ competence: ["update"] }),
  async (c, { params, body: input }) => {
    const memberData = c.get("member");
    const session = c.get("session");
    const { id } = params;

    const result = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCompetence(
          id,
          memberData.organizationId,
          ctx.o,
        );

        if (!COMPETENCE_MACHINE.canTransition(existing.status, "renew")) {
          throw invalid(
            "invalid_request",
            "Só é possível renovar competências EXPIRED ou SUSPENDED",
          );
        }

        // Separation of duties (ISO/IEC 17025 §6.2): renewing re-activates the
        // competence and records the renewer as its approver, so the person
        // being qualified cannot renew their own.
        if (existing.userId === session.user.id) {
          throw forbidden(
            "self_approval_blocked",
            "Separação de responsabilidades (ISO/IEC 17025): ninguém pode renovar a própria competência. Solicite a renovação a outro membro autorizado.",
          );
        }

        const qualifiedAt = input.qualifiedAt
          ? new Date(input.qualifiedAt)
          : new Date();
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

        const [updated] = await ctx.o
          .update(personnelCompetence)
          .set({
            status: COMPETENCE_MACHINE.requireTargetOf(
              existing.status,
              "renew",
            ),
            qualifiedAt,
            expiresAt,
            notes: input.notes ?? existing.notes,
            approvedBy: session.user.id,
          })
          .where(
            and(
              eq(personnelCompetence.id, id),
              eq(personnelCompetence.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row (COMPETENCE_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A competência mudou de situação durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("competence", id, {
          action: "renew",
          changes: {
            status: { old: existing.status, new: "ACTIVE" },
            qualifiedAt: qualifiedAt.toISOString(),
            expiresAt: expiresAt?.toISOString() ?? null,
          },
          reason: input.notes ?? null,
        });

        return updated;
      },
    );

    return result;
  },
);

mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.delete,
  withLabPermission({ competence: ["delete"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      await requireLabCompetence(id, memberData.organizationId, ctx.o);

      await ctx.o
        .update(personnelCompetence)
        .set({ deletedAt: new Date() })
        .where(eq(personnelCompetence.id, id));

      await ctx.audit("competence", id, {
        action: "delete",
        changes: { deletedAt: new Date().toISOString() },
      });
    });

    return { message: "Competência removida" };
  },
);

mount(
  competencesRouter,
  PREFIX,
  competenceEndpoints.auditLog,
  withLabPermission({ competence: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const [comp] = await tx
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
        throw notFound("not_found", "Competência não encontrada");
      }

      const logs = await tx
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

      return logs.map((log) => ({
        ...log,
        performedByName: log.performedByName ?? log.performedBy,
      }));
    });
  },
);
