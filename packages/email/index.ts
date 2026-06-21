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
export { NotificationEmail } from "./emails/notification-email";
export { CertificateReadyEmail } from "./emails/certificate-ready-email";
export { CertificateAmendedEmail } from "./emails/certificate-amended-email";
export { JobNotificationEmail } from "./emails/job-notification-email";
export { ComplianceAlertEmail } from "./emails/compliance-alert-email";
export { PaymentNotificationEmail } from "./emails/payment-notification-email";
export { NCNotificationEmail } from "./emails/nc-notification-email";
export { CompetenceNotificationEmail } from "./emails/competence-notification-email";
export { CustomerSuccessEmail } from "./emails/customer-success-email";
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
  NovaOsEmail,
  type NovaOsEmailProps,
} from "./emails/nova-os-email";
export {
  NovoOrcamentoEmail,
  type NovoOrcamentoEmailProps,
  type NovoOrcamentoEmailItem,
} from "./emails/novo-orcamento-email";
export {
  OrcamentoAprovadoEmail,
  type OrcamentoAprovadoEmailProps,
} from "./emails/orcamento-aprovado-email";
export {
  OrcamentoRecusadoEmail,
  type OrcamentoRecusadoEmailProps,
} from "./emails/orcamento-recusado-email";

// Service-order status-transition email templates (mini-spec E2)
export {
  ServicoIniciadoEmail,
  type ServicoIniciadoEmailProps,
} from "./emails/servico-iniciado-email";
export {
  ServicoAndamentoEmail,
  type ServicoAndamentoEmailProps,
  type ServicoAndamentoStage,
} from "./emails/servico-andamento-email";
export {
  AguardandoAvaliacaoTecnicaEmail,
  type AguardandoAvaliacaoTecnicaEmailProps,
} from "./emails/aguardando-avaliacao-tecnica-email";
export {
  EmAvaliacaoTecnicaEmail,
  type EmAvaliacaoTecnicaEmailProps,
} from "./emails/em-avaliacao-tecnica-email";

// Service-order conclusão/entrega email templates (mini-spec F)
export {
  ProntoParaRetiradaEmail,
  type ProntoParaRetiradaEmailProps,
} from "./emails/pronto-para-retirada-email";
export {
  OsEntregueEmail,
  type OsEntregueEmailProps,
} from "./emails/os-entregue-email";
export {
  OsEncerradaEmail,
  type OsEncerradaEmailProps,
} from "./emails/os-encerrada-email";
export {
  RevisaoFinalEmail,
  type RevisaoFinalEmailProps,
} from "./emails/revisao-final-email";

// Service-order cancelamento/garantia email templates (mini-spec G)
export {
  OsCanceladaEmail,
  type OsCanceladaEmailProps,
} from "./emails/os-cancelada-email";
export {
  GarantiaRetornoEmail,
  type GarantiaRetornoEmailProps,
} from "./emails/garantia-retorno-email";
