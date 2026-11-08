// Tables of the "oot" area. Part of the schema entry packages/db/src/schema.ts.
import { sql } from "drizzle-orm";
import type {
  AssetOotEventStatus,
  OotNotificationStatus,
  StandardRecallStatus,
} from "@calibra-facil/schemas/machines";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  foreignKey,
  index,
  unique,
  uniqueIndex,
  serial,
  jsonb,
  integer,
  real,
} from "drizzle-orm/pg-core";
import { organization, user } from "./identity";
import { customer } from "./customers";
import { asset } from "./assets";
import { referenceStandard } from "./standards";
import { calibrationJob } from "./jobs";
import { nonConformance } from "./quality";

// =============================================================================
// STANDARD RECALL - ISO 17025:2017 Clause 7.10 recall of work
// =============================================================================

/**
 * DRAFT → SENT. A recall stays DRAFT while the quality manager reviews the
 * impacted-certificate list; SENT is stamped by the approval-gated batch send.
 */

/**
 * One recall campaign for a reference standard found out-of-tolerance.
 * Created (with its NC) when the standard transitions to OUT_OF_TOLERANCE;
 * the batch send requires an admin/owner approver, recorded here (§7.10.1
 * defined responsibilities + the legal-sensitivity mitigation).
 */
export const standardRecall = pgTable(
  "standard_recall",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "restrict" }),
    ncId: integer("nc_id")
      .notNull()
      .references(() => nonConformance.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<StandardRecallStatus>()
      .default("DRAFT")
      .notNull(),
    // Reviewed notification window (defaults to the standard's last good
    // calibrationDate → now; both bounds editable — over-notification
    // mitigation).
    fromDate: timestamp("from_date"),
    toDate: timestamp("to_date"),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("standard_recall_organization_id_idx").on(table.organizationId),
    index("standard_recall_standard_id_idx").on(table.standardId),
    uniqueIndex("standard_recall_nc_uidx").on(table.ncId),
  ],
);

// =============================================================================
// OOT IMPACT ASSESSMENT - ISO 17025:2017 Clause 7.10.1
// =============================================================================

/** Outcome of the customer-impact evaluation of an OOT event. */
export type OotImpactAssessmentConclusion =
  | "no_significant_impact"
  | "impact_confirmed"
  | "inconclusive";

/** Disposition per affected measurement/item. */
export type OotImpactAssessmentItemDisposition =
  | "no_impact"
  | "recheck"
  | "notify_downstream"
  | "other";

export type OotImpactAssessmentItem = {
  description: string;
  disposition: OotImpactAssessmentItemDisposition;
  note?: string | null;
};

/**
 * Guided §7.10 impact-assessment record — one per out-of-tolerance NC.
 * Structured after common OOT practice guidance: deviation nature/magnitude
 * vs. the customer's tolerance, affected period, per-measurement disposition,
 * conclusion and sign-off. Editable while unsigned; signing (admin/owner)
 * freezes it as retained §7.10.2 evidence. The magnitude/tolerance pair
 * feeds the UI's ~10%-of-tolerance triage hint (never an automatic
 * dismissal).
 */
export const ootImpactAssessment = pgTable(
  "oot_impact_assessment",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    ncId: integer("nc_id")
      .notNull()
      .references(() => nonConformance.id, { onDelete: "restrict" }),
    // Nature + magnitude of the deviation.
    deviationSummary: text("deviation_summary").notNull(),
    /** |worst deviation| in the measurement's units. */
    deviationMagnitude: real("deviation_magnitude"),
    /** The customer's tolerance band, same units. */
    customerTolerance: real("customer_tolerance"),
    toleranceUnit: text("tolerance_unit"),
    // Affected period (defaults suggested from the notification context).
    affectedFrom: timestamp("affected_from"),
    affectedTo: timestamp("affected_to"),
    // Per-measurement/item dispositions.
    items: jsonb("items").$type<OotImpactAssessmentItem[]>(),
    conclusion: text("conclusion").$type<OotImpactAssessmentConclusion>(),
    correctiveActionNote: text("corrective_action_note"),
    // Sign-off freezes the record (§7.10.1 defined responsibilities).
    signedBy: text("signed_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    signedAt: timestamp("signed_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("oot_impact_assessment_organization_id_idx").on(table.organizationId),
    uniqueIndex("oot_impact_assessment_nc_uidx").on(table.ncId),
  ],
);

