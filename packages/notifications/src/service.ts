// Notifications, one door: `notify(type, payload)` runs the type's recipe
// (recipes/*.ts: entity reads, recipients, in-app copy, e-mail context) and
// hands each yielded row to `sendNotification` (delivery.ts: preferences,
// in-app row, e-mail). The `notifyXxx` functions below are one-line wrappers
// kept for the API, worker and jobs-core callers; call `notify` directly.
import type { NotificationType } from "@calibra-facil/schemas";
import { sendNotification } from "./delivery";
import { NOTIFICATION_RECIPES, type NotificationPayloads } from "./recipes";

export {
  getLabEmailBrand,
  getRecipientsByRole,
  sendNotification,
  type NotificationResult,
  type SendNotificationOptions,
} from "./delivery";
export {
  sendPortalDueDigests,
  type PortalDigestRunResult,
} from "./portal-digest";
export type { NotificationPayloads } from "./recipes";

/** Send the notification of `type` to everyone its recipe resolves. */
export async function notify<T extends NotificationType>(
  type: T,
  payload: NotificationPayloads[T],
): Promise<void> {
  for await (const row of NOTIFICATION_RECIPES[type](payload)) {
    await sendNotification(row);
  }
}

// =============================================================================
// WRAPPERS (callers should move to `notify`)
// =============================================================================

export function notifyCalibrationRequestSubmitted(
  requestId: number,
): Promise<void> {
  return notify("CALIBRATION_REQUEST_SUBMITTED", { requestId });
}

export function notifyCalibrationRequestUnderReview(
  requestId: number,
  actorUserId: string,
): Promise<void> {
  return notify("CALIBRATION_REQUEST_UNDER_REVIEW", { requestId, actorUserId });
}

export function notifyCalibrationRequestApproved(
  requestId: number,
  actorUserId: string,
): Promise<void> {
  return notify("CALIBRATION_REQUEST_APPROVED", { requestId, actorUserId });
}

export function notifyCalibrationRequestRejected(
  requestId: number,
  actorUserId: string,
  reason: string,
): Promise<void> {
  return notify("CALIBRATION_REQUEST_REJECTED", {
    requestId,
    actorUserId,
    reason,
  });
}

export function notifyCalibrationRequestConverted(
  requestId: number,
  actorUserId: string,
  jobCodes: string[],
): Promise<void> {
  return notify("CALIBRATION_REQUEST_CONVERTED", {
    requestId,
    actorUserId,
    jobCodes,
  });
}

export function notifyVisitScheduled(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  return notify("VISIT_SCHEDULED", { visitId, actorUserId });
}

export function notifyVisitConfirmed(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  return notify("VISIT_CONFIRMED", { visitId, actorUserId });
}

export function notifyVisitRescheduled(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  return notify("VISIT_RESCHEDULED", { visitId, actorUserId });
}

export function notifyVisitCancelled(
  visitId: number,
  actorUserId: string,
  reason?: string,
): Promise<void> {
  return notify("VISIT_CANCELLED", { visitId, actorUserId, reason });
}

export function notifyVisitReminder(visitId: number): Promise<void> {
  return notify("VISIT_REMINDER", { visitId });
}

export function notifyVisitCustomerConfirmed(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  return notify("VISIT_CUSTOMER_CONFIRMED", { visitId, actorUserId });
}

export function notifyVisitRescheduleRequested(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  return notify("VISIT_RESCHEDULE_REQUESTED", { visitId, actorUserId });
}

export function notifyVisitRescheduleDeclined(
  visitId: number,
  actorUserId: string,
  reason?: string,
): Promise<void> {
  return notify("VISIT_RESCHEDULE_DECLINED", { visitId, actorUserId, reason });
}

export function notifyJobSubmittedForReview(
  jobId: number,
  submittedByUserId: string,
): Promise<void> {
  return notify("JOB_SUBMITTED_FOR_REVIEW", { jobId, submittedByUserId });
}

export function notifyJobApproved(
  jobId: number,
  approvedByUserId: string,
): Promise<void> {
  return notify("JOB_APPROVED", { jobId, approvedByUserId });
}

export function notifyJobRejected(
  jobId: number,
  rejectedByUserId: string,
  reason: string,
): Promise<void> {
  return notify("JOB_REJECTED", { jobId, rejectedByUserId, reason });
}

export function notifyJobAssigned(
  jobId: number,
  technicianId: string,
  assignedByUserId: string,
): Promise<void> {
  return notify("JOB_ASSIGNED", { jobId, technicianId, assignedByUserId });
}

export function notifyJobOverdue(jobId: number): Promise<void> {
  return notify("JOB_OVERDUE", { jobId });
}

export function notifySigningCertificateLapsed(
  jobId: number,
  reason: string,
): Promise<void> {
  return notify("SIGNING_CERTIFICATE_LAPSED", { jobId, reason });
}

