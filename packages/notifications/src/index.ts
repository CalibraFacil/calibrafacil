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
  notifyStandardExpiring,
  notifyStandardExpired,
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
