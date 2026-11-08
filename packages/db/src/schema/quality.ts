// Tables of the "quality" area. Part of the schema entry packages/db/src/schema.ts.
import { sql } from "drizzle-orm";
import type {
  SpcStatus,
  PtOverallStatus,
  SignatoryAuthorizationStatus,
  TrainingStatus,
  CompetenceStatus,
  NonConformanceStatus,
  CorrectiveActionStatus,
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
  real,
  doublePrecision,
} from "drizzle-orm/pg-core";
import type {
  CmcExpressionType,
  MeasurementUnit,
  QuantityKind,
} from "@calibra-facil/shared";
import { organization, organizationUnit, user } from "./identity";
import { assetType } from "./assets";
import { referenceStandard } from "./standards";
import { calibrationJob } from "./jobs";

// =============================================================================
// ENVIRONMENTAL LIMITS - ISO 17025:2017 Clause 7.1.2
// Configurable environmental condition limits per organization/asset type
// =============================================================================

export const environmentalLimits = pgTable(
  "environmental_limits",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    // NULL = unit default; specific assetTypeId = override for that instrument type
    assetTypeId: integer("asset_type_id").references(() => assetType.id, {
      onDelete: "cascade",
    }),
    // Temperature limits (°C)
    temperatureMin: real("temperature_min"),
    temperatureMax: real("temperature_max"),
    // Humidity limits (%RH)
    humidityMin: real("humidity_min"),
    humidityMax: real("humidity_max"),
    // Pressure limits (hPa)
    pressureMin: real("pressure_min"),
    pressureMax: real("pressure_max"),
    // Audit
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("env_limits_organization_id_idx").on(table.organizationId),
    index("env_limits_unit_id_idx").on(table.unitId),
    unique("env_limits_org_unit_asset_type_uidx")
      .on(table.organizationId, table.unitId, table.assetTypeId)
      .nullsNotDistinct(),
  ],
);

// =============================================================================
// ACCREDITED SCOPE (CMC) - ISO/IEC 17025 §7.6 / §7.8.3, ILAC P14
// The lab's accredited scope: one line per grandeza × faixa × CMC, per unit
// (Cgcre accredits each laboratory site with its own scope). Certificate
// issuance is validated against these lines (see packages/shared/src/scope-compliance.ts).
// =============================================================================

export const accreditedScopeLine = pgTable(
  "accredited_scope_line",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    // Grandeza — a QuantityKind from the shared unit registry (no DB table).
    quantityKind: text("quantity_kind").$type<QuantityKind>().notNull(),
    // Faixa de medição (inclusive bounds), in rangeUnit.
    rangeMin: doublePrecision("range_min").notNull(),
    rangeMax: doublePrecision("range_max").notNull(),
    rangeUnit: text("range_unit").$type<MeasurementUnit>().notNull(),
    // CMC expression: CMC(x) = cmcA + cmcB·|x| with x in rangeUnit and the
    // result in cmcUnit ('fixed' ignores cmcB). Cgcre's "table" format is
    // just multiple lines over sub-ranges; percent-of-reading maps to cmcB.
    cmcType: text("cmc_type")
      .$type<CmcExpressionType>()
      .default("fixed")
      .notNull(),
    cmcA: doublePrecision("cmc_a").notNull(),
    cmcB: doublePrecision("cmc_b"),
    cmcUnit: text("cmc_unit").$type<MeasurementUnit>().notNull(),
    // Coverage factor the CMC is stated at (ILAC P14: k=2 / ~95 %).
    coverageFactor: doublePrecision("coverage_factor").default(2).notNull(),
    // Free-text service description, e.g. "Balanças classe II".
    description: text("description"),
    // Vigência window of this scope line; null bounds impose no constraint
    // (mirrors organization-level accreditation vigência).
    validFrom: timestamp("valid_from"),
    validUntil: timestamp("valid_until"),
    // Audit
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("accredited_scope_line_organization_id_idx").on(table.organizationId),
    index("accredited_scope_line_unit_id_idx").on(table.unitId),
  ],
);