export function notifyCertificateReady(jobId: number): Promise<void> {
  return notify("CERTIFICATE_READY", { jobId });
}

export function notifyAssetFoundOutOfTolerance(jobId: number): Promise<void> {
  return notify("ASSET_FOUND_OUT_OF_TOLERANCE", { jobId });
}

export function notifyAuditPackReady(exportId: number): Promise<void> {
  return notify("AUDIT_PACK_READY", { exportId });
}

export function notifyCertificateAmended(
  originalJobId: number,
  amendedJobId: number,
  reason: string,
): Promise<void> {
  return notify("CERTIFICATE_AMENDED", { originalJobId, amendedJobId, reason });
}

export function notifyAssetDueForRecalibration(
  assetId: number,
  organizationId: string,
): Promise<void> {
  return notify("ASSET_DUE_FOR_RECALIBRATION", { assetId, organizationId });
}

export function notifyAssetDueForLegalVerification(
  assetId: number,
  organizationId: string,
): Promise<void> {
  return notify("ASSET_DUE_FOR_LEGAL_VERIFICATION", {
    assetId,
    organizationId,
  });
}

export function notifyStandardExpiring(
  standardId: number,
  organizationId: string,
): Promise<void> {
  return notify("STANDARD_EXPIRING", { standardId, organizationId });
}

export function notifyPtPlanDue(
  planItemId: number,
  organizationId: string,
): Promise<void> {
  return notify("PT_PLAN_DUE", { planItemId, organizationId });
}

export function notifyStandardExpired(
  standardId: number,
  organizationId: string,
): Promise<void> {
  return notify("STANDARD_EXPIRED", { standardId, organizationId });
}

export function notifySigningCertificateExpiring(
  certificateId: number,
  organizationId: string,
  context: { daysRemaining: number },
): Promise<void> {
  return notify("SIGNING_CERTIFICATE_EXPIRING", {
    certificateId,
    organizationId,
    context,
  });
}

export function notifyAuditChainBroken(
  organizationId: string,
  context: {
    table: string;
    kind: string;
    chainSeq: number | null;
    rowId: number | null;
  },
): Promise<void> {
  return notify("AUDIT_CHAIN_BROKEN", { organizationId, context });
}

export function notifyAccreditationExpiring(
  organizationId: string,
  context: { daysRemaining: number; validUntil: Date },
): Promise<void> {
  return notify("ACCREDITATION_EXPIRING", { organizationId, context });
}

export function notifyAccreditedScopeLineExpiring(
  scopeLineId: number,
  organizationId: string,
  context: { daysRemaining: number },
): Promise<void> {
  return notify("ACCREDITED_SCOPE_LINE_EXPIRING", {
    scopeLineId,
    organizationId,
    context,
  });
}

export function notifyNCCreated(
  ncId: number,
  ncNumber: string,
  ncType: "work" | "equipment" | "documentation" | "out_of_tolerance",
  description: string,
  organizationId: string,
  createdByUserId: string,
): Promise<void> {
  return notify("NC_CREATED", {
    ncId,
    ncNumber,
    ncType,
    description,
    organizationId,
    createdByUserId,
  });
}

export function notifyOotAcknowledged(
  notificationId: number,
  ncId: number,
  ncNumber: string,
  organizationId: string,
): Promise<void> {
  return notify("OOT_NOTIFICATION_ACKNOWLEDGED", {
    notificationId,
    ncId,
    ncNumber,
    organizationId,
  });
}

export function notifyNCEscalatedToCapa(
  ncId: number,
  ncNumber: string,
  capaId: number,
  capaNumber: string,
  description: string,
  organizationId: string,
  escalatedByUserId: string,
): Promise<void> {
  return notify("NC_ESCALATED_TO_CAPA", {
    ncId,
    ncNumber,
    capaId,
    capaNumber,
    description,
    organizationId,
    escalatedByUserId,
  });
}

export function notifyCompetenceExpiring(
  competenceId: number,
  organizationId: string,
): Promise<void> {
  return notify("COMPETENCE_EXPIRING", { competenceId, organizationId });
}

export function notifyCompetenceExpired(
  competenceId: number,
  organizationId: string,
): Promise<void> {
  return notify("COMPETENCE_EXPIRED", { competenceId, organizationId });
}

export function notifyCompetenceRequested(
  competenceId: number,
  organizationId: string,
  requestedByUserId: string,
): Promise<void> {
  return notify("COMPETENCE_REQUESTED", {
    competenceId,
    organizationId,
    requestedByUserId,
  });
}

export function notifyCompetenceApproved(
  competenceId: number,
  organizationId: string,
  approvedByUserId: string,
): Promise<void> {
  return notify("COMPETENCE_APPROVED", {
    competenceId,
    organizationId,
    approvedByUserId,
  });
}
