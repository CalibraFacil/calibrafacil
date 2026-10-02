// Shared layout and theme
export {
  EmailLayout,
  StatusBox,
  theme,
  styles,
  type EmailBrand,
} from "./emails/components/email-layout";

// Email templates
export { OrganizationInvitationEmail } from "./emails/organization-invitation-email";
export { NewLeadEmail } from "./emails/new-lead-email";
export { NotificationEmail } from "./emails/notification-email";
export { CertificateReadyEmail } from "./emails/certificate-ready-email";
export { AssetOotEmail } from "./emails/asset-oot-email";
export { AuditPackReadyEmail } from "./emails/audit-pack-ready-email";
export { CertificateAmendedEmail } from "./emails/certificate-amended-email";
export { JobNotificationEmail } from "./emails/job-notification-email";
export { ComplianceAlertEmail } from "./emails/compliance-alert-email";
export { NCNotificationEmail } from "./emails/nc-notification-email";
export {
  OotNotificationEmail,
  type OotNotificationEmailProps,
} from "./emails/oot-notification-email";
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
  type PortalDueDigestEmailProps,
  type PortalDueDigestItem,
} from "./emails/portal-due-digest-email";

// Service-order customer-facing email layout (mini-spec A foundation)
export {
  ServiceOrderEmailLayout,
  type ServiceOrderEmailLayoutProps,
} from "./emails/service-order-email-layout";

// Service-order lifecycle email templates
export {
  ServiceOrderCreatedEmail,
  type ServiceOrderCreatedEmailProps,
} from "./emails/service-order-created-email";
export {
  QuoteEmail,
  type QuoteEmailProps,
  type QuoteEmailItem,
} from "./emails/quote-email";
export {
  QuoteApprovedEmail,
  type QuoteApprovedEmailProps,
} from "./emails/quote-approved-email";
export {
  QuoteRejectedEmail,
  type QuoteRejectedEmailProps,
} from "./emails/quote-rejected-email";

// Service-order status-transition email templates (mini-spec E2)
export {
  ServiceStartedEmail,
  type ServiceStartedEmailProps,
} from "./emails/service-started-email";
export {
  ServiceInProgressEmail,
  type ServiceInProgressEmailProps,
  type ServiceInProgressStage,
} from "./emails/service-in-progress-email";
export {
  AwaitingEvaluationEmail,
  type AwaitingEvaluationEmailProps,
} from "./emails/awaiting-evaluation-email";
export {
  UnderEvaluationEmail,
  type UnderEvaluationEmailProps,
} from "./emails/under-evaluation-email";

// Service-order conclusão/entrega email templates (mini-spec F)
export {
  ReadyForPickupEmail,
  type ReadyForPickupEmailProps,
} from "./emails/ready-for-pickup-email";
export {
  ServiceOrderDeliveredEmail,
  type ServiceOrderDeliveredEmailProps,
} from "./emails/service-order-delivered-email";
export {
  ServiceOrderClosedEmail,
  type ServiceOrderClosedEmailProps,
} from "./emails/service-order-closed-email";
export {
  FinalReviewEmail,
  type FinalReviewEmailProps,
} from "./emails/final-review-email";

// Service-order cancelamento/garantia email templates (mini-spec G)
export {
  ServiceOrderCanceledEmail,
  type ServiceOrderCanceledEmailProps,
} from "./emails/service-order-canceled-email";
export {
  WarrantyReturnEmail,
  type WarrantyReturnEmailProps,
} from "./emails/warranty-return-email";

// On-site visit (calibração in loco) email templates (mini-spec 2)
export { VisitNotificationEmail } from "./emails/visit-notification-email";
