import { createRouter } from "../server/router";
import { suppressEmail } from "@calibra-facil/notifications";
import {
  parseResendEvent,
  resendBounceIsHard,
  resendEventRecipients,
  verifyResendSignature,
} from "../lib/resend-webhook";
import { DomainError, invalid, unauthenticated } from "../lib/domain-errors";
import { recordResendWebhookEvent } from "../lib/resend-webhook-ledger";
import { isRecord } from "@calibra-facil/shared/record";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

// Logged once per process if Resend webhooks arrive while the secret is unset
// (graceful degradation, mirroring the email-config warnings elsewhere).
let resendWebhookSecretWarningLogged = false;

export const webhooksRouter = createRouter().post("/resend", async (c) => {
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_WEBHOOK_BODY_BYTES
  ) {
    throw new DomainError({
      code: "payload_too_large",
      status: 413,
      message: "Payload too large",
    });
  }

  // Graceful degradation: with no secret configured we cannot verify the Svix
  // signature, so we ack the provider (200) and process nothing.
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    if (!resendWebhookSecretWarningLogged) {
      console.warn(
        "RESEND_WEBHOOK_SECRET not configured - Resend webhook is a no-op",
      );
      resendWebhookSecretWarningLogged = true;
    }
    return c.json({ received: true, skipped: true }, 200);
  }

  const rawBody = await c.req.text();
  const svixId = c.req.header("svix-id") ?? null;
  const valid = verifyResendSignature({
    secret,
    svixId,
    svixTimestamp: c.req.header("svix-timestamp") ?? null,
    svixSignature: c.req.header("svix-signature") ?? null,
    body: rawBody,
  });
  if (!valid || !svixId) {
    throw unauthenticated("unauthenticated", "Invalid signature");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw invalid("invalid_request", "Invalid JSON payload");
  }

  const event = parseResendEvent(payload);
  if (!event) {
    return c.json({ received: true }, 200);
  }

  // Idempotency: insert-first by svix-id (lib/resend-webhook-ledger.ts). A
  // redelivery skips the suppression side effect (delivery is at-least-once).
  const { firstDelivery } = await recordResendWebhookEvent({
    svixId,
    eventType: event.type,
    payload: isRecord(payload) ? payload : {},
  });

  if (!firstDelivery) {
    return c.json({ received: true, duplicate: true }, 200);
  }

  try {
    if (event.type === "email.complained") {
      for (const email of resendEventRecipients(event.data)) {
        await suppressEmail({
          email,
          scope: "all",
          reason: "complaint",
          source: "resend_webhook",
        });
      }
    } else if (
      event.type === "email.bounced" &&
      resendBounceIsHard(event.data)
    ) {
      for (const email of resendEventRecipients(event.data)) {
        await suppressEmail({
          email,
          scope: "all",
          reason: "hard_bounce",
          source: "resend_webhook",
        });
      }
    }
  } catch (error) {
    console.error("[ResendWebhook] processing error", error);
  }

  return c.json({ received: true }, 200);
});
