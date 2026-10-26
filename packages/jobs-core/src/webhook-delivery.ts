import { createHmac } from "node:crypto";
import { getRetryDelayMs } from "@calibra-facil/db/queue";
import type { WebhookDeliveryBackgroundJobMessage } from "@calibra-facil/schemas";
import {
  PUBLIC_API_WEBHOOK_AUTO_DISABLE_AFTER,
  PUBLIC_API_WEBHOOK_AUTO_DISABLE_REASON,
  PUBLIC_API_WEBHOOK_RESPONSE_SNIPPET_BYTES,
  type PublicApiWebhookAttempt,
} from "@calibra-facil/shared";
import {
  OutboundRequestError,
  safeOutboundFetch,
} from "@calibra-facil/shared/safe-outbound-fetch";
import { decryptPassword } from "@calibra-facil/signing";
import { withOrgSession, type OrgSession } from "./pdf-render.js";
import {
  isFinalDelivery,
  type DeliveryAttempt,
  type Env,
} from "./runtime-types.js";

/** Calls kept on the delivery row (the newest ones). */
const MAX_RECORDED_ATTEMPTS = 10;

function signWebhookPayload(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

type DeliveryRow = {
  id: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  event_id: string;
  event_type: string;
  request_body: unknown;
  attempt_count: number;
  attempts: unknown;
  replay_of_delivery_id: string | null;
  subscription_id: string;
  target_url: string;
  subscription_status: "ACTIVE" | "INACTIVE";
  encrypted_secret: string;
  secret_iv: string;
};

function webhookMasterKey(env: Env): string {
  const key = env.PUBLIC_API_MASTER_KEY ?? env.INTEGRATIONS_MASTER_KEY;
  if (!key) throw new Error("PUBLIC_API_MASTER_KEY não configurada");
  return key;
}

function isAttemptList(value: unknown): value is PublicApiWebhookAttempt[] {
  return Array.isArray(value);
}

/**
 * The subscriber's answer as a short text snippet. It is untrusted and never
 * stored whole: the first `PUBLIC_API_WEBHOOK_RESPONSE_SNIPPET_BYTES` bytes,
 * without the NUL characters Postgres text refuses.
 */
function toSnippet(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  return new TextDecoder()
    .decode(bytes.subarray(0, PUBLIC_API_WEBHOOK_RESPONSE_SNIPPET_BYTES))
    .replaceAll("\u0000", "");
}

type Outcome = {
  status: number | null;
  snippet: string | null;
  error: string | null;
  durationMs: number;
  /** A failure a retry cannot fix (a refused address, an unusable URL). */
  permanent: boolean;
};

async function callSubscriber(
  row: DeliveryRow,
  secret: string,
): Promise<Outcome> {
  const body = JSON.stringify(row.request_body);
  const started = Date.now();
  try {
    const response = await safeOutboundFetch(
      row.target_url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-calibra-event-id": row.event_id,
          "x-calibra-event-type": row.event_type,
          "x-calibra-signature": signWebhookPayload(secret, body),
        },
        body,
      },
      // The answer is only ever kept as a snippet; a subscriber that streams
      // more is cut off, not waited for. No redirects: a 3xx is a failure.
      { onOversize: "truncate" },
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      snippet: toSnippet(bytes),
      error: response.ok ? null : `HTTP ${response.status}`,
      durationMs: Date.now() - started,
      permanent: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha de entrega";
    return {
      status: null,
      snippet: null,
      error: message,
      durationMs: Date.now() - started,
      permanent:
        error instanceof OutboundRequestError &&
        (error.code === "invalid_url" || error.code === "blocked_address"),
    };
  }
}

async function loadDelivery(
  session: OrgSession,
  deliveryId: string,
): Promise<DeliveryRow | null> {
  const result = await session.query<DeliveryRow>(
    `select d.id, d.status, d.event_id, d.event_type, d.request_body,
            d.attempt_count, d.attempts, d.replay_of_delivery_id,
            s.id as subscription_id, s.target_url,
            s.status as subscription_status, s.encrypted_secret, s.secret_iv
       from public_api_webhook_delivery d
       join public_api_webhook_subscription s
         on s.id = d.subscription_id and s.organization_id = d.organization_id
      where d.id = $1 and d.organization_id = $2`,
    [deliveryId, session.organizationId],
  );
  return result.rows[0] ?? null;
}

/**
 * Delivers one queued webhook event. The queue calls it again, with
 * exponential backoff, while it throws; the last delivery records the failure
 * and counts it against the subscription, which switches itself off after
 * `PUBLIC_API_WEBHOOK_AUTO_DISABLE_AFTER` deliveries in a row that gave up.
 * Delivery is at-least-once (a lease reclaim can repeat a call): subscribers
 * deduplicate on `x-calibra-event-id`. No database transaction is open while
 * the subscriber is called.
 */
