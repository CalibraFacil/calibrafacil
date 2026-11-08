// Tables of the "jobs" area. Part of the schema entry packages/db/src/schema.ts.
import type {
  CalibrationLocationSnapshot,
  CalibrationPhaseSnapshot,
} from "@calibra-facil/shared/calibration-record";
import { sql } from "drizzle-orm";
import type { MethodMeasurementModel } from "@calibra-facil/schemas";
import {
  pgTable,
  text,
  timestamp,
  foreignKey,
  index,
  unique,
  uniqueIndex,
  serial,
  jsonb,
  integer,
  bigint,
  customType,
} from "drizzle-orm/pg-core";
import { calendarDate } from "../calendar-date";
import type {
  MeasurementUnit,
  ScopeComplianceFinding,
  ScopeComplianceStatus,
} from "@calibra-facil/shared";
import {
  type CertificateNumberingConfig,
  organization,
  organizationUnit,
  user,
} from "./identity";
import { customer } from "./customers";
import { asset } from "./assets";
import {
  type MethodCertificateContent,
  type MethodFormula,
  type MethodInputField,
  type MethodTypeBComponent,
  type MethodValidation,
  type MethodVariableBinding,
} from "./methods";
import { service } from "./catalog";
import {
  type CertifiedValue,
  type ReferenceStandardKind,
  type ReferenceStandardMetrologyData,
  type UncertaintyDistribution,
} from "./standards";
import { calibrationVisit } from "./visits";
import { serviceOrder } from "./service-orders";

export type CertificateNumberingSnapshot = {
  profileId: number | null;
  profileName: string;
  config: CertificateNumberingConfig;
  sequenceKey: string;
  sequenceValue: number;
  generatedAt: string;
};

/** Postgres `bytea`: the hash-chain columns (migration 0131). Raw bytes on the wire. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Which renderer produced an issued certificate.
 *
 * XLSX_LEGACY is the retired lab-authored workbook path; exactly one
 * historical row carries it and no new row ever will. FIXED_LAYOUT is the
 * system-designed React layout. Reproducing an old certificate
 * means knowing which of the two made it.
 */
export type IssuedCertificateRenderPipeline = "XLSX_LEGACY" | "FIXED_LAYOUT";

/**
 * @deprecated Never written. `issued_certificate_snapshot.status` (and
 * `superseded_by_id`, `voided_*`) sit behind the append-only trigger of
 * migration 0115, so they stay at their defaults forever. The lifecycle of an
 * issued certificate is the status-event stream
 * (`issued_certificate_status_event`, migration 0132); read it, not this.
 */
export type IssuedCertificateSnapshotStatus =
  | "ISSUED"
  | "SUPERSEDED"
  | "VOIDED";

/**
 * One step of an issued certificate's life (ISO/IEC 17025 §7.8.8 amendments,
 * §7.10 nonconforming work):
 *
 * - ISSUED: the certificate was released (the worker's issuance transaction).
 * - SUPERSEDED: an amendment replaced it, written in the same transaction that
 *   issues the replacement (`supersededByJobId` names it).
 * - WITHDRAWN: the laboratory withdrew it (a recall, say); a written reason is
 *   mandatory.
 * - REINSTATED: a withdrawal was lifted; a written reason is mandatory.
 *
 * The current state is the LATEST event of the certificate.
 */
export type IssuedCertificateStatusEventType =
  | "ISSUED"
  | "SUPERSEDED"
  | "WITHDRAWN"
  | "REINSTATED";

export type CertificateXlsxRenderPolicy = {
  formulas: "preserve" | "rejectVolatile";
  macros: "reject";
  externalLinks: "reject";
  converter: "gotenberg-libreoffice";
};

/**
 * How the fixed layout was rendered. Recorded per issuance so a re-render years
 * later can be compared against the conditions that produced the stored bytes.
 */
export type CertificateFixedLayoutRenderPolicy = {
  converter: "gotenberg-chromium";
  /** Which layout component rendered it, and at which revision. */
  layoutKey: string;
  layoutVersion: string;
};

export type CertificateRenderPolicy =
  | CertificateXlsxRenderPolicy
  | CertificateFixedLayoutRenderPolicy;

