// Recipes of the personnel-competence notifications.
// One row per notification type: load the entity, resolve the recipients and
// yield what each one receives. `notify()` sends the yielded rows one by one.
import { user, personnelCompetence } from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { formatCalendarDate } from "@calibra-facil/shared/format";
import { inOrg } from "../lab-scope";
import { getUserName, getDaysRemaining, adminsAndOwners } from "./lookups";
import type { NotificationRecipes } from "./types";

export const competenceRecipes = {
  /**
   * Notify admins when a competence is expiring
   * Called by scheduled worker
   */
  async *COMPETENCE_EXPIRING({ competenceId, organizationId }) {
    const [comp] = await inOrg(organizationId, (o) =>
      o
        .select({
          userId: personnelCompetence.userId,
          scopeDescription: personnelCompetence.scopeDescription,
          expiresAt: personnelCompetence.expiresAt,
          assetTypeId: personnelCompetence.assetTypeId,
        })
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, competenceId),
            eq(personnelCompetence.organizationId, organizationId),
          ),
        )
        .limit(1),
    );

    // userId is nullable since migration 0083; skip when the competence has no
    // owning user (deleted) — there is no technician to notify about.
    if (!comp?.expiresAt || !comp.userId) return;

    const techName = await getUserName(comp.userId, "Um técnico");
    const daysRemaining = getDaysRemaining(comp.expiresAt);
    const dueDate = formatCalendarDate(comp.expiresAt);

    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "COMPETENCE_EXPIRING",
        priority: daysRemaining <= 7 ? "HIGH" : "MEDIUM",
        title: "Competência vencendo",
        message: `A competência de ${techName} (${comp.scopeDescription}) vence em ${daysRemaining} dias (${dueDate}).`,
        relatedEntity: {
          entityType: "competence",
          entityId: competenceId,
        },
        actionUrl: `/dashboard/personnel/${competenceId}`,
        emailContext: {
          type: "competence",
          data: {
            subjectName: techName,
            scopeDescription: comp.scopeDescription,
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },

  /**
   * Notify admins when a competence has expired
   * Called by scheduled worker
   */
  async *COMPETENCE_EXPIRED({ competenceId, organizationId }) {
    const [comp] = await inOrg(organizationId, (o) =>
      o
        .select({
          userId: personnelCompetence.userId,
          scopeDescription: personnelCompetence.scopeDescription,
          expiresAt: personnelCompetence.expiresAt,
        })
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, competenceId),
            eq(personnelCompetence.organizationId, organizationId),
          ),
        )
        .limit(1),
    );

    // userId is nullable since migration 0083 (a deleted user leaves the
    // competence with user_id NULL). These notifications are about a specific
    // technician, so skip when there is no owning user.
    if (!comp?.userId) return;

    const techName = await getUserName(comp.userId, "Um técnico");
    const dueDate = comp.expiresAt
      ? formatCalendarDate(comp.expiresAt)
      : undefined;

    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "COMPETENCE_EXPIRED",
        priority: "HIGH",
        title: "Competência EXPIRADA",
        message: `A competência de ${techName} (${comp.scopeDescription}) expirou. Atribuições com este escopo estão bloqueadas.`,
        relatedEntity: {
          entityType: "competence",
          entityId: competenceId,
        },
        actionUrl: `/dashboard/personnel/${competenceId}`,
        emailContext: {
          type: "competence",
          data: {
            subjectName: techName,
            scopeDescription: comp.scopeDescription,
            dueDate,
          },
        },
      };
    }
  },

  /**
   * Notify admins when a new competence request is submitted
   * Called from POST /api/competences
   */
  async *COMPETENCE_REQUESTED({
    competenceId,
    organizationId,
    requestedByUserId,
  }) {
    const [comp] = await inOrg(organizationId, (o) =>
      o
        .select({
          userId: personnelCompetence.userId,
          scopeDescription: personnelCompetence.scopeDescription,
        })
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, competenceId),
            eq(personnelCompetence.organizationId, organizationId),
          ),
        )
        .limit(1),
    );

    // userId is nullable since migration 0083 (a deleted user leaves the
    // competence with user_id NULL). These notifications are about a specific
    // technician, so skip when there is no owning user.
    if (!comp?.userId) return;

    const [requester] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, requestedByUserId))
      .limit(1);

    const [technician] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, comp.userId))
      .limit(1);

    const requesterName = requester?.name ?? "Um usuário";
    const techName = technician?.name ?? "um técnico";

    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      if (recipientId === requestedByUserId) continue;

      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "COMPETENCE_REQUESTED",
        priority: "MEDIUM",
        title: "Nova solicitação de competência",
        message: `${requesterName} solicitou qualificação para ${techName}: ${comp.scopeDescription}.`,
        relatedEntity: {
          entityType: "competence",
          entityId: competenceId,
        },
        actionUrl: `/dashboard/personnel/${competenceId}`,
        emailContext: {
          type: "competence",
          data: {
            subjectName: techName,
            scopeDescription: comp.scopeDescription,
            actorName: requesterName,
          },
        },
      };
    }
  },

  /**
   * Notify technician when their competence is approved
   * Called from POST /api/competences/:id/evaluate (when passed)
   */
  async *COMPETENCE_APPROVED({
    competenceId,
    organizationId,
    approvedByUserId,
  }) {
    const [comp] = await inOrg(organizationId, (o) =>
      o
        .select({
          userId: personnelCompetence.userId,
          scopeDescription: personnelCompetence.scopeDescription,
        })
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.id, competenceId),
            eq(personnelCompetence.organizationId, organizationId),
          ),
        )
        .limit(1),
    );

    // userId is nullable since migration 0083 (a deleted user leaves the
    // competence with user_id NULL). These notifications are about a specific
    // technician, so skip when there is no owning user.
    if (!comp?.userId) return;

    const approverName = await getUserName(approvedByUserId, "Um gestor");
    const techName = await getUserName(comp.userId, "Você");

    if (comp.userId === approvedByUserId) return;

    yield {
      recipientUserId: comp.userId,
      organizationId,
      type: "COMPETENCE_APPROVED",
      priority: "MEDIUM",
      title: "Competência aprovada",
      message: `${approverName} aprovou sua qualificação: ${comp.scopeDescription}.`,
      relatedEntity: {
        entityType: "competence",
        entityId: competenceId,
      },
      actionUrl: `/dashboard/personnel/${competenceId}`,
      emailContext: {
        type: "competence",
        data: {
          subjectName: techName,
          scopeDescription: comp.scopeDescription,
          actorName: approverName,
        },
      },
    };
  },
} satisfies Partial<NotificationRecipes>;
