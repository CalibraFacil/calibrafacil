// Internal lead-capture notification (marketing site)
export { notifyNewLead, type NewLeadNotification } from "./lead";

// Notification Service - Core exports
export {
  sendNotification,
  getRecipientsByRole,
  notifyJobSubmittedForReview,
  notifyJobApproved,
  notifyJobRejected,
  notifyJobAssigned,
  notifyCertificateReady,
  notifyCertificateAmended,
  notifyAuditPackReady,
  notifyNCCreated,
  notifyNCEscalatedToCapa,
  notifyOotAcknowledged,
  notifyCompetenceApproved,
  notifyCompetenceRequested,
  notifyCompetenceExpiring,
  notifyCompetenceExpired,
  notifyAssetDueForRecalibration,
  notifyAssetDueForLegalVerification,
  notifyStandardExpiring,
  notifyStandardExpired,
  notifyPtPlanDue,
  notifyAssetFoundOutOfTolerance,
  notifySigningCertificateExpiring,
  notifyAccreditationExpiring,
  notifyAccreditedScopeLineExpiring,
  notifyJobOverdue,
  notifyCalibrationRequestSubmitted,
  notifyCalibrationRequestUnderReview,
  notifyCalibrationRequestApproved,
  notifyCalibrationRequestRejected,
  notifyCalibrationRequestConverted,
  notifyVisitScheduled,
  notifyVisitConfirmed,
  notifyVisitRescheduled,
  notifyVisitCancelled,
  notifyVisitReminder,
  notifyVisitCustomerConfirmed,
  notifyVisitRescheduleRequested,
  notifyVisitRescheduleDeclined,
  sendPortalDueDigests,
  getLabEmailBrand,
  type PortalDigestRunResult,
  type SendNotificationOptions,
  type NotificationResult,
} from "./service";

// Pure pt-BR copy builder for the legal-metrology verification reminder
export { buildLegalVerificationMessage } from "./legal-verification-message";

// Pure decider for the ICP-Brasil A1 signing-certificate expiry alert (CMP-02)
export {
  decideSigningCertificateExpiryAlert,
  daysUntilCalendar,
  SIGNING_CERTIFICATE_EXPIRY_LEAD_DAYS,
  type SigningCertificateExpiryInput,
  type SigningCertificateExpiryDecision,
} from "./signing-certificate-expiry";

// Email suppression / unsubscribe list (issue #577)
export {
  suppressEmail,
  isEmailSuppressed,
  normalizeSuppressionEmail,
  suppressionScopesToCheck,
  type SuppressEmailInput,
  type EmailSuppressionScope,
  type EmailSuppressionReason,
  type EmailSuppressionSource,
} from "./suppression";

// §7.10 out-of-tolerance customer-facing email dispatcher (#426 Phase 0)
export {
  sendOotCustomerEmail,
  type OotCustomerEmailInput,
  type OotCustomerEmailResult,
} from "./oot-customer-email";

// Service-order customer-facing email dispatcher (mini-spec A)
export {
  sendServiceOrderCustomerEmail,
  resolveServiceOrderRecipient,
  type ServiceOrderEmailInput,
  type ServiceOrderEmailRenderContext,
  type ServiceOrderDispatchTarget,
  type CustomerDispatchTarget,
  type ServiceOrderCustomerEmailResult,
} from "./service-order-customer-email";
