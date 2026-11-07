// Tables of the "platform" area. Part of the schema entry packages/db/src/schema.ts.
import type { NotificationType, QueueJobType } from "@calibra-facil/schemas";
import type {
  PortalExportJobStatus,
  QueueJobReceiptStatus,
  AppQueueJobStatus,
  NotificationStatus,
} from "@calibra-facil/schemas/machines";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  unique,
  uniqueIndex,
  serial,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { organization, user } from "./identity";

// =============================================================================
// =============================================================================
// =============================================================================
// EMAIL SUPPRESSION - unsubscribe / complaint / hard-bounce suppression list
// =============================================================================

/** Whether an address is suppressed for marketing-class email only, or all. */
export type EmailSuppressionScope = "marketing" | "all";

/** Why the address was suppressed. */
export type EmailSuppressionReason =
  | "unsubscribed"
  | "complaint"
  | "hard_bounce"
  | "manual";

/** What recorded the suppression. */
export type EmailSuppressionSource = "resend_webhook" | "admin" | "api";

/**
 * Addresses that must not be emailed (at a given scope). Driven by Resend
 * complaint/hard-bounce webhooks plus manual/API opt-outs. Email is stored
 * lowercased/trimmed; UNIQUE (email, scope) makes the suppress upsert idempotent.
 */
export const emailSuppression = pgTable(
  "email_suppression",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    scope: text("scope")
      .$type<EmailSuppressionScope>()
      .default("all")
      .notNull(),
    reason: text("reason").$type<EmailSuppressionReason>().notNull(),
    source: text("source").$type<EmailSuppressionSource>().notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("email_suppression_email_scope_uidx").on(
      table.email,
      table.scope,
    ),
    index("email_suppression_email_idx").on(table.email),
  ],
);

/**
 * Minimal dedup ledger for inbound Resend (Svix-signed) webhook deliveries.
 * Delivery is at-least-once, so the unique `svix_id` lets a redelivery be
 * recognized and skipped before the suppression side effect is applied again.
 */
