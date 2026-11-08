// Tables of the "customers" area. Part of the schema entry packages/db/src/schema.ts.
import {
  pgTable,
  text,
  timestamp,
  index,
  serial,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { organization, user } from "./identity";

// =============================================================================
// CUSTOMER - Client companies that send equipment for calibration
// =============================================================================

/**
 * Address type for customer addresses
 */
export type CustomerAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
};

/**
 * Compliance tracking for ISO 17025:2017 clause 7.1
 * Tracks customer qualification status, contracts, and quality requirements
 */
export type CustomerCompliance = {
  qualificationStatus: "pending" | "qualified" | "suspended" | "expired";
  qualificationDate?: string;
  qualificationExpiresAt?: string;
  contractAgreementId?: number;
  contractNumber?: string;
  contractSignedAt?: string;
  contractExpiresAt?: string;
  qualityRequirementsAcknowledged: boolean;
  qualityRequirementsAcknowledgedAt?: string;
  notes?: string;
};

/**
 * Customer table - Business data for client organizations.
 * Links to Better Auth organization via authOrganizationId (the CLIENT org for portal access).
 * Links to LAB organization via labOrganizationId (the LAB that manages this customer).
 */
export const customer = pgTable(
  "customer",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // Razao Social (legal name, the official identifier on documents)
    tradeName: text("trade_name"), // Nome Fantasia (trade name, display-only — never replaces razao social on certificates)
    taxId: text("tax_id"), // CNPJ/VAT
    email: text("email"), // Contact email
    phone: text("phone"), // Optional
    address: jsonb("address").$type<CustomerAddress>(), // CEP, number, street, etc.
    // The CLIENT organization for portal access (created when customer is created)
    authOrganizationId: text("auth_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The LAB organization that manages this customer
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Optional parent group (network/rede). A branch belongs to at most one
    // group; deleting the group detaches branches rather than removing them.
    groupId: integer("group_id").references(() => customerGroup.id, {
      onDelete: "set null",
    }),
    // ISO 17025:2017 compliance tracking
    compliance: jsonb("compliance").$type<CustomerCompliance>(),
    internalNotes: text("internal_notes"), // Internal notes for lab staff
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("customer_auth_org_id_idx").on(table.authOrganizationId),
    index("customer_lab_org_id_idx").on(table.labOrganizationId),
    index("customer_group_id_idx").on(table.groupId),
  ],
);

// =============================================================================
// CUSTOMER GROUP - Multi-unit client (network/rede) grouping branch customers
// =============================================================================
// A customer group is itself a CLIENT organization (its own authOrganizationId)
// so it rides the existing portal switcher/active-org machinery: a unified
// quality manager is invited once to the group org and the portal fans the
// group's active session out to every branch customer (customer.groupId) at
// read time. The group has no customer row of its own.
export const customerGroup = pgTable(
  "customer_group",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // The CLIENT organization that represents the group for portal access.
    authOrganizationId: text("auth_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The LAB organization that owns this group. Branches must share it.
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("customer_group_auth_org_id_idx").on(table.authOrganizationId),
    index("customer_group_lab_org_id_idx").on(table.labOrganizationId),
  ],
);

// =============================================================================
// CUSTOMER AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for customer changes.
 * Tracks all modifications for compliance and traceability.
 */
export const customerAuditLog = pgTable(
  "customer_audit_log",
  {
    id: serial("id").primaryKey(),
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    // Soft reference on purpose — NO FK. The audit trail is
    // append-only (ISO/IEC 17025): the "delete" row must survive the deletion
    // of the customer it documents, so it keeps the id as a plain integer.
    customerId: serial("customer_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'compliance_change', 'user_invited', 'user_removed', etc.
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for compliance changes per ISO 17025
  },
  (table) => [
    index("customer_audit_log_customer_id_idx").on(table.customerId),
    index("customer_audit_log_performed_at_idx").on(table.performedAt),
    index("customer_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);