export const issuedCertificateSnapshot = pgTable(
  "issued_certificate_snapshot",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "restrict" }),
    /**
     * Historical pointer to the retired lab-authored template system.
     * Nullable and FK-free since 0107: the ON DELETE RESTRICT foreign keys are
     * exactly what would block dropping those tables in 0108, but the integers
     * are kept so the provenance of an already-issued, signed certificate is
     * not destroyed. New rows leave them null.
     */
    templateId: integer("template_id"),
    templateVersionId: integer("template_version_id"),
    /** Which renderer produced this row. 0108 adds the fixed-layout identity. */
    renderPipeline: text("render_pipeline")
      .$type<IssuedCertificateRenderPipeline>()
      .default("XLSX_LEGACY")
      .notNull(),
    certificateNumber: text("certificate_number"),
    pdfR2Key: text("pdf_r2_key").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    /**
     * 0108 — which layout produced this row, so it can be re-rendered and
     * compared. Nullable because the one XLSX_LEGACY row predates them.
     */
    layoutKey: text("layout_key"),
    layoutVersion: text("layout_version"),
    rendererVersion: text("renderer_version"),
    /**
     * 0108 — the retired XLSX pipeline's provenance (workbook R2 key, its
     * sha256, the binding-manifest sha256, template ids), moved off the columns
     * rather than deleted so the single historical row still describes how it
     * was made. Null for everything the fixed layout issues.
     */
    legacyXlsx: jsonb("legacy_xlsx").$type<Record<string, unknown>>(),
    renderPolicy: jsonb("render_policy").$type<CertificateRenderPolicy>(),
    renderMetadata: jsonb("render_metadata").$type<Record<string, unknown>>(),
    inputDataSnapshot: jsonb("input_data_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    /**
     * @deprecated Dead column, kept so no data is dropped: the append-only
     * trigger (0115) makes it unwritable, so it is always "ISSUED". The
     * certificate's current state is the latest row of
     * `issued_certificate_status_event`.
     */
    status: text("status")
      .$type<IssuedCertificateSnapshotStatus>()
      .default("ISSUED")
      .notNull(),
    issuedBy: text("issued_by").references(() => user.id, {
      onDelete: "set null",
    }),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    /** @deprecated Dead column (see `status`): use the status events. */
    supersededById: integer("superseded_by_id"),
    /** @deprecated Dead column (see `status`): use the status events. */
    voidedAt: timestamp("voided_at"),
    /** @deprecated Dead column (see `status`): use the status events. */
    voidedBy: text("voided_by").references(() => user.id, {
      onDelete: "set null",
    }),
    /** @deprecated Dead column (see `status`): use the status events. */
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("issued_certificate_snapshot_org_idx").on(table.organizationId),
    uniqueIndex("issued_certificate_snapshot_job_uidx").on(table.jobId),
    index("issued_certificate_snapshot_template_idx").on(table.templateId),
    index("issued_certificate_snapshot_version_idx").on(
      table.templateVersionId,
    ),
    index("issued_certificate_snapshot_status_idx").on(table.status),
  ],
);

/**
 * The lifecycle of an issued certificate as an append-only event stream
 * (ISO/IEC 17025 §7.8.8, §7.10). Written by the issuance
 * (ISSUED), by the amendment's issuance (SUPERSEDED, on the ORIGINAL, in the
 * same transaction that issues the replacement) and by the withdraw command
 * (WITHDRAWN / REINSTATED). Never updated or deleted: the trigger of migration
 * 0132 refuses both, like the other evidence tables.
 *
 * The state of a certificate is its latest event, `deriveCertificateLifecycle`
 * in `@calibra-facil/schemas`. A certificate issued before this table has its
 * ISSUED (and SUPERSEDED) rows from the 0132 backfill.
 *
 * `certificateId` and `jobId` are RESTRICT, like the snapshot: evidence is never
 * erased by deleting what it documents.
 */
export const issuedCertificateStatusEvent = pgTable(
  "issued_certificate_status_event",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    certificateId: integer("certificate_id")
      .notNull()
      .references(() => issuedCertificateSnapshot.id, { onDelete: "restrict" }),
    /** The job whose certificate this is (denormalised for lookups by job). */
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "restrict" }),
    event: text("event").$type<IssuedCertificateStatusEventType>().notNull(),
    /** SUPERSEDED only: the job whose issuance replaced this certificate. */
    supersededByJobId: integer("superseded_by_job_id").references(
      () => calibrationJob.id,
      { onDelete: "restrict" },
    ),
    /** Mandatory for WITHDRAWN and REINSTATED (CHECK, schema-extras.sql). */
    reason: text("reason"),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Which process wrote it: the API, the worker finishing an issuance, or the 0132 backfill. */
    source: text("source").$type<"api" | "worker" | "migration">().notNull(),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  },
  (table) => [
    index("issued_certificate_status_event_cert_idx").on(
      table.certificateId,
      table.id,
    ),
    index("issued_certificate_status_event_job_idx").on(table.jobId),
    index("issued_certificate_status_event_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.jobId, table.organizationId],
      foreignColumns: [calibrationJob.id, calibrationJob.organizationId],
      name: "issued_certificate_status_event_job_id_tenant_fk",
    }).onDelete("restrict"),
  ],
);

