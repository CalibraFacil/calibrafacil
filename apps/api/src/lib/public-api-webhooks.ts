import {
  publicApiWebhookDelivery,
  publicApiWebhookSubscription,
} from "@calibra-facil/db/schema";
import {
  PUBLIC_API_WEBHOOK_EVENTS,
  PUBLIC_API_WEBHOOK_RESPONSE_SNIPPET_BYTES,
  truncateUtf8Bytes,
  type PublicApiWebhookEvent,
} from "@calibra-facil/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { withOrg, type OrgActor, type OrgContext } from "./org-context";

/**
 * Webhook deliveries are queue jobs (`WEBHOOK_DELIVERY`), not calls made inside
 * the request. The delivery row and its queue row are written in the SAME
 * transaction as the change that raised the event, so a rolled-back mutation
 * sends nothing and a committed one cannot lose its event; the worker calls the
 * subscriber (`processWebhookDelivery` in jobs-core) with exponential backoff
 * and records every attempt on the delivery row.
 */

/** The write an event is staged in: the `OrgContext` of a `withOrg`. */
export type WebhookStagingScope = Pick<OrgContext, "o" | "emit">;

type StageParams = {
  organizationId: string;
  eventType: PublicApiWebhookEvent;
  payload: Record<string, unknown>;
};

/**
 * Registers the delivery of one event to every active subscription of the
 * laboratory that listens for it, inside the caller's transaction. Always scoped
 * by `organizationId`, so a subscription of another laboratory never receives
 * the event. Nothing leaves the process until the transaction commits.
 */
export async function stagePublicApiWebhookEvent(
  scope: WebhookStagingScope,
  params: StageParams,
): Promise<void> {
  if (!PUBLIC_API_WEBHOOK_EVENTS.includes(params.eventType)) return;
  const { o, emit } = scope;

  const subscriptions = await o
    .select({
      id: publicApiWebhookSubscription.id,
      targetUrl: publicApiWebhookSubscription.targetUrl,
    })
    .from(publicApiWebhookSubscription)
    .where(
      and(
        eq(publicApiWebhookSubscription.organizationId, params.organizationId),
        eq(publicApiWebhookSubscription.status, "ACTIVE"),
        sql`${publicApiWebhookSubscription.events} ? ${params.eventType}`,
      ),
    );
  if (subscriptions.length === 0) return;

  const requestBody = {
    id: crypto.randomUUID(),
    type: params.eventType,
    occurredAt: new Date().toISOString(),
    data: params.payload,
  };
  const deliveries = await o
    .insert(publicApiWebhookDelivery)
    .values(
      subscriptions.map((subscription) => ({
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        organizationId: params.organizationId,
        eventId: requestBody.id,
        eventType: params.eventType,
        requestUrl: subscription.targetUrl,
        requestBody,
      })),
    )
    .returning({ id: publicApiWebhookDelivery.id });

  // Each delivery is a queue row of this transaction (an in-process dispatch
  // mode runs it after the commit instead).
  for (const delivery of deliveries) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the queue rows are written on one transaction, one statement after the other.
    await emit({
      type: "WEBHOOK_DELIVERY",
      deliveryId: delivery.id,
      organizationId: params.organizationId,
    });
  }
}

/**
 * Stages an event in a transaction of its own, for the few mutations that
 * commit before they know the payload. Prefer `stagePublicApiWebhookEvent` in
 * the mutation's own transaction.
 */
export function emitPublicApiWebhookEvent(
  actor: OrgActor,
  params: StageParams,
) {
  return withOrg(params.organizationId, actor, (ctx) =>
    stagePublicApiWebhookEvent(ctx, params),
  );
}

/**
 * Queues a new delivery of the same event of an earlier delivery of this
 * subscription (the original stays on record). Returns the new delivery, or
 * `null` when the subscription or the delivery is not the laboratory's.
 */
export async function replayPublicApiWebhookDelivery(
  { o, emit }: Pick<OrgContext, "o" | "emit">,
  params: {
    organizationId: string;
    subscriptionId: string;
    deliveryId: string;
  },
) {
  const [subscription] = await o
    .select({
      id: publicApiWebhookSubscription.id,
      targetUrl: publicApiWebhookSubscription.targetUrl,
    })
    .from(publicApiWebhookSubscription)
    .where(
      and(
        eq(publicApiWebhookSubscription.id, params.subscriptionId),
        eq(publicApiWebhookSubscription.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!subscription) return null;

  const [delivery] = await o
    .select()
    .from(publicApiWebhookDelivery)
    .where(
      and(
        eq(publicApiWebhookDelivery.id, params.deliveryId),
        eq(publicApiWebhookDelivery.subscriptionId, subscription.id),
        eq(publicApiWebhookDelivery.organizationId, params.organizationId),
      ),
    )
    .orderBy(desc(publicApiWebhookDelivery.createdAt))
    .limit(1);
  if (!delivery) return null;

  const [created] = await o
    .insert(publicApiWebhookDelivery)
    .values({
      id: crypto.randomUUID(),
      subscriptionId: subscription.id,
      organizationId: params.organizationId,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      requestUrl: subscription.targetUrl,
      requestBody: delivery.requestBody,
      replayOfDeliveryId: delivery.id,
    })
    .returning();
  await emit({
    type: "WEBHOOK_DELIVERY",
    deliveryId: created!.id,
    organizationId: params.organizationId,
  });
  return created!;
}

type DeliveryRow = typeof publicApiWebhookDelivery.$inferSelect;

/**
 * A delivery as the API returns it. The subscriber's answer is untrusted and
 * only ever a short snippet (the worker stores no more; this also cuts rows
 * written before that).
 */
export function mapWebhookDelivery(row: DeliveryRow) {
  return {
    ...row,
    responseBody:
      row.responseBody === null
        ? null
        : truncateUtf8Bytes(
            row.responseBody,
            PUBLIC_API_WEBHOOK_RESPONSE_SNIPPET_BYTES,
          ),
  };
}
