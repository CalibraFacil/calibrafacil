// Tables of the "job-links" area. Part of the schema entry packages/db/src/schema.ts.
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  foreignKey,
  index,
  unique,
  uniqueIndex,
  serial,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import type {
  JobCommercialSnapshotSource,
  CertificateReleaseStatus,
  CertificateReleaseAuditSource,
  CertificateReleasePaymentStateSnapshot,
} from "@calibra-facil/shared";
import { organization, organizationUnit, user } from "./identity";
import { customer } from "./customers";
import { asset } from "./assets";
import { material, service } from "./catalog";
import { referenceStandard } from "./standards";
import {
  billingDocument,
  certificateReleasePolicy,
  commercialAgreement,
} from "./finance";
import { calibrationRequest } from "./visits";
import { serviceOrder } from "./service-orders";
import { calibrationJob } from "./jobs";

export const jobCommercialSnapshot = pgTable(
  "job_commercial_snapshot",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .unique()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "restrict" }),
    agreementId: integer("agreement_id").references(
      () => commercialAgreement.id,
      {
        onDelete: "set null",
      },
    ),
    sourceType: text("source_type")
      .$type<JobCommercialSnapshotSource>()
      .notNull(),
    serviceName: text("service_name").notNull(),
    priceCents: integer("price_cents"),
    currency: text("currency").default("BRL").notNull(),
    paymentTermDays: integer("payment_term_days").default(28).notNull(),
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
    capturedBySystemVersion: text("captured_by_system_version").notNull(),
  },
  (table) => [
    index("job_commercial_snapshot_org_idx").on(table.organizationId),
    index("job_commercial_snapshot_customer_idx").on(table.customerId),
    index("job_commercial_snapshot_service_idx").on(table.serviceId),
    index("job_commercial_snapshot_agreement_idx").on(table.agreementId),
  ],
);

