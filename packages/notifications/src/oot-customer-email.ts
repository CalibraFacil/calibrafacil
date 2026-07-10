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

import { Resend } from "resend";
import { render } from "@react-email/render";
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

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    console.error(
      "[OotEmail] EMAIL MISCONFIGURED: RESEND_API_KEY or RESEND_FROM_EMAIL not set.",
    );
    return {
      sent: false,
      skipped: true,
      skipReason: "Email transport not configured",
    } satisfies OotCustomerEmailResult;
  }

  try {
    const html = await render(email);
    const resend = new Resend(resendApiKey);

    const response = await resend.emails.send({
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

    const emailId =
      response.data &&
      typeof response.data === "object" &&
      "id" in response.data
        ? String(response.data.id)
        : undefined;

    return { sent: true, emailId } satisfies OotCustomerEmailResult;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown transport error";
    console.error("[OotEmail] Failed to send notification email:", error);
    return { sent: false, error: message } satisfies OotCustomerEmailResult;
  }
}
