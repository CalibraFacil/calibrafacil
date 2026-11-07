/**
 * The e-mails the identity layer sends: what each one says, from which address
 * and to whom. The decision to send (who may receive a link, whether e-mail is
 * configured, what a development install does instead) stays with the Better
 * Auth callbacks in auth.ts; this module only composes and delivers.
 *
 * The From/Reply-To/Subject header helpers are the one copy in
 * `@calibra-facil/email-sender` (header-injection sanitising lives there).
 */

import type { CreateEmailOptions } from "resend";
import {
  formatFromEmail,
  formatLabFromHeader,
  getPlatformFromEmail,
  getReplyToEmail,
  sanitizeMailHeader,
  sendEmailWithLabSender,
  sendPlatformEmail,
  stripBrandSender,
} from "@calibra-facil/email-sender";
import { labEmailSenderResolver } from "@calibra-facil/lab-email-domain";
import {
  EmailConfirmationEmail,
  LabAccessLinkEmail,
  LabOtpEmail,
  OrganizationInvitationEmail,
  PasswordResetEmail,
  PortalInvitationEmail,
  PortalMagicLinkEmail,
  type EmailBrand,
} from "@calibra-facil/email";
import { readEnv } from "./auth-env";

// Sender used when neither RESEND_FROM_EMAIL nor EMAIL_FROM is configured. The
// example.com domain is reserved, so a misconfigured deployment fails loudly at
// the email provider instead of impersonating a real domain.
const DEFAULT_EMAIL_FROM = "Calibra Fácil <noreply@example.com>";

function getEmailLogoSrc(): string {
  const explicitLogoUrl = readEnv("EMAIL_LOGO_URL");
  if (explicitLogoUrl) return explicitLogoUrl;

  const appUrl = readEnv("APP_URL") ?? readEnv("WEB_URL");
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/logo192.png`;

  return "http://localhost:5173/logo192.png";
}

/**
 * Send a transactional email through the platform transport (SMTP or Resend)
 * and FAIL LOUDLY on a delivery error.
 *
 * Providers report a rejected message (invalid/rotated key, unverified sender
 * domain, suppressed recipient, quota/rate limit) as a result, not an
 * exception. Discarding that result would let a total delivery outage surface
 * as a silent HTTP 200 with nothing logged. Surfacing the error (log + throw →
 * 5xx) makes a rejection observable instead of invisible.
 */
async function sendAuthEmail(payload: CreateEmailOptions): Promise<void> {
  const result = await sendPlatformEmail(payload);
  if (!result.ok) {
    console.error("[Email] Delivery failed", result.error);
    throw new Error(`Email delivery failed: ${result.error}`);
  }
}

export function emailNotConfiguredError(what: string): Error {
  return new Error(
    `E-mail is not configured (set SMTP_HOST or RESEND_API_KEY); cannot send ${what}`,
  );
}

function formatLabAddress(lab: {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighbourhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
}): string | undefined {
  const streetLine = [lab.street, lab.number, lab.complement]
    .filter(Boolean)
    .join(", ");
  const cityLine = [
    lab.neighbourhood,
    [lab.city, lab.state].filter(Boolean).join(" - "),
    lab.cep ? `CEP ${lab.cep}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const address = [streetLine, cityLine].filter(Boolean).join(" · ");

  return address || undefined;
}

