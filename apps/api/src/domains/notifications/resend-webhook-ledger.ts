import { db } from "@calibra-facil/db";
import { emailWebhookEvent } from "@calibra-facil/db/schema";

/** The transaction handle `processResendWebhookOnce` gives its side effect. */
export type ResendWebhookTx = Pick<typeof db, "insert">;

/**
 * Applies a provider webhook at most once, atomically. `email_webhook_event` is
 * a GLOBAL table (tenancy.ts: keyed by the provider's svix id, before any
 * organization is known; no organization column, no row-level-security
 * policy), so this stays on the plain `db` handle, here in the domain.
 *
 * The ledger row (insert-first by svix id: a redelivery hits the UNIQUE
 * constraint and returns no row) and the side effect commit in ONE
 * transaction. If the side effect throws, the ledger row rolls back with it,
 * so the provider's redelivery (the caller answers 5xx) is a first delivery
 * again and applies the effect; once committed, a redelivery is a duplicate and
 * is skipped (delivery is at-least-once). Two concurrent deliveries of one id
 * serialise on the unique row: the second waits for the first to commit or
 * roll back.
 */
export async function processResendWebhookOnce(
  params: {
    svixId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
  sideEffect: (tx: ResendWebhookTx) => Promise<void>,
): Promise<{ firstDelivery: boolean }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(emailWebhookEvent)
      .values({
        svixId: params.svixId,
        eventType: params.eventType,
        payload: params.payload,
      })
      .onConflictDoNothing({ target: emailWebhookEvent.svixId })
      .returning({ svixId: emailWebhookEvent.svixId });

    if (inserted.length === 0) return { firstDelivery: false };

    await sideEffect(tx);
    return { firstDelivery: true };
  });
}
