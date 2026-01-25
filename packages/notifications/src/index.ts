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
  type SendNotificationOptions,
  type NotificationResult,
} from "./service";
