// Tables of the "standards" area. Part of the schema entry packages/db/src/schema.ts.
import type {
  MassProfileStatus,
  ReferenceStandardStatus,
} from "@calibra-facil/schemas/machines";
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
  doublePrecision,
} from "drizzle-orm/pg-core";
import { calendarDate } from "../calendar-date";
import { organization, organizationUnit, user } from "./identity";

// =============================================================================
// REFERENCE STANDARD - Lab's Own Calibration Equipment (ISO 17025 Clause 6.4)
// =============================================================================

/**
 * Certified value for multi-value standards (e.g., weight sets).
 * Stores individual values from a calibration certificate.
 */
export type CertifiedValue = {
  nominal: string; // Display label, e.g., "100g"
  authentication?: string | null; // Certificate row/code, e.g., "JP03-2.1"
  value: number; // Actual certified value, e.g., 100.005
  uncertainty: number; // Uncertainty for this specific value
  unit: string; // Unit, e.g., "g", "mg"
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  compositionProfile?: boolean;
  profileKey?: string | null;
  profileClass?: string | null;
  profileQuantityAvailable?: number | null;
};

/**
 * Reference Standard status for lifecycle tracking
 */

/**
 * Uncertainty distribution types
 */
export type UncertaintyDistribution = "normal" | "rectangular";

export type ReferenceStandardKind =
  | "mass_single"
  | "mass_set"
  | "thermohygrometer"
  | "thermometer"
  | "hygrometer"
  | "barometer"
  | "manometer"
  | "dimensional"
  | "electrical"
  | "time_frequency"
  | "volume"
  | "force_torque"
  | "rpm"
  | "generic_scalar"
  | "generic_multi_channel";

export type ReferenceStandardMetrologyPoint = {
  reference?: number | null;
  indication?: number | null;
  meanReading?: number | null;
  correction?: number | null;
  uncertainty?: number | null;
  unit: string;
  coverageFactor?: number | null;
  degreesOfFreedom?: number | null;
  degreesOfFreedomOperator?: "exact" | "greater_than" | "infinity";
  repeatability?: number | null;
  metadata?: Record<string, unknown>;
};

export type ReferenceStandardMetrologyChannel = {
  key: string;
  label: string;
  quantity: string;
  value?: number | null;
  correction?: number | null;
  uncertainty?: number | null;
  unit: string;
  coverageFactor?: number | null;
  drift?: number | null;
  notes?: string | null;
  points?: ReferenceStandardMetrologyPoint[];
};

export type ReferenceStandardMassValue = {
  nominal: string;
  authentication?: string | null;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
};

export type ReferenceStandardCompositionProfile = {
  profileKey: string;
  profileClass?: string | null;
  nominal: string;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  quantityAvailable?: number | null;
};

export type ReferenceStandardMetrologyData = {
  version: 1;
  channels: ReferenceStandardMetrologyChannel[];
  massValues: ReferenceStandardMassValue[];
  compositionProfiles: ReferenceStandardCompositionProfile[];
  notes?: string | null;
};

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
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(), // e.g., "Conjunto de Pesos E2"
    kind: text("kind")
      .$type<ReferenceStandardKind>()
      .default("generic_scalar")
      .notNull(),
    type: text("type"), // Optional category: "Peso", "Bloco Padrão", etc.
    serialNumber: text("serial_number").notNull(),
    manufacturer: text("manufacturer"),
    model: text("model"),
    // Certificate traceability
    certificateNumber: text("certificate_number").notNull(),
    calibratedBy: text("calibrated_by"), // Calibration lab name (traceability)
    /**
     * The provider's accreditation number and
     * whether the accreditation body is an ILAC-MRA signatory (Cgcre/RBC in
     * Brazil). The certificate asserts SI traceability only when every standard
     * used records both, with a certificate valid on the calibration day.
     */
    calibrationProviderAccreditationNumber: text(
      "calibration_provider_accreditation_number",
    ),
    calibrationProviderMraRecognized: boolean(
      "calibration_provider_mra_recognized",
    )
      .default(false)
      .notNull(),
    calibrationDate: calendarDate("calibration_date").notNull(),
    nextCalibrationDate: calendarDate("next_calibration_date").notNull(),
    // Single-value metrology data
    referenceValue: doublePrecision("reference_value"), // For single-value standards
    uncertainty: doublePrecision("uncertainty"),
    uncertaintyUnit: text("uncertainty_unit"),
    coverageFactor: doublePrecision("coverage_factor").default(2.0).notNull(),
    distribution: text("distribution")
      .$type<UncertaintyDistribution>()
      .default("normal")
      .notNull(),
    drift: doublePrecision("drift"),
    // Multi-value metrology data (for sets like weight sets, gauge blocks)
    certifiedValues: jsonb("certified_values").$type<CertifiedValue[]>(),
    metrologyData:
      jsonb("metrology_data").$type<ReferenceStandardMetrologyData>(),
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
    index("standard_unit_id_idx").on(table.unitId),
    index("standard_organization_id_idx").on(table.organizationId),
    index("standard_status_idx").on(table.status),
    index("standard_next_cal_date_idx").on(table.nextCalibrationDate),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("reference_standard_id_org_uidx").on(table.id, table.organizationId),
  ],
);

