// Tables of the "methods" area. Part of the schema entry packages/db/src/schema.ts.
import type { MethodStatus } from "@calibra-facil/schemas/machines";
import type { MethodMeasurementModel } from "@calibra-facil/schemas";
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
import type { MeasurementUnit } from "@calibra-facil/shared";
import { organization, user } from "./identity";
import { assetType } from "./assets";

// =============================================================================
// CALIBRATION METHOD - ISO 17025 Validated Calibration Templates
// =============================================================================

/**
 * Method status values for versioning workflow
 * - DRAFT: Work in progress, can be edited
 * - PENDING_APPROVAL: Submitted for review, locked for edits
 * - TECHNICAL_REVIEWED: Approved by technical reviewer, pending quality approval
 * - PUBLISHED: Active and immutable, used for calibrations
 * - ARCHIVED: No longer active, kept for historical reference
 */

export type MethodInputSource = "manual" | "asset_spec";

export type EccentricityIndicatorVariant = "circular_platform" | "road_scale";

export type EccentricityIndicatorConfig = {
  enabled?: boolean;
  variant?: EccentricityIndicatorVariant;
};

export type WeighingRangeResolverConfig = {
  enabled?: boolean;
  assetSpecKey?: string;
  pointColumn?: string;
  pointUnit?: MeasurementUnit;
  targetColumns?: {
    rangeLabel?: string;
    rangeMin?: string;
    rangeMax?: string;
    rangeUnit?: string;
    resolution?: string;
    resolutionUnit?: string;
  };
};

export type MethodTableColumnRole =
  | "standard_value"
  | "mass_standard_composition";

export type MassCompositionConfig = {
  targetUnit?: "mg" | "g" | "kg";
  optionSource?: "certified_values" | "composition_profiles";
  targetColumns?: {
    certifiedValue?: string;
    compositionLabel?: string;
    expandedUncertainty?: string;
    maxError?: string;
    drift?: string;
    buoyancy?: string;
  };
  uncertaintyMode?: "expanded_rss" | "expanded_arithmetic";
  quantityMode?: "linear_per_item_then_rss" | "profile_linear";
};

/**
 * Input field definition for method data collection.
 * Defines what the technician types during calibration.
 */
export type MethodInputField = {
  key: string; // Variable name, e.g., "reading_1"
  label: string; // Display label, e.g., "Reading 1"
  type: "text" | "number" | "select" | "table";
  unit?: string; // e.g., "mm", "°C"
  // Semantic role; delta-valued roles (correction/uncertainty/resolution/…)
  // convert factor-only for affine kinds. See DELTA_QUANTITY_KINDS in shared.
  quantityKind?: string;
  required?: boolean;
  options?: string[]; // For select type
  defaultValue?: string | number;
  source?: MethodInputSource;
  assetSpecKey?: string;
  allowOverride?: boolean;
  eccentricityIndicator?: EccentricityIndicatorConfig;
  weighingRangeResolver?: WeighingRangeResolverConfig;
  phaseBlockKey?: string;
  phaseBlockLabel?: string;
  // For table type only:
  columns?: Array<{
    key: string;
    label: string;
    type: "text" | "number";
    unit?: string;
    role?: MethodTableColumnRole;
    quantityKind?: string;
    phase?: "before" | "after" | "always";
    massComposition?: MassCompositionConfig;
    // NOTE: the `standard_value` per-row binding config (`standardValue`) is
    // deliberately NOT enumerated here. `data_fields` is a jsonb column, so it
    // round-trips the config either way; the authoritative validator is
    // @calibra-facil/schemas' MethodTableColumnSchema (which DOES carry it).
    // Adding the optional field to this view-only type pushes the API's inferred
    // Hono AppType past the TS7056 serialization limit.
  }>;
};

export type MethodFormulaReporting = {
  includeInCertificate?: boolean;
  role?:
    | "primary_result"
    | "expanded_uncertainty"
    | "coverage_factor"
    | "conformity_margin"
    | "conformity_verdict"
    | "uncertainty_component"
    | "auxiliary";
  group?: "calibration_result" | "uncertainty_budget" | "raw_calculation";
};

/**
 * Formula definition for computed values.
 * Defines how results are calculated from inputs.
 */
export type MethodFormula = {
  outputKey: string; // Variable name for result, e.g., "error"
  expression: string; // Math expression, e.g., "reading_1 - nominal"
  scope?: { kind: "scalar" } | { kind: "table_row"; tableKey: string };
  label?: string; // Display label, e.g., "Measurement Error"
  unit?: string;
  reporting?: MethodFormulaReporting;
  metadata?: Record<string, unknown>;
};