/**
 * Append-only audit trail for scope-line edits (ISO/IEC 17025 §8.4) — a
 * Cgcre auditor will ask who changed the accredited scope and when. Soft
 * reference on purpose (no FK): rows must survive deletion of the line.
 */
export const accreditedScopeLineAuditLog = pgTable(
  "accredited_scope_line_audit_log",
  {
    id: serial("id").primaryKey(),
    // Null for org-level scope events (e.g. enforcement-mode changes) that
    // are not tied to a single line.
    scopeLineId: integer("scope_line_id"),
    // Evidence trail: a soft reference on purpose (no FK, like the other
    // audit tables), so the row survives deletion of its organization.
    organizationId: text("organization_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'delete'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
  },
  (table) => [
    index("accredited_scope_line_audit_log_line_idx").on(table.scopeLineId),
    index("accredited_scope_line_audit_log_org_idx").on(table.organizationId),
  ],
);

// =============================================================================
// CORRECTIVE ACTION (CAPA) - ISO 17025:2017 Clause 8.2 / 8.7 / 8.9
// =============================================================================

/** How the verifier of a CAPA relates to it. */
export type CapaVerificationIndependence =
  | "independent"
  | "waived_single_verifier";

/**
 * CAPA status values for lifecycle tracking
 */

/**
 * CAPA source - where the CAPA originated from
 */
export type CorrectiveActionSource =
  | "internal_audit"
  | "customer_complaint"
  | "nc_detection"
  | "external_audit"
  | "management_review"
  | "proficiency_test"
  | "spc_signal";

/**
 * CAPA type - corrective vs preventive
 */
export type CorrectiveActionType = "corrective" | "preventive";

/**
 * CAPA severity classification
 */
export type CorrectiveActionSeverity = "minor" | "major" | "critical";

/**
 * CAPA category - affected area
 */
export type CorrectiveActionCategory =
  | "method"
  | "equipment"
  | "personnel"
  | "procedure"
  | "environment"
  | "other";

/**
 * Root cause analysis method used
 */
export type RootCauseAnalysisMethod =
  | "5_whys"
  | "fishbone"
  | "pareto"
  | "other";

/**
 * Corrective Action table - Root Cause Analysis & Corrective/Preventive Actions
 * ISO 17025:2017 Clause 8.2 (Corrective Actions) / Clause 8.7 / Clause 8.9 (Improvement)
 *
 * Key concepts:
 * - Can be linked to one or more Non-Conformances (nc_detection source)
 * - Can also originate from audits, complaints, or management reviews
 * - Tracks root cause analysis, corrective action plan, and effectiveness verification
 * - Requires approval from technical manager for closure
 */
export const correctiveAction = pgTable(
  "corrective_action",
  {
    id: serial("id").primaryKey(),
    capaNumber: text("capa_number").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),

    // Source
    source: text("source")
      .$type<CorrectiveActionSource>()
      .default("nc_detection")
      .notNull(),
    sourceReference: text("source_reference"), // Job ID, complaint ID, NC number, etc.

    // Description
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    detectionDate: timestamp("detection_date"),

    // Classification
    type: text("type")
      .$type<CorrectiveActionType>()
      .default("corrective")
      .notNull(),
    severity: text("severity")
      .$type<CorrectiveActionSeverity>()
      .default("minor")
      .notNull(),
    category: text("category")
      .$type<CorrectiveActionCategory>()
      .default("procedure")
      .notNull(),

    // Root cause analysis
    rootCauseAnalysis: text("root_cause_analysis"),
    rootCauseAnalysisMethod:
      text("rca_method").$type<RootCauseAnalysisMethod>(),

    // Corrective action plan
    actionPlan: text("action_plan"),
    // Preventive measures
    preventiveMeasures: text("preventive_measures"),

    // Responsible person
    responsibleId: text("responsible_id").references(() => user.id),
    // Target date for completion
    dueDate: timestamp("due_date"),

    // Implementation tracking
    implementationEvidence: text("implementation_evidence"),
    implementedAt: timestamp("implemented_at"),

    // Investigation
    investigationCompletedAt: timestamp("investigation_completed_at"),

    // Effectiveness verification
    verifiedAt: timestamp("verified_at"),
    verifiedBy: text("verified_by").references(() => user.id),
    verificationNotes: text("verification_notes"),
    effectivenessConfirmed: boolean("effectiveness_confirmed"),
    // Independence of the verifier: "independent" when nobody tied
    // to the CAPA verified it, "waived_single_verifier" when the laboratory had no
    // other eligible verifier and the sole one verified with a written
    // justification (recorded here and in the audit entry).
    verificationIndependence: text(
      "verification_independence",
    ).$type<CapaVerificationIndependence>(),
    verificationIndependenceJustification: text(
      "verification_independence_justification",
    ),

    // Status tracking
    status: text("status")
      .$type<CorrectiveActionStatus>()
      .default("OPEN")
      .notNull(),

    // Closure
    closedAt: timestamp("closed_at"),
    closedBy: text("closed_by").references(() => user.id),

    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("capa_organization_id_idx").on(table.organizationId),
    index("capa_status_idx").on(table.status),
    index("capa_responsible_id_idx").on(table.responsibleId),
    index("capa_severity_idx").on(table.severity),
    index("capa_category_idx").on(table.category),
    index("capa_source_idx").on(table.source),
    // Numbers are per laboratory (migration 0124).
    uniqueIndex("capa_org_number_uidx").on(
      table.organizationId,
      table.capaNumber,
    ),
  ],
);