export const billingDocumentItem = pgTable(
  "billing_document_item",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => billingDocument.id, { onDelete: "cascade" }),
    jobId: integer("job_id").references(() => calibrationJob.id, {
      onDelete: "set null",
    }),
    jobCommercialSnapshotId: integer("job_commercial_snapshot_id").references(
      () => jobCommercialSnapshot.id,
      { onDelete: "set null" },
    ),
    serviceOrderId: integer("service_order_id"),
    // Optional material-catalog reference copied from the SO part line item.
    // When set (and the material is bound to an ERP product), the exported
    // sale carries the product line so ERP stock decrements on billing.
    materialId: integer("material_id").references(() => material.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("billing_document_item_document_idx").on(table.documentId),
    index("billing_document_item_job_idx").on(table.jobId),
    index("billing_document_item_snapshot_idx").on(
      table.jobCommercialSnapshotId,
    ),
    index("billing_document_item_service_order_idx").on(table.serviceOrderId),
    index("billing_document_item_material_idx").on(table.materialId),
    index("billing_document_item_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.documentId, table.organizationId],
      foreignColumns: [billingDocument.id, billingDocument.organizationId],
      name: "billing_document_item_document_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const certificateRelease = pgTable(
  "certificate_release",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    calibrationJobId: integer("calibration_job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    status: text("status").$type<CertificateReleaseStatus>().notNull(),
    appliedPolicyId: integer("applied_policy_id").references(
      () => certificateReleasePolicy.id,
      { onDelete: "set null" },
    ),
    lastEvaluatedAt: timestamp("last_evaluated_at").defaultNow().notNull(),
    paymentStateSnapshot: jsonb("payment_state_snapshot")
      .$type<CertificateReleasePaymentStateSnapshot | null>()
      .default(sql`'null'::jsonb`),
    releasedByUserId: text("released_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("certificate_release_job_uidx").on(table.calibrationJobId),
    index("certificate_release_org_idx").on(table.organizationId),
    index("certificate_release_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("certificate_release_policy_idx").on(table.appliedPolicyId),
  ],
);

export const certificateReleaseAuditLog = pgTable(
  "certificate_release_audit_log",
  {
    id: serial("id").primaryKey(),
    // Soft references on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): a row must survive deletion of the certificate release OR
    // organization it documents, so the ids stay as plain values.
    organizationId: text("organization_id").notNull(),
    certificateReleaseId: integer("certificate_release_id").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    fromStatus: text("from_status").$type<CertificateReleaseStatus | null>(),
    toStatus: text("to_status").$type<CertificateReleaseStatus>().notNull(),
    appliedPolicyId: integer("applied_policy_id").references(
      () => certificateReleasePolicy.id,
      { onDelete: "set null" },
    ),
    paymentStateSnapshot: jsonb(
      "payment_state_snapshot",
    ).$type<CertificateReleasePaymentStateSnapshot | null>(),
    reason: text("reason"),
    source: text("source").$type<CertificateReleaseAuditSource>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("certificate_release_audit_org_idx").on(table.organizationId),
    index("certificate_release_audit_release_idx").on(
      table.certificateReleaseId,
    ),
    index("certificate_release_audit_created_idx").on(table.createdAt),
  ],
);

export const serviceOrderCertificateLink = pgTable(
  "service_order_certificate_link",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    certificateJobId: integer("certificate_job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "restrict" }),
    linkedByUserId: text("linked_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("service_order_certificate_link_uidx").on(
      table.serviceOrderId,
      table.certificateJobId,
    ),
    index("service_order_certificate_link_job_idx").on(table.certificateJobId),
    index("service_order_certificate_link_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_certificate_link_service_order_id_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.certificateJobId, table.organizationId],
      foreignColumns: [calibrationJob.id, calibrationJob.organizationId],
      name: "service_order_certificate_link_certificate_job_id_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export const calibrationRequestItem = pgTable(
  "calibration_request_item",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    requestId: integer("request_id")
      .notNull()
      .references(() => calibrationRequest.id, { onDelete: "cascade" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    convertedJobId: integer("converted_job_id").references(
      () => calibrationJob.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("calibration_request_item_request_id_idx").on(table.requestId),
    index("calibration_request_item_asset_id_idx").on(table.assetId),
    index("calibration_request_item_job_id_idx").on(table.convertedJobId),
    uniqueIndex("calibration_request_item_request_asset_uidx").on(
      table.requestId,
      table.assetId,
    ),
    index("calibration_request_item_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.requestId, table.organizationId],
      foreignColumns: [
        calibrationRequest.id,
        calibrationRequest.organizationId,
      ],
      name: "calibration_request_item_request_id_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.assetId, table.organizationId],
      foreignColumns: [asset.id, asset.labOrganizationId],
      name: "calibration_request_item_asset_id_tenant_fk",
    }).onDelete("restrict"),
  ],
);

// =============================================================================
// JOB ↔ REFERENCE STANDARD LINK - reverse traceability
// =============================================================================

/**
 * First-class, indexed projection of `calibration_job.standards_snapshot`
 * (which stays the frozen source of truth). Enables the reverse-traceability
 * query "which certificates relied on standard X between dates" without an
 * unindexed JSONB containment scan. Rows are derived data: rewritten whenever
 * the snapshot is persisted and backfilled from existing snapshots by
 * migration 0090 — hence plain cascades (always rebuildable).
 */
export const jobStandard = pgTable(
  "job_standard",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "restrict" }),
    // When the standard was used (execution time; falls back to job creation
    // for backfilled rows without performed_at).
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("job_standard_job_standard_uidx").on(table.jobId, table.standardId),
    index("job_standard_job_id_idx").on(table.jobId),
    index("job_standard_standard_id_idx").on(table.standardId),
    index("job_standard_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.jobId, table.organizationId],
      foreignColumns: [calibrationJob.id, calibrationJob.organizationId],
      name: "job_standard_job_id_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.standardId, table.organizationId],
      foreignColumns: [referenceStandard.id, referenceStandard.organizationId],
      name: "job_standard_standard_id_tenant_fk",
    }).onDelete("restrict"),
  ],
);
