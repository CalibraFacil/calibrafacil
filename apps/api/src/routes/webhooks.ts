import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  emailWebhookEvent,
  operatorAlert,
  providerWebhookEvent,
} from "@calibra-facil/db/schema";
import { suppressEmail } from "@calibra-facil/notifications";
import { and, eq } from "drizzle-orm";
import type { AsaasWebhookPayload } from "../services/asaas/types";
import { reconcileCommercialWebhook } from "../services/commercial/reconcile-webhook";
import { isTransientWebhookError } from "../services/commercial/webhook-errors";
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

// Logged once per process when the Asaas IP allowlist is not configured.
let asaasIpAllowlistWarningLogged = false;

/**
 * Source-IP allowlist for Asaas webhooks (#641 / SEC-06).
 *
 * Asaas offers NO per-payload HMAC signature (docs.asaas.com, verified
 * 2026-07: authentication is the static per-webhook `asaas-access-token`
 * header only — made mandatory Feb/2026 — unlike Resend's Svix HMAC). The
 * compensating second factor is Asaas's published webhook source IPs
 * (https://docs.asaas.com/docs/ips-oficiais-do-asaas): forging an event then
 * requires BOTH the leaked token AND a request arriving from Asaas's
 * infrastructure.
 *
 * Env-driven and opt-in (`ASAAS_WEBHOOK_ALLOWED_IPS`, comma-separated):
 * Asaas has changed the list before, and a stale hardcoded list would
 * silently reject real payment events — so unset preserves the token-only
 * behavior (with a once-per-process warning) and the operator opts in with
 * the current list. Once set, enforcement fails closed (no resolvable source
 * IP => rejected). The source IP comes from `x-real-ip` (set by Vercel's
 * edge, not client-forgeable) with the first `x-forwarded-for` hop as
 * fallback.
 */
export async function verifyWebhookSourceIp(
  request: Request,
): Promise<boolean> {
  const raw = process.env.ASAAS_WEBHOOK_ALLOWED_IPS;
  const allowed = (raw ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    if (!asaasIpAllowlistWarningLogged) {
      asaasIpAllowlistWarningLogged = true;
      console.warn(
        "ASAAS_WEBHOOK_ALLOWED_IPS not configured — Asaas webhooks are authenticated by token only (see issue #641).",
      );
      // A console line nobody reads is not a control. Asaas signs nothing, so
      // the allowlist is the second factor on the endpoint that activates paid
      // plans, and it has to be surfaced where operators actually look.
      //
      // Awaited, not fired and forgotten. The flag above makes this run once
      // per process, and on a serverless runtime the instance can freeze the
      // moment the handler returns: a request rejected for a bad token exits
      // fast enough to discard an unawaited write, and no later request on that
      // warm instance would ever retry it.
      await raiseMissingIpAllowlistAlert();
    }
    return true;
  }

  const sourceIp =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;

  return sourceIp !== null && allowed.includes(sourceIp);
}

async function raiseMissingIpAllowlistAlert(): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(operatorAlert)
      .values({
        dedupeKey: "asaas:webhook_ip_allowlist_missing",
        kind: "asaas_webhook_ip_allowlist_missing",
        severity: "warning",
        title: "Webhook do Asaas sem allowlist de IP",
        detail:
          "ASAAS_WEBHOOK_ALLOWED_IPS não está definida. O Asaas não assina os webhooks, então hoje o endpoint que ativa planos pagos é autenticado apenas pelo token estático. IPs oficiais em https://docs.asaas.com/docs/ips-oficiais-do-asaas.",
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: operatorAlert.dedupeKey,
        set: { lastSeenAt: now, updatedAt: now },
      });
  } catch (error) {
    // Never let observability break the webhook that takes the money.
    console.error("Failed to record Asaas IP allowlist alert", error);
  }
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

export const webhooksRouter = new Hono()
  .post("/asaas", async (c) => {
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_WEBHOOK_BODY_BYTES
    ) {
      return c.json({ error: "Payload too large" }, 413);
    }

    // #641: source-IP allowlist runs BEFORE the token check and before any
    // side effect — with no HMAC available from Asaas, this is the second
    // authentication factor (REQ-SEC-ASA-002: invalid requests never reach
    // reconciliation, so no offer activation and no payment_record).
    if (!(await verifyWebhookSourceIp(c.req.raw))) {
      return c.json({ error: "Unauthorized" }, 401);
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
      // Record the failure for observability. The event stays UNPROCESSED
      // (processedAt is only set on a successful reconcile), so a retry re-runs the
      // work rather than being skipped as a duplicate (see reconcileCommercialWebhook).
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

      // A TRANSIENT failure (DB blip, network) → non-2xx so ASAAS retries the
      // delivery. A PERMANENT failure → ack (200): ASAAS's queue is SEQUENTIAL and
      // pauses after 15 consecutive non-2xx responses, so a poison event must not
      // stall it; the reconciliation cron is the backstop for the divergence.
      if (isTransientWebhookError(error)) {
        return c.json(
          { received: false, retryable: true, error: message },
          503,
        );
      }
      return c.json({ received: true }, 200);
    }
  })
  .post("/resend", async (c) => {
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_WEBHOOK_BODY_BYTES
    ) {
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