export function createLabEmailBrand(lab: {
  name: string;
  logo: string | null;
  cnpj: string | null;
  accreditationNumber: string | null;
  accreditationBody: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighbourhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}): EmailBrand {
  const accreditation = [lab.accreditationBody, lab.accreditationNumber]
    .filter(Boolean)
    .join(" ");
  const legalLines = [
    lab.cnpj ? `CNPJ ${lab.cnpj}` : undefined,
    accreditation ? `Acreditação ${accreditation}` : undefined,
    formatLabAddress(lab),
    lab.phone ? `Telefone: ${lab.phone}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return {
    name: lab.name,
    logoSrc: lab.logo ?? getEmailLogoSrc(),
    footerLegalLines: legalLines,
    supportEmail: lab.email ?? undefined,
    website: lab.website ?? undefined,
    isWhiteLabel: true,
  };
}

function platformFromEmail(): string {
  return getPlatformFromEmail() ?? DEFAULT_EMAIL_FROM;
}

/**
 * The portal INVITATION is lab-branded and may leave through the lab's own
 * sending domain when one is active. It fails loud like every auth mail.
 */
export async function deliverPortalInvitationEmail(input: {
  to: string;
  subject: string;
  invitation: { organizationName: string; role: string | null };
  labBrand: EmailBrand | undefined;
  magicLinkUrl: string;
}): Promise<void> {
  const { to, subject, invitation, labBrand, magicLinkUrl } = input;
  const fromEmail = platformFromEmail();
  const labName = labBrand?.name ?? null;

  const outcome = await sendEmailWithLabSender({
    organizationId: labBrand?.sender?.organizationId,
    labSender: labEmailSenderResolver,
    buildPayload: (sender) => {
      const brandVariant = sender ? labBrand : stripBrandSender(labBrand);
      return {
        from:
          sender && brandVariant
            ? formatLabFromHeader(brandVariant.name, sender.fromAddress)
            : formatFromEmail(fromEmail, brandVariant),
        to,
        subject,
        replyTo: getReplyToEmail(brandVariant),
        react: PortalInvitationEmail({
          recipientName: to,
          organizationName: invitation.organizationName,
          labName,
          role: invitation.role ?? undefined,
          inviteUrl: magicLinkUrl,
          logoSrc: getEmailLogoSrc(),
          brand: brandVariant,
        }),
        text: [
          `Convite para ${invitation.organizationName}`,
          "",
          "Use o link abaixo para aceitar o convite e acessar o portal:",
          magicLinkUrl,
          "",
          "Se você não esperava este convite, ignore esta mensagem.",
        ].join("\n"),
      };
    },
  });

  if (!outcome.sent) {
    // Same fail-loud contract as sendAuthEmail: a provider rejection must
    // surface instead of returning a silent 200.
    console.error("[Email] Delivery failed", outcome.error);
    throw new Error(`Email delivery failed: ${outcome.error}`);
  }
}

/**
 * The portal login link stays on the platform sender on purpose: auth mail is
 * the most deliverability-sensitive.
 */
export async function deliverPortalMagicLinkEmail(input: {
  to: string;
  subject: string;
  magicLinkUrl: string;
}): Promise<void> {
  const { to, subject, magicLinkUrl } = input;
  await sendAuthEmail({
    from: formatFromEmail(platformFromEmail(), undefined),
    to,
    subject,
    react: PortalMagicLinkEmail({
      recipientName: to,
      magicLinkUrl,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      "Acesse o Portal CalibraFácil",
      "",
      "Use o link abaixo para entrar no portal:",
      magicLinkUrl,
      "",
      "Se você não solicitou acesso, ignore esta mensagem.",
    ].join("\n"),
  });
}

export async function deliverLabMagicLinkEmail(input: {
  to: string;
  accessUrl: string;
}): Promise<void> {
  const { to, accessUrl } = input;
  await sendAuthEmail({
    from: platformFromEmail(),
    to,
    subject: "Acesse o CalibraFácil",
    react: LabAccessLinkEmail({
      recipientName: to,
      accessUrl,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      "Acesse o CalibraFácil",
      "",
      "Use o link abaixo para entrar no dashboard:",
      accessUrl,
      "",
      "Se você não solicitou acesso, ignore esta mensagem.",
    ].join("\n"),
  });
}

export async function deliverLabOtpEmail(input: {
  to: string;
  otp: string;
}): Promise<void> {
  const { to, otp } = input;
  await sendAuthEmail({
    from: platformFromEmail(),
    to,
    subject: "Código de acesso ao CalibraFácil",
    react: LabOtpEmail({
      recipientName: to,
      otp,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      "Código de acesso ao CalibraFácil",
      "",
      `Seu código de acesso é: ${otp}`,
      "",
      "Este código expira em poucos minutos. Se você não solicitou acesso, ignore esta mensagem.",
    ].join("\n"),
  });
}

export async function deliverLabAccountSetupEmail(input: {
  to: string;
  recipientName: string;
  organizationName: string;
  claimUrl: string;
}): Promise<void> {
  await sendAuthEmail({
    from: platformFromEmail(),
    to: input.to,
    subject: `Configure seu acesso a ${sanitizeMailHeader(input.organizationName)}`,
    react: LabAccessLinkEmail({
      recipientName: input.recipientName,
      organizationName: input.organizationName,
      accessUrl: input.claimUrl,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      `Configure seu acesso a ${input.organizationName}`,
      "",
      "Use o link abaixo para reivindicar seu acesso ao CalibraFácil:",
      input.claimUrl,
      "",
      "Se você não esperava este convite, ignore esta mensagem.",
    ].join("\n"),
  });
}

export async function deliverOrganizationInvitationEmail(input: {
  to: string;
  organizationName: string;
  invitedByUsername: string;
  invitedByEmail: string;
  inviteLink: string;
  role: string;
}): Promise<void> {
  await sendAuthEmail({
    from: platformFromEmail(),
    to: input.to,
    subject: `Convite para ${input.organizationName}`,
    react: OrganizationInvitationEmail({
      invitedByUsername: input.invitedByUsername,
      invitedByEmail: input.invitedByEmail,
      organizationName: input.organizationName,
      inviteLink: input.inviteLink,
      role: input.role,
      logoSrc: getEmailLogoSrc(),
    }),
  });
}

export async function deliverPasswordResetEmail(input: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  await sendAuthEmail({
    from: platformFromEmail(),
    to: input.to,
    subject: "Defina sua senha no CalibraFácil",
    react: PasswordResetEmail({
      recipientName: input.to,
      resetUrl: input.resetUrl,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      "Defina sua senha no CalibraFácil",
      "",
      "Use o link abaixo para definir ou redefinir sua senha:",
      input.resetUrl,
      "",
      "Se você não esperava este email, ignore esta mensagem.",
    ].join("\n"),
  });
}

export async function deliverEmailConfirmationEmail(input: {
  to: string;
  recipientName: string;
  confirmationUrl: string;
}): Promise<void> {
  await sendAuthEmail({
    from: platformFromEmail(),
    to: input.to,
    subject: "Confirme seu e-mail no CalibraFácil",
    react: EmailConfirmationEmail({
      recipientName: input.recipientName,
      confirmationUrl: input.confirmationUrl,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      "Confirme seu e-mail no CalibraFácil",
      "",
      "Use o link abaixo para confirmar seu endereço de e-mail:",
      input.confirmationUrl,
      "",
      "Se você não criou uma conta, ignore esta mensagem.",
    ].join("\n"),
  });
}
