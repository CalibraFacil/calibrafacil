import { z } from "zod";
import {
  PUBLIC_API_WEBHOOK_MAX_ATTEMPTS,
  type IntegrationSyncTarget,
  type IntegrationSyncTrigger,
} from "@calibra-facil/shared";

// The one job contract for background work: every message that travels through
// the Postgres queue (`app_queue_job`) is a member of
// `BackgroundJobMessageSchema`, discriminated by `type`. Producers are
// type-checked against the inferred types, `enqueueQueueJob` validates before it
// inserts, and every consumer parses with `parseBackgroundJobMessage` /
// `parseQueueMessage` before a handler runs, so a handler only ever sees a
// payload that already matched its schema.
//
// The shapes mirror what the producers write today (rows already queued in
// production must keep parsing): a certificate render may omit `type`, the
// integration sync may omit `provider`, and the cron-only timers carry no
// payload. Unknown keys are stripped on parse.
//
// A Conta Azul sync is deliberately NOT in this union: it runs in the API
// process (its client lives in the API's integrations module), so it is never a
// queue row and has its own schema, `ContaAzulSyncMessageSchema`, below.

const IntegrationSyncTargetSchema = z.enum([
  "catalog_item",
  "contract",
  "customer",
  "supplier",
  "transporter",
  "service_order",
  "billing_document",
  "payable",
]) satisfies z.ZodType<IntegrationSyncTarget>;

const IntegrationSyncTriggerSchema = z.enum([
  "manual",
  "event",
  "scheduled",
  "retry",
]) satisfies z.ZodType<IntegrationSyncTrigger>;

const id = z.number();
const userId = z.string();

/** Certificate render. `type` is omitted by the approval and amendment flows. */
const CertificateJobMessageSchema = z.object({
  type: z.literal("CERTIFICATE").optional(),
  jobId: id,
  userId,
});

const LabelJobMessageSchema = z.object({
  type: z.literal("LABEL"),
  jobId: id,
  userId,
});

const ServiceOrderIntakeDocumentJobMessageSchema = z.object({
  type: z.literal("SERVICE_ORDER_INTAKE_DOCUMENT"),
  serviceOrderId: id,
  documentId: id.optional(),
  userId,
});

const ServiceOrderTagJobMessageSchema = z.object({
  type: z.literal("SERVICE_ORDER_TAG"),
  serviceOrderId: id,
  tagId: id.optional(),
  userId,
});

const ServiceOrderQuoteJobMessageSchema = z.object({
  type: z.literal("SERVICE_ORDER_QUOTE"),
  serviceOrderId: id,
  quoteId: id.optional(),
  userId,
});

const ServiceOrderDeliveryReceiptJobMessageSchema = z.object({
  type: z.literal("SERVICE_ORDER_DELIVERY_RECEIPT"),
  serviceOrderId: id,
  documentId: id.optional(),
  userId,
});

/**
 * §7.10 out-of-tolerance customer notification PDF (#426 Phase 0).
 * All context lives on the `oot_notification` row; the message points at it.
 */
const OotNotificationJobMessageSchema = z.object({
  type: z.literal("OOT_NOTIFICATION"),
  notificationId: id,
  userId,
});

/**
 * Post-approval notification to the technician (or job creator) that the
 * calibration was approved. Staged in the approval's own transaction (outbox),
 * so it is delivered after the commit with the queue's retries and never for an
 * approval that rolled back.
 */
const JobApprovedNotificationJobMessageSchema = z.object({
  type: z.literal("JOB_APPROVED_NOTIFICATION"),
  jobId: id,
  /** The approver. */
  userId,
});

/**
 * Customer-facing out-of-tolerance alert of an as-found NON_CONFORMING approval
 * (ISO/IEC 17025 7.10, #740 Track B). The event row itself is written in the
 * approval's transaction; this message only delivers the in-app notification
 * and the e-mail and records the `notify` audit entry. Idempotent per event.
 */
