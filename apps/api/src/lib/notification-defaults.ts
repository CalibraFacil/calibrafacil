import type { NotificationPreferenceMap } from "@calibra-facil/db/schema";

/**
 * Default notification preferences for new users.
 * All operational notifications enabled by default for ISO 17025 compliance.
 * Shared by the lab notifications router and the portal digest opt-in (both
 * create the user's notification_preference row on first write).
 */
export const DEFAULT_PREFERENCES: NotificationPreferenceMap = {
  JOB_SUBMITTED_FOR_REVIEW: { inApp: true, email: true },
  JOB_APPROVED: { inApp: true, email: true },
  JOB_REJECTED: { inApp: true, email: true },
  JOB_ASSIGNED: { inApp: true, email: false },
  CERTIFICATE_READY: { inApp: true, email: true },
  CERTIFICATE_AMENDED: { inApp: true, email: true },
  ASSET_DUE_FOR_RECALIBRATION: { inApp: true, email: true },
  STANDARD_EXPIRING: { inApp: true, email: true },
  STANDARD_EXPIRED: { inApp: true, email: true },
  JOB_OVERDUE: { inApp: true, email: true },
  PAYMENT_RECEIVED: { inApp: true, email: true },
  PAYMENT_FAILED: { inApp: true, email: true },
  NC_CREATED: { inApp: true, email: true },
  NC_ESCALATED_TO_CAPA: { inApp: true, email: true },
  COMPETENCE_EXPIRING: { inApp: true, email: true },
  COMPETENCE_EXPIRED: { inApp: true, email: true },
  COMPETENCE_REQUESTED: { inApp: true, email: true },
  COMPETENCE_APPROVED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_WORKFLOW_BLOCKED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_GO_LIVE_AT_RISK: { inApp: true, email: true },
  CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE: { inApp: true, email: true },
  CUSTOMER_SUCCESS_SLA_DUE_SOON: { inApp: true, email: true },
  CUSTOMER_SUCCESS_SLA_BREACHED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_ESCALATION_REQUIRED: { inApp: true, email: true },
  SUPPORT_REQUEST_REPLIED: { inApp: true, email: true },
  CALIBRATION_REQUEST_SUBMITTED: { inApp: true, email: true },
  CALIBRATION_REQUEST_UNDER_REVIEW: { inApp: true, email: true },
  CALIBRATION_REQUEST_APPROVED: { inApp: true, email: true },
  CALIBRATION_REQUEST_REJECTED: { inApp: true, email: true },
  CALIBRATION_REQUEST_CONVERTED: { inApp: true, email: true },
  VISIT_SCHEDULED: { inApp: true, email: false },
  VISIT_CONFIRMED: { inApp: true, email: true },
};
