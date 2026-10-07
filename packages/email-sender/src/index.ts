export {
  EMAIL_DOMAIN_MASTER_KEY_ENV,
  decryptResendApiKey,
  encryptResendApiKey,
  generateEmailDomainMasterKey,
  getEmailDomainMasterKey,
  maskResendApiKey,
  resendApiKeyLast4,
} from "./encryption";
export {
  classifyResendErrorName,
  createResendDomain,
  deleteResendDomain,
  getResendDomain,
  listResendDomains,
  validateResendApiKey,
  verifyResendDomain,
  type ResendDomainDetails,
  type ResendDomainSummary,
  type ResendDomainsResult,
  type ResendFailureClass,
} from "./resend-domains";
export {
  getLabEmailCredential,
  markLabEmailKeyFailure,
  markLabEmailKeyOk,
  resolveLabEmailSender,
  type LabEmailCredential,
  type LabEmailSenderInfo,
} from "./sender";
export {
  formatLabFromHeader,
  sendEmailWithLabSender,
  type EmailPayloadBuilder,
  type LabSenderContext,
  type SendEmailOutcome,
} from "./send";
export {
  getPlatformFromEmail,
  isPlatformEmailConfigured,
  resolvePlatformEmailTransport,
  sendPlatformEmail,
  type EmailDeliveryResult,
  type PlatformEmailTransport,
} from "./transport";