/**
 * The frozen input of a certificate (ISO/IEC 17025 §7.8: the report reflects
 * the approved record). Written once, by the approval transaction itself, and
 * read by the worker as the only source of what the certificate says: lab
 * identity and accreditation, signatory, seal decision, customer, asset,
 * results, standards, method, layout and engine identity. See
 * `@calibra-facil/certificate-data` (`certificate-input.ts`) for the document.
 *
 * A 1:1 table keyed by (job_id, organization_id), not a column of
 * calibration_job: the document is large (it embeds the logo and the signature
 * image as data URIs, plus the execution data and results) and calibration_job
 * is read whole (`select()`) on most paths. It is immutable once the job is
 * released (trigger `certificate_input_immutable_guard`, migration 0120): the
 * only way out is the approval being reverted to REVIEW.
 *
 * `jobId` is RESTRICT, like the issued certificate snapshot: evidence is never
 * erased by deleting the job it documents.
 */
export const certificateInput = pgTable(
  "certificate_input",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "restrict" }),
    /** `CertificateInput.schemaVersion`, readable without parsing the document. */
    schemaVersion: integer("schema_version").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    /** SHA-256 (hex) of the canonical JSON of `input`; also on the approve audit row. */
    sha256: text("sha256").notNull(),
    layoutKey: text("layout_key").notNull(),
    layoutVersion: text("layout_version").notNull(),
    engineVersion: text("engine_version"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("certificate_input_job_uidx").on(table.jobId),
    index("certificate_input_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.jobId, table.organizationId],
      foreignColumns: [calibrationJob.id, calibrationJob.organizationId],
      name: "certificate_input_job_id_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export type ReferenceStandardCertificateDocumentSnapshot = {
  documentId: number;
  r2Key: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  uploadedAt: Date | string;
  certificateNumber: string;
  calibrationDate: Date | string;
  nextCalibrationDate: Date | string;
};

// =============================================================================
// CALIBRATION JOB - Work Order (ISO 17025 Operational Layer)
// =============================================================================

/**
 * Job status values for workflow tracking
 * - DRAFT: Created, not started
 * - IN_PROGRESS: Technician is executing the calibration
 * - REVIEW: Submitted for manager review
 * - GENERATING_PDF: Approved, certificate being generated async
 * - RENDER_FAILED: The certificate render failed; retried or rejected by a manager
 * - APPROVED: Certificate generated and ready
 * - REJECTED: Manager rejected, needs rework
 * - CANCELED: Job was canceled (soft delete equivalent)
 * - SUPERSEDED: Certificate was amended and replaced by a new version (ISO 17025 Clause 7.8.8)
 */
export type JobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "GENERATING_PDF"
  | "RENDER_FAILED"
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
  compiledMethod?: unknown;
  methodFingerprint?: string | null;
  engineVersion?: string | null;
  engineOptionsFingerprint?: string | null;
  normalizedMethodJson?: string | null;
  publicationEvidence?: unknown;
  dataFields: MethodInputField[];
  variableBindings: MethodVariableBinding[];
  formulas: MethodFormula[];
  measurementModels: MethodMeasurementModel[];
  validations: MethodValidation[];
  uncertaintyParams: MethodTypeBComponent[];
  certificateContent?: MethodCertificateContent | null;
  /** Frozen ISO 17025 accredited-scope flag (absent on legacy snapshots). */
  accreditedScope?: boolean;
};

