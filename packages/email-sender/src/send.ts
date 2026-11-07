/**
 * Send-with-fallback core (issue #584).
 *
 * One attempt via the lab's own Resend account when a usable sender resolves;
 * on any key/domain-class failure the SAME call re-renders and re-sends via
 * the platform sender (fall-back-now), so a dead lab key can never stall a
 * queue or lose an email. Only genuinely transient failures (network/5xx)
 * surface as retryable — the service-order outbox drain's release/retry path
 * then handles them exactly as before. The platform sender is whichever
 * transport (SMTP or Resend) transport.ts resolves from the environment.
 */

import { Resend, type CreateEmailOptions } from "resend";
import {
  classifyResendErrorName,
  type ResendFailureClass,
} from "./resend-domains";
import { reportEmailError } from "./report";
import { sendPlatformEmail } from "./transport";

/** The lab's own sending identity, resolved by whoever owns the tenant's e-mail domain. */
export interface LabEmailCredential {
  apiKey: string;
  fromAddress: string;
  hostname: string;
}

/**
 * What the sender needs to know about a laboratory's own sending domain. The
 * state lives with the tenant's e-mail domains (the database), not in this
 * transport: the caller passes an implementation in.
 */
export interface LabSenderResolver {
  /** The decrypted credential, or `undefined` to use the platform sender. */
  getCredential(
    organizationId: string,
  ): Promise<LabEmailCredential | undefined>;
  /** Record a key/domain-class failure seen at send time. Best-effort, never throws. */
  recordKeyFailure(
    organizationId: string,
    failureClass: ResendFailureClass,
    message: string,
  ): Promise<void>;
}

/** Passed to the payload builder when the lab variant is being rendered. */
interface LabSenderContext {
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
 * @param params.labSender resolves the lab's credential and records its
 *   failures; without it every message leaves through the platform sender.
 * @param params.buildPayload see {@link EmailPayloadBuilder}.
 */
export async function sendEmailWithLabSender(params: {
  organizationId: string | undefined;
  labSender?: LabSenderResolver;
  buildPayload: EmailPayloadBuilder;
}): Promise<SendEmailOutcome> {
  const { labSender } = params;
  const credential =
    params.organizationId && labSender
      ? await labSender.getCredential(params.organizationId)
      : undefined;

  let fellBack = false;

  if (credential && params.organizationId && labSender) {
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
    reportEmailError(
      `Lab sender failed for org ${params.organizationId} (${labResult.errorName}: ${labResult.message}); falling back to the platform sender`,
      undefined,
      { event: "lab_sender_fallback" },
    );
    await labSender.recordKeyFailure(
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

  const platformResult = await sendPlatformEmail(platformPayload);
  if (platformResult.ok) {
    return {
      sent: true,
      emailId: platformResult.emailId,
      usedLabSender: false,
      fellBack,
    };
  }

  return {
    sent: false,
    retryable: platformResult.retryable,
    error: platformResult.error,
  };
}
