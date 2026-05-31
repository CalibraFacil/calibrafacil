import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { db } from "@calibra-facil/db";
import { providerWebhookEvent } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import type { AsaasWebhookPayload } from "../services/asaas/types";
import { reconcileCommercialWebhook } from "../services/commercial/reconcile-webhook";
import { invalidateOnMutation } from "../lib/cache";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

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

export const webhooksRouter = new Hono<{
  Bindings: { CACHE?: KVNamespace };
}>().post("/asaas", async (c) => {
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

    if (result.organizationId) {
      await invalidateOnMutation(
        c.env.CACHE,
        result.organizationId,
        "subscription",
      );
    }

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
});
