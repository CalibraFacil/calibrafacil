import { relations } from "drizzle-orm";
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

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

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
 * - APPROVED: Manager approved, ready for certificate generation
 * - REJECTED: Manager rejected, needs rework
 * - CANCELED: Job was canceled (soft delete equivalent)
 */
export type JobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED";

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
