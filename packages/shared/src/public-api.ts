export const PUBLIC_API_RESOURCE_TYPES = [
  "customer",
  "asset",
  "request",
  "job",
] as const;

export type PublicApiResourceType = (typeof PUBLIC_API_RESOURCE_TYPES)[number];

export const PUBLIC_API_WEBHOOK_EVENTS = [
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "asset.created",
  "asset.updated",
  "asset.deleted",
  "request.created",
  "request.updated",
  "request.submitted",
  "request.canceled",
  "job.created",
  "job.updated",
  "job.results_submitted",
  "job.approved",
  "job.canceled",
  "certificate.available",
] as const;

export type PublicApiWebhookEvent = (typeof PUBLIC_API_WEBHOOK_EVENTS)[number];

export const PUBLIC_API_WEBHOOK_SUBSCRIPTION_STATUSES = [
  "ACTIVE",
  "INACTIVE",
] as const;

export type PublicApiWebhookSubscriptionStatus =
  (typeof PUBLIC_API_WEBHOOK_SUBSCRIPTION_STATUSES)[number];

export const PUBLIC_API_WEBHOOK_DELIVERY_STATUSES = [
  "PENDING",
  "SUCCESS",
  "FAILED",
] as const;

export type PublicApiWebhookDeliveryStatus =
  (typeof PUBLIC_API_WEBHOOK_DELIVERY_STATUSES)[number];

/** Attempts a webhook delivery gets (the first call plus the retries). */
export const PUBLIC_API_WEBHOOK_MAX_ATTEMPTS = 5;

/**
 * Deliveries in a row that exhaust every attempt before the subscription is
 * switched off (the reason is recorded on it).
 */
export const PUBLIC_API_WEBHOOK_AUTO_DISABLE_AFTER = 10;

/** What the subscription records as `disabledReason` when it switched itself off. */
export const PUBLIC_API_WEBHOOK_AUTO_DISABLE_REASON = "consecutive_failures";

/** A subscriber's answer is kept as a snippet this long (bytes), never whole. */
export const PUBLIC_API_WEBHOOK_RESPONSE_SNIPPET_BYTES = 512;

/**
 * The longest prefix of `text` whose UTF-8 encoding is at most `maxBytes`,
 * cut between characters (never inside one, so it stays valid text).
 */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const width = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + width > maxBytes) break;
    bytes += width;
    end += character.length;
  }
  return text.slice(0, end);
}

/** One recorded call to a subscriber (an entry of the delivery's `attempts`). */
export interface PublicApiWebhookAttempt {
  /** 1-based. */
  attempt: number;
  at: string;
  durationMs: number;
  /** HTTP status; `null` when no answer arrived (refused address, timeout...). */
  status: number | null;
  /** Why it failed; `null` on success. */
  error: string | null;
}
