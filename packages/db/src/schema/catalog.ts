// Tables of the "catalog" area. Part of the schema entry packages/db/src/schema.ts.
import { sql } from "drizzle-orm";
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
  real,
} from "drizzle-orm/pg-core";
import { organization, organizationUnit, user } from "./identity";
import { assetType } from "./assets";
import { calibrationMethod } from "./methods";

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
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
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
    index("service_unit_id_idx").on(table.unitId),
    index("service_organization_id_idx").on(table.organizationId),
    index("service_method_id_idx").on(table.methodId),
    index("service_asset_type_id_idx").on(table.assetTypeId),
    index("service_is_active_idx").on(table.isActive),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("service_id_org_uidx").on(table.id, table.organizationId),
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
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    // Soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the service it documents.
    serviceId: integer("service_id").notNull(),
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
    index("service_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

// =============================================================================
// MATERIAL CATALOG - Peças e materiais (parts consumed on service orders)
// =============================================================================

/**
 * Provider-neutral parts/materials catalog. Service-order part line items
 * can reference a material to get unit/cost/price prefills and, when the
 * material is bound to an ERP product (via integrationObjectLink target
 * "catalog_item", localEntityId "material:{id}"), drive stock decrement
 * through the exported sale. `controlsStock` gates which materials ever
 * carry stock semantics — services must never fake stock fields.
 */
export const material = pgTable(
  "material",
  {
    id: serial("id").primaryKey(),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // E.g., "Célula de carga 50kg"
    description: text("description"),
    // Internal part code / SKU (also seeds the ERP product SKU when bound)
    sku: text("sku"),
    unit: text("unit").default("un").notNull(),
    // Default costs/prices in cents; line items still snapshot their own
    unitCostCents: integer("unit_cost_cents"),
    unitPriceCents: integer("unit_price_cents"),
    // Only stock-controlled materials participate in ERP stock movement
    controlsStock: boolean("controls_stock").default(false).notNull(),
    // Read-mostly snapshot of the ERP on-hand balance (stock truth lives in
    // the ERP; this mirror powers picker badges and the materials list).
    stockQuantity: real("stock_quantity"),
    stockSyncedAt: timestamp("stock_synced_at"),
    // Soft delete - never hard delete commercial data
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("material_unit_id_idx").on(table.unitId),
    index("material_organization_id_idx").on(table.organizationId),
    index("material_is_active_idx").on(table.isActive),
    uniqueIndex("material_org_sku_uidx")
      .on(table.organizationId, table.sku)
      .where(sql`${table.sku} is not null`),
  ],
);
