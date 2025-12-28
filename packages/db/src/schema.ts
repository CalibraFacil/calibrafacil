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
 * Links to Better Auth organization via authOrganizationId.
 * This is the "bridge" between business logic and identity provider.
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
    authOrganizationId: text("auth_organization_id")
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
  (table) => [index("customer_auth_org_id_idx").on(table.authOrganizationId)],
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
