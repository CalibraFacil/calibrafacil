import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  publicApiWebhookDelivery,
  publicApiWebhookSubscription,
} from "@calibra-facil/db/schema";
import type { WebhookDeliveryBackgroundJobMessage } from "@calibra-facil/schemas";
import {
  PUBLIC_API_WEBHOOK_EVENTS,
  PUBLIC_API_WEBHOOK_RESPONSE_SNIPPET_BYTES,
  type PublicApiWebhookEvent,
} from "@calibra-facil/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterCommitQueue, type AfterCommitTask } from "./after-commit";
import { enqueueBackgroundJob } from "./background-jobs";
import {
  dispatchStagedBackgroundJob,
  stageBackgroundJob,
} from "./background-job-outbox";
import {
  orgTransactionWithExecutor,
  type OrgRawTransaction,
} from "./org-transaction";

/**
 * Webhook deliveries are queue jobs (`WEBHOOK_DELIVERY`), not calls made inside
 * the request. The delivery row and its queue row are written in the SAME
 * transaction as the change that raised the event, so a rolled-back mutation
 * sends nothing and a committed one cannot lose its event; the worker calls the
 * subscriber (`processWebhookDelivery` in jobs-core) with exponential backoff
 * and records every attempt on the delivery row.
 */

/** The transaction a mutation runs in, and where to register post-commit work. */
export type WebhookStagingScope = {
  o: OrgDb;
  tx: OrgRawTransaction;
  afterCommit: (task: AfterCommitTask) => void;
};

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
  const { o, tx, afterCommit } = scope;

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

  await stageDeliveries(
    tx,
    afterCommit,
    deliveries.map((delivery) => ({
      type: "WEBHOOK_DELIVERY",
      deliveryId: delivery.id,
      organizationId: params.organizationId,
    })),
  );
}

async function stageDeliveries(
  tx: OrgRawTransaction,
  afterCommit: (task: AfterCommitTask) => void,
  messages: WebhookDeliveryBackgroundJobMessage[],
) {
  let anyStaged = false;
  for (const message of messages) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the queue rows are written on one transaction, one statement after the other.
    const staged = await stageBackgroundJob(tx, message);
    if (staged) {
      anyStaged = true;
    } else {
      // In-process dispatch (local/inline mode): runs after the commit.
      afterCommit(() => enqueueBackgroundJob(message));
    }
  }
  // Queue rows are durable already; the document worker only needs a nudge.
  if (anyStaged) afterCommit(() => dispatchStagedBackgroundJob());
}

async function runAfterCommit(queue: ReturnType<typeof afterCommitQueue>) {
  try {
    await queue.run();
  } catch (error) {
    // The mutation is committed and the delivery is a row the queue (or a
    // replay) can still drive: a failed wake-up must not fail the request.
    console.error("[PublicApi] Webhook dispatch failed after commit", error);
  }
}

/**
 * Stages an event in a transaction of its own, for the few mutations that
 * commit before they know the payload. Prefer `stagePublicApiWebhookEvent` in
 * the mutation's own transaction.
 */
export async function emitPublicApiWebhookEvent(params: StageParams) {
  const queue = afterCommitQueue();
  await orgTransactionWithExecutor(params.organizationId, (o, tx) =>
    stagePublicApiWebhookEvent({ o, tx, afterCommit: queue.add }, params),
  );
  await runAfterCommit(queue);
}

/**
 * An org-bound transaction for a mutation that raises webhook events: `run`
 * stages them with the scope it is handed, they are queued with the mutation
 * (a rollback queues nothing) and dispatched once it has committed.
 */
export async function withPublicApiWebhookTransaction<R>(
  organizationId: string,
  run: (o: OrgDb, webhooks: WebhookStagingScope) => Promise<R>,
): Promise<R> {
  const queue = afterCommitQueue();
  const result = await orgTransactionWithExecutor(organizationId, (o, tx) =>
    run(o, { o, tx, afterCommit: queue.add }),
  );
  await runAfterCommit(queue);
  return result;
}

/**
 * Queues a new delivery of the same event of an earlier delivery of this
 * subscription (the original stays on record). Returns the new delivery, or
 * `null` when the subscription or the delivery is not the laboratory's.
 */
export async function replayPublicApiWebhookDelivery(params: {
  organizationId: string;
  subscriptionId: string;
  deliveryId: string;
}) {
  const queue = afterCommitQueue();
  const replay = await orgTransactionWithExecutor(
    params.organizationId,
    async (o, tx) => {
      const [subscription] = await o
        .select({
          id: publicApiWebhookSubscription.id,
          targetUrl: publicApiWebhookSubscription.targetUrl,
        })
        .from(publicApiWebhookSubscription)
        .where(
          and(
            eq(publicApiWebhookSubscription.id, params.subscriptionId),
            eq(
              publicApiWebhookSubscription.organizationId,
              params.organizationId,
            ),
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
      await stageDeliveries(tx, queue.add, [
        {
          type: "WEBHOOK_DELIVERY",
          deliveryId: created!.id,
          organizationId: params.organizationId,
        },
      ]);
      return created!;
    },
  );
  if (replay) await runAfterCommit(queue);
  return replay;
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
        : Buffer.from(row.responseBody)
            .subarray(0, PUBLIC_API_WEBHOOK_RESPONSE_SNIPPET_BYTES)
            .toString(),
  };
}