export const emailWebhookEvent = pgTable("email_webhook_event", {
  id: serial("id").primaryKey(),
  svixId: text("svix_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

/**
 * Notification priority levels
 */
export type NotificationPriority = "HIGH" | "MEDIUM" | "LOW";

/**
 * Notification status values
 */

/**
 * Notification delivery channel
 */
export type NotificationChannel = "IN_APP" | "EMAIL";

/**
 * Related entity reference for deep linking
 */
export type NotificationRelatedEntity = {
  entityType:
    | "job"
    | "asset"
    | "standard"
    | "payment"
    | "customer"
    | "request"
    | "visit"
    | "nc"
    | "capa"
    | "competence"
    | "audit_pack"
    | "pt_plan_item";
  entityId: number | string;
  jobId?: string; // Human-readable job ID for display
};

/**
 * Notification table - Stores all notifications for users.
 * Never hard-delete for ISO 17025 audit compliance - use ARCHIVED status.
 */
export const notification = pgTable(
  "notification",
  {
    id: serial("id").primaryKey(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    priority: text("priority")
      .$type<NotificationPriority>()
      .default("MEDIUM")
      .notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    relatedEntity: jsonb("related_entity").$type<NotificationRelatedEntity>(),
    actionUrl: text("action_url"),
    channelsSent: jsonb("channels_sent")
      .$type<NotificationChannel[]>()
      .default([])
      .notNull(),
    status: text("status")
      .$type<NotificationStatus>()
      .default("UNREAD")
      .notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [
    index("notification_recipient_user_id_idx").on(table.recipientUserId),
    index("notification_organization_id_idx").on(table.organizationId),
    index("notification_status_idx").on(table.status),
    index("notification_type_idx").on(table.type),
    index("notification_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Notification preference per notification type
 */
export type NotificationPreferenceMap = {
  [K in NotificationType]?: {
    inApp: boolean;
    email: boolean;
  };
};

/**
 * Digest frequency for email notifications
 */
export type DigestFrequency = "NONE" | "DAILY" | "WEEKLY";

/**
 * Notification Preference table - User preferences for notification delivery.
 * One record per user with JSONB preferences map.
 */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    preferences: jsonb("preferences")
      .$type<NotificationPreferenceMap>()
      .notNull(),
    emailEnabled: boolean("email_enabled").default(true).notNull(),
    notifySelfActions: boolean("notify_self_actions").default(false).notNull(),
    digestFrequency: text("digest_frequency")
      .$type<DigestFrequency>()
      .default("NONE")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("notification_preference_user_id_uidx").on(table.userId),
  ],
);

/**
 * Scheduled notification entity type
 */
export type ScheduledNotificationEntityType =
  | "asset"
  | "standard"
  | "job"
  | "competence"
  | "visit"
  | "signing_certificate" // CMP-02 - ICP-Brasil A1 signing-certificate expiry alert
  | "organization_accreditation" // #647 - entity_id is the constant 0 (one accreditation per org)
  | "accredited_scope_line";

// #427 Phase 2 - entity_id is accredited_scope_line.id

/**
 * Scheduled Notification table - Tracks scheduled compliance alerts.
 * Prevents duplicate alerts by using unique constraint on entity + type + lead time.
 */
export const scheduledNotification = pgTable(
  "scheduled_notification",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    entityType: text("entity_type")
      .$type<ScheduledNotificationEntityType>()
      .notNull(),
    entityId: integer("entity_id").notNull(),
    scheduledFor: timestamp("scheduled_for").notNull(),
    leadTimeDays: integer("lead_time_days").default(7).notNull(),
    sentAt: timestamp("sent_at"),
    canceled: boolean("canceled").default(false).notNull(),
    canceledReason: text("canceled_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("scheduled_notification_organization_id_idx").on(
      table.organizationId,
    ),
    index("scheduled_notification_scheduled_for_idx").on(table.scheduledFor),
    index("scheduled_notification_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    uniqueIndex("scheduled_notification_unique_idx").on(
      table.organizationId,
      table.type,
      table.entityType,
      table.entityId,
      table.leadTimeDays,
    ),
  ],
);

// =============================================================================
// APP QUEUE JOBS - Postgres-backed background queue
// =============================================================================

export const appQueueJob = pgTable(
  "app_queue_job",
  {
    id: serial("id").primaryKey(),
    type: text("type").$type<QueueJobType>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<AppQueueJobStatus>()
      .default("PENDING")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("app_queue_job_status_available_idx").on(
      table.status,
      table.availableAt,
    ),
    index("app_queue_job_locked_at_idx").on(table.lockedAt),
    index("app_queue_job_type_idx").on(table.type),
  ],
);

/**
 * Idempotency ledger for queue consumers.
 *
 * Delivery is at-least-once (the app_queue_job stale-lease reclaim re-runs
 * rows), so a consumer can see
 * the same DELIVERY UNIT twice. Each unit claims a receipt keyed by
 * (job_type, idempotency_key) before running: `app-queue-<rowId>` for DB-queue
 * rows. A COMPLETED receipt means
 * the work already ran to success and the duplicate is skipped (enforce mode).
 *
 * Deliberately keyed by delivery unit and NOT by business ids (jobId /
 * serviceOrderId): a user re-requesting the same certificate is a NEW logical
 * dispatch and must run — a business-id key would wrongly skip it.
 */
export const queueJobReceipt = pgTable(
  "queue_job_receipt",
  {
    id: serial("id").primaryKey(),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status")
      .$type<QueueJobReceiptStatus>()
      .default("RUNNING")
      .notNull(),
    /** Claim attempts observed for this delivery unit (1 = first run). */
    attempts: integer("attempts").default(1).notNull(),
    /** Claim lease: an unexpired RUNNING receipt means another worker owns it. */
    lockedUntil: timestamp("locked_until").notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("queue_job_receipt_type_key_unique").on(
      table.jobType,
      table.idempotencyKey,
    ),
    index("queue_job_receipt_completed_at_idx").on(table.completedAt),
  ],
);

// =============================================================================
// PORTAL EXPORT JOBS - customer-requested bulk exports (audit packs)
// =============================================================================

export type PortalExportJobKind = "AUDIT_PACK";

/**
 * Audit-pack request parameters, frozen at enqueue time. `customerIds` is the
 * resolved portal scope (branch customer ids, already unit-filtered) so the
 * worker never re-derives tenant scope from mutable membership state; the
 * certificate release gate, by contrast, IS re-evaluated inside the worker at
 * generation time (statuses can change between enqueue and run).
 */
export type PortalAuditPackParams = {
  /** Inclusive approval-date window (YYYY-MM-DD, America/Sao_Paulo). */
  dateFrom: string;
  dateTo: string;
  /** Branch customer id when the group cockpit narrowed to one unit. */
  unitId: number | null;
  include: {
    certificates: boolean;
    fleetReport: boolean;
    verificationIndex: boolean;
  };
  customerIds: number[];
};

/**
 * A customer-facing export produced asynchronously by the worker.
 * Rows are listed in the portal by the requesting CLIENT org
 * (`authOrganizationId`), so every portal user of that branch/group sees and
 * can re-download the pack until `expiresAt`.
 */
export const portalExportJob = pgTable(
  "portal_export_job",
  {
    id: serial("id").primaryKey(),
    kind: text("kind")
      .$type<PortalExportJobKind>()
      .default("AUDIT_PACK")
      .notNull(),
    /** The lab whose documents are exported (tenant / host-domain scope). */
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The CLIENT org (branch customer or customer group) that requested it. */
    authOrganizationId: text("auth_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    params: jsonb("params").$type<PortalAuditPackParams>().notNull(),
    status: text("status")
      .$type<PortalExportJobStatus>()
      .default("PENDING")
      .notNull(),
    /** Released certificates included in the pack (set by the worker). */
    certificateCount: integer("certificate_count"),
    /** calibration_job ids in the pack — re-gated on every download. */
    includedJobIds: jsonb("included_job_ids").$type<number[]>(),
    r2Key: text("r2_key"),
    fileSizeBytes: integer("file_size_bytes"),
    failureReason: text("failure_reason"),
    /** Download availability window; the pack is regenerate-on-demand after. */
    expiresAt: timestamp("expires_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("portal_export_job_auth_org_idx").on(
      table.authOrganizationId,
      table.createdAt,
    ),
    index("portal_export_job_lab_org_idx").on(table.labOrganizationId),
    index("portal_export_job_status_idx").on(table.status),
  ],
);

/**
 * Heartbeat + lease-lock for the cron dispatcher (one row per
 * /api/cron/* job). The dispatcher records each run's outcome here so a
 * silently-failing or never-firing cron is detectable from the DB, and takes a
 * short `lockedUntil` row-lease to prevent overlapping runs. Treated as
 * best-effort / fail-open by the dispatcher (see apps/api/src/cron/cron-run.ts).
 */
export const cronRun = pgTable("cron_run", {
  job: text("job").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
});
