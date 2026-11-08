// What a recipe is handed, and what it yields. NotificationPayloads has one
// entry per type of the registry (packages/schemas/src/notification-types.ts):
// the compiler refuses a registry type without a payload and a recipe.
import type { NotificationType } from "@calibra-facil/schemas";
import type { SendNotificationOptions } from "../delivery";

/** The arguments of each notification type, named. */
export interface NotificationPayloads {
  CALIBRATION_REQUEST_SUBMITTED: { requestId: number };
  CALIBRATION_REQUEST_UNDER_REVIEW: { requestId: number; actorUserId: string };
  CALIBRATION_REQUEST_APPROVED: { requestId: number; actorUserId: string };
  CALIBRATION_REQUEST_REJECTED: {
    requestId: number;
    actorUserId: string;
    reason: string;
  };
  CALIBRATION_REQUEST_CONVERTED: {
    requestId: number;
    actorUserId: string;
    jobCodes: string[];
  };
  VISIT_SCHEDULED: { visitId: number; actorUserId: string };
  VISIT_CONFIRMED: { visitId: number; actorUserId: string };
  VISIT_RESCHEDULED: { visitId: number; actorUserId: string };
  VISIT_CANCELLED: { visitId: number; actorUserId: string; reason?: string };
  VISIT_REMINDER: { visitId: number };
  VISIT_CUSTOMER_CONFIRMED: { visitId: number; actorUserId: string };
  VISIT_RESCHEDULE_REQUESTED: { visitId: number; actorUserId: string };
  VISIT_RESCHEDULE_DECLINED: {
    visitId: number;
    actorUserId: string;
    reason?: string;
  };
  JOB_SUBMITTED_FOR_REVIEW: { jobId: number; submittedByUserId: string };
  JOB_APPROVED: { jobId: number; approvedByUserId: string };
  JOB_REJECTED: { jobId: number; rejectedByUserId: string; reason: string };
  JOB_ASSIGNED: {
    jobId: number;
    technicianId: string;
    assignedByUserId: string;
  };
  JOB_OVERDUE: { jobId: number };
  SIGNING_CERTIFICATE_LAPSED: { jobId: number; reason: string };
  CERTIFICATE_READY: { jobId: number };
  ASSET_FOUND_OUT_OF_TOLERANCE: { jobId: number };
  AUDIT_PACK_READY: { exportId: number };
  CERTIFICATE_AMENDED: {
    originalJobId: number;
    amendedJobId: number;
    reason: string;
  };
  ASSET_DUE_FOR_RECALIBRATION: { assetId: number; organizationId: string };
  ASSET_DUE_FOR_LEGAL_VERIFICATION: { assetId: number; organizationId: string };
  STANDARD_EXPIRING: { standardId: number; organizationId: string };
  PT_PLAN_DUE: { planItemId: number; organizationId: string };
  STANDARD_EXPIRED: { standardId: number; organizationId: string };
  SIGNING_CERTIFICATE_EXPIRING: {
    certificateId: number;
    organizationId: string;
    context: { daysRemaining: number };
  };
  AUDIT_CHAIN_BROKEN: {
    organizationId: string;
    context: {
      table: string;
      kind: string;
      chainSeq: number | null;
      rowId: number | null;
    };
  };
  ACCREDITATION_EXPIRING: {
    organizationId: string;
    context: { daysRemaining: number; validUntil: Date };
  };
  ACCREDITED_SCOPE_LINE_EXPIRING: {
    scopeLineId: number;
    organizationId: string;
    context: { daysRemaining: number };
  };
  NC_CREATED: {
    ncId: number;
    ncNumber: string;
    ncType: "work" | "equipment" | "documentation" | "out_of_tolerance";
    description: string;
    organizationId: string;
    createdByUserId: string;
  };
  OOT_NOTIFICATION_ACKNOWLEDGED: {
    notificationId: number;
    ncId: number;
    ncNumber: string;
    organizationId: string;
  };
  NC_ESCALATED_TO_CAPA: {
    ncId: number;
    ncNumber: string;
    capaId: number;
    capaNumber: string;
    description: string;
    organizationId: string;
    escalatedByUserId: string;
  };
  COMPETENCE_EXPIRING: { competenceId: number; organizationId: string };
  COMPETENCE_EXPIRED: { competenceId: number; organizationId: string };
  COMPETENCE_REQUESTED: {
    competenceId: number;
    organizationId: string;
    requestedByUserId: string;
  };
  COMPETENCE_APPROVED: {
    competenceId: number;
    organizationId: string;
    approvedByUserId: string;
  };
}

/**
 * Loads what the notification is about, decides who receives it and yields one
 * row per recipient (in-app copy, link, e-mail context), each of the recipe's
 * own `type`. The yield is lazy:
 * the next recipient's reads happen only after the previous row was sent.
 */
type NotificationRecipe<T extends NotificationType> = (
  payload: NotificationPayloads[T],
) => AsyncGenerator<SendNotificationOptions & { type: T }, void, undefined>;

/** The whole table: one recipe per registry type. */
export type NotificationRecipes = {
  [T in NotificationType]: NotificationRecipe<T>;
};
