// Notification Service - Core exports
export {
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
  notifySigningCertificateLapsed,
  notifyAuditChainBroken,
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
} from "./service";

// Pure pt-BR copy builder for the legal-metrology verification reminder

// Pure decider for the ICP-Brasil A1 signing-certificate expiry alert (CMP-02)
export {
  decideSigningCertificateExpiryAlert,
  SIGNING_CERTIFICATE_EXPIRY_LEAD_DAYS,
} from "./signing-certificate-expiry";

// Email suppression / unsubscribe list (issue #577)
export { suppressEmail, isEmailSuppressed } from "./suppression";

// §7.10 out-of-tolerance customer-facing email dispatcher (#426 Phase 0)
export { sendOotCustomerEmail } from "./oot-customer-email";

// Service-order customer-facing email dispatcher (mini-spec A)
export {
  sendServiceOrderCustomerEmail,
  resolveServiceOrderRecipient,
  type ServiceOrderCustomerEmailResult,
} from "./service-order-customer-email";