export async function processWebhookDelivery(
  env: Env,
  message: WebhookDeliveryBackgroundJobMessage,
  delivery?: DeliveryAttempt,
): Promise<void> {
  await withOrgSession(env, message.organizationId, async (session) => {
    const row = await loadDelivery(session, message.deliveryId);
    if (!row) {
      // The subscription (and with it the delivery) was deleted meanwhile.
      console.warn(
        `[Webhook] delivery ${message.deliveryId} no longer exists; nothing to send`,
      );
      return;
    }
    // A repeated message (lease reclaim) for a delivery already made.
    if (row.status === "SUCCESS") return;

    const isReplay = row.replay_of_delivery_id !== null;
    const attemptNumber = row.attempt_count + 1;
    const previous = isAttemptList(row.attempts) ? row.attempts : [];

    const record = (entry: PublicApiWebhookAttempt) =>
      [...previous, entry].slice(-MAX_RECORDED_ATTEMPTS);

    // Switched off while the event waited: do not call a subscriber that no
    // longer wants it. (A replay is an operator's explicit request.)
    if (row.subscription_status !== "ACTIVE" && !isReplay) {
      await session.query(
        `update public_api_webhook_delivery
            set status = 'FAILED', failed_at = now(), next_attempt_at = null,
                last_error = $3, updated_at = now()
          where id = $1 and organization_id = $2`,
        [row.id, session.organizationId, "Webhook desativado antes da entrega"],
      );
      return;
    }

    const secret = decryptPassword(
      row.encrypted_secret,
      row.secret_iv,
      webhookMasterKey(env),
    );
    const outcome = await callSubscriber(row, secret);
    const entry: PublicApiWebhookAttempt = {
      attempt: attemptNumber,
      at: new Date().toISOString(),
      durationMs: outcome.durationMs,
      status: outcome.status,
      error: outcome.error,
    };
    const attempts = JSON.stringify(record(entry));

    if (outcome.error === null) {
      await session.transaction(async (client) => {
        await client.query(
          `update public_api_webhook_delivery
              set status = 'SUCCESS', attempt_count = $3, attempts = $4::jsonb,
                  response_status = $5, response_body = $6, delivered_at = now(),
                  failed_at = null, last_error = null, next_attempt_at = null,
                  updated_at = now()
            where id = $1 and organization_id = $2`,
          [
            row.id,
            session.organizationId,
            attemptNumber,
            attempts,
            outcome.status,
            outcome.snippet,
          ],
        );
        if (!isReplay) {
          await client.query(
            `update public_api_webhook_subscription
                set consecutive_failures = 0, last_success_at = now(),
                    updated_at = now()
              where id = $1 and organization_id = $2`,
            [row.subscription_id, session.organizationId],
          );
        }
      });
      return;
    }

    const final = outcome.permanent || isFinalDelivery(delivery);
    if (!final) {
      const delayMs = getRetryDelayMs(
        delivery?.attempt ?? attemptNumber,
        "WEBHOOK_DELIVERY",
      );
      await session.query(
        `update public_api_webhook_delivery
            set attempt_count = $3, attempts = $4::jsonb, response_status = $5,
                response_body = $6, last_error = $7,
                next_attempt_at = now() + make_interval(secs => $8::double precision / 1000),
                updated_at = now()
          where id = $1 and organization_id = $2`,
        [
          row.id,
          session.organizationId,
          attemptNumber,
          attempts,
          outcome.status,
          outcome.snippet,
          outcome.error,
          delayMs,
        ],
      );
      // The queue redelivers after its backoff.
      throw new Error(`Webhook delivery failed: ${outcome.error}`);
    }

    await session.transaction(async (client) => {
      await client.query(
        `update public_api_webhook_delivery
            set status = 'FAILED', attempt_count = $3, attempts = $4::jsonb,
                response_status = $5, response_body = $6, last_error = $7,
                failed_at = now(), next_attempt_at = null, updated_at = now()
          where id = $1 and organization_id = $2`,
        [
          row.id,
          session.organizationId,
          attemptNumber,
          attempts,
          outcome.status,
          outcome.snippet,
          outcome.error,
        ],
      );
      // A replay is an operator's own request: it does not count against the
      // subscription's health.
      if (isReplay) return;
      await client.query(
        `update public_api_webhook_subscription
            set consecutive_failures = consecutive_failures + 1,
                last_failure_at = now(),
                status = case when status = 'ACTIVE'
                               and consecutive_failures + 1 >= $3
                              then 'INACTIVE' else status end,
                disabled_at = case when status = 'ACTIVE'
                                    and consecutive_failures + 1 >= $3
                                   then now() else disabled_at end,
                disabled_reason = case when status = 'ACTIVE'
                                        and consecutive_failures + 1 >= $3
                                       then $4 else disabled_reason end,
                updated_at = now()
          where id = $1 and organization_id = $2`,
        [
          row.subscription_id,
          session.organizationId,
          PUBLIC_API_WEBHOOK_AUTO_DISABLE_AFTER,
          PUBLIC_API_WEBHOOK_AUTO_DISABLE_REASON,
        ],
      );
    });
  });
}
