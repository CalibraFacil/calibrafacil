// Tables of the "service-orders" area. Part of the schema entry packages/db/src/schema.ts.
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
  real,
} from "drizzle-orm/pg-core";
import type {
  AutomaticSendMilestone,
  AutomaticSendOutcome,
  ServiceOrderActorType,
  ServiceOrderClosingReason,
  ServiceOrderDeliveryMethod,
  ServiceOrderEventType,
  ServiceOrderExecutionResult,
  ServiceOrderIntakeType,
  ServiceOrderItemType,
  ServiceOrderManualApprovalEvidenceType,
  ServiceOrderPriority,
  ServiceOrderQuoteStatus,
  ServiceOrderRecommendedAction,
  ServiceOrderStatus,
} from "@calibra-facil/shared";
import { organization, organizationUnit, user } from "./identity";
import { customer } from "./customers";
import { asset, assetType } from "./assets";
import { material } from "./catalog";
import { automaticSendRule, billingDocument, billingGroup } from "./finance";

export const automaticSendAuditLog = pgTable(
  "automatic_send_audit_log",
  {
    id: serial("id").primaryKey(),
    // Evidence trail: a soft reference on purpose (no FK, like the other
    // audit tables), so the row survives deletion of its organization.
    organizationId: text("organization_id").notNull(),
    serviceOrderId: integer("service_order_id").references(
      () => serviceOrder.id,
      { onDelete: "set null" },
    ),
    appliedRuleId: integer("applied_rule_id").references(
      () => automaticSendRule.id,
      { onDelete: "set null" },
    ),
    milestone: text("milestone").$type<AutomaticSendMilestone>().notNull(),
    outcome: text("outcome").$type<AutomaticSendOutcome>().notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    providerResponseSummary: jsonb("provider_response_summary").$type<Record<
      string,
      unknown
    > | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("automatic_send_audit_org_idx").on(table.organizationId),
    index("automatic_send_audit_so_idx").on(table.serviceOrderId),
    index("automatic_send_audit_created_idx").on(table.createdAt),
  ],
);

export const billingGroupServiceOrder = pgTable(
  "billing_group_service_order",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => billingGroup.id, { onDelete: "cascade" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "restrict" }),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("billing_group_service_order_uidx").on(
      table.groupId,
      table.serviceOrderId,
    ),
    index("billing_group_service_order_so_idx").on(table.serviceOrderId),
    index("billing_group_service_order_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.groupId, table.organizationId],
      foreignColumns: [billingGroup.id, billingGroup.organizationId],
      name: "billing_group_service_order_group_id_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "billing_group_service_order_service_order_id_tenant_fk",
    }).onDelete("restrict"),
  ],
);

// Outsourced calibration cost capture so margin per
// service order is visible. expected_cost_cents is set by the operator
// before dispatch; actual_cost_cents + payable_link_id are populated
// when the Conta Azul payable poll reconciles a matching payable.

export const serviceOrderOutsourcedCost = pgTable(
  "service_order_outsourced_cost",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    supplierName: text("supplier_name").notNull(),
    expectedCostCents: integer("expected_cost_cents").notNull(),
    actualCostCents: integer("actual_cost_cents"),
    currency: text("currency").default("BRL").notNull(),
    payableLinkId: text("payable_link_id"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    voidedAt: timestamp("voided_at"),
  },
  (table) => [
    index("service_order_outsourced_cost_org_idx").on(table.organizationId),
    index("service_order_outsourced_cost_so_idx").on(table.serviceOrderId),
    index("service_order_outsourced_cost_payable_idx").on(table.payableLinkId),
  ],
);

// =============================================================================
// SERVICE ORDER - Operational intake, repair, quote and delivery workflow
// =============================================================================

export type ServiceOrderNumberingScope = "organization" | "unit";

export type ServiceOrderSignatureData = {
  signerName: string;
  signedAt?: string;
  dataUrl: string;
};