/**
 * Validation rule for pass/fail criteria.
 * Defines acceptance criteria per ISO 17025.
 */
export type MethodValidationOperator = "<" | "<=" | ">" | ">=" | "==" | "!=";

export type MethodValidation = {
  leftExpression: string;
  operator: MethodValidationOperator;
  rightExpression: string;
  message: string; // Message shown on failure
  severity: "error" | "warning";
  metadata?: Record<string, unknown>;
};

export type MethodVariableBinding =
  | {
      key: string;
      label?: string;
      source: "data_field";
      fieldKey: string;
    }
  | {
      key: string;
      label?: string;
      source: "table_statistic";
      fieldKey: string;
      columnKey: string;
      statistic: "mean" | "sample_stddev" | "count" | "min" | "max";
    }
  | {
      key: string;
      label?: string;
      source: "table_column";
      fieldKey: string;
      columnKey: string;
    }
  | {
      key: string;
      label?: string;
      source: "environment";
      field: "temperature" | "humidity" | "pressure";
    }
  | {
      key: string;
      label?: string;
      source: "standard";
      standardId?: number;
      valueKey: string;
    }
  | {
      key: string;
      label?: string;
      source: "standard_channel";
      standardId?: number;
      channelKey: string;
      property:
        | "value"
        | "correction"
        | "uncertainty"
        | "coverageFactor"
        | "drift";
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

export type MethodCertificateContentSection =
  | {
      kind: "paragraphs";
      title: string;
      paragraphs: string[];
    }
  | {
      kind: "definition_list";
      title: string;
      items: Array<{ term: string; definition: string }>;
    }
  | {
      kind: "bullets";
      title?: string;
      items: string[];
    };

export type MethodCertificateContent = {
  procedureCode?: string;
  referenceStandards?: string[];
  certifiedValuesDisplay?: "full" | "hidden";
  massCompositionDisplay?: "full" | "hidden";
  uncertaintyBudgetDisplay?: "full" | "hidden";
  decisionRuleStatement?: string;
  /** ISO/IEC 17025 7.8.6 / ILAC-G8; absent: undeclared (simple acceptance). */
  decisionRuleKind?: "simple_acceptance" | "guarded_acceptance" | "non_binary";
  sections?: MethodCertificateContentSection[];
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
    // ISO 17025 accredited scope: certificates issued from this method may
    // carry the accreditation seal (traceable-only methods keep this off).
    accreditedScope: boolean("accredited_scope").default(false).notNull(),
    // JSONB fields for method definition
    dataFields: jsonb("data_fields").$type<MethodInputField[]>().notNull(),
    variableBindings: jsonb("variable_bindings")
      .$type<MethodVariableBinding[]>()
      .default([])
      .notNull(),
    formulas: jsonb("formulas").$type<MethodFormula[]>().default([]).notNull(),
    measurementModels: jsonb("measurement_models")
      .$type<MethodMeasurementModel[]>()
      .default([])
      .notNull(),
    validations: jsonb("validations")
      .$type<MethodValidation[]>()
      .default([])
      .notNull(),
    uncertaintyParams: jsonb("uncertainty_params")
      .$type<MethodTypeBComponent[]>()
      .default([])
      .notNull(),
    certificateContent: jsonb(
      "certificate_content",
    ).$type<MethodCertificateContent>(),
    compiledMethod: jsonb("compiled_method").$type<unknown>(),
    methodFingerprint: text("method_fingerprint"),
    methodEngine: jsonb("method_engine").$type<unknown>(),
    methodCompiledAt: timestamp("method_compiled_at"),
    publicationEvidence: jsonb("publication_evidence").$type<unknown>(),
    // Version chain - links to the parent version
    parentId: integer("parent_id"),
    // Provenance when created from a curated template (packages/method-templates).
    // Informational only — never part of methodFingerprint (so adopting or
    // upgrading a template never changes a method's reproducible fingerprint).
    templateKey: text("template_key"),
    templateVersion: integer("template_version"),
    // Timestamps and actors
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    technicalReviewedBy: text("technical_reviewed_by").references(
      () => user.id,
      {
        onDelete: "set null",
      },
    ),
    publishedAt: timestamp("published_at"),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedBy: text("approved_by").references(() => user.id, {
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
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    // Soft reference on purpose — NO FK. The audit trail is
    // append-only (ISO/IEC 17025 §7.2): the "delete" row must survive the
    // deletion of the method it documents, so it keeps the id as a plain integer.
    methodId: integer("method_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'request_approval', 'technical_review', 'quality_approve', 'return_to_draft', 'publish', 'archive', 'new_version'
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
    index("method_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);