// =============================================================================
// CORRECTIVE ACTION AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for CAPA changes.
 * Tracks all modifications for compliance and traceability.
 */
export const correctiveActionAuditLog = pgTable(
  "corrective_action_audit_log",
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
    // (ISO/IEC 17025): the row must survive deletion of the corrective action.
    capaId: integer("capa_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'investigate', 'implement', 'verify', 'close'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("capa_audit_log_capa_id_idx").on(table.capaId),
    index("capa_audit_log_performed_at_idx").on(table.performedAt),
    index("corrective_action_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

// =============================================================================
// NON-CONFORMANCE - ISO 17025:2017 Clause 8.7 (Control of Nonconforming Work)
// =============================================================================

/**
 * NC type values
 */
export type NonConformanceType =
  | "work"
  | "equipment"
  | "documentation"
  | "out_of_tolerance";

/**
 * What opened the NC. Distinguishes manually filed NCs from ones opened by the
 * as-found OOT verdict on a job (§7.10 customer notification) and
 * from a reference-standard recall.
 */
export type NonConformanceTriggerSource =
  | "manual"
  | "as_found_verdict"
  | "standard_recall";

/**
 * NC disposition values
 */
export type NonConformanceDisposition =
  | "rework"
  | "scrap"
  | "use_as_is"
  | "concession";

/**
 * NC status values
 */

/**
 * Non-Conformance table - ISO 17025:2017 Clause 8.7
 * Tracks nonconforming work, equipment issues, and documentation errors.
 *
 * Key concepts:
 * - Linked optionally to a calibration job
 * - Requires disposition decision (rework, scrap, use as is, concession)
 * - "use_as_is" and "concession" require technical manager approval
 * - Can be escalated to CAPA for root cause analysis
 */
export const nonConformance = pgTable(
  "non_conformance",
  {
    id: serial("id").primaryKey(),
    ncNumber: text("nc_number").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    // Optional link to calibration job
    jobId: integer("job_id").references(() => calibrationJob.id),
    // NC classification
    type: text("type").$type<NonConformanceType>().notNull(),
    // What opened this NC (nullable — legacy rows are implicitly "manual").
    triggerSource: text("trigger_source").$type<NonConformanceTriggerSource>(),
    description: text("description").notNull(),
    // Detection
    detectedBy: text("detected_by")
      .notNull()
      .references(() => user.id),
    detectedAt: timestamp("detected_at").notNull(),
    // Disposition
    disposition: text("disposition").$type<NonConformanceDisposition>(),
    dispositionJustification: text("disposition_justification"),
    dispositionApprovedBy: text("disposition_approved_by").references(
      () => user.id,
    ),
    dispositionApprovedAt: timestamp("disposition_approved_at"),
    // Resolution
    correctionTaken: text("correction_taken"),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by").references(() => user.id),
    // Status
    status: text("status")
      .$type<NonConformanceStatus>()
      .default("open")
      .notNull(),
    // Link to CAPA (if escalated)
    capaId: integer("capa_id").references(() => correctiveAction.id),
    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("nc_organization_id_idx").on(table.organizationId),
    index("nc_job_id_idx").on(table.jobId),
    index("nc_status_idx").on(table.status),
    index("nc_type_idx").on(table.type),
    index("nc_detected_at_idx").on(table.detectedAt),
    index("nc_capa_id_idx").on(table.capaId),
    // Numbers are per laboratory (migration 0124).
    uniqueIndex("nc_org_number_uidx").on(table.organizationId, table.ncNumber),
  ],
);

// =============================================================================
// NON-CONFORMANCE AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for non-conformance changes.
 * Tracks all modifications for compliance and traceability.
 */
export const nonConformanceAuditLog = pgTable(
  "non_conformance_audit_log",
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
    // (ISO/IEC 17025): the row must survive deletion of the non-conformance.
    ncId: integer("nc_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'disposition', 'resolve', 'escalate_to_capa'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("nc_audit_log_nc_id_idx").on(table.ncId),
    index("nc_audit_log_performed_at_idx").on(table.performedAt),
    index("non_conformance_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

// =============================================================================
// PERSONNEL COMPETENCE - ISO 17025:2017 Clause 6.2.3 (Personnel Competence)
// =============================================================================

/**
 * Competence workflow status values
 */

/**
 * Training type values
 */
export type TrainingType = "internal" | "external" | "ojt" | "proficiency_test";

/**
 * Training status values
 */

/**
 * Personnel Competence table - Tracks technician qualifications per asset type
 * ISO 17025:2017 Clause 6.2.3 - Personnel competence requirements
 *
 * Key concepts:
 * - Tracks qualifications per user per asset type
 * - Full workflow: REQUESTED → TRAINING_ASSIGNED → IN_TRAINING → PENDING_EVALUATION → ACTIVE
 * - Auto-detect enforcement: skip if org has zero records, enforce once populated
 * - Supports expiration and renewal
 * - Supports cancellation before activation when qualification should not proceed
 */
export const personnelCompetence = pgTable(
  "personnel_competence",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    // ISO/IEC 17025 §6.2 competence record. userId is nullable + ON DELETE SET
    // NULL (migration 0083): a user self-deletion (Better Auth deleteUser) must
    // NOT cascade-wipe this regulated record. The beforeDelete hook soft-deletes
    // (deletedAt) + writes an audit row with an identity snapshot first, then the
    // SET NULL lets the user row go while this row survives.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    assetTypeId: integer("asset_type_id").references(() => assetType.id, {
      onDelete: "set null",
    }),
    scopeDescription: text("scope_description").notNull(),
    status: text("status")
      .$type<CompetenceStatus>()
      .default("REQUESTED")
      .notNull(),
    qualifiedAt: timestamp("qualified_at"),
    expiresAt: timestamp("expires_at"),
    certificateR2Key: text("certificate_r2_key"),
    certificateFileName: text("certificate_file_name"),
    notes: text("notes"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    evaluatedBy: text("evaluated_by").references(() => user.id),
    approvedBy: text("approved_by").references(() => user.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("competence_organization_id_idx").on(table.organizationId),
    index("competence_user_id_idx").on(table.userId),
    index("competence_asset_type_id_idx").on(table.assetTypeId),
    index("competence_status_idx").on(table.status),
    index("competence_expires_at_idx").on(table.expiresAt),
    // True DDL is a PARTIAL unique index —
    // `UNIQUE (organization_id, user_id, asset_type_id) NULLS NOT DISTINCT
    // WHERE user_id IS NOT NULL` — so a tombstoned row (user_id NULL after a
    // user's beforeDelete hook) never collides with another tombstone, while
    // ACTIVE rows keep the "one org-wide (asset_type_id NULL) row per user"
    // invariant. Confirmed (by reading the installed drizzle-orm@0.45.2
    // IndexBuilder + drizzle-kit@0.31.7 SQL generator): `nullsNotDistinct()`
    // exists ONLY on the `unique()` CONSTRAINT builder, and `.where()` exists
    // ONLY on the `uniqueIndex()` builder — neither builder supports both, and
    // drizzle-kit's DDL emitter never writes "NULLS NOT DISTINCT" for a
    // `CREATE INDEX` statement (only for `ADD CONSTRAINT ... UNIQUE`). This
    // declaration is therefore an APPROXIMATION for drizzle-kit's benefit
    // (keeps the object named/documented); the real WHERE + NULLS NOT
    // DISTINCT DDL is applied by migration 0083 (prod/dev) and by
    // `packages/db/sql/schema-extras.sql` (test harness, run once
    // after `drizzle-kit push` builds the per-run template DB).
    uniqueIndex("competence_org_user_asset_type_uidx")
      .on(table.organizationId, table.userId, table.assetTypeId)
      .where(sql`${table.userId} is not null`),
  ],
);

// =============================================================================
// TRAINING RECORD - ISO 17025:2017 Clause 6.2.3 (Training Evidence)
// =============================================================================

/**
 * Training Record table - Stores training history for personnel
 * Links to personnel competence for qualification tracking
 */
export const trainingRecord = pgTable(
  "training_record",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    // Nullable + ON DELETE SET NULL (migration 0083): a user self-deletion
    // (Better Auth deleteUser) must NOT cascade-wipe this ISO/IEC 17025 §6.2.3
    // training record (incl. the R2 certificate reference). The beforeDelete hook
    // soft-deletes (deletedAt) + audits with an identity snapshot first.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    competenceId: integer("competence_id").references(
      () => personnelCompetence.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    type: text("type").$type<TrainingType>().notNull(),
    status: text("status").$type<TrainingStatus>().default("planned").notNull(),
    provider: text("provider"),
    description: text("description"),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"),
    hoursCompleted: integer("hours_completed"),
    certificateR2Key: text("certificate_r2_key"),
    certificateFileName: text("certificate_file_name"),
    score: real("score"),
    passingScore: real("passing_score"),
    passed: boolean("passed"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("training_organization_id_idx").on(table.organizationId),
    index("training_user_id_idx").on(table.userId),
    index("training_competence_id_idx").on(table.competenceId),
    index("training_status_idx").on(table.status),
    index("training_start_date_idx").on(table.startDate),
  ],
);

// =============================================================================
// PERSONNEL COMPETENCE AUDIT LOG - ISO 17025:2017 Clause 8.4
// =============================================================================

export const personnelCompetenceAuditLog = pgTable(
  "personnel_competence_audit_log",
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
    // (ISO/IEC 17025): the row must survive deletion of the competence record
    // (which itself cascades from user self-delete), so it keeps a plain integer.
    competenceId: integer("competence_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by").notNull(),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("competence_audit_log_competence_id_idx").on(table.competenceId),
    index("competence_audit_log_performed_at_idx").on(table.performedAt),
    index("personnel_competence_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

// =============================================================================
// TRAINING RECORD AUDIT LOG - ISO 17025:2017 Clause 8.4
// =============================================================================

export const trainingRecordAuditLog = pgTable(
  "training_record_audit_log",
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
    // (ISO/IEC 17025): the row must survive deletion of the training record
    // (which itself cascades from user self-delete), so it keeps a plain integer.
    trainingRecordId: integer("training_record_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by").notNull(),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("training_audit_log_training_id_idx").on(table.trainingRecordId),
    index("training_audit_log_performed_at_idx").on(table.performedAt),
    index("training_record_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

// =============================================================================
// AUTHORIZED SIGNATORY - ISO 17025:2017 Clause 6.2.6 (Authorization of personnel)
// =============================================================================

/**
 * Signatory authorization status.
 */

/**
 * Authorized Signatory table - who may APPROVE / sign off calibration
 * certificates, optionally scoped per asset type. ISO/IEC 17025:2017 Clause 6.2.6
 * (authorization of personnel for specific lab activities, incl. issuing
 * calibration reports).
 *
 * Distinct from `personnel_competence` (which authorizes who may EXECUTE a
 * calibration): a quality/technical manager is commonly an authorized signatory
 * across scopes without holding per-asset-type execution competence.
 *
 * - assetTypeId NULL = authorized to sign across ALL scopes (org-wide signatory).
 * - Auto-detect enforcement: skip if the org has zero records, enforce once populated.
 */
export const authorizedSignatory = pgTable(
  "authorized_signatory",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    // Nullable + ON DELETE SET NULL (migration 0083): a user self-deletion
    // (Better Auth deleteUser) must NOT cascade-wipe this ISO/IEC 17025 §6.2.6
    // authorization history. The beforeDelete hook REVOKES the authorization
    // (status REVOKED + revokedAt) + audits with an identity snapshot first, so
    // the record survives with user_id NULL.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    assetTypeId: integer("asset_type_id").references(() => assetType.id, {
      onDelete: "set null",
    }),
    scopeDescription: text("scope_description"),
    /**
     * The title printed under the signature of
     * the certificates this person approves under this authorization (e.g.
     * "Signatário Autorizado — Massa"). Frozen with the certificate input.
     */
    title: text("title"),
    status: text("status")
      .$type<SignatoryAuthorizationStatus>()
      .default("ACTIVE")
      .notNull(),
    authorizedBy: text("authorized_by")
      .notNull()
      .references(() => user.id),
    authorizedAt: timestamp("authorized_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    revokedBy: text("revoked_by").references(() => user.id),
    revokedAt: timestamp("revoked_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("authorized_signatory_organization_id_idx").on(table.organizationId),
    index("authorized_signatory_user_id_idx").on(table.userId),
    index("authorized_signatory_asset_type_id_idx").on(table.assetTypeId),
    index("authorized_signatory_status_idx").on(table.status),
    index("authorized_signatory_expires_at_idx").on(table.expiresAt),
    // Same partial-unique-index rationale as
    // personnel_competence above — see that comment for the full explanation
    // of why drizzle-orm/drizzle-kit cannot express `NULLS NOT DISTINCT` on a
    // partial `uniqueIndex()`. Real DDL: migration 0083 + packages/db/sql/schema-extras.sql.
    uniqueIndex("authorized_signatory_org_user_asset_type_uidx")
      .on(table.organizationId, table.userId, table.assetTypeId)
      .where(sql`${table.userId} is not null`),
  ],
);

// =============================================================================
// AUTHORIZED SIGNATORY AUDIT LOG - ISO 17025:2017 Clause 8.4
// =============================================================================

export const authorizedSignatoryAuditLog = pgTable(
  "authorized_signatory_audit_log",
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
    // (ISO/IEC 17025 §6.2.6): the record of who was an authorized signatory must
    // survive deletion of the authorization row, so it keeps a plain integer.
    signatoryId: integer("signatory_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by").notNull(),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("authorized_signatory_audit_log_signatory_id_idx").on(
      table.signatoryId,
    ),
    index("authorized_signatory_audit_log_performed_at_idx").on(
      table.performedAt,
    ),
    index("authorized_signatory_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

// ============================================================================
// Proficiency Testing & SPC — ISO/IEC 17025 §7.7 "Ensuring the validity of
// results". PT register (7.7.2) + check-standard control charts (7.7.1).
// ============================================================================

/**
 * 17025 §7.7.2: (a) proficiency testing, (b) other interlaboratory comparisons.
 */
export type PtActivityType = "proficiency_test" | "interlab_comparison";

/**
 * Performance-score statistic per ISO 13528:2022 §9. En is the default for
 * calibration PT rounds; z/z'/zeta apply the ±2 warning / ±3 action bands.
 */
export type PtScoreType = "en" | "z" | "z_prime" | "zeta";

export type PtScoreVerdict = "satisfactory" | "questionable" | "unsatisfactory";

/**
 * One measured point of a PT round: the lab's reported value against the
 * provider's assigned value, with the computed performance score.
 */
export type PtResultPoint = {
  /** Measured point label, e.g. "100 g" or "10 V @ 1 kHz". */
  label: string;
  unit?: string | null;
  labValue: number;
  /** Lab expanded uncertainty (k=2) for En / zeta. */
  labUncertainty?: number | null;
  refValue: number;
  /** Provider expanded uncertainty (En) or sigma_pt (z-family). */
  refUncertainty?: number | null;
  sigmaPt?: number | null;
  scoreType: PtScoreType;
  score?: number | null;
  verdict?: PtScoreVerdict | null;
};

export const proficiencyTest = pgTable(
  "proficiency_test",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),

    activityType: text("activity_type")
      .$type<PtActivityType>()
      .default("proficiency_test")
      .notNull(),

    // Provider (ISO/IEC 17043; NIT-DICLA-026 §10 accreditation evidence)
    provider: text("provider").notNull(),
    providerAccreditation: text("provider_accreditation"),

    ptRound: text("pt_round").notNull(), // e.g. "PT-2026-01"
    /** "Significant part of scope" covered (NIT-DICLA-026 §9.3). */
    scopePart: text("scope_part").notNull(),
    metrologyKind: text("metrology_kind"),
    standardId: integer("standard_id").references(() => referenceStandard.id, {
      onDelete: "restrict",
    }),

    registrationDate: timestamp("registration_date"),
    participationDate: timestamp("participation_date"),
    resultReportedAt: timestamp("result_reported_at"),

    results: jsonb("results").$type<PtResultPoint[]>(),
    overallStatus: text("overall_status")
      .$type<PtOverallStatus>()
      .default("pending")
      .notNull(),

    // Set when an unsatisfactory result auto-opens a CAPA (§7.7.3)
    capaId: integer("capa_id").references(() => correctiveAction.id),

    notes: text("notes"),

    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("proficiency_test_organization_id_idx").on(table.organizationId),
    index("proficiency_test_unit_id_idx").on(table.unitId),
    index("proficiency_test_status_idx").on(table.overallStatus),
    index("proficiency_test_scope_part_idx").on(table.scopePart),
    index("proficiency_test_standard_id_idx").on(table.standardId),
  ],
);

/**
 * Risk-based PT participation plan per significant scope part
 * (NIT-DICLA-026 §9.4; default cycle 4 years per §9.2.2).
 */
export const ptPlanItem = pgTable(
  "pt_plan_item",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),

    scopePart: text("scope_part").notNull(),
    riskJustification: text("risk_justification"),
    frequencyMonths: integer("frequency_months").default(48).notNull(),

    // Denormalized from satisfactory rounds; drives due-date alerts
    lastSatisfactoryAt: timestamp("last_satisfactory_at"),
    nextDueAt: timestamp("next_due_at"),

    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("pt_plan_item_organization_id_idx").on(table.organizationId),
    index("pt_plan_item_next_due_at_idx").on(table.nextDueAt),
  ],
);

export const proficiencyTestAuditLog = pgTable(
  "proficiency_test_audit_log",
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
    // (ISO/IEC 17025): the row must survive deletion of the PT round.
    proficiencyTestId: integer("proficiency_test_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'record_results', 'escalate', 'close'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("pt_audit_log_pt_id_idx").on(table.proficiencyTestId),
    index("pt_audit_log_performed_at_idx").on(table.performedAt),
    index("proficiency_test_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);

/**
 * Raw check/working-standard readings (17025 §7.7.1). First-class rows —
 * not a jsonb array — so trends stay queryable and each point carries
 * provenance (who, when, optionally which calibration job).
 */
export const checkStandardReading = pgTable(
  "check_standard_reading",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "restrict" }),

    /** Measured point/parameter key, e.g. "100 g" — one chart per parameter. */
    parameter: text("parameter").notNull(),
    value: doublePrecision("value").notNull(),
    uncertainty: doublePrecision("uncertainty"),
    measuredAt: timestamp("measured_at").notNull(),
    /** Set when the reading was captured during a calibration job. */
    sourceJobId: integer("source_job_id"),

    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("check_standard_reading_org_idx").on(table.organizationId),
    index("check_standard_reading_standard_idx").on(
      table.standardId,
      table.parameter,
      table.measuredAt,
    ),
  ],
);

/**
 * I-MR is the default: check-standard monitoring usually yields one reading
 * per run (n=1), which X-bar/R cannot chart (NIST/SEMATECH §6.3.2).
 */
export type SpcChartType = "i_mr" | "xbar_r" | "cusum" | "ewma";

/**
 * Chart configuration. Limits are recomputed from the baseline window unless
 * frozen values are provided.
 */
export type SpcChartParams = {
  /** Number of initial in-control points used to estimate limits. */
  baselineWindow?: number | null;
  /** Frozen centerline/sigma — when set, recompute keeps them fixed. */
  centerline?: number | null;
  sigma?: number | null;
  /** Subgroup size (X-bar/R only). */
  subgroupSize?: number | null;
  /** CUSUM reference value k and decision interval h, in sigma units. */
  cusumK?: number | null;
  cusumH?: number | null;
  /** EWMA smoothing constant lambda and limit width in sigmas. */
  ewmaLambda?: number | null;
  ewmaK?: number | null;
  /** Individually toggleable detection rules (see interval-analysis/spc). */
  enabledRules?: string[] | null;
};

export type SpcRuleHit = {
  rule: string;
  severity: "trending" | "out_of_control";
  /** Indices into the evaluated reading sequence (chronological). */
  pointIndices: number[];
  description: string;
};

export type SpcEvaluationLimits = {
  centerline: number;
  sigma: number;
  ucl: number;
  lcl: number;
  /** Secondary (MR / R) chart limits when applicable. */
  secondaryUcl?: number | null;
  secondaryLcl?: number | null;
};

export type SpcEvaluation = {
  engineVersion: string;
  fingerprint: string;
  status: SpcStatus;
  sampleSize: number;
  limits?: SpcEvaluationLimits | null;
  ruleHits: SpcRuleHit[];
  evaluatedAt?: string | null;
};

export const controlChart = pgTable(
  "control_chart",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "restrict" }),
    parameter: text("parameter").notNull(),

    chartType: text("chart_type")
      .$type<SpcChartType>()
      .default("i_mr")
      .notNull(),
    params: jsonb("params").$type<SpcChartParams>(),

    status: text("status")
      .$type<SpcStatus>()
      .default("insufficient_data")
      .notNull(),
    lastEvaluation: jsonb("last_evaluation").$type<SpcEvaluation>(),
    lastEvaluatedAt: timestamp("last_evaluated_at"),

    // Set when a signal is escalated to the quality workflow
    ncId: integer("nc_id").references(() => nonConformance.id),
    capaId: integer("capa_id").references(() => correctiveAction.id),

    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("control_chart_organization_id_idx").on(table.organizationId),
    index("control_chart_status_idx").on(table.status),
    uniqueIndex("control_chart_standard_parameter_uidx").on(
      table.standardId,
      table.parameter,
    ),
  ],
);

export const controlChartAuditLog = pgTable(
  "control_chart_audit_log",
  {
    id: serial("id").primaryKey(),
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    // Soft reference on purpose — NO FK (append-only audit trail).
    controlChartId: integer("control_chart_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'recalculate', 'escalate'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("control_chart_audit_log_chart_id_idx").on(table.controlChartId),
    index("control_chart_audit_log_performed_at_idx").on(table.performedAt),
    index("control_chart_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
  ],
);
