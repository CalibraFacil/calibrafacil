// Tables of the "finance" area. Part of the schema entry packages/db/src/schema.ts.
import { sql } from "drizzle-orm";
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
} from "drizzle-orm/pg-core";
import { calendarDate } from "../calendar-date";
import type {
  BillingDocumentExportStatus,
  BillingDocumentStatus,
  CommercialAgreementStatus,
  FinancialPaymentMethod,
  FinancialErpConnectionConfig,
  IntegrationCredentialType,
  IntegrationEventLevel,
  IntegrationObjectLinkTarget,
  IntegrationProvider,
  IntegrationStatus,
  IntegrationSyncItemOperation,
  IntegrationSyncItemStatus,
  IntegrationSyncStatus,
  IntegrationSyncTarget,
  IntegrationSyncTrigger,
  IntegrationType,
  ReceivableInstallmentStatus,
  CertificateReleasePolicyMode,
  AutomaticSendMilestone,
  SupplierKind,
  BillingGroupStatus,
} from "@calibra-facil/shared";
import { organization, organizationUnit, user } from "./identity";
import { customer } from "./customers";
import { service } from "./catalog";

export const organizationIntegration = pgTable(
  "organization_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").$type<IntegrationType>().notNull(),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    name: text("name").notNull(),
    status: text("status")
      .$type<IntegrationStatus>()
      .default("ACTIVE")
      .notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    lastValidatedAt: timestamp("last_validated_at"),
    lastValidationError: text("last_validation_error"),
    disabledAt: timestamp("disabled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("organization_integration_org_id_idx").on(table.organizationId),
    index("organization_integration_status_idx").on(table.status),
    // Composite-unique TARGET of the integration_* composite foreign keys.
    // Declared as a table UNIQUE CONSTRAINT (not uniqueIndex) so drizzle emits it
    // before the ADD FOREIGN KEY statements. A uniqueIndex is emitted AFTER the
    // FKs, so the referencing FK can't find its target on a cold build (fresh DB
    // via drizzle-kit push/migrate) — see migration 0060.
    unique("organization_integration_id_org_uidx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

// The OAuth application a laboratory registered with a provider (today only
// Conta Azul), for servers that do not supply one in their environment. One
// per laboratory and provider; the secret is encrypted with
// INTEGRATIONS_MASTER_KEY, like the tokens in integration_connection.
export const integrationOAuthApp = pgTable(
  "integration_oauth_app",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    clientId: text("client_id").notNull(),
    encryptedClientSecret: text("encrypted_client_secret").notNull(),
    clientSecretIv: text("client_secret_iv").notNull(),
    // Shown in settings so an admin can tell which secret is stored.
    clientSecretLast4: text("client_secret_last4").notNull(),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_oauth_app_org_provider_uidx").on(
      table.organizationId,
      table.provider,
    ),
  ],
);

export const integrationConnection = pgTable(
  "integration_connection",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    credentialType: text("credential_type")
      .$type<IntegrationCredentialType>()
      .default("bearer")
      .notNull(),
    config: jsonb("config").$type<FinancialErpConnectionConfig>().notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    secretIv: text("secret_iv").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_connection_integration_uidx").on(
      table.integrationId,
    ),
    index("integration_connection_org_id_idx").on(table.organizationId),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_connection_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

