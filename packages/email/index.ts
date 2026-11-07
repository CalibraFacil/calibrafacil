// Shared layout and theme
export { type EmailBrand } from "./emails/components/email-layout";

// Email templates
export { OrganizationInvitationEmail } from "./emails/organization-invitation-email";
export { NotificationEmail } from "./emails/notification-email";
export { CertificateReadyEmail } from "./emails/certificate-ready-email";
export { AssetOotEmail } from "./emails/asset-oot-email";
export { AuditPackReadyEmail } from "./emails/audit-pack-ready-email";
export { CertificateAmendedEmail } from "./emails/certificate-amended-email";
export { JobNotificationEmail } from "./emails/job-notification-email";
export { ComplianceAlertEmail } from "./emails/compliance-alert-email";
export { NCNotificationEmail } from "./emails/nc-notification-email";
export { OotNotificationEmail } from "./emails/oot-notification-email";
export { CompetenceNotificationEmail } from "./emails/competence-notification-email";
export { PasswordResetEmail } from "./emails/password-reset-email";
export { EmailConfirmationEmail } from "./emails/email-confirmation-email";
export { PortalInvitationEmail } from "./emails/portal-invitation-email";
export { PortalMagicLinkEmail } from "./emails/portal-magic-link-email";
export { LabAccessLinkEmail } from "./emails/lab-access-link-email";
export { LabOtpEmail } from "./emails/lab-otp-email";
export { CalibrationRequestEmail } from "./emails/calibration-request-email";
export {
  PortalDueDigestEmail,
  type PortalDueDigestItem,
} from "./emails/portal-due-digest-email";

// Service-order customer-facing email layout

// Service-order lifecycle email templates
export { ServiceOrderCreatedEmail } from "./emails/service-order-created-email";
export { QuoteEmail, type QuoteEmailItem } from "./emails/quote-email";
export { QuoteApprovedEmail } from "./emails/quote-approved-email";
export { QuoteRejectedEmail } from "./emails/quote-rejected-email";

// Service-order status-transition emails: one template,
// the words per status in its table.
export {
  ServiceOrderStatusEmail,
  SERVICE_ORDER_EMAIL_STATUSES,
  sendsServiceOrderStatusEmail,
  serviceOrderStatusEmailRequirement,
  serviceOrderStatusEmailSubject,
  type ServiceOrderEmailStatus,
  type ServiceOrderStatusEmailProps,
} from "./emails/service-order-status-email";
// Per-status names the outbox drain still imports (see the file's header).
export {
  AwaitingEvaluationEmail,
  FinalReviewEmail,
  ReadyForPickupEmail,
  ServiceInProgressEmail,
  ServiceOrderCanceledEmail,
  ServiceOrderClosedEmail,
  ServiceOrderDeliveredEmail,
  ServiceStartedEmail,
  UnderEvaluationEmail,
  WarrantyReturnEmail,
  type ServiceInProgressStage,
} from "./emails/service-order-status-email-aliases";

// On-site visit (calibração in loco) email templates
export { VisitNotificationEmail } from "./emails/visit-notification-email";
