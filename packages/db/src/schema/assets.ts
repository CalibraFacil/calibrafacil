// Tables of the "assets" area. Part of the schema entry packages/db/src/schema.ts.
import { sql } from "drizzle-orm";
import type { AssetStatus } from "@calibra-facil/schemas/machines";
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
} from "drizzle-orm/pg-core";
import { calendarDate } from "../calendar-date";
import type { MeasurementUnit } from "@calibra-facil/shared";
import { organization, organizationUnit, user } from "./identity";
import { customer } from "./customers";

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
  type: "text" | "number" | "select" | "weighing_ranges";
  options?: string[]; // For select type
  unit?: string; // e.g., "g", "°C", "mm"
  required?: boolean;
};

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
// ASSET - Equipment/Instruments under test (EUT) from clients
// =============================================================================

/**
 * Asset status values for equipment lifecycle tracking
 */

/**
 * Provenance of an asset's customer-owned calibration interval (Track 1). The interval is
 * the equipment owner's (customer's) decision, never the lab's (ISO/IEC 17025:2017
 * §7.8.4.3 + ILAC-G24 / OIML D 10). There is deliberately NO `lab` value, and no
 * `legal_fixed` value — a legal-metrology instrument's regulation-fixed VERIFICATION
 * periodicity is a separate, independent track (`metrologyRegime` + `regulatedInterval`),
 * not a calibration-interval provenance.
 * - `customer_confirmed`: the customer set it in the portal.
 * - `engine_applied`: the customer applied a reliability-engine suggestion.
 */
export type AssetIntervalSetBy = "customer_confirmed" | "engine_applied";

/**
 * Legal-metrology regime of an instrument (Inmetro / RBMLQ-I), set by the lab as a known
 * regulatory fact (enquadramento + finalidade de uso), never inferred from assetType.
 * INDEPENDENT of the customer-owned calibration interval. `LEGAL` → the instrument has a
 * regulation-fixed verification periodicity (`regulatedInterval`); `UNKNOWN` → the lab has
 * not yet determined the enquadramento. Spec: `specs/legal-metrology-regime/spec.md`.
 */
export type MetrologyRegime = "INDUSTRIAL" | "LEGAL" | "UNKNOWN";

/**
 * Asset table - Equipment/Instruments linked to customers.
 * Each asset belongs to a customer and can have calibration history.
 */