const AssetOotNotificationJobMessageSchema = z.object({
  type: z.literal("ASSET_OOT_NOTIFICATION"),
  eventId: id,
  /** The laboratory that owns the event (the handler scopes its reads to it). */
  organizationId: z.string(),
  /** The approver (or the reconciler's actor) the audit entry is attributed to. */
  userId,
});

// The generic HTTP ERP sync. `provider` is either omitted (what every producer
// writes) or `generic_http`; a payload naming `conta_azul` no longer parses (it
// never was a queue row: the dead-letter reason says why).
const IntegrationSyncJobMessageSchema = z.object({
  type: z.literal("INTEGRATION_SYNC"),
  provider: z.literal("generic_http").optional(),
  integrationId: z.string(),
  organizationId: z.string(),
  runId: z.string(),
  target: IntegrationSyncTargetSchema,
  limit: z.number(),
  trigger: IntegrationSyncTriggerSchema,
});

/**
 * One Conta Azul sync, started in the API process by `dispatchContaAzulSync`
 * (apps/api, modules/integrations): from the integrations route and from the
 * scheduled-sync cron. Not a `BackgroundJobMessage`: it never travels through
 * `app_queue_job`, so sending one to `enqueueBackgroundJob` fails type-checking.
 */
export const ContaAzulSyncMessageSchema = z.object({
  type: z.literal("CONTA_AZUL_SYNC"),
  integrationId: z.string(),
  organizationId: z.string(),
  runId: z.string(),
  target: IntegrationSyncTargetSchema,
  limit: z.number(),
  trigger: IntegrationSyncTriggerSchema,
});

export type ContaAzulSyncMessage = z.infer<typeof ContaAzulSyncMessageSchema>;

/**
 * One delivery of a public-API webhook event to a subscriber. Everything the
 * call needs lives on the `public_api_webhook_delivery` row (and its
 * subscription); the message points at it. The laboratory is named so the
 * handler can bind its transaction to it (row-level security).
 */
const WebhookDeliveryJobMessageSchema = z.object({
  type: z.literal("WEBHOOK_DELIVERY"),
  deliveryId: z.string(),
  organizationId: z.string(),
});

/**
 * Portal audit pack (issue #738): bulk export of released certificates +
 * fleet-status report requested by a portal user. All request parameters live
 * on the `portal_export_job` row; the message only points at it.
 */
const AuditPackJobMessageSchema = z.object({
  type: z.literal("AUDIT_PACK"),
  exportId: id,
  userId,
});

/**
 * Nightly timer that re-evaluates every SPC control chart against its stored
 * check-standard readings (ISO/IEC 17025 §7.7.1, issue #60). No payload.
 */
const SpcRecomputeJobMessageSchema = z.object({
  type: z.literal("SPC_RECOMPUTE"),
});

/**
 * Daily timer that re-polls Resend for every lab-owned email sending domain
 * (issue #584). No payload — the worker sweeps all organization_email_domain rows.
 */
const EmailDomainHealthJobMessageSchema = z.object({
  type: z.literal("EMAIL_DOMAIN_HEALTH"),
});

/** Cron-only timer, never written to `app_queue_job`. No payload. */
const ScheduledNotificationsJobMessageSchema = z.object({
  type: z.literal("SCHEDULED_NOTIFICATIONS"),
});

/**
 * Cron-only daily timer that fans out the client-portal due-calibration digest
 * emails. No payload — the worker derives which frequencies fire from the date.
 */
const PortalDigestJobMessageSchema = z.object({
  type: z.literal("PORTAL_DIGEST"),
});

/** Every job that can be written to `app_queue_job`. */
export const QueueMessageSchema = z.discriminatedUnion("type", [
  CertificateJobMessageSchema,
  LabelJobMessageSchema,
  ServiceOrderIntakeDocumentJobMessageSchema,
  ServiceOrderTagJobMessageSchema,
  ServiceOrderQuoteJobMessageSchema,
  ServiceOrderDeliveryReceiptJobMessageSchema,
  OotNotificationJobMessageSchema,
  JobApprovedNotificationJobMessageSchema,
  AssetOotNotificationJobMessageSchema,
  IntegrationSyncJobMessageSchema,
  AuditPackJobMessageSchema,
  WebhookDeliveryJobMessageSchema,
  SpcRecomputeJobMessageSchema,
  EmailDomainHealthJobMessageSchema,
]);

