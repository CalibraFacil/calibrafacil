export {
  decryptResendApiKey,
  encryptResendApiKey,
  generateEmailDomainMasterKey,
  getEmailDomainMasterKey,
  EMAIL_DOMAIN_MASTER_KEY_ENV,
} from "./encryption";
export {
  formatFromEmail,
  formatLabFromHeader,
  getEmailAddress,
  getReplyToEmail,
  sanitizeMailHeader,
  stripBrandSender,
  type MailHeaderBrand,
} from "./mail-headers";
export { reportEmailError } from "./report";
export {
  createResendDomain,
  deleteResendDomain,
  getResendDomain,
  verifyResendDomain,
  type ResendFailureClass,
} from "./resend-domains";
export {
  sendEmailWithLabSender,
  type LabEmailCredential,
  type LabSenderResolver,
} from "./send";
export {
  getPlatformFromEmail,
  isPlatformEmailConfigured,
  sendPlatformEmail,
} from "./transport";
