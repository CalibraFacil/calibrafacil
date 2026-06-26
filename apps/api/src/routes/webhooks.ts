import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  emailWebhookEvent,
  providerWebhookEvent,
} from "@calibra-facil/db/schema";
import { suppressEmail } from "@calibra-facil/notifications";
import { and, eq } from "drizzle-orm";
import type { AsaasWebhookPayload } from "../services/asaas/types";
import { reconcileCommercialWebhook } from "../services/commercial/reconcile-webhook";
import {
  parseResendEvent,
  resendBounceIsHard,
  resendEventRecipients,
  verifyResendSignature,
} from "../lib/resend-webhook";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

// Logged once per process if Resend webhooks arrive while the secret is unset
// (graceful degradation, mirroring the email-config warnings elsewhere).
let resendWebhookSecretWarningLogged = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function verifyWebhookToken(request: Request): boolean {
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;

  if (!webhookToken) {
    console.warn(
      "ASAAS_WEBHOOK_TOKEN not configured - rejecting webhook request",
    );
    return false;
  }

  const receivedToken = request.headers.get("asaas-access-token");
  if (!receivedToken) {
    return false;
  }

  const expected = Buffer.from(webhookToken, "utf8");
  const received = Buffer.from(receivedToken, "utf8");

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

export const webhooksRouter = new Hono().post("/asaas", async (c) => {
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_WEBHOOK_BODY_BYTES
  ) {
    return c.json({ error: "Payload too large" }, 413);
  }

  if (!verifyWebhookToken(c.req.raw)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let payload: AsaasWebhookPayload;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const eventId = payload.id ?? crypto.randomUUID();

  try {
    const result = await reconcileCommercialWebhook(payload);

    return c.json(
      { received: true, duplicate: result.duplicate ?? false },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(providerWebhookEvent)
      .set({ processingError: message })
      .where(
        and(
          eq(providerWebhookEvent.provider, "ASAAS"),
          eq(providerWebhookEvent.eventId, eventId),
        ),
      );
    console.error("Webhook processing error", error);
    return c.json({ received: true }, 200);
  }
}).post("/resend", async (c) => {
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return c.json({ error: "Payload too large" }, 413);
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
    return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const event = parseResendEvent(payload);
  if (!event) {
    return c.json({ received: true }, 200);
  }

  // Idempotency: insert-first by svix-id. A redelivery hits the UNIQUE
  // constraint, returns no row, and the suppression side effect is skipped
  // (delivery is at-least-once).
  // `db` is a Proxy over a union of the neon + postgres-js drivers, so a typed
  // `.returning({...})` collapses to the 0-arg overload (TS2554). Use 0-arg
  // returning — only the row count matters for the dedup decision.
  const inserted = await db
    .insert(emailWebhookEvent)
    .values({
      svixId,
      eventType: event.type,
      payload: isRecord(payload) ? payload : {},
    })
    .onConflictDoNothing({ target: emailWebhookEvent.svixId })
    .returning();

  if (inserted.length === 0) {
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
