// Tables of the "visits" area. Part of the schema entry packages/db/src/schema.ts.
import { sql } from "drizzle-orm";
import type {
  CalibrationRequestStatus,
  VisitRescheduleRequestStatus,
  VisitStatus,
} from "@calibra-facil/schemas/machines";
import {
  pgTable,
  text,
  timestamp,
  index,
  unique,
  uniqueIndex,
  serial,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { organization, organizationUnit, user } from "./identity";
import { customer, type CustomerAddress } from "./customers";

// =============================================================================
// CALIBRATION REQUEST - Client Portal Intake Queue
// =============================================================================

export const calibrationRequest = pgTable(
  "calibration_request",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    authOrganizationId: text("auth_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<CalibrationRequestStatus>()
      .default("PENDING")
      .notNull(),
    observations: text("observations"),
    internalNotes: text("internal_notes"),
    requestedDueDate: timestamp("requested_due_date", {
      withTimezone: true,
    }),
    // How the customer will get the assets to the lab. When shipping via a
    // carrier, they provide the "nota fiscal de remessa para conserto" so the
    // lab can receive the goods and later issue the return invoice. When
    // "onsite", a lab technician travels to the customer (calibração in loco) —
    // no goods move, so the customer instead provides a visit address + a
    // preferred date (the lab confirms and schedules the actual visit).
    deliveryMethod: text("delivery_method")
      .$type<"dropoff" | "carrier" | "onsite">()
      .default("dropoff")
      .notNull(),
    invoiceRemittanceNumber: text("invoice_remittance_number"),
    invoiceRemittanceKey: text("invoice_remittance_key"),
    invoiceRemittanceIssuedAt: timestamp("invoice_remittance_issued_at", {
      withTimezone: true,
    }),
    carrierName: text("carrier_name"),
    // On-site (deliveryMethod = "onsite") — where the technician visits and the
    // customer's preferred date. Address defaults to the customer's registered
    // address but can be overridden (e.g. a branch/temporary location).
    onsiteAddress: jsonb("onsite_address").$type<CustomerAddress>(),
    preferredVisitDate: timestamp("preferred_visit_date", {
      withTimezone: true,
    }),
    submittedBy: text("submitted_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedBy: text("rejected_by").references(() => user.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    convertedBy: text("converted_by").references(() => user.id, {
      onDelete: "set null",
    }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("calibration_request_unit_id_idx").on(table.unitId),
    index("calibration_request_org_id_idx").on(table.organizationId),
    index("calibration_request_customer_id_idx").on(table.customerId),
    index("calibration_request_auth_org_id_idx").on(table.authOrganizationId),
    index("calibration_request_status_idx").on(table.status),
    index("calibration_request_submitted_at_idx").on(table.submittedAt),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("calibration_request_id_org_uidx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const calibrationRequestAuditLog = pgTable(
  "calibration_request_audit_log",
  {
    id: serial("id").primaryKey(),
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    // Soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the calibration request.
    requestId: integer("request_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("cal_request_audit_log_request_id_idx").on(table.requestId),
    index("cal_request_audit_log_performed_at_idx").on(table.performedAt),
    index("calibration_request_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

// =============================================================================
// CALIBRATION VISIT (on-site / calibração in loco)
// =============================================================================

// A scheduled on-site visit: one technician trip that can cover many
// instruments (each becomes a calibration_job linked via calibration_job.visit_id).
// The customer proposes a date on the request; the lab confirms + assigns the
// technician here. Lifecycle: PROPOSED → CONFIRMED → IN_PROGRESS → COMPLETED
// (or CANCELLED at any point).

export const calibrationVisit = pgTable(
  "calibration_visit",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    sourceRequestId: integer("source_request_id").references(
      () => calibrationRequest.id,
      { onDelete: "set null" },
    ),
    technicianId: text("technician_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<VisitStatus>().default("PROPOSED").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
    address: jsonb("address").$type<CustomerAddress>(),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    confirmedBy: text("confirmed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    // Customer acknowledgement from the portal ("estaremos prontos para
    // receber o técnico"). An annotation, not a status transition — the lab
    // lifecycle above stays the single state machine, and confirmedBy/At keep
    // their lab-actor meaning. Both reset to NULL whenever scheduledAt moves
    // (a rescheduled visit must be re-confirmed).
    customerConfirmedBy: text("customer_confirmed_by").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    customerConfirmedAt: timestamp("customer_confirmed_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    index("calibration_visit_org_idx").on(table.organizationId),
    index("calibration_visit_unit_idx").on(table.unitId),
    index("calibration_visit_customer_idx").on(table.customerId),
    index("calibration_visit_technician_idx").on(table.technicianId),
    index("calibration_visit_status_idx").on(table.status),
    index("calibration_visit_scheduled_idx").on(table.scheduledAt),
  ],
);

// =============================================================================
// VISIT RESCHEDULE REQUEST (portal customer → lab)
// =============================================================================

// A customer-initiated "this date doesn't work" request raised from the
// portal. First-class record (like calibrationRequest), NOT a mutation of the
// visit: the visit only moves when the lab accepts and reschedules. At most
// one PENDING request per visit (partial unique index). A lab-side reschedule
// while a request is pending marks it SUPERSEDED.

export type VisitReschedulePreferredPeriod = "MORNING" | "AFTERNOON" | "ANY";

export type VisitReschedulePreferredWindow = {
  /** Preferred date, ISO yyyy-mm-dd. */
  date: string;
  period: VisitReschedulePreferredPeriod;
  note?: string;
};

export const visitRescheduleRequest = pgTable(
  "visit_reschedule_request",
  {
    id: serial("id").primaryKey(),
    visitId: integer("visit_id")
      .notNull()
      .references(() => calibrationVisit.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason"),
    preferredWindows: jsonb("preferred_windows")
      .$type<VisitReschedulePreferredWindow[]>()
      .default([])
      .notNull(),
    status: text("status")
      .$type<VisitRescheduleRequestStatus>()
      .default("PENDING")
      .notNull(),
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("visit_reschedule_request_visit_idx").on(table.visitId),
    index("visit_reschedule_request_customer_idx").on(table.customerId),
    index("visit_reschedule_request_org_pending_idx")
      .on(table.organizationId, table.status)
      .where(sql`${table.status} = 'PENDING'`),
    uniqueIndex("visit_reschedule_request_pending_uidx")
      .on(table.visitId)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);

// Append-only audit trail for customer-facing visit actions (portal confirm,
// reschedule request lifecycle). Same pattern as calibrationRequestAuditLog:
// soft reference on purpose — NO FK — so rows survive deletion of the visit.
export const visitAuditLog = pgTable(
  "visit_audit_log",
  {
    id: serial("id").primaryKey(),
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    visitId: integer("visit_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    reason: text("reason"),
  },
  (table) => [
    index("visit_audit_log_visit_id_idx").on(table.visitId),
    index("visit_audit_log_performed_at_idx").on(table.performedAt),
    index("visit_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);
