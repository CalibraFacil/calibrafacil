// Recipes of the on-site visit notifications (calibração in loco): technician, customer and lab staff.
// One row per notification type: load the entity, resolve the recipients and
// yield what each one receives. `notify()` sends the yielded rows one by one.
import {
  user,
  customer,
  calibrationRequest,
  calibrationVisit,
  visitRescheduleRequest,
  organization,
  customerGroup,
} from "@calibra-facil/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { formatInstant } from "@calibra-facil/shared/format";
import { inOrg, findVisitLaboratory } from "../lab-scope";
import {
  getUserPreferences,
  getLabEmailBrand,
  getRecipientsByRole,
} from "../delivery";
import { getUserName } from "./lookups";
import type { CustomerAddress } from "@calibra-facil/db/schema";
import type { NotificationRecipes } from "./types";

/**
 * Formats the visit's on-site address to a single-line text string for the
 * customer email. Mirrors the API-side `formatOnsiteAddressText` used to
 * freeze the calibration location snapshot at job-creation time.
 */
function formatVisitAddressText(
  address: CustomerAddress | null,
): string | undefined {
  if (!address) return undefined;
  const street = [address.street, address.number].filter(Boolean).join(", ");
  const region = [address.neighbourhood, address.city, address.state]
    .filter(Boolean)
    .join(" - ");
  const text = [street, address.complement, region, address.cep]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  return text || undefined;
}

function formatVisitDate(date: Date | null): string {
  if (!date) return "data a confirmar";
  return formatInstant(date, "date");
}

async function getVisitDetails(visitId: number): Promise<{
  id: number;
  organizationId: string;
  technicianId: string | null;
  scheduledAt: Date | null;
  sourceRequestId: number | null;
  address: CustomerAddress | null;
  customerName: string;
  labName: string;
  technicianName: string | null;
  requestSubmittedBy: string | null;
  requestAuthOrganizationId: string | null;
} | null> {
  const laboratoryId = await findVisitLaboratory(visitId);
  if (!laboratoryId) return null;

  const [visit] = await inOrg(laboratoryId, (o) =>
    o
      .select({
        id: calibrationVisit.id,
        organizationId: calibrationVisit.organizationId,
        technicianId: calibrationVisit.technicianId,
        scheduledAt: calibrationVisit.scheduledAt,
        sourceRequestId: calibrationVisit.sourceRequestId,
        address: calibrationVisit.address,
        customerName: customer.name,
        labName: organization.name,
        technicianName: user.name,
        requestSubmittedBy: calibrationRequest.submittedBy,
        requestAuthOrganizationId: calibrationRequest.authOrganizationId,
      })
      .from(calibrationVisit)
      .innerJoin(customer, eq(calibrationVisit.customerId, customer.id))
      .innerJoin(
        organization,
        eq(calibrationVisit.organizationId, organization.id),
      )
      .leftJoin(user, eq(calibrationVisit.technicianId, user.id))
      .leftJoin(
        calibrationRequest,
        eq(calibrationVisit.sourceRequestId, calibrationRequest.id),
      )
      .where(eq(calibrationVisit.id, visitId))
      .limit(1),
  );

  return visit ?? null;
}

const VISIT_LAB_STAFF_ROLES = ["owner", "admin", "operator"];

/**
 * Resolve the portal (CLIENT) organization for a customer: the customer's own
 * linked org, or its group's org in multi-unit (group) mode.
 */
async function getPortalOrgForCustomer(
  laboratoryId: string,
  customerId: number,
): Promise<string | null> {
  const [row] = await inOrg(laboratoryId, (o) =>
    o
      .select({
        authOrganizationId: customer.authOrganizationId,
        groupAuthOrganizationId: customerGroup.authOrganizationId,
      })
      .from(customer)
      .leftJoin(customerGroup, eq(customer.groupId, customerGroup.id))
      .where(eq(customer.id, customerId))
      .limit(1),
  );
  return row?.authOrganizationId ?? row?.groupAuthOrganizationId ?? null;
}

