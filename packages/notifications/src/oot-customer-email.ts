/**
 * Customer-facing §7.10 out-of-tolerance notification email dispatcher
 * (#426 Phase 0).
 *
 * Sibling to sendServiceOrderCustomerEmail — same contract:
 *  - Recipient/brand are resolved by the caller (the oot email-outbox drain),
 *    which loads everything from the notification's own org scope.
 *  - The caller supplies the rendered React element, keeping this dispatcher
 *    template-agnostic.
 *  - Transport errors never propagate; the drain decides retry/dead-letter
 *    from the returned result.
 *  - Supports attaching the generated notification PDF (the §7.10 letter).
 */

import { render } from "@react-email/render";
import {
  getPlatformFromEmail,
  isPlatformEmailConfigured,
  sendPlatformEmail,
} from "@calibra-facil/email-sender";
import type { EmailBrand } from "@calibra-facil/email";

export interface OotCustomerEmailInput {
  /** Already-validated recipient address (the notification's snapshot). */
  recipientEmail: string;
  /** Brand resolved via getLabEmailBrand(notification.organizationId). */
  brand: EmailBrand | undefined;
  /** Email subject line (pt-BR). */
  subject: string;
  /** The email React element (OotNotificationEmail). */
  email: React.ReactNode;
  /** Optional PDF attachment — the generated §7.10 notification letter. */
  attachment?: { filename: string; content: Uint8Array };
}

export type OotCustomerEmailResult =
  | { sent: true; skipped?: false; emailId?: string; error?: undefined }
  | { sent: false; skipped: true; skipReason: string; error?: undefined }
  | { sent: false; skipped?: false; error: string };

function sanitizeMailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function getEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? value.trim();
}

function formatFromEmail(
  fromEmail: string,
  brand: EmailBrand | undefined,
): string {
  if (!brand?.isWhiteLabel) return fromEmail;
  return `${sanitizeMailHeader(brand.name)} via CalibraFácil <${getEmailAddress(fromEmail)}>`;
}

function getReplyToEmail(brand: EmailBrand | undefined): string | undefined {
  const email = brand?.supportEmail?.trim();
  if (!email || !email.includes("@")) return undefined;
  return sanitizeMailHeader(email);
}

export async function sendOotCustomerEmail(
  input: OotCustomerEmailInput,
): Promise<OotCustomerEmailResult> {
  const { recipientEmail, brand, subject, email, attachment } = input;

  const fromEmail = getPlatformFromEmail();

  if (!isPlatformEmailConfigured() || !fromEmail) {
    console.error(
      "[OotEmail] EMAIL MISCONFIGURED: no e-mail transport (SMTP_HOST or RESEND_API_KEY) or no sender (EMAIL_FROM).",
    );
    return {
      sent: false,
      skipped: true,
      skipReason: "Email transport not configured",
    } satisfies OotCustomerEmailResult;
  }

  try {
    const html = await render(email);

    const delivery = await sendPlatformEmail({
      from: formatFromEmail(fromEmail, brand),
      to: recipientEmail,
      subject: sanitizeMailHeader(subject),
      html,
      replyTo: getReplyToEmail(brand),
      attachments: attachment
        ? [
            {
              filename: attachment.filename,
              content: Buffer.from(attachment.content),
            },
          ]
        : undefined,
    });

    if (!delivery.ok) {
      console.error(
        "[OotEmail] Failed to send notification email:",
        delivery.error,
      );
      return {
        sent: false,
        error: delivery.error,
      } satisfies OotCustomerEmailResult;
    }

    return {
      sent: true,
      emailId: delivery.emailId,
    } satisfies OotCustomerEmailResult;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown transport error";
    console.error("[OotEmail] Failed to send notification email:", error);
    return { sent: false, error: message } satisfies OotCustomerEmailResult;
  }
}
