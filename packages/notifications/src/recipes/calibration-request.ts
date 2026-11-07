// Recipes of the calibration-request notifications (portal customer to lab and back).
// One row per notification type: load the entity, resolve the recipients and
// yield what each one receives. `notify()` sends the yielded rows one by one.
import {
  customer,
  calibrationRequest,
  calibrationRequestItem,
  organization,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { formatCalendarDate } from "@calibra-facil/shared/format";
import { inOrg, findCalibrationRequestLaboratory } from "../lab-scope";
import { getLabEmailBrand, getRecipientsByRole } from "../delivery";
import { getUserName } from "./lookups";
import type { CalibrationRequestEmailContext } from "../delivery";
import type { NotificationRecipes } from "./types";

async function getCalibrationRequestDetails(requestId: number): Promise<{
  id: number;
  organizationId: string;
  authOrganizationId: string;
  submittedBy: string;
  customerName: string;
  labName: string;
  itemCount: number;
  requestedDueDate: Date | null;
} | null> {
  const laboratoryId = await findCalibrationRequestLaboratory(requestId);
  if (!laboratoryId) return null;

  return inOrg(laboratoryId, async (o) => {
    const [request] = await o
      .select({
        id: calibrationRequest.id,
        organizationId: calibrationRequest.organizationId,
        authOrganizationId: calibrationRequest.authOrganizationId,
        submittedBy: calibrationRequest.submittedBy,
        requestedDueDate: calibrationRequest.requestedDueDate,
        customerName: customer.name,
        labName: organization.name,
      })
      .from(calibrationRequest)
      .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
      .innerJoin(
        organization,
        eq(calibrationRequest.organizationId, organization.id),
      )
      .where(eq(calibrationRequest.id, requestId))
      .limit(1);

    if (!request) return null;

    const items = await o
      .select({ id: calibrationRequestItem.id })
      .from(calibrationRequestItem)
      .where(
        and(
          eq(calibrationRequestItem.requestId, requestId),
          eq(calibrationRequestItem.organizationId, request.organizationId),
        ),
      );

    return {
      ...request,
      itemCount: items.length,
    };
  });
}

function createCalibrationRequestEmailContext(
  details: NonNullable<
    Awaited<ReturnType<typeof getCalibrationRequestDetails>>
  >,
  extras: {
    actorName?: string;
    reason?: string;
    jobCodes?: string[];
  } = {},
): CalibrationRequestEmailContext {
  return {
    requestId: details.id,
    customerName: details.customerName,
    labName: details.labName,
    itemCount: details.itemCount,
    requestedDueDate: details.requestedDueDate
      ? formatCalendarDate(details.requestedDueDate)
      : undefined,
    ...extras,
  };
}

export const calibrationRequestRecipes = {
  async *CALIBRATION_REQUEST_SUBMITTED({ requestId }) {
    const details = await getCalibrationRequestDetails(requestId);
    if (!details) return;

    const recipients = await getRecipientsByRole(details.organizationId, [
      "owner",
      "admin",
      "operator",
    ]);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId: details.organizationId,
        type: "CALIBRATION_REQUEST_SUBMITTED",
        priority: "HIGH",
        title: "Nova solicitação de calibração",
        message: `${details.customerName} enviou a solicitação #${requestId} com ${details.itemCount} ${details.itemCount === 1 ? "item" : "itens"}.`,
        relatedEntity: {
          entityType: "request",
          entityId: requestId,
        },
        actionUrl: `/dashboard/requests/${requestId}`,
        emailContext: {
          type: "calibrationRequest",
          data: createCalibrationRequestEmailContext(details),
        },
      };
    }
  },

  async *CALIBRATION_REQUEST_UNDER_REVIEW({ requestId, actorUserId }) {
    const details = await getCalibrationRequestDetails(requestId);
    if (!details || details.submittedBy === actorUserId) return;

    const actorName = await getUserName(actorUserId, "Um usuário");
    const emailBrand = await getLabEmailBrand(details.organizationId);

    yield {
      recipientUserId: details.submittedBy,
      organizationId: details.authOrganizationId,
      type: "CALIBRATION_REQUEST_UNDER_REVIEW",
      priority: "MEDIUM",
      title: "Solicitação em análise",
      message: `${details.labName} começou a analisar a solicitação #${requestId}.`,
      relatedEntity: {
        entityType: "request",
        entityId: requestId,
      },
      actionUrl: `/portal/requests/${requestId}`,
      emailContext: {
        type: "calibrationRequest",
        data: createCalibrationRequestEmailContext(details, { actorName }),
      },
      emailBrand,
    };
  },

  async *CALIBRATION_REQUEST_APPROVED({ requestId, actorUserId }) {
    const details = await getCalibrationRequestDetails(requestId);
    if (!details || details.submittedBy === actorUserId) return;

    const actorName = await getUserName(actorUserId, "Um usuário");
    const emailBrand = await getLabEmailBrand(details.organizationId);

    yield {
      recipientUserId: details.submittedBy,
      organizationId: details.authOrganizationId,
      type: "CALIBRATION_REQUEST_APPROVED",
      priority: "HIGH",
      title: "Solicitação de calibração aprovada",
      message: `${details.labName} aprovou a solicitação #${requestId}.`,
      relatedEntity: {
        entityType: "request",
        entityId: requestId,
      },
      actionUrl: `/portal/requests/${requestId}`,
      emailContext: {
        type: "calibrationRequest",
        data: createCalibrationRequestEmailContext(details, { actorName }),
      },
      emailBrand,
    };
  },

  async *CALIBRATION_REQUEST_REJECTED({ requestId, actorUserId, reason }) {
    const details = await getCalibrationRequestDetails(requestId);
    if (!details || details.submittedBy === actorUserId) return;

    const actorName = await getUserName(actorUserId, "Um usuário");
    const emailBrand = await getLabEmailBrand(details.organizationId);

    yield {
      recipientUserId: details.submittedBy,
      organizationId: details.authOrganizationId,
      type: "CALIBRATION_REQUEST_REJECTED",
      priority: "HIGH",
      title: "Solicitação de calibração recusada",
      message: `${details.labName} recusou a solicitação #${requestId}. Motivo: ${reason}`,
      relatedEntity: {
        entityType: "request",
        entityId: requestId,
      },
      actionUrl: `/portal/requests/${requestId}`,
      emailContext: {
        type: "calibrationRequest",
        data: createCalibrationRequestEmailContext(details, {
          actorName,
          reason,
        }),
      },
      emailBrand,
    };
  },

  async *CALIBRATION_REQUEST_CONVERTED({ requestId, actorUserId, jobCodes }) {
    const details = await getCalibrationRequestDetails(requestId);
    if (!details || details.submittedBy === actorUserId) return;

    const actorName = await getUserName(actorUserId, "Um usuário");
    const emailBrand = await getLabEmailBrand(details.organizationId);

    yield {
      recipientUserId: details.submittedBy,
      organizationId: details.authOrganizationId,
      type: "CALIBRATION_REQUEST_CONVERTED",
      priority: "HIGH",
      title: "Solicitação convertida em ordem de serviço",
      message: `${details.labName} converteu a solicitação #${requestId} em ${jobCodes.length} ${jobCodes.length === 1 ? "ordem de serviço" : "ordens de serviço"}.`,
      relatedEntity: {
        entityType: "request",
        entityId: requestId,
      },
      actionUrl: `/portal/requests/${requestId}`,
      emailContext: {
        type: "calibrationRequest",
        data: createCalibrationRequestEmailContext(details, {
          actorName,
          jobCodes,
        }),
      },
      emailBrand,
    };
  },
} satisfies Partial<NotificationRecipes>;