/** Every message the background-job dispatcher carries (queue jobs + cron timers). */
export const BackgroundJobMessageSchema = z.discriminatedUnion("type", [
  ...QueueMessageSchema.options,
  ScheduledNotificationsJobMessageSchema,
  PortalDigestJobMessageSchema,
]);

export type DocumentBackgroundJobMessage =
  | z.infer<typeof CertificateJobMessageSchema>
  | z.infer<typeof LabelJobMessageSchema>
  | z.infer<typeof ServiceOrderIntakeDocumentJobMessageSchema>
  | z.infer<typeof ServiceOrderTagJobMessageSchema>
  | z.infer<typeof ServiceOrderQuoteJobMessageSchema>
  | z.infer<typeof ServiceOrderDeliveryReceiptJobMessageSchema>
  | z.infer<typeof OotNotificationJobMessageSchema>;
export type JobApprovedNotificationBackgroundJobMessage = z.infer<
  typeof JobApprovedNotificationJobMessageSchema
>;
export type AssetOotNotificationBackgroundJobMessage = z.infer<
  typeof AssetOotNotificationJobMessageSchema
>;
export type IntegrationSyncBackgroundJobMessage = z.infer<
  typeof IntegrationSyncJobMessageSchema
>;
export type AuditPackBackgroundJobMessage = z.infer<
  typeof AuditPackJobMessageSchema
>;
export type WebhookDeliveryBackgroundJobMessage = z.infer<
  typeof WebhookDeliveryJobMessageSchema
>;
export type QueueMessage = z.infer<typeof QueueMessageSchema>;
export type BackgroundJobMessage = z.infer<typeof BackgroundJobMessageSchema>;

/** A job type; a certificate render may leave `type` out of its payload. */
export type BackgroundJobType = NonNullable<BackgroundJobMessage["type"]>;
export type QueueJobType = NonNullable<QueueMessage["type"]>;

type RetryPolicy = {
  maxAttempts: number;
  firstDelayMs: number;
  factor: number;
  maxDelayMs: number;
};

/** Our own jobs: 5 s, 10 s, 20 s ... capped at five minutes. */
const INTERNAL_RETRY: RetryPolicy = {
  maxAttempts: 3,
  firstDelayMs: 5_000,
  factor: 2,
  maxDelayMs: 5 * 60_000,
};

/**
 * A call to an outside system that may need minutes to recover: 30 s, 2 min,
 * 8 min, 32 min, capped at an hour.
 */
const OUTSIDE_SYSTEM_RETRY: RetryPolicy = {
  maxAttempts: PUBLIC_API_WEBHOOK_MAX_ATTEMPTS,
  firstDelayMs: 30_000,
  factor: 4,
  maxDelayMs: 60 * 60_000,
};

/**
 * Every background job type: whether it travels through `app_queue_job` (a cron
 * timer does not) and how a failed attempt is retried. Adding a message schema
 * above without a row here fails type-checking.
 */