export type AssetSnapshot = {
  assetId: number;
  assetTypeId: number;
  assetTypeName: string;
  assetTypeSlug: string;
  baseMeasurementUnit: MeasurementUnit | null;
  name: string;
  tag: string;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  specifications: Record<string, unknown> | null;
  capturedAt: string;
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
  type?: string | null;
  kind?: ReferenceStandardKind;
  certificateNumber: string;
  calibratedBy?: string | null;
  /** Absent on snapshots frozen before the provider was recorded (not verified). */
  calibrationProvider?: {
    accreditationNumber: string | null;
    mraRecognized: boolean;
  } | null;
  calibrationDate: Date;
  nextCalibrationDate: Date | null;
  uncertainty: number | null;
  uncertaintyUnit: string | null;
  coverageFactor: number;
  distribution: UncertaintyDistribution;
  drift: number | null;
  certifiedValues: CertifiedValue[] | null;
  metrologyData?: ReferenceStandardMetrologyData | null;
  certificateDocument?: ReferenceStandardCertificateDocumentSnapshot | null;
};

export type EnvironmentalLimitsSnapshot = {
  temperature?: { min: number; max: number };
  humidity?: { min: number; max: number };
  pressure?: { min: number; max: number };
};

export type EnvironmentalSnapshot = {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  recordedAt: string;
  recordedBy: string;
  limits: EnvironmentalLimitsSnapshot | null;
  withinLimits: boolean;
  outOfLimitsJustification: string | null;
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
    // Human-readable certificate number, unique within the laboratory.
    jobId: text("job_id").notNull(),
    // Optional human-readable/document filename generated from lab-specific
    // certificate naming rules. Older jobs keep this null and use jobId.
    certificateName: text("certificate_name"),
    certificateNumberingSnapshot: jsonb(
      "certificate_numbering_snapshot",
    ).$type<CertificateNumberingSnapshot>(),
    // Organization scope
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
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
    // Frozen copy of asset identity and specifications used by calculations
    assetSnapshot: jsonb("asset_snapshot").$type<AssetSnapshot>(),
    // Workflow status
    status: text("status").$type<JobStatus>().default("DRAFT").notNull(),
    // On-site (calibração in loco): the scheduled visit this job belongs to, when
    // it came from an on-site request. Null for in-lab jobs.
    visitId: integer("visit_id").references(() => calibrationVisit.id, {
      onDelete: "set null",
    }),
    // Source repair service order (DOM-02): when this calibration was opened
    // directly from a service order flagged "calibration required after repair"
    // (serviceOrderExecution.calibrationRequiredAfterRepair), record the link
    // back so the OS's follow-up calibration is tracked and the technician does
    // not re-enter customer/asset. Null for standalone jobs. Set-null on delete
    // so removing an OS never cascades into an issued certificate.
    sourceServiceOrderId: integer("source_service_order_id").references(
      () => serviceOrder.id,
      { onDelete: "set null" },
    ),
    // Dates
    dueDate: calendarDate("due_date"),
    performedAt: timestamp("performed_at"),
    // Execution data (filled by technician during calibration)
    data: jsonb("data").$type<Record<string, unknown>>(),
    // Calculated results (output from math engine)
    results: jsonb("results").$type<Record<string, unknown>>(),
    // As-found (pre-adjustment) conformity verdict — the reliability signal for
    // ILAC-G24 / NCSL RP-1 interval analysis. Derived ONCE at approval from the
    // frozen `results` (`margem_conformidade_antes`, NOT the as-left `_apos`) via
    // `apps/api/src/domains/jobs/as-found-reliability-verdict.ts`. UNKNOWN when the method
    // emits no as-found margin. Never feeds any certificate/approval logic.
    asFoundConformity: text("as_found_conformity").$type<
      "CONFORMING" | "NON_CONFORMING" | "UNKNOWN"
    >(),
    asFoundMargins: jsonb("as_found_margins").$type<number[]>(),
    // Accredited-scope (CMC) classification — ISO/IEC 17025 §7.6/§7.8.3,
    // ILAC P14. Stamped at submit (technician warning) and
    // re-stamped at approval (authoritative, frozen with the record) via
    // packages/shared/src/scope-compliance.ts. Null when the certificate is not accredited
    // or the lab has no scope lines configured. The stamp itself never blocks.
    scopeComplianceStatus: text(
      "scope_compliance_status",
    ).$type<ScopeComplianceStatus>(),
    scopeComplianceFindings: jsonb("scope_compliance_findings").$type<
      ScopeComplianceFinding[]
    >(),
    // Documented scope-violation override. Non-null means the
    // approver knowingly issued DESPITE an adverse classification under
    // enforce mode — and the certificate was downgraded to non-accredited
    // (shouldRenderAccreditationSeal suppresses the seal when this is set).
    scopeOverrideJustification: text("scope_override_justification"),
    /**
     * ISO/IEC 17025 §7.8.2.1(n): additions to, deviations from, or exclusions
     * from the method, as actually executed — printed on the certificate when
     * present. A DIFFERENT question from the two justifications either side of
     * it: `scopeOverrideJustification` above is an accreditation-scope
     * override that suppresses the seal, and
     * `environmentalSnapshot.outOfLimitsJustification` covers environmental
     * limits only. Recorded by whoever executed the calibration.
     */
    methodDeviations: text("method_deviations"),
    // Frozen copy of reference standards used during execution
    // This ensures traceability per ISO 17025 requirements
    standardsSnapshot: jsonb("standards_snapshot").$type<StandardSnapshot[]>(),
    // Frozen copy of environmental conditions at execution time
    // ISO 17025:2017 Clause 7.1.2 - Environmental conditions monitoring
    environmentalSnapshot: jsonb(
      "environmental_snapshot",
    ).$type<EnvironmentalSnapshot>(),
    calibrationLocationSnapshot: jsonb(
      "calibration_location_snapshot",
    ).$type<CalibrationLocationSnapshot>(),
    calibrationPhaseSnapshot: jsonb(
      "calibration_phase_snapshot",
    ).$type<CalibrationPhaseSnapshot>(),
    /**
     * Frozen record of what an APPROVED job was issued with. Regulated
     * evidence, not a link: the `certificate_template_id` FK that sat
     * beside it was dropped in 0107 with the lab-authored template system.
     *
     * Read-only history. Nothing resolves a template, and nothing fabricates a
     * snapshot: the desktop-sync path passes through what a pre-redesign desktop
     * build sent, or null, and never writes a placeholder template name, which
     * would put an invented name into regulated evidence for a certificate no
     * template produced.
     */
    certificateTemplateSnapshot: jsonb("certificate_template_snapshot").$type<
      Record<string, unknown>
    >(),
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
    // Submission tracking (ISO/IEC 17025 §6.2.4, impartiality): WHO moved the job
    // to REVIEW, and when. Written by the submit command (every entry point: cloud
    // route, public API, desktop sync) and overwritten by a resubmission, so it is
    // always the person whose work is under review. Separation of duties at
    // approval is checked against this actor, not only against the assigned
    // technician or the creator. Null on a job that never reached REVIEW and on
    // jobs approved before the column existed (migration 0134 backfills the rest
    // from `job_audit_log`). RESTRICT, not SET NULL: an approved job is frozen
    // (`calibra_calibration_job_guard`), so a referential SET NULL could not
    // rewrite it; the submitter is also named by the append-only audit row.
    submittedBy: text("submitted_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    submittedAt: timestamp("submitted_at"),
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
    // AMENDMENT TRACKING - ISO 17025:2017 Clause 7.8.8 (amendments to
    // reports; 7.8.4 covers calibration-certificate content)
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
    // ==========================================================================
    // DIGITAL SIGNATURE - ISO 17025:2017 Clause 7.8.2.1(q)
    // "Reports and certificates shall include... the signature..."
    // ==========================================================================
    /**
     * Digital signature metadata from ICP-Brasil certificate.
     * Populated after PDF signing. NULL if not signed.
     */
    signatureMetadata: jsonb("signature_metadata").$type<{
      signedAt: string; // ISO timestamp
      signerCertificateSerial: string;
      signerName: string;
      signerCpfCnpj: string | null;
      pdfHash: string; // SHA-256 hash of signed PDF
      ltvEnabled: boolean;
      // PAdES-T: RFC 3161 carimbo do tempo, when a TSA was configured.
      timestamped?: boolean;
      timestampIcpBrasilConformant?: boolean;
    }>(),
    /**
     * At-issue signature-integrity verdict (`@calibra-facil/signing` verifyPdf),
     * computed once when the certificate is signed. The public verification page
     * serves this directly and may additionally recheck the chain "now". NULL
     * when the certificate is unsigned or predates this column. Shape mirrors
     * VerifyPdfResult plus the timestamp it was computed at.
     */
    signatureVerdict: jsonb("signature_verdict").$type<{
      hashMatch: boolean | null;
      signatureCryptographicallyValid: boolean;
      chainValid: boolean;
      signerChainsToIcpRoot: boolean;
      certNotExpiredAtCheckDate: boolean;
      signaturePresent: boolean;
      // PAdES-T: optional for verdicts that predate the column.
      timestampPresent?: boolean;
      timestamp?: { time: string | null; tsaCommonName: string | null } | null;
      // Optional for verdicts computed before revocation checking.
      revocationChecked?: boolean;
      certificateRevoked?: boolean | null;
      revocationTime?: string | null;
      signer: {
        commonName: string | null;
        cpfCnpj: string | null;
        certificateSerial: string | null;
      };
      overall: "VALID" | "ALTERED" | "UNSIGNED" | "REVOKED" | "UNVERIFIABLE";
      details: string[];
      computedAt: string; // ISO timestamp
    }>(),
  },
  (table) => [
    index("job_unit_id_idx").on(table.unitId),
    index("job_organization_id_idx").on(table.organizationId),
    index("job_customer_id_idx").on(table.customerId),
    index("job_asset_id_idx").on(table.assetId),
    index("job_service_id_idx").on(table.serviceId),
    index("job_technician_id_idx").on(table.technicianId),
    index("job_status_idx").on(table.status),
    index("job_due_date_idx").on(table.dueDate),
    index("job_org_status_due_idx").on(
      table.organizationId,
      table.status,
      table.dueDate,
    ),
    index("job_org_status_approved_at_idx").on(
      table.organizationId,
      table.status,
      table.approvedAt,
    ),
    index("job_org_status_rejected_at_idx").on(
      table.organizationId,
      table.status,
      table.rejectedAt,
    ),
    index("job_org_created_at_idx").on(table.organizationId, table.createdAt),
    uniqueIndex("job_org_job_id_uidx").on(table.organizationId, table.jobId),
    // Amendment tracking indexes for efficient chain lookups
    index("job_supersedes_id_idx").on(table.supersedesId),
    // One amendment in progress per certificate: two concurrent amendments of
    // the same approved job must not both survive (ISO 17025 §7.8.8 chain). A
    // CANCELED amendment (terminal) is not "in progress": the original is still
    // the valid certificate and may be amended again (migration 0132; until
    // then the index covered every amendment ever started).
    uniqueIndex("job_supersedes_id_uidx")
      .on(table.supersedesId)
      .where(
        sql`${table.supersedesId} is not null and ${table.status} <> 'CANCELED'`,
      ),
    index("job_superseded_by_id_idx").on(table.supersededById),
    // DOM-02: resolve "does this repair OS already have a calibration opened?"
    // (the pending-after-repair queue leftJoins on this column).
    index("job_source_service_order_id_idx").on(table.sourceServiceOrderId),
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("calibration_job_id_org_uidx").on(table.id, table.organizationId),
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
    // Nullable only for the orphans of migration 0118 (audit rows of an entity that
    // was hard-deleted before the column existed); the CHECK
    // `<table>_organization_id_required ... NOT VALID` (migration 0118,
    // sql/schema-extras.sql) refuses every new row without it.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    // Soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the calibration job.
    jobId: integer("job_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'submit', 'approve', 'reject', 'cancel', 'assign', 'execute'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for rejections, cancellations, approvals
    // Tamper evidence (migration 0131): a per-organization hash chain.
    // NEVER written by the application: the BEFORE INSERT trigger
    // `job_audit_log_hash_chain` assigns all three under a per-organization advisory
    // lock (a value an insert carries is overwritten). `chain_seq` counts 1, 2, 3...
    // within the organization; `row_hash = sha256(prev_hash || canonical row)`.
    // NULL only on an orphan row of an entity hard-deleted before migration 0118
    // (no organization, so no chain). Verified by `calibra_audit_chain_verify` /
    // the daily audit-chain-verify cron / `cli/verify-audit-chain.ts`.
    chainSeq: bigint("chain_seq", { mode: "number" }),
    prevHash: bytea("prev_hash"),
    rowHash: bytea("row_hash"),
  },
  (table) => [
    index("job_audit_log_job_id_idx").on(table.jobId),
    index("job_audit_log_performed_at_idx").on(table.performedAt),
    index("job_audit_log_action_idx").on(table.action),
    index("job_audit_log_org_performed_at_idx").on(
      table.organizationId,
      table.performedAt,
    ),
    // One link per position of an organization's chain: even a trigger bypass cannot fork it.
    uniqueIndex("job_audit_log_org_chain_seq_uidx").on(
      table.organizationId,
      table.chainSeq,
    ),
  ],
);
