import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  serial,
  jsonb,
  integer,
  real,
} from "drizzle-orm/pg-core";

// =============================================================================
// ASSET TYPE - Dynamic Instrument Classification (ISO 17025)
// =============================================================================

/**
 * Field definition for dynamic asset specifications.
 * This defines the "blueprint" for what fields an instrument type requires.
 */
export type AssetTypeFieldDefinition = {
  key: string; // e.g., "resolution"
  label: string; // e.g., "Resolution (d)"
  type: "text" | "number" | "select";
  options?: string[]; // For select type
  unit?: string; // e.g., "g", "°C", "mm"
  required?: boolean;
};

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at").notNull(),
    metadata: text("metadata"),
    type: text("type").default("LAB"),
    // ISO 17025 / RBC compliance fields
    cnpj: text("cnpj"),
    accreditationNumber: text("accreditation_number"),
    accreditationBody: text("accreditation_body"),
    street: text("street"),
    number: text("number"),
    complement: text("complement"),
    neighbourhood: text("neighbourhood"),
    city: text("city"),
    state: text("state"),
    cep: text("cep"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    technicalManagerName: text("technical_manager_name"),
    technicalManagerTitle: text("technical_manager_title"),
    // Billing / Asaas integration
    asaasCustomerId: text("asaas_customer_id"),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

// =============================================================================
// ASSET TYPE - Instrument Classification Blueprint
// =============================================================================

/**
 * Asset Type table - Defines instrument categories and their specification fields.
 * Each type has a "definition" that describes what dynamic fields assets of this type need.
 * Examples: Digital Balance, Thermohygrometer, Caliper, Micrometer, etc.
 */
export const assetType = pgTable(
  "asset_type",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // e.g., "Balança Digital"
    slug: text("slug").notNull().unique(), // e.g., "balanca-digital"
    description: text("description"), // Optional description
    // The Blueprint: Defines what specification fields this type requires
    // Example: [{ key: "resolution", label: "Resolução", type: "number", unit: "g", required: true }]
    definition: jsonb("definition")
      .$type<AssetTypeFieldDefinition[]>()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("asset_type_slug_uidx").on(table.slug)],
);

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
    name: text("name").notNull(), // Razao Social / Nome Fantasia
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
    customerId: serial("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
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
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(
  organization,
  ({ one, many }) => ({
    members: many(member),
    invitations: many(invitation),
    subscription: one(subscription),
  }),
);

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const customerRelations = relations(customer, ({ one, many }) => ({
  organization: one(organization, {
    fields: [customer.authOrganizationId],
    references: [organization.id],
  }),
  auditLogs: many(customerAuditLog),
  assets: many(asset),
}));

export const customerAuditLogRelations = relations(
  customerAuditLog,
  ({ one }) => ({
    customer: one(customer, {
      fields: [customerAuditLog.customerId],
      references: [customer.id],
    }),
    performedByUser: one(user, {
      fields: [customerAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// ASSET - Equipment/Instruments under test (EUT) from clients
// =============================================================================

/**
 * Asset status values for equipment lifecycle tracking
 */
export type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

/**
 * Asset table - Equipment/Instruments linked to customers.
 * Each asset belongs to a customer and can have calibration history.
 */
export const asset = pgTable(
  "asset",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    // Dynamic Instrument Classification
    assetTypeId: integer("asset_type_id")
      .notNull()
      .references(() => assetType.id),
    // Dynamic specifications stored as JSONB (e.g., { "resolution": 0.001, "capacity": 220 })
    specifications: jsonb("specifications").$type<Record<string, unknown>>(),
    name: text("name").notNull(), // e.g., "Analytical Balance", "Pressure Gauge"
    manufacturer: text("manufacturer"), // e.g., "Mettler Toledo", "Fluke"
    model: text("model"), // e.g., "XPE205", "700G"
    serialNumber: text("serial_number").notNull(), // Manufacturer's serial number
    tag: text("tag").notNull().unique(), // Internal Lab ID / Asset ID (unique across lab)
    status: text("status").$type<AssetStatus>().default("ACTIVE").notNull(),
    lastCalibrationDate: timestamp("last_calibration_date"),
    nextCalibrationDate: timestamp("next_calibration_date"),
    comments: text("comments"), // Additional notes about the equipment
    deletedAt: timestamp("deleted_at"), // Soft delete for ISO 17025 compliance
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("asset_customer_id_idx").on(table.customerId),
    index("asset_type_id_idx").on(table.assetTypeId),
    index("asset_status_idx").on(table.status),
    uniqueIndex("asset_tag_uidx").on(table.tag),
  ],
);

// =============================================================================
// ASSET AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for asset changes.
 * Tracks all modifications for compliance and traceability.
 */
export const assetAuditLog = pgTable(
  "asset_audit_log",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'delete', 'status_change', etc.
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for status changes per ISO 17025
  },
  (table) => [
    index("asset_audit_log_asset_id_idx").on(table.assetId),
    index("asset_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// ASSET RELATIONS
// =============================================================================

export const assetTypeRelations = relations(assetType, ({ many }) => ({
  assets: many(asset),
}));

export const assetRelations = relations(asset, ({ one, many }) => ({
  customer: one(customer, {
    fields: [asset.customerId],
    references: [customer.id],
  }),
  assetType: one(assetType, {
    fields: [asset.assetTypeId],
    references: [assetType.id],
  }),
  auditLogs: many(assetAuditLog),
}));

export const assetAuditLogRelations = relations(assetAuditLog, ({ one }) => ({
  asset: one(asset, {
    fields: [assetAuditLog.assetId],
    references: [asset.id],
  }),
  performedByUser: one(user, {
    fields: [assetAuditLog.performedBy],
    references: [user.id],
  }),
}));

// =============================================================================
// CALIBRATION METHOD - ISO 17025 Validated Calibration Templates
// =============================================================================

/**
 * Method status values for versioning workflow
 * - DRAFT: Work in progress, can be edited
 * - PUBLISHED: Active and immutable, used for calibrations
 * - ARCHIVED: No longer active, kept for historical reference
 */
export type MethodStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

/**
 * Input field definition for method data collection.
 * Defines what the technician types during calibration.
 */
export type MethodInputField = {
  key: string; // Variable name, e.g., "reading_1"
  label: string; // Display label, e.g., "Reading 1"
  type: "text" | "number" | "select" | "table";
  unit?: string; // e.g., "mm", "°C"
  required?: boolean;
  options?: string[]; // For select type
  defaultValue?: string | number;
  // For table type only:
  columns?: Array<{
    key: string;
    label: string;
    type: "text" | "number";
    unit?: string;
  }>;
};

/**
 * Formula definition for computed values.
 * Defines how results are calculated from inputs.
 */
export type MethodFormula = {
  outputKey: string; // Variable name for result, e.g., "error"
  expression: string; // Math expression, e.g., "reading_1 - nominal"
  label?: string; // Display label, e.g., "Measurement Error"
  unit?: string;
};

/**
 * Validation rule for pass/fail criteria.
 * Defines acceptance criteria per ISO 17025.
 */
export type MethodValidation = {
  expression: string; // Boolean expression, e.g., "abs(error) < tolerance"
  message: string; // Message shown on failure
  severity: "error" | "warning";
};

/**
 * Default Type B uncertainty component for the method.
 * Pre-configured systematic uncertainty sources.
 */
export type MethodTypeBComponent = {
  name: string;
  value: number;
  distribution: "normal" | "rectangular" | "triangular" | "u-shaped";
  coverageFactor?: number;
  divisor?: number;
  degreesOfFreedom?: number;
};

/**
 * Calibration Method table - Versioned calibration templates
 * ISO 17025:2017 Clause 7.2 - Method Validation
 *
 * Key concepts:
 * - Methods are organization-scoped (each lab owns their methods)
 * - Published methods are immutable for ISO compliance
 * - Editing a published method creates a new version (clone)
 * - Version chain tracked via parentId
 */
export const calibrationMethod = pgTable(
  "calibration_method",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    assetTypeId: integer("asset_type_id").references(() => assetType.id),
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").default(1).notNull(),
    status: text("status").$type<MethodStatus>().default("DRAFT").notNull(),
    // JSONB fields for method definition
    dataFields: jsonb("data_fields").$type<MethodInputField[]>().notNull(),
    formulas: jsonb("formulas").$type<MethodFormula[]>().default([]).notNull(),
    validations: jsonb("validations")
      .$type<MethodValidation[]>()
      .default([])
      .notNull(),
    uncertaintyParams: jsonb("uncertainty_params")
      .$type<MethodTypeBComponent[]>()
      .default([])
      .notNull(),
    // Version chain - links to the parent version
    parentId: integer("parent_id"),
    // Timestamps and actors
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at"),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("method_organization_id_idx").on(table.organizationId),
    index("method_asset_type_id_idx").on(table.assetTypeId),
    index("method_status_idx").on(table.status),
    index("method_parent_id_idx").on(table.parentId),
    uniqueIndex("method_org_name_version_uidx").on(
      table.organizationId,
      table.name,
      table.version,
    ),
  ],
);

// =============================================================================
// METHOD AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for method changes.
 * Tracks all modifications for compliance and traceability.
 * Critical for ISO 17025 Clause 7.2 (Method Validation) audits.
 */
export const methodAuditLog = pgTable(
  "method_audit_log",
  {
    id: serial("id").primaryKey(),
    methodId: integer("method_id")
      .notNull()
      .references(() => calibrationMethod.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'publish', 'archive', 'new_version'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Optional reason for change
  },
  (table) => [
    index("method_audit_log_method_id_idx").on(table.methodId),
    index("method_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// CALIBRATION METHOD RELATIONS
// =============================================================================

export const calibrationMethodRelations = relations(
  calibrationMethod,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [calibrationMethod.organizationId],
      references: [organization.id],
    }),
    assetType: one(assetType, {
      fields: [calibrationMethod.assetTypeId],
      references: [assetType.id],
    }),
    parent: one(calibrationMethod, {
      fields: [calibrationMethod.parentId],
      references: [calibrationMethod.id],
      relationName: "versionChain",
    }),
    versions: many(calibrationMethod, { relationName: "versionChain" }),
    createdByUser: one(user, {
      fields: [calibrationMethod.createdBy],
      references: [user.id],
      relationName: "methodCreator",
    }),
    publishedByUser: one(user, {
      fields: [calibrationMethod.publishedBy],
      references: [user.id],
      relationName: "methodPublisher",
    }),
    auditLogs: many(methodAuditLog),
  }),
);

export const methodAuditLogRelations = relations(methodAuditLog, ({ one }) => ({
  method: one(calibrationMethod, {
    fields: [methodAuditLog.methodId],
    references: [calibrationMethod.id],
  }),
  performedByUser: one(user, {
    fields: [methodAuditLog.performedBy],
    references: [user.id],
  }),
}));

// =============================================================================
// SERVICE - Commercial Service Catalog (Product Registry)
// =============================================================================

/**
 * Service table - Links commercial offerings to calibration methods.
 * This is the "Commercial Wrapper" around technical Methods.
 *
 * Key concepts:
 * - Services are what the lab sells (e.g., "Calibração de Balança Digital 0-220g")
 * - Links to a validated Method for technical execution
 * - Contains pricing and turnaround time for quotes
 * - Soft-delete only (isActive) for financial audit trail
 *
 * ISO 17025 Clause 7.1 - Service Agreements
 */
export const service = pgTable(
  "service",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // E.g., "Calibração de Paquímetro 0-150mm"
    description: text("description"),
    // Link to calibration method (nullable - repair services don't need methods)
    methodId: integer("method_id").references(() => calibrationMethod.id, {
      onDelete: "set null",
    }),
    // Link to asset type for filtering during job creation
    // When methodId has an assetTypeId, this MUST match (enforced at app level)
    assetTypeId: integer("asset_type_id").references(() => assetType.id, {
      onDelete: "set null",
    }),
    // Pricing in cents (e.g., 15000 = R$ 150,00)
    // Nullable for "Call for Quote" / "Sob Consulta" services
    price: integer("price"),
    currency: text("currency").default("BRL").notNull(),
    // Turnaround time in business days
    tat: integer("tat"),
    // Soft delete - never hard delete commercial data
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_organization_id_idx").on(table.organizationId),
    index("service_method_id_idx").on(table.methodId),
    index("service_asset_type_id_idx").on(table.assetTypeId),
    index("service_is_active_idx").on(table.isActive),
  ],
);

// =============================================================================
// SERVICE AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for service changes.
 * Tracks all modifications for compliance and financial traceability.
 */
export const serviceAuditLog = pgTable(
  "service_audit_log",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'deactivate', 'reactivate'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Optional reason for change
  },
  (table) => [
    index("service_audit_log_service_id_idx").on(table.serviceId),
    index("service_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// SERVICE RELATIONS
// =============================================================================

export const serviceRelations = relations(service, ({ one, many }) => ({
  organization: one(organization, {
    fields: [service.organizationId],
    references: [organization.id],
  }),
  method: one(calibrationMethod, {
    fields: [service.methodId],
    references: [calibrationMethod.id],
  }),
  assetType: one(assetType, {
    fields: [service.assetTypeId],
    references: [assetType.id],
  }),
  auditLogs: many(serviceAuditLog),
}));

export const serviceAuditLogRelations = relations(
  serviceAuditLog,
  ({ one }) => ({
    service: one(service, {
      fields: [serviceAuditLog.serviceId],
      references: [service.id],
    }),
    performedByUser: one(user, {
      fields: [serviceAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// REFERENCE STANDARD - Lab's Own Calibration Equipment (ISO 17025 Clause 6.4)
// =============================================================================

/**
 * Certified value for multi-value standards (e.g., weight sets).
 * Stores individual values from a calibration certificate.
 */
export type CertifiedValue = {
  nominal: string; // Display label, e.g., "100g"
  value: number; // Actual certified value, e.g., 100.005
  uncertainty: number; // Uncertainty for this specific value
  unit: string; // Unit, e.g., "g", "mg"
};

/**
 * Reference Standard status for lifecycle tracking
 */
export type ReferenceStandardStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "OUT_OF_TOLERANCE"
  | "SENT_FOR_CALIBRATION";

/**
 * Uncertainty distribution types
 */
export type UncertaintyDistribution = "normal" | "rectangular";

/**
 * Reference Standard table - Lab's own master instruments for calibrations.
 * These are the "Truth" used to calibrate client equipment.
 *
 * Key concepts:
 * - Distinct from Client Assets (EUT) - these are the lab's own equipment
 * - Certificate data is critical for uncertainty calculations
 * - Supports both single-value (e.g., single weight) and multi-value (e.g., weight set)
 * - ISO 17025:2017 Clause 6.4 - Equipment
 */
export const referenceStandard = pgTable(
  "reference_standard",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // e.g., "Conjunto de Pesos E2"
    type: text("type"), // Optional category: "Peso", "Bloco Padrão", etc.
    serialNumber: text("serial_number").notNull(),
    manufacturer: text("manufacturer"),
    model: text("model"),
    // Certificate traceability
    certificateNumber: text("certificate_number").notNull(),
    calibratedBy: text("calibrated_by"), // Calibration lab name (traceability)
    calibrationDate: timestamp("calibration_date").notNull(),
    nextCalibrationDate: timestamp("next_calibration_date").notNull(),
    // Single-value metrology data
    referenceValue: real("reference_value"), // For single-value standards
    uncertainty: real("uncertainty"),
    uncertaintyUnit: text("uncertainty_unit"),
    coverageFactor: real("coverage_factor").default(2.0).notNull(),
    distribution: text("distribution")
      .$type<UncertaintyDistribution>()
      .default("normal")
      .notNull(),
    drift: real("drift"),
    // Multi-value metrology data (for sets like weight sets, gauge blocks)
    certifiedValues: jsonb("certified_values").$type<CertifiedValue[]>(),
    // Status
    status: text("status")
      .$type<ReferenceStandardStatus>()
      .default("ACTIVE")
      .notNull(),
    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"), // Soft delete
  },
  (table) => [
    index("standard_organization_id_idx").on(table.organizationId),
    index("standard_status_idx").on(table.status),
    index("standard_next_cal_date_idx").on(table.nextCalibrationDate),
  ],
);

// =============================================================================
// REFERENCE STANDARD AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for reference standard changes.
 * Tracks all modifications for compliance and traceability.
 * Critical for ISO 17025 equipment management audits.
 */
export const referenceStandardAuditLog = pgTable(
  "reference_standard_audit_log",
  {
    id: serial("id").primaryKey(),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'renew', 'status_change', 'delete'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for renewals and status changes (ISO 17025)
  },
  (table) => [
    index("standard_audit_log_standard_id_idx").on(table.standardId),
    index("standard_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// REFERENCE STANDARD RELATIONS
// =============================================================================

export const referenceStandardRelations = relations(
  referenceStandard,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [referenceStandard.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [referenceStandard.createdBy],
      references: [user.id],
    }),
    auditLogs: many(referenceStandardAuditLog),
  }),
);

export const referenceStandardAuditLogRelations = relations(
  referenceStandardAuditLog,
  ({ one }) => ({
    standard: one(referenceStandard, {
      fields: [referenceStandardAuditLog.standardId],
      references: [referenceStandard.id],
    }),
    performedByUser: one(user, {
      fields: [referenceStandardAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// CALIBRATION JOB - Work Order (ISO 17025 Operational Layer)
// =============================================================================

/**
 * Job status values for workflow tracking
 * - DRAFT: Created, not started
 * - IN_PROGRESS: Technician is executing the calibration
 * - REVIEW: Submitted for manager review
 * - GENERATING_PDF: Approved, certificate being generated async
 * - APPROVED: Certificate generated and ready
 * - REJECTED: Manager rejected, needs rework
 * - CANCELED: Job was canceled (soft delete equivalent)
 * - SUPERSEDED: Certificate was amended and replaced by a new version (ISO 17025 Clause 7.8.4.1)
 */
export type JobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "GENERATING_PDF"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "SUPERSEDED";

/**
 * Method Snapshot - Frozen copy of method at job creation time.
 * This ensures future changes to the Method do not affect historical jobs.
 * Critical for ISO 17025 compliance: must be able to reproduce calculations
 * exactly as performed, even years later.
 */
export type MethodSnapshot = {
  methodId: number;
  methodName: string;
  methodVersion: number;
  dataFields: MethodInputField[];
  formulas: MethodFormula[];
  validations: MethodValidation[];
  uncertaintyParams: MethodTypeBComponent[];
};

/**
 * Standard Snapshot - Frozen copy of reference standards at execution time.
 * This ensures the standard values used are recorded exactly as they were
 * during calibration, even if the standard is recalibrated later.
 * Critical for ISO 17025 compliance: traceability and reproducibility.
 */
export type StandardSnapshot = {
  id: number;
  name: string;
  certificateNumber: string;
  calibrationDate: Date;
  uncertainty: number | null;
  uncertaintyUnit: string | null;
  coverageFactor: number;
  distribution: UncertaintyDistribution;
  drift: number | null;
  certifiedValues: CertifiedValue[] | null;
};

/**
 * Calibration Job table - The Work Order / Operational Record
 * ISO 17025:2017 Clause 7.7 - Ensuring Validity of Results
 *
 * Key concepts:
 * - Connects Customer + Asset + Service + Method into a single record
 * - Method configuration is SNAPSHOTTED at job creation (immutable history)
 * - Workflow states enforce ISO 17025 separation of duties
 * - Approved jobs are immutable for compliance
 */
export const calibrationJob = pgTable(
  "calibration_job",
  {
    id: serial("id").primaryKey(),
    // Human-readable ID: "JOB-2024-0001" (per organization per year)
    jobId: text("job_id").notNull(),
    // Organization scope
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Customer who owns the asset
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    // Asset being calibrated
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    // Service (commercial wrapper, contains pricing/TAT)
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "restrict" }),
    // Assigned technician (nullable - can be assigned later)
    technicianId: text("technician_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // CRITICAL: Frozen copy of method configuration at job creation
    // This ensures reproducibility per ISO 17025 requirements
    methodSnapshot: jsonb("method_snapshot").$type<MethodSnapshot>().notNull(),
    // Workflow status
    status: text("status").$type<JobStatus>().default("DRAFT").notNull(),
    // Dates
    dueDate: timestamp("due_date"),
    performedAt: timestamp("performed_at"),
    // Execution data (filled by technician during calibration)
    data: jsonb("data").$type<Record<string, unknown>>(),
    // Calculated results (output from math engine)
    results: jsonb("results").$type<Record<string, unknown>>(),
    // Frozen copy of reference standards used during execution
    // This ensures traceability per ISO 17025 requirements
    standardsSnapshot: jsonb("standards_snapshot").$type<StandardSnapshot[]>(),
    // Certificate URL (populated after approval and PDF generation)
    certificateUrl: text("certificate_url"),
    // Label URL for thermal printer sticker (populated after label generation)
    labelUrl: text("label_url"),
    // Public verification token (UUID) - unguessable link for auditors/clients
    // Uses PostgreSQL's native gen_random_uuid() for automatic generation
    verificationToken: text("verification_token")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    // Timestamps and actors
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Approval tracking
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    // Rejection tracking
    rejectedBy: text("rejected_by").references(() => user.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    // ==========================================================================
    // AMENDMENT TRACKING - ISO 17025:2017 Clause 7.8.4.1
    // "When a report or certificate needs to be revised after issue, each
    // revision shall be uniquely identified and shall contain a reference
    // to the original."
    // ==========================================================================
    /**
     * References the job that this job supersedes (if this is a correction).
     * NULL for original certificates.
     * Example: Job #123 has error. Create Job #456 with supersedesId=123.
     */
    supersedesId: integer("supersedes_id"),
    /**
     * References the job that superseded this job (if this has been corrected).
     * NULL for current valid certificates.
     * Automatically set when another job is created to supersede this one.
     */
    supersededById: integer("superseded_by_id"),
    /**
     * Amendment number (1, 2, 3...) if this is a correction.
     * NULL for original certificates.
     * Used for display: "Retificação nº 2"
     */
    amendmentNumber: integer("amendment_number"),
    /**
     * Mandatory reason for amendment (ISO 17025 requirement).
     * Example: "Erro de digitação no valor de incerteza"
     */
    amendmentReason: text("amendment_reason"),
    /**
     * Timestamp when this job was superseded by another.
     */
    supersededAt: timestamp("superseded_at"),
  },
  (table) => [
    index("job_organization_id_idx").on(table.organizationId),
    index("job_customer_id_idx").on(table.customerId),
    index("job_asset_id_idx").on(table.assetId),
    index("job_service_id_idx").on(table.serviceId),
    index("job_technician_id_idx").on(table.technicianId),
    index("job_status_idx").on(table.status),
    index("job_due_date_idx").on(table.dueDate),
    uniqueIndex("job_org_job_id_uidx").on(table.organizationId, table.jobId),
    // Amendment tracking indexes for efficient chain lookups
    index("job_supersedes_id_idx").on(table.supersedesId),
    index("job_superseded_by_id_idx").on(table.supersededById),
  ],
);

// =============================================================================
// CALIBRATION JOB AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for calibration job changes.
 * Tracks all modifications for compliance and traceability.
 * Critical for ISO 17025 audits and legal defensibility.
 */
export const jobAuditLog = pgTable(
  "job_audit_log",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'submit', 'approve', 'reject', 'cancel', 'assign', 'execute'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for rejections, cancellations, approvals
  },
  (table) => [
    index("job_audit_log_job_id_idx").on(table.jobId),
    index("job_audit_log_performed_at_idx").on(table.performedAt),
    index("job_audit_log_action_idx").on(table.action),
  ],
);

// =============================================================================
// CALIBRATION JOB RELATIONS
// =============================================================================

export const calibrationJobRelations = relations(
  calibrationJob,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [calibrationJob.organizationId],
      references: [organization.id],
    }),
    customer: one(customer, {
      fields: [calibrationJob.customerId],
      references: [customer.id],
    }),
    asset: one(asset, {
      fields: [calibrationJob.assetId],
      references: [asset.id],
    }),
    service: one(service, {
      fields: [calibrationJob.serviceId],
      references: [service.id],
    }),
    technician: one(user, {
      fields: [calibrationJob.technicianId],
      references: [user.id],
      relationName: "jobTechnician",
    }),
    createdByUser: one(user, {
      fields: [calibrationJob.createdBy],
      references: [user.id],
      relationName: "jobCreator",
    }),
    approvedByUser: one(user, {
      fields: [calibrationJob.approvedBy],
      references: [user.id],
      relationName: "jobApprover",
    }),
    rejectedByUser: one(user, {
      fields: [calibrationJob.rejectedBy],
      references: [user.id],
      relationName: "jobRejecter",
    }),
    auditLogs: many(jobAuditLog),
    // Amendment tracking - ISO 17025:2017 Clause 7.8.4.1
    // The job that this one supersedes (original certificate being corrected)
    supersedes: one(calibrationJob, {
      fields: [calibrationJob.supersedesId],
      references: [calibrationJob.id],
      relationName: "amendmentChain",
    }),
    // The job that superseded this one (the corrected certificate)
    supersededBy: one(calibrationJob, {
      fields: [calibrationJob.supersededById],
      references: [calibrationJob.id],
      relationName: "amendmentChainReverse",
    }),
  }),
);

export const jobAuditLogRelations = relations(jobAuditLog, ({ one }) => ({
  job: one(calibrationJob, {
    fields: [jobAuditLog.jobId],
    references: [calibrationJob.id],
  }),
  performedByUser: one(user, {
    fields: [jobAuditLog.performedBy],
    references: [user.id],
  }),
}));

// =============================================================================
// SUBSCRIPTION - Organization Billing (SaaS Tiering)
// =============================================================================

/**
 * Plan identifiers - matches shared/plans.ts
 */
export type PlanId = "FREE" | "STANDARD" | "PROFESSIONAL" | "ENTERPRISE";

/**
 * Subscription status
 */
export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIAL";

/**
 * Billing cycle
 */
export type BillingCycle = "MONTHLY" | "YEARLY";

/**
 * Subscription table - Links organizations to their billing plan.
 * Each organization can have at most one active subscription.
 */
export const subscription = pgTable(
  "subscription",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Plan from shared config (FREE, STANDARD, PROFESSIONAL, ENTERPRISE)
    planId: text("plan_id").$type<PlanId>().notNull(),
    // Asaas integration (nullable for FREE plan)
    asaasSubscriptionId: text("asaas_subscription_id").unique(),
    asaasCustomerId: text("asaas_customer_id"),
    // Billing details
    billingCycle: text("billing_cycle").$type<BillingCycle>(),
    status: text("status")
      .$type<SubscriptionStatus>()
      .default("TRIAL")
      .notNull(),
    // Trial period
    trialEndsAt: timestamp("trial_ends_at"),
    // Current billing period
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    nextBillingDate: timestamp("next_billing_date"),
    // Cancellation tracking
    canceledAt: timestamp("canceled_at"),
    cancelReason: text("cancel_reason"),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("subscription_org_id_idx").on(table.organizationId),
    index("subscription_status_idx").on(table.status),
    index("subscription_asaas_sub_id_idx").on(table.asaasSubscriptionId),
  ],
);

// =============================================================================
// PAYMENT HISTORY - Payment Records from Asaas
// =============================================================================

/**
 * Payment status matching Asaas webhook events
 */
export type PaymentStatus =
  | "PENDING"
  | "AWAITING_RISK_ANALYSIS"
  | "CONFIRMED"
  | "RECEIVED"
  | "OVERDUE"
  | "REFUNDED"
  | "REFUND_REQUESTED"
  | "CHARGEBACK_REQUESTED"
  | "CHARGEBACK_DISPUTE"
  | "AWAITING_CHARGEBACK_REVERSAL"
  | "DUNNING_REQUESTED"
  | "DUNNING_RECEIVED"
  | "DELETED";

/**
 * Payment method types
 */
export type PaymentMethod = "CREDIT_CARD" | "PIX" | "BOLETO";

/**
 * Payment source - where the payment record originated from.
 * CHECKOUT: Created during checkout flow (provisional, for UX)
 * WEBHOOK: Created/confirmed by Asaas webhook (canonical source)
 */
export type PaymentSource = "CHECKOUT" | "WEBHOOK";

/**
 * Payment History table - Records all payments for subscriptions.
 * Populated via Asaas webhooks for accurate tracking.
 */
export const paymentHistory = pgTable(
  "payment_history",
  {
    id: serial("id").primaryKey(),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscription.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Asaas references
    asaasPaymentId: text("asaas_payment_id").unique(),
    asaasInvoiceUrl: text("asaas_invoice_url"),
    asaasBankSlipUrl: text("asaas_bank_slip_url"), // Boleto PDF
    asaasPixQrCodeUrl: text("asaas_pix_qr_code_url"),
    asaasPixPayload: text("asaas_pix_payload"), // Copia e Cola
    // Payment details
    amount: integer("amount").notNull(), // In centavos
    netAmount: integer("net_amount"), // After fees
    currency: text("currency").default("BRL").notNull(),
    paymentMethod: text("payment_method").$type<PaymentMethod>().notNull(),
    status: text("status").$type<PaymentStatus>().notNull(),
    source: text("source").$type<PaymentSource>().default("WEBHOOK").notNull(),
    // Dates
    dueDate: timestamp("due_date"),
    paidAt: timestamp("paid_at"),
    // Card info (last 4 digits only for display)
    cardLast4: text("card_last4"),
    cardBrand: text("card_brand"),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("payment_subscription_id_idx").on(table.subscriptionId),
    index("payment_org_id_idx").on(table.organizationId),
    index("payment_status_idx").on(table.status),
    uniqueIndex("payment_asaas_id_idx").on(table.asaasPaymentId),
  ],
);

// =============================================================================
// WEBHOOK EVENT LOG - Idempotency for Asaas Webhooks
// =============================================================================

/**
 * Webhook Event Log table - Ensures idempotent webhook processing.
 * Stores all received webhook events with their processing status.
 * Uses UNIQUE constraint on eventId for "at least once" delivery handling.
 */
export const webhookEventLog = pgTable(
  "webhook_event_log",
  {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull().unique(), // Asaas event ID
    eventType: text("event_type").notNull(), // PAYMENT_RECEIVED, etc.
    payload: jsonb("payload").notNull(), // Full webhook payload
    processedAt: timestamp("processed_at"), // When processing completed
    processingError: text("processing_error"), // Error message if failed
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webhook_event_id_uidx").on(table.eventId),
    index("webhook_event_type_idx").on(table.eventType),
    index("webhook_created_at_idx").on(table.createdAt),
  ],
);

// =============================================================================
// BILLING RELATIONS
// =============================================================================

export const subscriptionRelations = relations(
  subscription,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [subscription.organizationId],
      references: [organization.id],
    }),
    payments: many(paymentHistory),
  }),
);

export const paymentHistoryRelations = relations(paymentHistory, ({ one }) => ({
  subscription: one(subscription, {
    fields: [paymentHistory.subscriptionId],
    references: [subscription.id],
  }),
  organization: one(organization, {
    fields: [paymentHistory.organizationId],
    references: [organization.id],
  }),
}));

// =============================================================================
// NOTIFICATION SYSTEM - ISO 17025 Compliance Alerts & Operational Notifications
// =============================================================================

/**
 * Notification type enum - categorizes notification events
 */
export type NotificationType =
  | "JOB_SUBMITTED_FOR_REVIEW"
  | "JOB_APPROVED"
  | "JOB_REJECTED"
  | "JOB_ASSIGNED"
  | "CERTIFICATE_READY"
  | "CERTIFICATE_AMENDED" // ISO 17025 Clause 7.8.4.1 - Certificate amendment notification
  | "ASSET_DUE_FOR_RECALIBRATION"
  | "STANDARD_EXPIRING"
  | "STANDARD_EXPIRED" // ISO 17025 Clause 6.4.6 - Standard expired, jobs blocked
  | "JOB_OVERDUE"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_FAILED";

/**
 * Notification priority levels
 */
export type NotificationPriority = "HIGH" | "MEDIUM" | "LOW";

/**
 * Notification status values
 */
export type NotificationStatus = "UNREAD" | "READ" | "ARCHIVED";

/**
 * Notification delivery channel
 */
export type NotificationChannel = "IN_APP" | "EMAIL";

/**
 * Related entity reference for deep linking
 */
export type NotificationRelatedEntity = {
  entityType: "job" | "asset" | "standard" | "payment" | "customer";
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
  (table) => [uniqueIndex("notification_preference_user_id_uidx").on(table.userId)],
);

/**
 * Scheduled notification entity type
 */
export type ScheduledNotificationEntityType = "asset" | "standard" | "job";

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
    index("scheduled_notification_organization_id_idx").on(table.organizationId),
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
// NOTIFICATION RELATIONS
// =============================================================================

export const notificationRelations = relations(notification, ({ one }) => ({
  recipient: one(user, {
    fields: [notification.recipientUserId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [notification.organizationId],
    references: [organization.id],
  }),
}));

export const notificationPreferenceRelations = relations(
  notificationPreference,
  ({ one }) => ({
    user: one(user, {
      fields: [notificationPreference.userId],
      references: [user.id],
    }),
  }),
);

export const scheduledNotificationRelations = relations(
  scheduledNotification,
  ({ one }) => ({
    organization: one(organization, {
      fields: [scheduledNotification.organizationId],
      references: [organization.id],
    }),
  }),
);