const BACKGROUND_JOB_TYPES = {
  CERTIFICATE: { queue: true, retry: INTERNAL_RETRY },
  LABEL: { queue: true, retry: INTERNAL_RETRY },
  SERVICE_ORDER_INTAKE_DOCUMENT: { queue: true, retry: INTERNAL_RETRY },
  SERVICE_ORDER_TAG: { queue: true, retry: INTERNAL_RETRY },
  SERVICE_ORDER_QUOTE: { queue: true, retry: INTERNAL_RETRY },
  SERVICE_ORDER_DELIVERY_RECEIPT: { queue: true, retry: INTERNAL_RETRY },
  OOT_NOTIFICATION: { queue: true, retry: INTERNAL_RETRY },
  JOB_APPROVED_NOTIFICATION: { queue: true, retry: INTERNAL_RETRY },
  ASSET_OOT_NOTIFICATION: { queue: true, retry: INTERNAL_RETRY },
  INTEGRATION_SYNC: { queue: true, retry: INTERNAL_RETRY },
  AUDIT_PACK: { queue: true, retry: INTERNAL_RETRY },
  WEBHOOK_DELIVERY: { queue: true, retry: OUTSIDE_SYSTEM_RETRY },
  SPC_RECOMPUTE: { queue: true, retry: INTERNAL_RETRY },
  EMAIL_DOMAIN_HEALTH: { queue: true, retry: INTERNAL_RETRY },
  SCHEDULED_NOTIFICATIONS: { queue: false },
  PORTAL_DIGEST: { queue: false },
} as const satisfies Record<
  BackgroundJobType,
  { queue: true; retry: RetryPolicy } | { queue: false }
>;

/** The job type a message names (`CERTIFICATE` when the payload leaves it out). */
export function backgroundJobType<T extends BackgroundJobType>(message: {
  type?: T;
}): T | "CERTIFICATE" {
  return message.type ?? "CERTIFICATE";
}

export function isQueueJobType(value: unknown): value is QueueJobType {
  return (
    typeof value === "string" &&
    Object.entries(BACKGROUND_JOB_TYPES).some(
      ([type, entry]) => type === value && entry.queue,
    )
  );
}

/** A row whose type predates this table gets the policy of our own jobs. */
function retryPolicy(type: string | undefined): RetryPolicy {
  return isQueueJobType(type)
    ? BACKGROUND_JOB_TYPES[type].retry
    : INTERNAL_RETRY;
}

export function queueJobMaxAttempts(type: QueueJobType): number {
  return retryPolicy(type).maxAttempts;
}

/** Wait before attempt `attempts + 1` of a job of this type. */
export function queueJobRetryDelayMs(
  type: string | undefined,
  attempts: number,
): number {
  const { firstDelayMs, factor, maxDelayMs } = retryPolicy(type);
  return Math.min(
    maxDelayMs,
    firstDelayMs * factor ** Math.max(0, attempts - 1),
  );
}

export type BackgroundJobParseResult<TMessage> =
  | { ok: true; message: TMessage }
  | { ok: false; reason: string };

const MAX_REASON_LENGTH = 500;

function describeValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function readType(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value)).type;
}

function failureReason(value: unknown, error: z.ZodError): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `Job payload must be a JSON object, received ${
      Array.isArray(value) ? "an array" : value === null ? "null" : typeof value
    }`;
  }

  const type = readType(value);
  const typeIssue = error.issues.find(
    (issue) => issue.code === "invalid_union" && issue.path[0] === "type",
  );
  if (typeIssue) {
    return `Unknown job type ${type === undefined ? "(missing)" : describeValue(type)}`;
  }

  const details = error.issues
    .map((issue) => `${issue.path.join(".") || "(payload)"}: ${issue.message}`)
    .join("; ");
  const reason = `Invalid payload for job type ${
    type === undefined ? "CERTIFICATE" : describeValue(type)
  }: ${details}`;
  return reason.length > MAX_REASON_LENGTH
    ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…`
    : reason;
}

/**
 * The single parse step the Postgres drain runs on an untrusted message before a handler sees it.
 * Never throws: a failure carries the human-readable reason a dead-letter
 * records.
 */
export function parseBackgroundJobMessage(
  value: unknown,
): BackgroundJobParseResult<BackgroundJobMessage> {
  const result = BackgroundJobMessageSchema.safeParse(value);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, reason: failureReason(value, result.error) };
}

/**
 * As `parseBackgroundJobMessage`, restricted to the jobs `app_queue_job` can
 * hold. The cron-only timers are reported as unknown job types.
 */
export function parseQueueMessage(
  value: unknown,
): BackgroundJobParseResult<QueueMessage> {
  const result = QueueMessageSchema.safeParse(value);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, reason: failureReason(value, result.error) };
}
