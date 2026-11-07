// Recipes of the non-conformance notifications.
// One row per notification type: load the entity, resolve the recipients and
// yield what each one receives. `notify()` sends the yielded rows one by one.

import { getUserName, adminsAndOwners } from "./lookups";
import type { NotificationRecipes } from "./types";

export const ncRecipes = {
  /**
   * Notify admins/owners when a new non-conformance is created
   * Called from POST /api/nc
   */
  async *NC_CREATED({
    ncId,
    ncNumber,
    ncType,
    description,
    organizationId,
    createdByUserId,
  }) {
    const creatorName = await getUserName(createdByUserId, "Um usuário");
    const typeLabel =
      ncType === "work"
        ? "trabalho"
        : ncType === "equipment"
          ? "equipamento"
          : ncType === "out_of_tolerance"
            ? "fora de tolerância"
            : "documentação";

    // Notify admins and owners
    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      // Don't notify the creator
      if (recipientId === createdByUserId) continue;

      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "NC_CREATED",
        priority: "HIGH",
        title: "Nova não conformidade registrada",
        message: `${creatorName} registrou a ${ncNumber} (${typeLabel}).`,
        relatedEntity: {
          entityType: "nc",
          entityId: ncId,
        },
        actionUrl: `/dashboard/nc/${ncId}`,
        emailContext: {
          type: "nc",
          data: {
            ncNumber,
            ncType,
            description,
            actorName: creatorName,
          },
        },
      };
    }
  },

  /**
   * Notify admins/owners when a customer acknowledges a §7.10 out-of-tolerance
   * notification (#426 Phase 0). Called from the public ack route and recorded
   * against the owning NC.
   */
  async *OOT_NOTIFICATION_ACKNOWLEDGED({
    notificationId,
    ncId,
    ncNumber,
    organizationId,
  }) {
    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "OOT_NOTIFICATION_ACKNOWLEDGED",
        priority: "MEDIUM",
        title: "Notificação 7.10 confirmada pelo cliente",
        message: `O cliente confirmou o recebimento da notificação de fora de tolerância da ${ncNumber} (notificação #${notificationId}).`,
        relatedEntity: {
          entityType: "nc",
          entityId: ncId,
        },
        actionUrl: `/dashboard/nc/${ncId}`,
      };
    }
  },

  /**
   * Notify admins/owners when an NC is escalated to CAPA
   * Called from POST /api/nc/:id/escalate-to-capa
   */
  async *NC_ESCALATED_TO_CAPA({
    ncNumber,
    capaId,
    capaNumber,
    description,
    organizationId,
    escalatedByUserId,
  }) {
    const escalatorName = await getUserName(escalatedByUserId, "Um usuário");

    // Notify admins and owners
    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      // Don't notify the person who escalated
      if (recipientId === escalatedByUserId) continue;

      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "NC_ESCALATED_TO_CAPA",
        priority: "HIGH",
        title: "NC escalada para CAPA",
        message: `${escalatorName} escalou a ${ncNumber} para ${capaNumber}.`,
        relatedEntity: {
          entityType: "capa",
          entityId: capaId,
        },
        actionUrl: `/dashboard/capa/${capaId}`,
        emailContext: {
          type: "nc",
          data: {
            ncNumber,
            description,
            capaNumber,
            actorName: escalatorName,
          },
        },
      };
    }
  },
} satisfies Partial<NotificationRecipes>;