// =============================================================================
// OUT-OF-TOLERANCE NOTIFICATION - ISO 17025:2017 Clause 7.10
// =============================================================================

/**
 * Lifecycle of a §7.10 customer notification.
 * PENDING → GENERATED (PDF on R2) → SENT (email dispatched) → ACKNOWLEDGED.
 */

/**
 * How the customer's acknowledgement was registered. `portal_link` is reserved
 * for the portal's acknowledge action.
 */
export type OotAcknowledgedVia = "email_link" | "portal_link" | "manual";

/**
 * §7.10.2 evidence record: one row per customer notification about an
 * out-of-tolerance as-found result. Written in the same transaction as the
 * triggering NC; the PDF/email pipeline updates it as the notification
 * progresses. FKs are deliberately non-cascading — this is a retained
 * quality record and must block deletion of what it evidences.
 */
export const ootNotification = pgTable(
  "oot_notification",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    ncId: integer("nc_id")
      .notNull()
      .references(() => nonConformance.id, { onDelete: "restrict" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "restrict" }),
    // Set when this notification belongs to a standard-recall
    // batch (one row per impacted certificate). Null for as-found
    // notifications. Changes the letter/email copy to the recall variant.
    recallId: integer("recall_id").references(() => standardRecall.id, {
      onDelete: "set null",
    }),
    // Context snapshot frozen at flag time (the certificate/customer may change
    // later; the notification must evidence what was communicated).
    certificateNumber: text("certificate_number"),
    recipientName: text("recipient_name"),
    recipientEmail: text("recipient_email"),
    // Manual affected-scope entry (the customer's measurement window/context),
    // frozen here for the generated PDF.
    affectedScope: text("affected_scope"),
    status: text("status")
      .$type<OotNotificationStatus>()
      .default("PENDING")
      .notNull(),
    // Generated §7.10 notification PDF.
    pdfR2Key: text("pdf_r2_key"),
    pdfSha256: text("pdf_sha256"),
    sentAt: timestamp("sent_at"),
    // Unguessable token embedded in the email's "confirmo o recebimento" link.
    ackToken: text("ack_token")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    acknowledgedAt: timestamp("acknowledged_at"),
    acknowledgedVia: text("acknowledged_via").$type<OotAcknowledgedVia>(),
    acknowledgedNote: text("acknowledged_note"),
    // Who triggered/approved sending the notification (§7.10.1 defined
    // responsibilities; legal-sensitivity mitigation).
    approvedBy: text("approved_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("oot_notification_organization_id_idx").on(table.organizationId),
    index("oot_notification_nc_id_idx").on(table.ncId),
    index("oot_notification_job_id_idx").on(table.jobId),
    index("oot_notification_status_idx").on(table.status),
    index("oot_notification_recall_id_idx").on(table.recallId),
    // Batch-send idempotency: one notification per certificate per recall
    // (NULL recall_id — the as-found path — never collides).
    unique("oot_notification_recall_job_uidx").on(table.recallId, table.jobId),
  ],
);

// =============================================================================
// OOT EMAIL OUTBOX - Transactional outbox for §7.10 notification emails
// =============================================================================
// Same contract as service_order_email_outbox: rows are written in the SAME
// transaction as the oot_notification they dispatch, and a cron drain sends
// the actual email with claim-lease / retry / dead-letter semantics.