export const integrationObjectLink = pgTable(
  "integration_object_link",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    target: text("target").$type<IntegrationObjectLinkTarget>().notNull(),
    localEntityId: text("local_entity_id").notNull(),
    remoteEntityId: text("remote_entity_id"),
    remoteDisplayId: text("remote_display_id"),
    remoteEntityType: text("remote_entity_type"),
    remoteLegacyId: text("remote_legacy_id"),
    remoteVersion: integer("remote_version"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp("last_synced_at"),
    // Operator-acknowledged drift. When a drift state is
    // surfaced via the drift queue and the operator decides the local state
    // is correct (or that the remote will be reconciled separately), they
    // can acknowledge the link to remove it from the queue without
    // resolving the underlying drift.
    driftAcknowledgedAt: timestamp("drift_acknowledged_at"),
    driftAcknowledgedByUserId: text("drift_acknowledged_by_user_id"),
    driftAcknowledgedReason: text("drift_acknowledged_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_object_link_local_uidx").on(
      table.integrationId,
      table.target,
      table.localEntityId,
    ),
    index("integration_object_link_remote_idx").on(
      table.integrationId,
      table.target,
      table.remoteEntityId,
    ),
    index("integration_object_link_drift_ack_idx").on(
      table.organizationId,
      table.driftAcknowledgedAt,
    ),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_object_link_integration_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.driftAcknowledgedByUserId],
      foreignColumns: [user.id],
      name: "integration_object_link_drift_ack_user_fk",
    }).onDelete("set null"),
  ],
);