export const serviceOrder = pgTable(
  "service_order",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    serviceOrderNumber: text("service_order_number").notNull(),
    // Opaque, non-sequential identifier for client-facing URLs (the portal
    // routes by this instead of the enumerable serial id). Mirrors
    // calibrationJob.verificationToken / billingDocument.publicId.
    publicId: text("public_id")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    clientContactId: integer("client_contact_id"),
    clientContactSnapshot: jsonb("client_contact_snapshot").$type<
      Record<string, unknown>
    >(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    intakeType: text("intake_type")
      .$type<ServiceOrderIntakeType>()
      .default("counter")
      .notNull(),
    sourceServiceOrderId: integer("source_service_order_id"),
    // External / in-loco service order: the technician travels to the client
    // to perform the work. Drives rendering the client service address on the
    // lab print copy.
    isExternalService: boolean("is_external_service").default(false).notNull(),
    status: text("status")
      .$type<ServiceOrderStatus>()
      .default("opened")
      .notNull(),
    priority: text("priority")
      .$type<ServiceOrderPriority>()
      .default("normal")
      .notNull(),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    // When the technician actually started the budget/service work. Distinct
    // from openedAt (OS creation); nullable and editable, not auto-set.
    serviceStartedAt: timestamp("service_started_at"),
    openedByUserId: text("opened_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    responsibleTechnicianId: text("responsible_technician_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    evaluatedAt: timestamp("evaluated_at"),
    quotedAt: timestamp("quoted_at"),
    approvedAt: timestamp("approved_at"),
    rejectedAt: timestamp("rejected_at"),
    repairStartedAt: timestamp("repair_started_at"),
    repairFinishedAt: timestamp("repair_finished_at"),
    readyAt: timestamp("ready_at"),
    deliveredAt: timestamp("delivered_at"),
    deliveredToName: text("delivered_to_name"),
    deliveredToDocument: text("delivered_to_document"),
    deliveryNotes: text("delivery_notes"),
    closedAt: timestamp("closed_at"),
    canceledAt: timestamp("canceled_at"),
    cancelReason: text("cancel_reason"),
    claimedDefect: text("claimed_defect").notNull(),
    intakeCondition: text("intake_condition").notNull(),
    accessories: text("accessories"),
    // Marca de selagem (Inmetro; "lacre" coloquial) numbers: retirada na
    // entrada / aposta na saída.
    removedSealingMarkNumber: text("removed_sealing_mark_number"),
    affixedSealingMarkNumber: text("affixed_sealing_mark_number"),
    // Marca de Reparo (Inmetro / RBMLQ-I) — the glued repair mark applied by
    // the permissionária.
    inmetroRepairMarkNumber: text("inmetro_repair_mark_number"),
    inmetroRepairMarkIssuedAt: timestamp("inmetro_repair_mark_issued_at"),
    inmetroRepairMarkAppliedAt: timestamp("inmetro_repair_mark_applied_at"),
    inmetroRepairMarkAppliedByUserId: text(
      "inmetro_repair_mark_applied_by_user_id",
    ).references(() => user.id, { onDelete: "set null" }),
    inmetroRepairMarkNotes: text("inmetro_repair_mark_notes"),
    invoiceRemittanceNumber: text("invoice_remittance_number"),
    invoiceRemittanceKey: text("invoice_remittance_key"),
    invoiceRemittanceIssuedAt: timestamp("invoice_remittance_issued_at"),
    carrierName: text("carrier_name"),
    carrierDocument: text("carrier_document"),
    thirdPartyName: text("third_party_name"),
    thirdPartyDocument: text("third_party_document"),
    thirdPartyPhone: text("third_party_phone"),
    deliveryMethod: text("delivery_method")
      .$type<ServiceOrderDeliveryMethod>()
      .default("pickup_at_lab")
      .notNull(),
    internalNotes: text("internal_notes"),
    clientVisibleNotes: text("client_visible_notes"),
    totalQuotedCents: integer("total_quoted_cents").default(0).notNull(),
    totalApprovedCents: integer("total_approved_cents").default(0).notNull(),
    evaluationFeeCents: integer("evaluation_fee_cents").default(0).notNull(),
    evaluationFeeApplied: boolean("evaluation_fee_applied")
      .default(false)
      .notNull(),
    warrantyUntil: timestamp("warranty_until"),
    warrantyTerms: text("warranty_terms"),
    closingReason: text("closing_reason").$type<ServiceOrderClosingReason>(),
    billingDocumentId: integer("billing_document_id").references(
      () => billingDocument.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_order_org_number_uidx").on(
      table.organizationId,
      table.serviceOrderNumber,
    ),
    index("service_order_org_status_opened_idx").on(
      table.organizationId,
      table.status,
      table.openedAt,
    ),
    index("service_order_unit_status_idx").on(table.unitId, table.status),
    index("service_order_customer_idx").on(table.customerId),
    index("service_order_asset_idx").on(table.assetId),
    index("service_order_technician_idx").on(table.responsibleTechnicianId),
    index("service_order_source_idx").on(table.sourceServiceOrderId),
    index("service_order_billing_document_idx").on(table.billingDocumentId),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("service_order_id_org_uidx").on(table.id, table.organizationId),
  ],
);

export const serviceOrderAssetSnapshot = pgTable(
  "service_order_asset_snapshot",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .unique()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    assetName: text("asset_name").notNull(),
    assetType: text("asset_type"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    serialNumber: text("serial_number"),
    patrimonyNumber: text("patrimony_number"),
    capacity: text("capacity"),
    resolution: text("resolution"),
    inventoryCode: text("inventory_code"),
    clientAssetCode: text("client_asset_code"),
    observedIdentification: text("observed_identification"),
    photos: jsonb("photos").$type<string[]>().default([]).notNull(),
    specifications: jsonb("specifications").$type<Record<string, unknown>>(),
    // Blueprint-driven instrument specs, frozen at intake as an ordered, printable
    // [{label, value}] list so the printed OS renders any asset type's specs
    // (not just weighing). Null for snapshots created before migration 0056 —
    // the doc renderer falls back to the live asset-type blueprint for those.
    displaySpecs:
      jsonb("display_specs").$type<{ label: string; value: string }[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_asset_snapshot_asset_idx").on(table.assetId),
    index("service_order_asset_snapshot_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_asset_snapshot_service_order_id_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.assetId, table.organizationId],
      foreignColumns: [asset.id, asset.labOrganizationId],
      name: "service_order_asset_snapshot_asset_id_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export const serviceOrderIntakeDocument = pgTable(
  "service_order_intake_document",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    documentNumber: text("document_number").notNull(),
    version: integer("version").default(1).notNull(),
    type: text("type").default("combined").notNull(),
    pdfR2Key: text("pdf_r2_key"),
    issuedAt: timestamp("issued_at"),
    issuedByUserId: text("issued_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    accessTokenHash: text("access_token_hash"),
    qrCodePayload: text("qr_code_payload"),
    signatureData: jsonb("signature_data").$type<ServiceOrderSignatureData>(),
    canceledAt: timestamp("canceled_at"),
    canceledReason: text("canceled_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_intake_document_order_idx").on(table.serviceOrderId),
    // Numbers derive from the per-laboratory order number: unique per laboratory (migration 0125).
    uniqueIndex("service_order_intake_document_org_number_version_uidx").on(
      table.organizationId,
      table.documentNumber,
      table.version,
    ),
    index("service_order_intake_document_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_intake_document_service_order_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const serviceOrderTag = pgTable(
  "service_order_tag",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    tagNumber: text("tag_number").notNull(),
    labelTemplateId: integer("label_template_id"),
    pdfR2Key: text("pdf_r2_key"),
    printedAt: timestamp("printed_at"),
    printedByUserId: text("printed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_tag_order_idx").on(table.serviceOrderId),
    // Numbers derive from the per-laboratory order number: unique per laboratory (migration 0125).
    uniqueIndex("service_order_tag_org_number_uidx").on(
      table.organizationId,
      table.tagNumber,
    ),
    index("service_order_tag_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_tag_service_order_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const serviceOrderDeliveryDocument = pgTable(
  "service_order_delivery_document",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    documentNumber: text("document_number").notNull(),
    version: integer("version").default(1).notNull(),
    pdfR2Key: text("pdf_r2_key"),
    issuedAt: timestamp("issued_at"),
    issuedByUserId: text("issued_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    technicianSignatureData: jsonb(
      "technician_signature_data",
    ).$type<ServiceOrderSignatureData>(),
    clientSignatureData: jsonb(
      "client_signature_data",
    ).$type<ServiceOrderSignatureData>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_delivery_document_order_idx").on(table.serviceOrderId),
    // Numbers derive from the per-laboratory order number: unique per laboratory (migration 0125).
    uniqueIndex("service_order_delivery_document_org_number_version_uidx").on(
      table.organizationId,
      table.documentNumber,
      table.version,
    ),
    index("service_order_delivery_document_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_delivery_document_service_order_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const serviceOrderEvaluation = pgTable(
  "service_order_evaluation",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    technicianId: text("technician_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    evaluatedAt: timestamp("evaluated_at").defaultNow().notNull(),
    diagnosis: text("diagnosis").notNull(),
    detectedIssues: text("detected_issues"),
    recommendedAction: text("recommended_action")
      .$type<ServiceOrderRecommendedAction>()
      .notNull(),
    requiresQuote: boolean("requires_quote").default(true).notNull(),
    requiresClientApproval: boolean("requires_client_approval")
      .default(true)
      .notNull(),
    calibrationRecommended: boolean("calibration_recommended")
      .default(false)
      .notNull(),
    photos: jsonb("photos").$type<string[]>().default([]).notNull(),
    internalNotes: text("internal_notes"),
    clientVisibleNotes: text("client_visible_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_order_evaluation_order_idx").on(table.serviceOrderId),
    index("service_order_evaluation_technician_idx").on(table.technicianId),
    index("service_order_evaluation_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_evaluation_service_order_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const serviceOrderQuote = pgTable(
  "service_order_quote",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    quoteNumber: text("quote_number").notNull(),
    version: integer("version").default(1).notNull(),
    status: text("status")
      .$type<ServiceOrderQuoteStatus>()
      .default("draft")
      .notNull(),
    subtotalServicesCents: integer("subtotal_services_cents")
      .default(0)
      .notNull(),
    subtotalPartsCents: integer("subtotal_parts_cents").default(0).notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    freightCents: integer("freight_cents").default(0).notNull(),
    totalCents: integer("total_cents").default(0).notNull(),
    validUntil: timestamp("valid_until"),
    paymentTerms: text("payment_terms"),
    deliveryEstimate: text("delivery_estimate"),
    warrantyTerms: text("warranty_terms"),
    clientMessage: text("client_message"),
    internalNotes: text("internal_notes"),
    sentAt: timestamp("sent_at"),
    sentByUserId: text("sent_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    approvedByPortalUserId: text("approved_by_portal_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    approvedManuallyByUserId: text("approved_manually_by_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    manualApprovalByName: text("manual_approval_by_name"),
    manualApprovalEvidenceType: text(
      "manual_approval_evidence_type",
    ).$type<ServiceOrderManualApprovalEvidenceType>(),
    manualApprovalEvidenceText: text("manual_approval_evidence_text"),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    pdfR2Key: text("pdf_r2_key"),
    portalAccessTokenHash: text("portal_access_token_hash"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_order_quote_order_status_idx").on(
      table.serviceOrderId,
      table.status,
    ),
    uniqueIndex("service_order_quote_order_version_uidx").on(
      table.serviceOrderId,
      table.version,
    ),
    // Numbers derive from the per-laboratory order number: unique per laboratory (migration 0125).
    uniqueIndex("service_order_quote_org_number_version_uidx").on(
      table.organizationId,
      table.quoteNumber,
      table.version,
    ),
    index("service_order_quote_token_idx").on(table.portalAccessTokenHash),
    index("service_order_quote_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_quote_service_order_id_tenant_fk",
    }).onDelete("cascade"),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("service_order_quote_id_org_uidx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const serviceOrderQuoteItem = pgTable(
  "service_order_quote_item",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    quoteId: integer("quote_id")
      .notNull()
      .references(() => serviceOrderQuote.id, { onDelete: "cascade" }),
    type: text("type").$type<ServiceOrderItemType>().notNull(),
    description: text("description").notNull(),
    // Optional catalog reference for "part" items; free-form items keep null
    materialId: integer("material_id").references(() => material.id, {
      onDelete: "set null",
    }),
    quantity: real("quantity").default(1).notNull(),
    unit: text("unit").default("un").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalPriceCents: integer("total_price_cents").notNull(),
    taxable: boolean("taxable").default(true).notNull(),
    warrantyCovered: boolean("warranty_covered").default(false).notNull(),
    warrantyUntil: timestamp("warranty_until"),
    warrantyTerms: text("warranty_terms"),
    notes: text("notes"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_quote_item_quote_idx").on(table.quoteId),
    index("service_order_quote_item_material_idx").on(table.materialId),
    index("service_order_quote_item_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.quoteId, table.organizationId],
      foreignColumns: [serviceOrderQuote.id, serviceOrderQuote.organizationId],
      name: "service_order_quote_item_quote_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const serviceOrderExecution = pgTable(
  "service_order_execution",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .unique()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    startedByUserId: text("started_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    finishedAt: timestamp("finished_at"),
    finishedByUserId: text("finished_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    servicePerformed: text("service_performed"),
    partsUsedSummary: text("parts_used_summary"),
    technicalNotes: text("technical_notes"),
    technicianSignatureData: jsonb(
      "technician_signature_data",
    ).$type<ServiceOrderSignatureData>(),
    clientSignatureData: jsonb(
      "client_signature_data",
    ).$type<ServiceOrderSignatureData>(),
    calibrationRequiredAfterRepair: boolean("calibration_required_after_repair")
      .default(false)
      .notNull(),
    result: text("result").$type<ServiceOrderExecutionResult>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_order_execution_order_idx").on(table.serviceOrderId),
    index("service_order_execution_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_execution_service_order_id_tenant_fk",
    }).onDelete("cascade"),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("service_order_execution_id_org_uidx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const serviceOrderExecutionItem = pgTable(
  "service_order_execution_item",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    executionId: integer("execution_id")
      .notNull()
      .references(() => serviceOrderExecution.id, { onDelete: "cascade" }),
    quoteItemId: integer("quote_item_id").references(
      () => serviceOrderQuoteItem.id,
      { onDelete: "set null" },
    ),
    type: text("type").$type<ServiceOrderItemType>().notNull(),
    description: text("description").notNull(),
    // Optional catalog reference for "part" items; free-form items keep null
    materialId: integer("material_id").references(() => material.id, {
      onDelete: "set null",
    }),
    quantity: real("quantity").default(1).notNull(),
    unit: text("unit").default("un").notNull(),
    unitCostCents: integer("unit_cost_cents").default(0).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalPriceCents: integer("total_price_cents").notNull(),
    technicianId: text("technician_id").references(() => user.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_execution_item_execution_idx").on(table.executionId),
    index("service_order_execution_item_quote_item_idx").on(table.quoteItemId),
    index("service_order_execution_item_material_idx").on(table.materialId),
    index("service_order_execution_item_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.executionId, table.organizationId],
      foreignColumns: [
        serviceOrderExecution.id,
        serviceOrderExecution.organizationId,
      ],
      name: "service_order_execution_item_execution_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const serviceOrderEventLog = pgTable(
  "service_order_event_log",
  {
    id: serial("id").primaryKey(),
    // Evidence trail: a soft reference on purpose (no FK, like the other
    // audit tables), so the row survives deletion of its organization.
    organizationId: text("organization_id").notNull(),
    // Soft references (no FK): the event trail outlives the order and its unit.
    unitId: integer("unit_id").notNull(),
    serviceOrderId: integer("service_order_id").notNull(),
    actorType: text("actor_type").$type<ServiceOrderActorType>().notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type").$type<ServiceOrderEventType>().notNull(),
    oldValue: jsonb("old_value").$type<Record<string, unknown>>(),
    newValue: jsonb("new_value").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_event_order_created_idx").on(
      table.serviceOrderId,
      table.createdAt,
    ),
    index("service_order_event_org_unit_created_idx").on(
      table.organizationId,
      table.unitId,
      table.createdAt,
    ),
    index("service_order_event_type_idx").on(table.eventType),
  ],
);

export const serviceOrderAttachment = pgTable(
  "service_order_attachment",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    r2Key: text("r2_key").notNull(),
    visibility: text("visibility").default("internal").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_attachment_order_idx").on(table.serviceOrderId),
    index("service_order_attachment_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_attachment_service_order_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const serviceOrderSettings = pgTable(
  "service_order_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),
    numberingTemplate: text("numbering_template")
      .default("OS-{YYYY}-{SEQ}")
      .notNull(),
    numberingScope: text("numbering_scope")
      .$type<ServiceOrderNumberingScope>()
      .default("unit")
      .notNull(),
    defaultIntakeTerms: text("default_intake_terms"),
    defaultQuoteTerms: text("default_quote_terms"),
    requirePhotoOnIntake: boolean("require_photo_on_intake")
      .default(false)
      .notNull(),
    requireInvoiceOrJustification: boolean("require_invoice_or_justification")
      .default(false)
      .notNull(),
    allowPublicQuoteApproval: boolean("allow_public_quote_approval")
      .default(true)
      .notNull(),
    requirePortalLoginForApproval: boolean("require_portal_login_for_approval")
      .default(false)
      .notNull(),
    autoEmailOnOpen: boolean("auto_email_on_open").default(true).notNull(),
    autoEmailOnQuoteSent: boolean("auto_email_on_quote_sent")
      .default(true)
      .notNull(),
    autoEmailOnReady: boolean("auto_email_on_ready").default(true).notNull(),
    autoEmailOnClose: boolean("auto_email_on_close").default(false).notNull(),
    showValuesInPortal: boolean("show_values_in_portal")
      .default(true)
      .notNull(),
    defaultQuoteValidityDays: integer("default_quote_validity_days")
      .default(15)
      .notNull(),
    defaultWarrantyTerms: text("default_warranty_terms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_order_settings_org_uidx").on(table.organizationId),
  ],
);

export const serviceOrderNumberingSequence = pgTable(
  "service_order_numbering_sequence",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),
    sequenceKey: text("sequence_key").notNull(),
    currentValue: integer("current_value").default(0).notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("service_order_numbering_sequence_uidx")
      .on(table.organizationId, table.unitId, table.sequenceKey)
      .nullsNotDistinct(),
  ],
);

/**
 * Why a public access token stopped granting access:
 * - "decided": the quote it grants access to was approved or rejected.
 * - "superseded": a newer quote version was sent for the same service order.
 */
export type ServiceOrderTokenRevokedReason = "decided" | "superseded";

export const serviceOrderPublicAccessToken = pgTable(
  "service_order_public_access_token",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    quoteId: integer("quote_id").references(() => serviceOrderQuote.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    // Peppered HMAC-SHA-256 of the human-typeable approval code. Only set on
    // the grant minted at quote send; redemption-minted sibling tokens keep it
    // NULL. Nullable + unique is safe: Postgres unique indexes admit multiple
    // NULLs.
    codeHash: text("code_hash"),
    scope: text("scope").default("service_order").notNull(),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    revokedReason:
      text("revoked_reason").$type<ServiceOrderTokenRevokedReason>(),
    lastViewedAt: timestamp("last_viewed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("service_order_public_access_token_hash_uidx").on(
      table.tokenHash,
    ),
    uniqueIndex("service_order_public_access_token_code_hash_uidx").on(
      table.codeHash,
    ),
    index("service_order_public_access_token_order_idx").on(
      table.serviceOrderId,
    ),
    index("service_order_public_access_token_quote_idx").on(table.quoteId),
  ],
);

/**
 * Per-IP failed-attempt counter for the public approval-code redemption
 * endpoint. Fixed-window buckets: one row per (ip_hash, window_starts_at).
 * The IP is stored as a SHA-256 hash (no raw PII at rest); the row carries no
 * organization/FK because the traffic is pre-auth and unattributable.
 */
export const publicCodeRedeemThrottle = pgTable(
  "public_code_redeem_throttle",
  {
    id: serial("id").primaryKey(),
    ipHash: text("ip_hash").notNull(),
    windowStartsAt: timestamp("window_starts_at").notNull(),
    failedAttempts: integer("failed_attempts").default(0).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("public_code_redeem_throttle_ip_window_uidx").on(
      table.ipHash,
      table.windowStartsAt,
    ),
  ],
);

// =============================================================================
// SERVICE ORDER EMAIL LOG - Idempotency / dedup (REQ-SOEMAIL-007)
// =============================================================================

/**
 * Records each sent transition email keyed by (serviceOrderId, eventKey).
 * A UNIQUE constraint on (service_order_id, event_key) enforces at-most-once
 * dispatch per service-order lifecycle event (REQ-SOEMAIL-008).
 *
 * The send-once helper in apps/api claims a row before dispatch and deletes it
 * on failure so a retry can resend (REQ-SOEMAIL-009). Only apps/api has DB
 * access; packages/notifications remains DB-free (preserves REQ-004 boundary).
 */
export const serviceOrderEmailLog = pgTable(
  "service_order_email_log",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    /** Stable event key, e.g. "nova_os", "orcamento_sent:42". */
    eventKey: text("event_key").notNull(),
    /** Resolved recipient address at send time (informational). */
    recipientEmail: text("recipient_email"),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => [
    unique("service_order_email_log_so_event_uidx").on(
      table.serviceOrderId,
      table.eventKey,
    ),
    index("service_order_email_log_so_idx").on(table.serviceOrderId),
    index("service_order_email_log_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.serviceOrderId, table.organizationId],
      foreignColumns: [serviceOrder.id, serviceOrder.organizationId],
      name: "service_order_email_log_service_order_id_tenant_fk",
    }).onDelete("cascade"),
  ],
);

// =============================================================================
// SERVICE ORDER EMAIL OUTBOX - Transactional outbox for customer status emails
// =============================================================================
// Rows are written in the SAME database transaction as the triggering status
// change so that a rollback never produces an orphaned email dispatch.
// A separate worker drains this table and sends the actual email.

export const serviceOrderEmailOutbox = pgTable(
  "service_order_email_outbox",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Nullable to match how events store unitId — some paths may not have it.
    unitId: integer("unit_id"),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    // Stable per-transition dedup key, e.g. "status_email:repair_in_progress".
    eventKey: text("event_key").notNull(),
    // The service-order status that triggered this outbox entry.
    targetStatus: text("target_status").notNull(),
    // Minimal snapshot needed to send later; worker may re-load the order.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Terminal "done" marker — set only when the row is successfully sent (or
    // gracefully skipped). A NULL processedAt means the row is still owed.
    processedAt: timestamp("processed_at"),
    // Explicit dead-letter marker (REQ-REL-OBS-003) — set when a release pushes
    // `attempts` to `maxAttempts`, i.e. the row will never be drained again.
    // Before this, an exhausted row simply stopped being selected (silently);
    // now it is a queryable state. Distinct from processedAt (which means
    // "succeeded").
    deadLetterAt: timestamp("dead_letter_at"),
    // Lease marker — set when a drain claims the row for in-flight processing.
    // The drain reclaims a row whose lease is older than the lease window, so a
    // run killed mid-send (claimedAt set, processedAt still NULL) auto-recovers
    // instead of stranding. Cleared on send failure (released for retry).
    claimedAt: timestamp("claimed_at"),
  },
  (table) => [
    // At most one outbox row per (service order, transition event). INSERT with
    // onConflictDoNothing prevents duplicates on re-entry / retries.
    unique("service_order_email_outbox_order_event_uidx").on(
      table.serviceOrderId,
      table.eventKey,
    ),
    index("service_order_email_outbox_pending_idx").on(
      table.createdAt,
      table.processedAt,
    ),
  ],
);
