import { createRouter } from "../../../server/router";
import { suppressEmail } from "@calibra-facil/notifications";
import {
  parseResendEvent,
  resendBounceIsHard,
  resendEventRecipients,
  verifyResendSignature,
} from "../resend-webhook";
import {
  DomainError,
  invalid,
  unauthenticated,
} from "../../../lib/domain-errors";
import { processResendWebhookOnce } from "../resend-webhook-ledger";
import { isRecord } from "@calibra-facil/shared/record";
import { log } from "../../../lib/logger";

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
      log("warn", "resend_webhook_secret_missing");
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

  // The ledger row and the suppression commit together
  // (domains/notifications/resend-webhook-ledger.ts). A failure of the
  // suppression is not swallowed: it rolls the ledger row back and answers 5xx,
  // so Resend redelivers and the address is suppressed on the retry.
  const { firstDelivery } = await processResendWebhookOnce(
    {
      svixId,
      eventType: event.type,
      payload: isRecord(payload) ? payload : {},
    },
    async (tx) => {
      if (event.type === "email.complained") {
        for (const email of resendEventRecipients(event.data)) {
          await suppressEmail(
            {
              email,
              scope: "all",
              reason: "complaint",
              source: "resend_webhook",
            },
            tx,
          );
        }
      } else if (
        event.type === "email.bounced" &&
        resendBounceIsHard(event.data)
      ) {
        for (const email of resendEventRecipients(event.data)) {
          await suppressEmail(
            {
              email,
              scope: "all",
              reason: "hard_bounce",
              source: "resend_webhook",
            },
            tx,
          );
        }
      }
    },
  );

  if (!firstDelivery) {
    return c.json({ received: true, duplicate: true }, 200);
  }

  return c.json({ received: true }, 200);
});