export const asset = pgTable(
  "asset",
  {
    id: serial("id").primaryKey(),
    // Opaque, non-sequential identifier for client-facing URLs (the portal
    // routes by this instead of the enumerable serial id). Mirrors
    // serviceOrder.publicId / billingDocument.publicId.
    publicId: text("public_id")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    // Denormalized LAB organization owner (== customer.labOrganizationId). Lets
    // tag uniqueness be enforced PER ORG — UNIQUE(lab_organization_id, tag) below
    // — instead of globally, so two labs may reuse the same tag without a
    // cross-tenant collision or existence oracle. Every asset
    // write derives this from the in-scope customer's lab org; a customer's lab
    // org never changes after creation, so the invariant holds. `onDelete:
    // "cascade"` mirrors customer.labOrganizationId.
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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
    tag: text("tag").notNull(), // Internal Lab ID / Asset ID (unique per lab org — see asset_lab_org_tag_uidx)
    status: text("status").$type<AssetStatus>().default("ACTIVE").notNull(),
    baseMeasurementUnit: text("base_measurement_unit").$type<MeasurementUnit>(),
    lastCalibrationDate: calendarDate("last_calibration_date"),
    nextCalibrationDate: calendarDate("next_calibration_date"),
    // Date the instrument was installed/commissioned. Nullable. Anchors the
    // legal-metrology verification ceiling for `regulated_interval.kind =
    // 'max_months_from_install'` (hidrômetros): `next_legal_verification_date`
    // = `installed_at` + valueMonths. NULL → no fabricated date (REQ-INSTALL-003).
    installedAt: timestamp("installed_at"),
    comments: text("comments"), // Additional notes about the equipment
    // Calibration interval (periodicity) — OWNED BY THE CUSTOMER, never the lab
    // (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24 / OIML D 10). NULL = "aguardando
    // definição do cliente" (the lab does not attribute periodicity). When set,
    // `next_calibration_date` is derived = `last_calibration_date` + this many
    // months. `interval_rationale` is the required §7.5 technical record.
    calibrationIntervalMonths: integer("calibration_interval_months"),
    intervalSetBy: text("interval_set_by").$type<AssetIntervalSetBy>(),
    intervalSetAt: timestamp("interval_set_at"),
    intervalSetByUserId: text("interval_set_by_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    intervalRationale: text("interval_rationale"),
    // Legal-metrology TRACK 2 (independent of the customer-owned calibration interval
    // above): the regulation-fixed VERIFICATION periodicity for instruments under Inmetro /
    // RBMLQ-I legal control. `metrologyRegime` is the lab-set source of truth;
    // `regulatedInterval` is the structured period (validated by `RegulatedIntervalSchema`
    // at the API boundary — stored loosely like `specifications`);
    // `nextLegalVerificationDate` is derived from it and is SEPARATE from
    // `nextCalibrationDate`. Spec: `specs/legal-metrology-regime/spec.md`.
    metrologyRegime: text("metrology_regime")
      .$type<MetrologyRegime>()
      .default("INDUSTRIAL")
      .notNull(),
    regulatedInterval:
      jsonb("regulated_interval").$type<Record<string, unknown>>(),
    nextLegalVerificationDate: calendarDate("next_legal_verification_date"),
    deletedAt: timestamp("deleted_at"), // Soft delete for ISO 17025 compliance
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("asset_unit_id_idx").on(table.unitId),
    index("asset_customer_id_idx").on(table.customerId),
    index("asset_type_id_idx").on(table.assetTypeId),
    index("asset_status_idx").on(table.status),
    // Tag is unique PER LAB ORG, not globally. This composite
    // replaces the global `asset_tag_unique` constraint + `asset_tag_uidx`
    // index (dropped in migration 0082). Its leftmost column also serves as
    // the lab-org lookup index, so no separate lab_organization_id index is kept.
    uniqueIndex("asset_lab_org_tag_uidx").on(
      table.labOrganizationId,
      table.tag,
    ),
    // Partial index for the legal-verification recall sweep (migration 0075).
    index("asset_legal_verification_due_idx")
      .on(table.nextLegalVerificationDate)
      .where(sql`${table.metrologyRegime} = 'LEGAL'`),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("asset_id_org_uidx").on(table.id, table.labOrganizationId),
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
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    // Soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the "delete" row must survive the deletion of the asset it
    // documents (assets cascade when their customer is deleted), so it keeps the
    // id as a plain integer.
    assetId: integer("asset_id").notNull(),
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
    index("asset_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

// =============================================================================
// LEGAL-METROLOGY REGULATION CATALOG
// =============================================================================

/**
 * The shape of a regulation-fixed verification periodicity. Mirrors
 * `RegulatedInterval['kind']` from `@calibra-facil/schemas` (kept as a local union so
 * `schema.ts` carries no cross-package type import). Spec:
 * `specs/legal-metrology-regime/spec.md` (REQ-MLR-010/011).
 */
export type LegalMetrologyRegulationKind =
  | "fixed_months"
  | "max_months_from_install"
  | "per_technology"
  | "not_nationally_fixed";

/**
 * Provenance of a catalog row. `primary` → the period shape was confirmed against the
 * official Inmetro RTM / DOU. `secondary` → corroborated but the exact article still needs
 * operator re-confirmation before it backs a compliance certificate; the UI shows a
 * "(verificar artigo no DOU)" caveat. Spec: REQ-CATALOG-002/005.
 */
export type LegalMetrologyProvenance = "primary" | "secondary";

/**
 * Curated, in-house lookup of legal-metrology Portarias → the default regulated-interval
 * shape, so the lab regime form can auto-fill the regulated fields from a chosen regulation
 * (a default the lab can still override — the regime is use-dependent). There is no public
 * Inmetro registry, so this is seeded with provenance. GLOBAL reference data (the same
 * Portarias apply to every lab) — NOT tenant-scoped. `category` is the idempotent natural
 * key. Spec: `specs/legal-metrology-catalog/spec.md` (REQ-CATALOG-001).
 */
export const legalMetrologyRegulation = pgTable(
  "legal_metrology_regulation",
  {
    id: serial("id").primaryKey(),
    // Human label of the regulated instrument class (e.g. "Taxímetros").
    category: text("category").notNull(),
    // The period shape (reuses RegulatedInterval kinds).
    kind: text("kind").$type<LegalMetrologyRegulationKind>().notNull(),
    // Scalar months for `fixed_months` / `max_months_from_install`; NULL for
    // `per_technology` (resolved from byTechnology) and `not_nationally_fixed`.
    valueMonths: integer("value_months"),
    // Per-technology month map for `per_technology` (e.g. {"diafragma":120,...}).
    byTechnology: jsonb("by_technology").$type<Record<string, number>>(),
    // The counting anchor (last_verification / calendar_year / first_verification /
    // install_year). NULL for `not_nationally_fixed`.
    anchor: text("anchor"),
    // true → the Ipem operationalizes the cadence (derived date is indicative).
    operationalizedByDelegate: boolean("operationalized_by_delegate")
      .default(false)
      .notNull(),
    // The governing act, verbatim (e.g. "Portaria Inmetro nº 157, de 30 de março de 2022").
    regulationReference: text("regulation_reference").notNull(),
    // primary (RTM/DOU-confirmed) | secondary (needs operator re-confirmation).
    provenance: text("provenance").$type<LegalMetrologyProvenance>().notNull(),
    // Optional curator note (e.g. the distinct ANEEL regime for energia elétrica).
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("legal_metrology_regulation_category_uidx").on(table.category),
  ],
);