export const integrationSyncRun = pgTable(
  "integration_sync_run",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<IntegrationSyncTrigger>().notNull(),
    target: text("target").$type<IntegrationSyncTarget>().notNull(),
    status: text("status")
      .$type<IntegrationSyncStatus>()
      .default("PENDING")
      .notNull(),
    initiatedBy: text("initiated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    processedCount: integer("processed_count").default(0).notNull(),
    successCount: integer("success_count").default(0).notNull(),
    errorCount: integer("error_count").default(0).notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("integration_sync_run_integration_idx").on(table.integrationId),
    index("integration_sync_run_org_idx").on(table.organizationId),
    index("integration_sync_run_status_idx").on(table.status),
    index("integration_sync_run_created_at_idx").on(table.createdAt),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_sync_run_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

export const integrationSyncItem = pgTable(
  "integration_sync_item",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => integrationSyncRun.id, { onDelete: "cascade" }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    target: text("target").$type<IntegrationObjectLinkTarget>().notNull(),
    localEntityId: text("local_entity_id").notNull(),
    remoteEntityId: text("remote_entity_id"),
    operation: text("operation")
      .$type<IntegrationSyncItemOperation>()
      .notNull(),
    status: text("status")
      .$type<IntegrationSyncItemStatus>()
      .default("RUNNING")
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    requestFingerprint: text("request_fingerprint"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("integration_sync_item_run_idx").on(table.runId),
    index("integration_sync_item_integration_target_status_idx").on(
      table.integrationId,
      table.target,
      table.status,
    ),
    index("integration_sync_item_local_entity_idx").on(
      table.integrationId,
      table.localEntityId,
    ),
    index("integration_sync_item_request_fingerprint_idx").on(
      table.integrationId,
      table.target,
      table.requestFingerprint,
    ),
    index("integration_sync_item_dead_letter_idx").on(
      table.integrationId,
      table.status,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_sync_item_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

export const integrationSyncCursor = pgTable(
  "integration_sync_cursor",
  {
    id: serial("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    cursorType: text("cursor_type").notNull(),
    lastRemoteUpdatedAt: timestamp("last_remote_updated_at"),
    lastSuccessfulPollAt: timestamp("last_successful_poll_at"),
    nextPage: integer("next_page"),
    state: jsonb("state").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_sync_cursor_integration_type_uidx").on(
      table.integrationId,
      table.cursorType,
    ),
    index("integration_sync_cursor_org_type_idx").on(
      table.organizationId,
      table.cursorType,
    ),
    index("integration_sync_cursor_last_poll_idx").on(
      table.lastSuccessfulPollAt,
    ),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_sync_cursor_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

export const integrationEventLog = pgTable(
  "integration_event_log",
  {
    id: serial("id").primaryKey(),
    // Soft reference (no FK): the trail outlives the integration and its runs.
    integrationId: text("integration_id").notNull(),
    // Evidence trail: a soft reference on purpose (no FK, like the other
    // audit tables), so the row survives deletion of its organization.
    organizationId: text("organization_id").notNull(),
    runId: text("run_id"),
    level: text("level")
      .$type<IntegrationEventLevel>()
      .default("info")
      .notNull(),
    event: text("event").notNull(),
    message: text("message").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("integration_event_log_integration_idx").on(table.integrationId),
    index("integration_event_log_org_idx").on(table.organizationId),
    index("integration_event_log_run_idx").on(table.runId),
    index("integration_event_log_created_at_idx").on(table.createdAt),
  ],
);

// =============================================================================
// OPERATIONAL FINANCE - Contracts, snapshots, receivables and receipts
// =============================================================================

export type FinancialAuditEntityType =
  | "agreement"
  | "snapshot"
  | "document"
  | "installment"
  | "receipt"
  | "service_order";

export const commercialAgreement = pgTable(
  "commercial_agreement",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<CommercialAgreementStatus>()
      .default("DRAFT")
      .notNull(),
    agreementCode: text("agreement_code"),
    title: text("title").notNull(),
    externalReference: text("external_reference"),
    currency: text("currency").default("BRL").notNull(),
    effectiveFrom: timestamp("effective_from").notNull(),
    effectiveTo: timestamp("effective_to"),
    defaultPaymentTermDays: integer("default_payment_term_days")
      .default(28)
      .notNull(),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("commercial_agreement_org_idx").on(table.organizationId),
    index("commercial_agreement_customer_idx").on(table.customerId),
    index("commercial_agreement_status_idx").on(table.status),
    index("commercial_agreement_effective_from_idx").on(table.effectiveFrom),
    uniqueIndex("commercial_agreement_org_code_uidx").on(
      table.organizationId,
      table.agreementCode,
    ),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("commercial_agreement_id_org_uidx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const commercialAgreementUnitScope = pgTable(
  "commercial_agreement_unit_scope",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    agreementId: integer("agreement_id")
      .notNull()
      .references(() => commercialAgreement.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("commercial_agreement_unit_scope_uidx").on(
      table.agreementId,
      table.unitId,
    ),
    index("commercial_agreement_unit_scope_unit_idx").on(table.unitId),
    index("commercial_agreement_unit_scope_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.agreementId, table.organizationId],
      foreignColumns: [
        commercialAgreement.id,
        commercialAgreement.organizationId,
      ],
      name: "commercial_agreement_unit_scope_agreement_id_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.unitId, table.organizationId],
      foreignColumns: [organizationUnit.id, organizationUnit.organizationId],
      name: "commercial_agreement_unit_scope_unit_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const commercialAgreementServiceTerm = pgTable(
  "commercial_agreement_service_term",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    agreementId: integer("agreement_id")
      .notNull()
      .references(() => commercialAgreement.id, { onDelete: "cascade" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "cascade",
    }),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").default("BRL").notNull(),
    tatDays: integer("tat_days"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("commercial_agreement_service_term_agreement_idx").on(
      table.agreementId,
    ),
    index("commercial_agreement_service_term_service_idx").on(table.serviceId),
    index("commercial_agreement_service_term_unit_idx").on(table.unitId),
    index("commercial_agreement_service_term_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.agreementId, table.organizationId],
      foreignColumns: [
        commercialAgreement.id,
        commercialAgreement.organizationId,
      ],
      name: "commercial_agreement_service_term_agreement_id_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.serviceId, table.organizationId],
      foreignColumns: [service.id, service.organizationId],
      name: "commercial_agreement_service_term_service_id_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.unitId, table.organizationId],
      foreignColumns: [organizationUnit.id, organizationUnit.organizationId],
      name: "commercial_agreement_service_term_unit_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const billingDocument = pgTable(
  "billing_document",
  {
    id: serial("id").primaryKey(),
    // Non-sequential public identifier used in URLs so the global serial id
    // (and cross-tenant document volume) is never exposed. gen_random_uuid().
    publicId: text("public_id")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    agreementId: integer("agreement_id").references(
      () => commercialAgreement.id,
      {
        onDelete: "set null",
      },
    ),
    documentNumber: text("document_number"),
    status: text("status")
      .$type<BillingDocumentStatus>()
      .default("DRAFT")
      .notNull(),
    issueDate: calendarDate("issue_date"),
    dueDate: calendarDate("due_date").notNull(),
    currency: text("currency").default("BRL").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    totalCents: integer("total_cents").notNull(),
    notes: text("notes"),
    issuedBy: text("issued_by").references(() => user.id, {
      onDelete: "set null",
    }),
    voidedBy: text("voided_by").references(() => user.id, {
      onDelete: "set null",
    }),
    voidReason: text("void_reason"),
    exportStatus: text("export_status")
      .$type<BillingDocumentExportStatus>()
      .default("NOT_EXPORTED")
      .notNull(),
    exportedAt: timestamp("exported_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("billing_document_org_idx").on(table.organizationId),
    index("billing_document_customer_idx").on(table.customerId),
    index("billing_document_unit_idx").on(table.unitId),
    index("billing_document_status_idx").on(table.status),
    index("billing_document_due_date_idx").on(table.dueDate),
    index("billing_document_agreement_idx").on(table.agreementId),
    uniqueIndex("billing_document_org_number_uidx").on(
      table.organizationId,
      table.documentNumber,
    ),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("billing_document_id_org_uidx").on(table.id, table.organizationId),
  ],
);

export const receivableInstallment = pgTable(
  "receivable_installment",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => billingDocument.id, { onDelete: "cascade" }),
    installmentNumber: integer("installment_number").default(1).notNull(),
    status: text("status")
      .$type<ReceivableInstallmentStatus>()
      .default("OPEN")
      .notNull(),
    dueDate: calendarDate("due_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").default("BRL").notNull(),
    paidAt: timestamp("paid_at"),
    paymentMethod: text("payment_method").$type<FinancialPaymentMethod>(),
    paymentReference: text("payment_reference"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("receivable_installment_document_number_uidx").on(
      table.documentId,
      table.installmentNumber,
    ),
    index("receivable_installment_status_idx").on(table.status),
    index("receivable_installment_due_date_idx").on(table.dueDate),
    index("receivable_installment_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.documentId, table.organizationId],
      foreignColumns: [billingDocument.id, billingDocument.organizationId],
      name: "receivable_installment_document_id_tenant_fk",
    }).onDelete("cascade"),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("receivable_installment_id_org_uidx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const paymentReceipt = pgTable(
  "payment_receipt",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    installmentId: integer("installment_id")
      .notNull()
      .references(() => receivableInstallment.id, { onDelete: "cascade" }),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => user.id),
    receivedAt: timestamp("received_at").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paymentMethod: text("payment_method")
      .$type<FinancialPaymentMethod>()
      .notNull(),
    reference: text("reference"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("payment_receipt_installment_idx").on(table.installmentId),
    index("payment_receipt_received_at_idx").on(table.receivedAt),
    index("payment_receipt_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.installmentId, table.organizationId],
      foreignColumns: [
        receivableInstallment.id,
        receivableInstallment.organizationId,
      ],
      name: "payment_receipt_installment_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const financialAuditLog = pgTable(
  "financial_audit_log",
  {
    id: serial("id").primaryKey(),
    // Evidence trail: a soft reference on purpose (no FK, like the other
    // audit tables), so the row survives deletion of its organization.
    organizationId: text("organization_id").notNull(),
    entityType: text("entity_type").$type<FinancialAuditEntityType>().notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    reason: text("reason"),
  },
  (table) => [
    index("financial_audit_log_org_idx").on(table.organizationId),
    index("financial_audit_log_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    index("financial_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// CERTIFICATE RELEASE. Separates technical approval
// (calibrationJob.status === "APPROVED") from commercial release of the
// certificate to the customer portal. Driven by a per-org / per-customer /
// per-contract / per-service-category policy that evaluates the
// payment continuity state. ERP payment status must never mutate
// calibrationJob.status or issuedCertificateSnapshot.status.
// =============================================================================

export const certificateReleasePolicy = pgTable(
  "certificate_release_policy",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mode: text("mode").$type<CertificateReleasePolicyMode>().notNull(),
    customerId: integer("customer_id").references(() => customer.id, {
      onDelete: "cascade",
    }),
    commercialAgreementId: integer("commercial_agreement_id").references(
      () => commercialAgreement.id,
      { onDelete: "cascade" },
    ),
    serviceCategory: text("service_category"),
    priority: integer("priority").default(0).notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("certificate_release_policy_org_idx").on(table.organizationId),
    index("certificate_release_policy_customer_idx").on(
      table.organizationId,
      table.customerId,
    ),
    index("certificate_release_policy_agreement_idx").on(
      table.organizationId,
      table.commercialAgreementId,
    ),
    index("certificate_release_policy_category_idx").on(
      table.organizationId,
      table.serviceCategory,
    ),
    // One active org-default per organization. Drizzle's uniqueIndex with a
    // where-style partial cannot be expressed directly; enforce via the SQL
    // unique on (org, customer=null, agreement=null, category=null) where
    // archivedAt is null at the application layer in resolveCertificateReleasePolicy.
  ],
);

// Automatic send rules by milestone. Mirrors the
// certificate-release-policy shape: org default + per-customer /
// per-agreement / per-service-name override scopes, priority + id
// tie-break. Triggered by certificate-approval / SO-delivery /
// contract-anniversary events.

export const automaticSendRule = pgTable(
  "automatic_send_rule",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    milestone: text("milestone").$type<AutomaticSendMilestone>().notNull(),
    customerId: integer("customer_id").references(() => customer.id, {
      onDelete: "cascade",
    }),
    commercialAgreementId: integer("commercial_agreement_id").references(
      () => commercialAgreement.id,
      { onDelete: "cascade" },
    ),
    serviceCategory: text("service_category"),
    priority: integer("priority").default(0).notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("automatic_send_rule_org_idx").on(table.organizationId),
    index("automatic_send_rule_customer_idx").on(
      table.organizationId,
      table.customerId,
    ),
    index("automatic_send_rule_agreement_idx").on(
      table.organizationId,
      table.commercialAgreementId,
    ),
    index("automatic_send_rule_category_idx").on(
      table.organizationId,
      table.serviceCategory,
    ),
  ],
);

// Batch / consolidated billing groups. Many service
// orders can share one billing document via this group; compatibility
// rules live in apps/api/src/domains/finance/billing-group.ts.

export const billingGroup = pgTable(
  "billing_group",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<BillingGroupStatus>()
      .default("OPEN")
      .notNull(),
    paymentTermDays: integer("payment_term_days").default(28).notNull(),
    currency: text("currency").default("BRL").notNull(),
    billingPeriodFrom: timestamp("billing_period_from"),
    billingPeriodTo: timestamp("billing_period_to"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("billing_group_org_idx").on(table.organizationId),
    index("billing_group_customer_idx").on(
      table.organizationId,
      table.customerId,
    ),
    index("billing_group_status_idx").on(table.organizationId, table.status),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("billing_group_id_org_uidx").on(table.id, table.organizationId),
  ],
);

// Normalized supplier / transporter records, referenced by
// service_order_outsourced_cost instead of a free-text supplier name.

export const supplier = pgTable(
  "supplier",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    taxId: text("tax_id"),
    email: text("email"),
    phone: text("phone"),
    kind: text("kind").$type<SupplierKind>().default("other").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("supplier_org_idx").on(table.organizationId),
    index("supplier_org_name_idx").on(table.organizationId, table.name),
  ],
);
