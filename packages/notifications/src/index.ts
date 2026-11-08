// Notification Service - Core exports
export {
  notify,
  getRecipientsByRole,
  sendPortalDueDigests,
  getLabEmailBrand,
  type NotificationPayloads,
  type PortalDigestRunResult,
} from "./service";

// Pure pt-BR copy builder for the legal-metrology verification reminder

// Pure decider for the ICP-Brasil A1 signing-certificate expiry alert
export {
  decideSigningCertificateExpiryAlert,
  SIGNING_CERTIFICATE_EXPIRY_LEAD_DAYS,
} from "./signing-certificate-expiry";

// Email suppression / unsubscribe list
export { suppressEmail, isEmailSuppressed } from "./suppression";

// §7.10 out-of-tolerance customer-facing email dispatcher
export { sendOotCustomerEmail } from "./oot-customer-email";

// Service-order customer-facing email dispatcher
export {
  sendServiceOrderCustomerEmail,
  resolveServiceOrderRecipient,
  type ServiceOrderCustomerEmailResult,
} from "./service-order-customer-email";