export const visitRecipes = {
  /**
   * Notify the assigned technician when an on-site visit is scheduled/assigned.
   * Fired on convert (and on assign). No-op when the visit has no technician.
   */
  async *VISIT_SCHEDULED({ visitId, actorUserId }) {
    const visit = await getVisitDetails(visitId);
    if (!visit || !visit.technicianId) return;

    const isSelfAssignment = visit.technicianId === actorUserId;
    if (isSelfAssignment) {
      const { notifySelfActions } = await getUserPreferences(
        visit.technicianId,
      );
      if (!notifySelfActions) return;
    }

    const actorName = isSelfAssignment
      ? "Você"
      : await getUserName(actorUserId, "Um usuário");
    const visitDate = formatVisitDate(visit.scheduledAt);

    yield {
      recipientUserId: visit.technicianId,
      organizationId: visit.organizationId,
      type: "VISIT_SCHEDULED",
      priority: "MEDIUM",
      title: "Nova visita no local",
      message: isSelfAssignment
        ? `Você assumiu a visita ao cliente ${visit.customerName} (${visitDate}).`
        : `${actorName} agendou uma visita ao cliente ${visit.customerName} (${visitDate}) para você.`,
      relatedEntity: {
        entityType: "visit",
        entityId: visitId,
      },
      actionUrl: "/dashboard/visits",
    };
  },

  /**
   * Notify the customer (request submitter) when their on-site visit is confirmed.
   * Fired on confirm. No-op when the visit has no linked portal request.
   */
  async *VISIT_CONFIRMED({ visitId, actorUserId }) {
    const visit = await getVisitDetails(visitId);
    if (
      !visit ||
      !visit.requestSubmittedBy ||
      !visit.requestAuthOrganizationId
    ) {
      return;
    }
    if (visit.requestSubmittedBy === actorUserId) return;

    const emailBrand = await getLabEmailBrand(visit.organizationId);
    const visitDate = formatVisitDate(visit.scheduledAt);
    const technicianSuffix = visit.technicianName
      ? ` com o técnico ${visit.technicianName}`
      : "";

    yield {
      recipientUserId: visit.requestSubmittedBy,
      organizationId: visit.requestAuthOrganizationId,
      type: "VISIT_CONFIRMED",
      priority: "HIGH",
      title: "Visita no local confirmada",
      message: `${visit.labName} confirmou a visita de calibração no local para ${visitDate}${technicianSuffix}.`,
      relatedEntity: {
        entityType: "visit",
        entityId: visitId,
      },
      actionUrl: visit.sourceRequestId
        ? `/portal/requests/${visit.sourceRequestId}`
        : "/portal/requests",
      emailBrand,
      emailContext: {
        type: "visit",
        data: {
          customerName: visit.customerName,
          scheduledDate: visitDate,
          technicianName: visit.technicianName ?? undefined,
          addressText: formatVisitAddressText(visit.address),
          labName: visit.labName,
        },
      },
    };
  },

  /**
   * Notify the technician + customer when an on-site visit is rescheduled.
   * No-op for the recipient that triggered the change.
   */
  async *VISIT_RESCHEDULED({ visitId, actorUserId }) {
    const visit = await getVisitDetails(visitId);
    if (!visit) return;

    const visitDate = formatVisitDate(visit.scheduledAt);

    if (visit.technicianId && visit.technicianId !== actorUserId) {
      yield {
        recipientUserId: visit.technicianId,
        organizationId: visit.organizationId,
        type: "VISIT_RESCHEDULED",
        priority: "MEDIUM",
        title: "Visita no local reagendada",
        message: `A visita ao cliente ${visit.customerName} foi reagendada para ${visitDate}.`,
        relatedEntity: { entityType: "visit", entityId: visitId },
        actionUrl: "/dashboard/visits",
      };
    }

    if (
      visit.requestSubmittedBy &&
      visit.requestAuthOrganizationId &&
      visit.requestSubmittedBy !== actorUserId
    ) {
      yield {
        recipientUserId: visit.requestSubmittedBy,
        organizationId: visit.requestAuthOrganizationId,
        type: "VISIT_RESCHEDULED",
        priority: "HIGH",
        title: "Visita no local reagendada",
        message: `${visit.labName} reagendou sua visita de calibração no local para ${visitDate}.`,
        relatedEntity: { entityType: "visit", entityId: visitId },
        actionUrl: visit.sourceRequestId
          ? `/portal/requests/${visit.sourceRequestId}`
          : "/portal/requests",
        emailBrand: await getLabEmailBrand(visit.organizationId),
        emailContext: {
          type: "visit",
          data: {
            customerName: visit.customerName,
            scheduledDate: visitDate,
            technicianName: visit.technicianName ?? undefined,
            addressText: formatVisitAddressText(visit.address),
            labName: visit.labName,
          },
        },
      };
    }
  },

  /**
   * Notify the technician + customer when an on-site visit is cancelled.
   * No-op for the recipient that triggered the cancellation.
   */
  async *VISIT_CANCELLED({ visitId, actorUserId, reason }) {
    const visit = await getVisitDetails(visitId);
    if (!visit) return;

    const reasonSuffix = reason?.trim() ? ` Motivo: ${reason.trim()}.` : "";

    if (visit.technicianId && visit.technicianId !== actorUserId) {
      yield {
        recipientUserId: visit.technicianId,
        organizationId: visit.organizationId,
        type: "VISIT_CANCELLED",
        priority: "MEDIUM",
        title: "Visita no local cancelada",
        message: `A visita ao cliente ${visit.customerName} foi cancelada.${reasonSuffix}`,
        relatedEntity: { entityType: "visit", entityId: visitId },
        actionUrl: "/dashboard/visits",
      };
    }

    if (
      visit.requestSubmittedBy &&
      visit.requestAuthOrganizationId &&
      visit.requestSubmittedBy !== actorUserId
    ) {
      yield {
        recipientUserId: visit.requestSubmittedBy,
        organizationId: visit.requestAuthOrganizationId,
        type: "VISIT_CANCELLED",
        priority: "HIGH",
        title: "Visita no local cancelada",
        message: `${visit.labName} cancelou sua visita de calibração no local.${reasonSuffix}`,
        relatedEntity: { entityType: "visit", entityId: visitId },
        actionUrl: visit.sourceRequestId
          ? `/portal/requests/${visit.sourceRequestId}`
          : "/portal/requests",
        emailBrand: await getLabEmailBrand(visit.organizationId),
        emailContext: {
          type: "visit",
          data: {
            customerName: visit.customerName,
            scheduledDate: formatVisitDate(visit.scheduledAt),
            technicianName: visit.technicianName ?? undefined,
            addressText: formatVisitAddressText(visit.address),
            labName: visit.labName,
            reason: reason?.trim() || undefined,
          },
        },
      };
    }
  },

  /**
   * Remind the technician + customer that an on-site visit is coming up.
   * Driven by the scheduled-notifications cron (no actor — system reminder).
   */
  async *VISIT_REMINDER({ visitId }) {
    const visit = await getVisitDetails(visitId);
    if (!visit) return;

    const visitDate = formatVisitDate(visit.scheduledAt);

    if (visit.technicianId) {
      yield {
        recipientUserId: visit.technicianId,
        organizationId: visit.organizationId,
        type: "VISIT_REMINDER",
        priority: "MEDIUM",
        title: "Lembrete de visita no local",
        message: `Lembrete: visita ao cliente ${visit.customerName} em ${visitDate}.`,
        relatedEntity: { entityType: "visit", entityId: visitId },
        actionUrl: "/dashboard/visits",
      };
    }

    if (visit.requestSubmittedBy && visit.requestAuthOrganizationId) {
      yield {
        recipientUserId: visit.requestSubmittedBy,
        organizationId: visit.requestAuthOrganizationId,
        type: "VISIT_REMINDER",
        priority: "MEDIUM",
        title: "Lembrete de visita no local",
        message: `Lembrete: ${visit.labName} fará a visita de calibração no local em ${visitDate}.`,
        relatedEntity: { entityType: "visit", entityId: visitId },
        actionUrl: visit.sourceRequestId
          ? `/portal/requests/${visit.sourceRequestId}`
          : "/portal/requests",
        emailBrand: await getLabEmailBrand(visit.organizationId),
        emailContext: {
          type: "visit",
          data: {
            customerName: visit.customerName,
            scheduledDate: visitDate,
            technicianName: visit.technicianName ?? undefined,
            addressText: formatVisitAddressText(visit.address),
            labName: visit.labName,
          },
        },
      };
    }
  },

  /**
   * #739: notify the lab (unit staff) that the portal customer confirmed
   * attendance for a visit — schedulers chase only the unconfirmed ones.
   */
  async *VISIT_CUSTOMER_CONFIRMED({ visitId, actorUserId }) {
    const visit = await getVisitDetails(visitId);
    if (!visit) return;

    const visitDate = formatVisitDate(visit.scheduledAt);
    const recipients = await getRecipientsByRole(
      visit.organizationId,
      VISIT_LAB_STAFF_ROLES,
    );

    for (const recipientId of recipients) {
      if (recipientId === actorUserId) continue;
      yield {
        recipientUserId: recipientId,
        organizationId: visit.organizationId,
        type: "VISIT_CUSTOMER_CONFIRMED",
        priority: "MEDIUM",
        title: "Cliente confirmou presença na visita",
        message: `${visit.customerName} confirmou que estará pronto para receber o técnico em ${visitDate}.`,
        relatedEntity: { entityType: "visit", entityId: visitId },
        actionUrl: `/dashboard/visits/${visitId}`,
      };
    }
  },

  /**
   * #739: notify the lab (unit staff) that the portal customer asked to
   * reschedule a visit — actionable: someone must accept or decline.
   */
  async *VISIT_RESCHEDULE_REQUESTED({ visitId, actorUserId }) {
    const visit = await getVisitDetails(visitId);
    if (!visit) return;

    const visitDate = formatVisitDate(visit.scheduledAt);
    const recipients = await getRecipientsByRole(
      visit.organizationId,
      VISIT_LAB_STAFF_ROLES,
    );

    for (const recipientId of recipients) {
      if (recipientId === actorUserId) continue;
      yield {
        recipientUserId: recipientId,
        organizationId: visit.organizationId,
        type: "VISIT_RESCHEDULE_REQUESTED",
        priority: "HIGH",
        title: "Cliente solicitou reagendamento de visita",
        message: `${visit.customerName} solicitou o reagendamento da visita de ${visitDate}. Aceite ou recuse a solicitação.`,
        relatedEntity: { entityType: "visit", entityId: visitId },
        actionUrl: `/dashboard/visits/${visitId}`,
      };
    }
  },

  /**
   * #739: notify the requesting portal user that the lab declined their
   * reschedule request (the visit keeps its date). The recipient is whoever
   * opened the most recently declined request, not the original request
   * submitter — in group mode those can differ.
   */
  async *VISIT_RESCHEDULE_DECLINED({ visitId, actorUserId, reason }) {
    const visit = await getVisitDetails(visitId);
    if (!visit) return;

    const [declined] = await inOrg(visit.organizationId, (o) =>
      o
        .select({
          requestedBy: visitRescheduleRequest.requestedBy,
          customerId: visitRescheduleRequest.customerId,
        })
        .from(visitRescheduleRequest)
        .where(
          and(
            eq(visitRescheduleRequest.visitId, visitId),
            eq(visitRescheduleRequest.status, "DECLINED"),
          ),
        )
        .orderBy(
          desc(visitRescheduleRequest.resolvedAt),
          desc(visitRescheduleRequest.id),
        )
        .limit(1),
    );
    if (!declined || declined.requestedBy === actorUserId) return;

    const portalOrgId = await getPortalOrgForCustomer(
      visit.organizationId,
      declined.customerId,
    );
    if (!portalOrgId) return;

    const visitDate = formatVisitDate(visit.scheduledAt);

    yield {
      recipientUserId: declined.requestedBy,
      organizationId: portalOrgId,
      type: "VISIT_RESCHEDULE_DECLINED",
      priority: "HIGH",
      title: "Reagendamento não foi possível",
      message: reason
        ? `${visit.labName} não pôde reagendar a visita de ${visitDate}: ${reason}`
        : `${visit.labName} não pôde reagendar a visita de ${visitDate}. A data original está mantida.`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: "/portal/calendar",
      emailBrand: await getLabEmailBrand(visit.organizationId),
      emailContext: {
        type: "visit",
        data: {
          customerName: visit.customerName,
          scheduledDate: visitDate,
          technicianName: visit.technicianName ?? undefined,
          addressText: formatVisitAddressText(visit.address),
          labName: visit.labName,
          reason,
        },
      },
    };
  },
} satisfies Partial<NotificationRecipes>;