export const ootEmailOutbox = pgTable(
  "oot_email_outbox",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    notificationId: integer("notification_id")
      .notNull()
      .references(() => ootNotification.id, { onDelete: "cascade" }),
    // Stable dedup key, e.g. "oot_notification". One logical email per
    // (notification, event); INSERT with onConflictDoNothing.
    eventKey: text("event_key").notNull(),
    // Minimal snapshot needed to send later; the drain re-loads the
    // notification row for current state.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Terminal "done" marker — NULL means the row is still owed.
    processedAt: timestamp("processed_at"),
    // Dead-letter marker — set when attempts reach maxAttempts.
    deadLetterAt: timestamp("dead_letter_at"),
    // Lease marker — see service_order_email_outbox for the recovery contract.
    claimedAt: timestamp("claimed_at"),
  },
  (table) => [
    unique("oot_email_outbox_notification_event_uidx").on(
      table.notificationId,
      table.eventKey,
    ),
    index("oot_email_outbox_pending_idx").on(
      table.createdAt,
      table.processedAt,
    ),
  ],
);

// ============================================================================
// Asset out-of-tolerance (OOT) events & customer impact assessments.
// Track B: when a certificate is approved with asFoundConformity =
// NON_CONFORMING, the owning customer gets an auditable "avaliar impacto"
// workflow — ISO 9001:2015 §7.1.5.2 (validity of previous results) and
// IATF 16949 §7.1.5.2.1 (risk assessment + customer notification records).
// The assessment is the CUSTOMER'S obligation; the portal is the workspace.
// ============================================================================

export type AssetOotImpactDecision =
  | "NO_IMPACT"
  | "IMPACT_CONTAINED"
  | "IMPACT_ESCALATED";

export const assetOotEvent = pgTable(
  "asset_oot_event",
  {
    id: serial("id").primaryKey(),
    // One event per approved job — the approval hook is idempotent on this.
    jobId: integer("job_id")
      .notNull()
      .unique()
      .references(() => calibrationJob.id, { onDelete: "restrict" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<AssetOotEventStatus>()
      .default("OPEN")
      .notNull(),
    /** Approval time of the non-conforming as-found certificate. */
    detectedAt: timestamp("detected_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("asset_oot_event_customer_status_idx").on(
      table.customerId,
      table.status,
    ),
    index("asset_oot_event_asset_id_idx").on(table.assetId),
    index("asset_oot_event_lab_org_idx").on(table.labOrganizationId),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("asset_oot_event_id_org_uidx").on(table.id, table.labOrganizationId),
  ],
);

export const assetOotImpactAssessment = pgTable(
  "asset_oot_impact_assessment",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    eventId: integer("event_id")
      .notNull()
      .references(() => assetOotEvent.id, { onDelete: "cascade" }),
    decision: text("decision").$type<AssetOotImpactDecision>().notNull(),
    rationale: text("rationale").notNull(),
    // Suspect window: last known-good calibration → the failing calibration.
    affectedPeriodStart: timestamp("affected_period_start"),
    affectedPeriodEnd: timestamp("affected_period_end"),
    // IATF 16949 §7.1.5.2.1 fields
    suspectProductShipped: boolean("suspect_product_shipped"),
    customerNotified: boolean("customer_notified"),
    // Actor provenance (portal user; append-only audit evidence)
    portalUserId: text("portal_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("asset_oot_impact_assessment_event_uidx").on(table.eventId),
    index("asset_oot_impact_assessment_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.eventId, table.organizationId],
      foreignColumns: [assetOotEvent.id, assetOotEvent.labOrganizationId],
      name: "asset_oot_impact_assessment_event_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const assetOotAuditLog = pgTable(
  "asset_oot_audit_log",
  {
    id: serial("id").primaryKey(),
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    // Soft reference on purpose — NO FK. Append-only audit trail: the row
    // must survive deletion of the event (customer's own audit evidence).
    eventId: integer("event_id").notNull(),
    action: text("action").notNull(), // 'create', 'notify', 'assess'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("asset_oot_audit_log_event_id_idx").on(table.eventId),
    index("asset_oot_audit_log_performed_at_idx").on(table.performedAt),
    index("asset_oot_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);
