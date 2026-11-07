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

// Service-order customer-facing email layout (mini-spec A foundation)

// Service-order lifecycle email templates
export { ServiceOrderCreatedEmail } from "./emails/service-order-created-email";
export { QuoteEmail, type QuoteEmailItem } from "./emails/quote-email";
export { QuoteApprovedEmail } from "./emails/quote-approved-email";
export { QuoteRejectedEmail } from "./emails/quote-rejected-email";

// Service-order status-transition email templates (mini-spec E2)
export { ServiceStartedEmail } from "./emails/service-started-email";
export {
  ServiceInProgressEmail,
  type ServiceInProgressStage,
} from "./emails/service-in-progress-email";
export { AwaitingEvaluationEmail } from "./emails/awaiting-evaluation-email";
export { UnderEvaluationEmail } from "./emails/under-evaluation-email";

// Service-order conclusão/entrega email templates (mini-spec F)
export { ReadyForPickupEmail } from "./emails/ready-for-pickup-email";
export { ServiceOrderDeliveredEmail } from "./emails/service-order-delivered-email";
export { ServiceOrderClosedEmail } from "./emails/service-order-closed-email";
export { FinalReviewEmail } from "./emails/final-review-email";

// Service-order cancelamento/garantia email templates (mini-spec G)
export { ServiceOrderCanceledEmail } from "./emails/service-order-canceled-email";
export { WarrantyReturnEmail } from "./emails/warranty-return-email";

// On-site visit (calibração in loco) email templates (mini-spec 2)
export { VisitNotificationEmail } from "./emails/visit-notification-email";
