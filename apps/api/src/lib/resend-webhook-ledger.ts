import { db } from "@calibra-facil/db";
import { emailWebhookEvent } from "@calibra-facil/db/schema";

/**
 * Idempotency ledger of inbound provider webhooks. `email_webhook_event` is a
 * GLOBAL table (tenancy.ts: keyed by the provider's svix id, before any
 * organization is known; no organization column, no row-level-security
 * policy), so the insert stays on the plain `db` handle, here in a lib.
 *
 * Insert-first by svix id: a redelivery hits the UNIQUE constraint and returns
 * no row, so the caller skips the side effect (delivery is at-least-once).
 * `db` is a Proxy over a union of the neon + postgres-js drivers, so a typed
 * `.returning({...})` collapses to the 0-arg overload (TS2554): the 0-arg form
 * is used, only the row count matters for the dedup decision.
 */
export async function recordResendWebhookEvent(params: {
  svixId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<{ firstDelivery: boolean }> {
  const inserted = await db
    .insert(emailWebhookEvent)
    .values({
      svixId: params.svixId,
      eventType: params.eventType,
      payload: params.payload,
    })
    .onConflictDoNothing({ target: emailWebhookEvent.svixId })
    .returning();

  return { firstDelivery: inserted.length > 0 };
}
