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
  notifyNCCreated,
  notifyNCEscalatedToCapa,
  notifyCompetenceApproved,
  notifyCompetenceRequested,
  notifyCompetenceExpiring,
  notifyCompetenceExpired,
  notifyAssetDueForRecalibration,
  notifyAssetDueForLegalVerification,
  notifyStandardExpiring,
  notifyStandardExpired,
  notifySigningCertificateExpiring,
  notifyJobOverdue,
  notifyPaymentReceived,
  notifyPaymentFailed,
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

// Resend marketing-audience sync (lab staff → Contacts; foundation for Broadcasts)
export {
  syncLabUsersToResendAudience,
  selectLabAudienceContacts,
  type ResendAudienceSyncEnv,
  type ResendAudienceSyncDeps,
  type ResendAudienceSyncResult,
  type RawAudienceMemberRow,
  type LabAudienceContact,
} from "./resend-audience-sync";

export {
  createResendContactsClient,
  type ResendContactsClient,
  type ResendContactsClientConfig,
  type ContactUpsertInput,
  type ContactUpsertResult,
  type ContactTopic,
  type TopicSubscription,
} from "./resend-contacts-client";

// Resend marketing Broadcasts (operator-triggered product-update sends)
export {
  sendMarketingBroadcast,
  type SendMarketingBroadcastEnv,
  type SendMarketingBroadcastOptions,
  type SendMarketingBroadcastResult,
  type SendMarketingBroadcastDeps,
} from "./resend-broadcast";
