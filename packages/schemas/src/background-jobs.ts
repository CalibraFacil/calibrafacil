import { z } from "zod";
import type {
  IntegrationProvider,
  IntegrationSyncTarget,
  IntegrationSyncTrigger,
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

// Same literals as the shared string unions: `satisfies` keeps the two in step
// (a literal the union does not know about fails type-checking here; a member
// missing from this list fails type-checking in the producers).
const IntegrationProviderSchema = z.enum([
  "generic_http",
  "conta_azul",
]) satisfies z.ZodType<IntegrationProvider>;

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
export const CertificateJobMessageSchema = z.object({
  type: z.literal("CERTIFICATE").optional(),
  jobId: id,
  userId,
});

export const LabelJobMessageSchema = z.object({
  type: z.literal("LABEL"),
  jobId: id,
  userId,
});

export const ServiceOrderIntakeDocumentJobMessageSchema = z.object({
  type: z.literal("SERVICE_ORDER_INTAKE_DOCUMENT"),
  serviceOrderId: id,
  documentId: id.optional(),
  userId,
});

export const ServiceOrderTagJobMessageSchema = z.object({
  type: z.literal("SERVICE_ORDER_TAG"),
  serviceOrderId: id,
  tagId: id.optional(),
  userId,
});

export const ServiceOrderQuoteJobMessageSchema = z.object({
  type: z.literal("SERVICE_ORDER_QUOTE"),
  serviceOrderId: id,
  quoteId: id.optional(),
  userId,
});

export const ServiceOrderDeliveryReceiptJobMessageSchema = z.object({
  type: z.literal("SERVICE_ORDER_DELIVERY_RECEIPT"),
  serviceOrderId: id,
  documentId: id.optional(),
  userId,
});

/**
 * §7.10 out-of-tolerance customer notification PDF (#426 Phase 0).
 * All context lives on the `oot_notification` row; the message points at it.
 */
export const OotNotificationJobMessageSchema = z.object({
  type: z.literal("OOT_NOTIFICATION"),
  notificationId: id,
  userId,
});

export const IntegrationSyncJobMessageSchema = z.object({
  type: z.literal("INTEGRATION_SYNC"),
  provider: IntegrationProviderSchema.optional(),
  integrationId: z.string(),
  organizationId: z.string(),
  runId: z.string(),
  target: IntegrationSyncTargetSchema,
  limit: z.number(),
  trigger: IntegrationSyncTriggerSchema,
});

/**
 * One delivery of a public-API webhook event to a subscriber. Everything the
 * call needs lives on the `public_api_webhook_delivery` row (and its
 * subscription); the message points at it. The laboratory is named so the
 * handler can bind its transaction to it (row-level security).
 */
export const WebhookDeliveryJobMessageSchema = z.object({
  type: z.literal("WEBHOOK_DELIVERY"),
  deliveryId: z.string(),
  organizationId: z.string(),
});

/**
 * Portal audit pack (issue #738): bulk export of released certificates +
 * fleet-status report requested by a portal user. All request parameters live
 * on the `portal_export_job` row; the message only points at it.
 */
export const AuditPackJobMessageSchema = z.object({
  type: z.literal("AUDIT_PACK"),
  exportId: id,
  userId,
});

/**
 * Nightly timer that re-evaluates every SPC control chart against its stored
 * check-standard readings (ISO/IEC 17025 §7.7.1, issue #60). No payload.
 */
export const SpcRecomputeJobMessageSchema = z.object({
  type: z.literal("SPC_RECOMPUTE"),
});

/**
 * Daily timer that re-polls Resend for every lab-owned email sending domain
 * (issue #584). No payload — the worker sweeps all organization_email_domain rows.
 */
export const EmailDomainHealthJobMessageSchema = z.object({
  type: z.literal("EMAIL_DOMAIN_HEALTH"),
});

/** Cron-only timer, never written to `app_queue_job`. No payload. */
export const ScheduledNotificationsJobMessageSchema = z.object({
  type: z.literal("SCHEDULED_NOTIFICATIONS"),
});

/**
 * Cron-only daily timer that fans out the client-portal due-calibration digest
 * emails. No payload — the worker derives which frequencies fire from the date.
 */
export const PortalDigestJobMessageSchema = z.object({
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
