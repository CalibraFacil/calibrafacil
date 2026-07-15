/**
 * Send-with-fallback core (issue #584).
 *
 * One attempt via the lab's own Resend account when a usable sender resolves;
 * on any key/domain-class failure the SAME call re-renders and re-sends via
 * the platform sender (fall-back-now), so a dead lab key can never stall a
 * queue or lose an email. Only genuinely transient failures (network/5xx)
 * surface as retryable — the service-order outbox drain's release/retry path
 * then handles them exactly as before.
 */

import { Resend, type CreateEmailOptions } from "resend";
import { getLabEmailCredential, markLabEmailKeyFailure } from "./sender";
import { classifyResendErrorName } from "./resend-domains";

/** Passed to the payload builder when the lab variant is being rendered. */
export interface LabSenderContext {
  fromAddress: string;
  hostname: string;
}

/**
 * Builds the full Resend payload for one variant:
 *  - `sender` set  → lab variant: from the lab's own domain, brand without the
 *    "via CalibraFácil" wording.
 *  - `sender` null → platform variant: existing RESEND_FROM_EMAIL formatting.
 * Called again for the platform variant on fallback so the rendered HTML
 * always matches the envelope it is actually sent from.
 */
export type EmailPayloadBuilder = (
  sender: LabSenderContext | null,
) => Promise<CreateEmailOptions> | CreateEmailOptions;

export type SendEmailOutcome =
  | {
      sent: true;
      emailId?: string;
      /** True when the email left through the lab's own Resend account. */
      usedLabSender: boolean;
      /** True when a lab attempt failed and the platform sender delivered. */
      fellBack: boolean;
    }
  | { sent: false; retryable: boolean; error: string };

/** From-header for the lab's own domain — no "via CalibraFácil". */
export function formatLabFromHeader(
  displayName: string,
  fromAddress: string,
): string {
  const name = displayName.replace(/[\r\n"]+/g, " ").trim();
  return `${name} <${fromAddress}>`;
}

async function sendOnce(
  apiKey: string,
  payload: CreateEmailOptions,
): Promise<
  | { ok: true; emailId?: string }
  | { ok: false; errorName: string; message: string }
> {
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      return { ok: false, errorName: error.name, message: error.message };
    }
    return { ok: true, emailId: data?.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown transport error";
    return { ok: false, errorName: "transport_error", message };
  }
}

/**
 * Send an email from the lab's own domain when possible, falling back to the
 * platform sender per the #584 fallback matrix. Never throws.
 *
 * @param params.organizationId lab org whose sender should be tried; pass
 *   `undefined` to send via the platform directly (non-white-label mail).
 * @param params.platformApiKey the global RESEND_API_KEY (callers already
 *   guard on it being configured).
 * @param params.buildPayload see {@link EmailPayloadBuilder}.
 */
export async function sendEmailWithLabSender(params: {
  organizationId: string | undefined;
  platformApiKey: string;
  buildPayload: EmailPayloadBuilder;
}): Promise<SendEmailOutcome> {
  const credential = params.organizationId
    ? await getLabEmailCredential(params.organizationId)
    : undefined;

  let fellBack = false;

  if (credential && params.organizationId) {
    let labResult: Awaited<ReturnType<typeof sendOnce>>;
    try {
      const labPayload = await params.buildPayload({
        fromAddress: credential.fromAddress,
        hostname: credential.hostname,
      });
      labResult = await sendOnce(credential.apiKey, labPayload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to build lab payload";
      labResult = { ok: false, errorName: "transport_error", message };
    }

    if (labResult.ok) {
      return {
        sent: true,
        emailId: labResult.emailId,
        usedLabSender: true,
        fellBack: false,
      };
    }

    const failureClass = classifyResendErrorName(labResult.errorName);
    if (failureClass === "transient") {
      // Platform delivery would ride the same failing path — retry later.
      return { sent: false, retryable: true, error: labResult.message };
    }

    // Key/domain-class failure: record it and resend via the platform NOW.
    console.warn(
      `[EmailSender] Lab sender failed for org ${params.organizationId} (${labResult.errorName}: ${labResult.message}); falling back to the platform sender.`,
    );
    await markLabEmailKeyFailure(
      params.organizationId,
      failureClass,
      `${labResult.errorName}: ${labResult.message}`,
    );
    fellBack = true;
  }

  let platformPayload: CreateEmailOptions;
  try {
    platformPayload = await params.buildPayload(null);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to build platform payload";
    return { sent: false, retryable: false, error: message };
  }

  const platformResult = await sendOnce(params.platformApiKey, platformPayload);
  if (platformResult.ok) {
    return {
      sent: true,
      emailId: platformResult.emailId,
      usedLabSender: false,
      fellBack,
    };
  }

  const failureClass = classifyResendErrorName(platformResult.errorName);
  return {
    sent: false,
    retryable: failureClass === "transient" || failureClass === "rate_limited",
    error: platformResult.message,
  };
}
