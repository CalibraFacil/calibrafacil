// Notification Service - Core exports
export {
  sendNotification,
  getRecipientsByRole,
  notifyJobSubmittedForReview,
  notifyJobApproved,
  notifyJobRejected,
  notifyJobAssigned,
  notifyCertificateReady,
  notifyCertificateAmended, // ISO 17025 Clause 7.8.4.1
  notifyNCCreated, // ISO 17025 Clause 8.7
  notifyNCEscalatedToCapa, // ISO 17025 Clause 8.7
  notifyCompetenceApproved,
  notifyCompetenceRequested,
  type SendNotificationOptions,
  type NotificationResult,
} from "./service";