/**
 * Normalized catalog of mass composition-build profiles — the lab's available
 * buildup weights by class + nominal (e.g. M1 1g..20kg). Previously stored as a
 * byte-identical `compositionProfile: true` block copied onto every mass
 * reference_standard.certified_values; this table is the single source of
 * truth (one row per org+class+nominal, with provenance), and the runtime reads
 * profiles from here.
 */
export const massCompositionProfile = pgTable(
  "mass_composition_profile",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileKey: text("profile_key").notNull(), // runtime key, e.g. "20kg-M1"
    profileClass: text("profile_class").notNull(), // "M1" | "M2" | "F1"
    // double precision (not real): faithfully preserves the float8 values that
    // lived in certified_values JSONB, so buildMassCompositionValue is identical.
    nominalG: doublePrecision("nominal_g").notNull(), // canonical nominal mass in grams (key dimension)
    nominal: text("nominal").notNull(), // display label, e.g. "20 kg"
    value: doublePrecision("value").notNull(),
    uncertainty: doublePrecision("uncertainty").notNull(),
    unit: text("unit").default("g").notNull(),
    maxError: doublePrecision("max_error"),
    drift: doublePrecision("drift"),
    buoyancy: doublePrecision("buoyancy"),
    coverageFactor: doublePrecision("coverage_factor"),
    quantityAvailable: integer("quantity_available"),
    // Provenance: which standard/certificate these values were sourced from.
    sourceStandardId: integer("source_standard_id").references(
      () => referenceStandard.id,
      { onDelete: "set null" },
    ),
    sourceCertificate: text("source_certificate"),
    status: text("status")
      .$type<MassProfileStatus>()
      .default("ACTIVE")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("mass_composition_profile_org_idx").on(table.organizationId),
    index("mass_composition_profile_class_idx").on(
      table.organizationId,
      table.profileClass,
    ),
    uniqueIndex("mass_composition_profile_org_class_nominal_uidx").on(
      table.organizationId,
      table.profileClass,
      table.nominalG,
    ),
  ],
);

export type MassCompositionProfileRow =
  typeof massCompositionProfile.$inferSelect;

export const referenceStandardCertificateDocument = pgTable(
  "reference_standard_certificate_document",
  {
    id: serial("id").primaryKey(),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    certificateNumber: text("certificate_number").notNull(),
    calibrationDate: calendarDate("calibration_date").notNull(),
    nextCalibrationDate: calendarDate("next_calibration_date").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: integer("file_size").notNull(),
    sha256: text("sha256").notNull(),
    r2Key: text("r2_key").notNull(),
    isCurrent: boolean("is_current").default(true).notNull(),
    uploadedBy: text("uploaded_by").references(() => user.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (table) => [
    index("standard_certificate_document_standard_idx").on(table.standardId),
    index("standard_certificate_document_org_idx").on(table.organizationId),
    index("standard_certificate_document_unit_idx").on(table.unitId),
    index("standard_certificate_document_current_idx").on(
      table.standardId,
      table.isCurrent,
    ),
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
/**
 * The calibrations of a reference standard, one row per certificate: the values
 * and the validity interval each certificate gave the standard. A renewal appends a row instead of overwriting the standard, so
 * work done on a given day is judged by, and can be traced to, the certificate
 * that was valid that day. The standard's own columns keep the current one.
 *
 * Append-only evidence (trigger + REVOKE, evidence-tables.ts). `standard_id` is
 * a soft reference on purpose, like the audit log: the history outlives the
 * standard.
 */
export const referenceStandardCalibration = pgTable(
  "reference_standard_calibration",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    standardId: integer("standard_id").notNull(),
    certificateNumber: text("certificate_number").notNull(),
    calibratedBy: text("calibrated_by"),
    calibrationProviderAccreditationNumber: text(
      "calibration_provider_accreditation_number",
    ),
    calibrationProviderMraRecognized: boolean(
      "calibration_provider_mra_recognized",
    )
      .default(false)
      .notNull(),
    calibrationDate: calendarDate("calibration_date").notNull(),
    nextCalibrationDate: calendarDate("next_calibration_date").notNull(),
    referenceValue: doublePrecision("reference_value"),
    uncertainty: doublePrecision("uncertainty"),
    uncertaintyUnit: text("uncertainty_unit"),
    coverageFactor: doublePrecision("coverage_factor"),
    certifiedValues: jsonb("certified_values").$type<CertifiedValue[]>(),
    metrologyData:
      jsonb("metrology_data").$type<ReferenceStandardMetrologyData>(),
    /** 'create', 'renew' or 'backfill' (migration 0138, from the standard's row). */
    source: text("source").notNull(),
    recordedBy: text("recorded_by").references(() => user.id, {
      onDelete: "set null",
    }),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (table) => [
    index("reference_standard_calibration_standard_idx").on(
      table.organizationId,
      table.standardId,
      table.calibrationDate,
    ),
  ],
);

export const referenceStandardAuditLog = pgTable(
  "reference_standard_audit_log",
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
    // (ISO/IEC 17025): the row must survive deletion of the reference standard.
    standardId: integer("standard_id").notNull(),
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
    index("reference_standard_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);
