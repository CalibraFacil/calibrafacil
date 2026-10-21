import { z } from "zod";
import {
  JobStatusSchema,
  MeasurementUnitSchema,
  ReferenceStandardKindSchema,
  UncertaintyDistributionSchema,
} from "@calibra-facil/schemas";

/**
 * Response contracts for the calibration-jobs endpoints (`/api/jobs/*`).
 *
 * These are WIRE schemas: they describe the JSON the API sends, so every
 * timestamp is an ISO string (the handlers hold `Date`s; `JSON.stringify`
 * turns them into strings). They are written from what the handlers return
 * today — nothing here changes API output.
 *
 * Rules for every schema in this file (the client relies on them):
 * - No `.default()`, `.transform()`, `.coerce`, `.preprocess()`. A schema here
 *   only ever *validates*. The client hands back the original payload once it
 *   validates, so frozen evidence (method / standards snapshots) keeps every
 *   key the server sent, including keys this contract does not know about.
 * - Object schemas stay non-strict (unknown keys allowed), so the server can
 *   add a field without breaking old clients.
 *
 * The API proves it honors a schema with `satisfies ServerShape<...>` at the
 * handler (see `ServerShape`), and an int spec parses the real response with it.
 */

// ---------------------------------------------------------------------------
// Server-side view of a wire type
// ---------------------------------------------------------------------------

/**
 * What a handler may hold before `c.json()` serializes it to the wire type `T`:
 * the same shape, except any free-form `string` may also be a `Date` (it
 * serializes to an ISO string). String literal unions stay exact, so an enum
 * drift (a new status) still fails `check-types`. Use as
 * `body satisfies ServerShape<z.infer<typeof schema>>`.
 *
 * Limitation: a `Date` returned where the schema says `string` for a
 * non-timestamp field is accepted; number/boolean/null/missing-field drift is
 * not.
 */
export type ServerShape<T> = T extends string
  ? string extends T
    ? string | Date
    : T
  : T extends readonly (infer Item)[]
    ? ServerShape<Item>[]
    : T extends object
      ? { [Key in keyof T]: ServerShape<T[Key]> }
      : T;

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const isoTimestamp = z.string();
const nullableTimestamp = z.string().nullable();
const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const jobStatusSchema = JobStatusSchema;
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const financialStatusSchema = z.enum([
  "UNBILLED",
  "DRAFT",
  "ISSUED",
  "PAID",
  "OVERDUE",
  "VOID",
]);

/** Fields `loadJobFinancialContexts` spreads onto a job (absent => omitted). */
const jobFinancialContextShape = {
  documentId: nullableNumber.optional(),
  financialStatus: financialStatusSchema.optional(),
  invoiceDocumentNumber: nullableString.optional(),
  invoiceEligibility: z.boolean().optional(),
  overdueBalanceFlag: z.boolean().optional(),
};

// ---------------------------------------------------------------------------
// Frozen evidence snapshots (ISO/IEC 17025: reproducible exactly as performed)
// ---------------------------------------------------------------------------

const massUnitSchema = z.enum(["mg", "g", "kg"]);

const methodTableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number"]),
  unit: z.string().optional(),
  role: z.enum(["standard_value", "mass_standard_composition"]).optional(),
  quantityKind: z.string().optional(),
  phase: z.enum(["before", "after", "always"]).optional(),
  massComposition: z
    .object({
      targetUnit: massUnitSchema.optional(),
      optionSource: z
        .enum(["certified_values", "composition_profiles"])
        .optional(),
      targetColumns: z
        .object({
          certifiedValue: z.string().optional(),
          compositionLabel: z.string().optional(),
          expandedUncertainty: z.string().optional(),
          maxError: z.string().optional(),
          drift: z.string().optional(),
          buoyancy: z.string().optional(),
        })
        .optional(),
      uncertaintyMode: z
        .enum(["expanded_rss", "expanded_arithmetic"])
        .optional(),
      quantityMode: z
        .enum(["linear_per_item_then_rss", "profile_linear"])
        .optional(),
    })
    .optional(),
  standardValue: z
    .object({
      matchBy: z.literal("nominal").optional(),
      targetColumns: z
        .object({
          value: z.string().optional(),
          expandedUncertainty: z.string().optional(),
          coverageFactor: z.string().optional(),
          drift: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const methodInputFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "select", "table"]),
  unit: z.string().optional(),
  quantityKind: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.union([z.string(), z.number()]).optional(),
  columns: z.array(methodTableColumnSchema).optional(),
  source: z.enum(["manual", "asset_spec"]).optional(),
  assetSpecKey: z.string().optional(),
  allowOverride: z.boolean().optional(),
  phaseBlockKey: z.string().optional(),
  phaseBlockLabel: z.string().optional(),
  eccentricityIndicator: z
    .object({
      enabled: z.boolean().optional(),
      variant: z.enum(["circular_platform", "road_scale"]).optional(),
    })
    .optional(),
  weighingRangeResolver: z
    .object({
      enabled: z.boolean().optional(),
      assetSpecKey: z.string().optional(),
      pointColumn: z.string().optional(),
      pointUnit: MeasurementUnitSchema.optional(),
      targetColumns: z
        .object({
          rangeLabel: z.string().optional(),
          rangeMin: z.string().optional(),
          rangeMax: z.string().optional(),
          rangeUnit: z.string().optional(),
          resolution: z.string().optional(),
          resolutionUnit: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const methodVariableBindingSchema = z.discriminatedUnion("source", [
  z.object({
    key: z.string(),
    label: z.string().optional(),
    source: z.literal("data_field"),
    fieldKey: z.string(),
  }),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    source: z.literal("table_statistic"),
    fieldKey: z.string(),
    columnKey: z.string(),
    statistic: z.enum(["mean", "sample_stddev", "count", "min", "max"]),
  }),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    source: z.literal("table_column"),
    fieldKey: z.string(),
    columnKey: z.string(),
  }),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    source: z.literal("environment"),
    field: z.enum(["temperature", "humidity", "pressure"]),
  }),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    source: z.literal("standard"),
    standardId: z.number().optional(),
    valueKey: z.string(),
  }),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    source: z.literal("standard_channel"),
    standardId: z.number().optional(),
    channelKey: z.string(),
    property: z.enum([
      "value",
      "correction",
      "uncertainty",
      "coverageFactor",
      "drift",
    ]),
  }),
]);

const formulaScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scalar") }),
  z.object({ kind: z.literal("table_row"), tableKey: z.string() }),
]);

const formulaReportingSchema = z.object({
  includeInCertificate: z.boolean().optional(),
  role: z
    .enum([
      "primary_result",
      "expanded_uncertainty",
      "coverage_factor",
      "conformity_margin",
      "conformity_verdict",
      "uncertainty_component",
      "auxiliary",
    ])
    .optional(),
  group: z
    .enum(["calibration_result", "uncertainty_budget", "raw_calculation"])
    .optional(),
});

const methodFormulaSchema = z.object({
  outputKey: z.string(),
  expression: z.string(),
  scope: formulaScopeSchema.optional(),
  label: z.string().optional(),
  unit: z.string().optional(),
  reporting: formulaReportingSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The part of a job's compiled method the worksheet reads (its calculation
 * formulas and acceptance criteria). `methodSnapshot.compiledMethod` itself is
 * typed `unknown` in the job schema because the database column is; a client
 * that needs it parses it with this schema (`safeParse`), once, at the point
 * of use.
 */
export const compiledMethodSnapshotSchema = z.object({
  methodFingerprint: z.string(),
  engine: z
    .object({
      version: z.string().optional(),
      optionsFingerprint: z.string().optional(),
    })
    .optional(),
  formulas: z
    .array(
      z.object({
        key: z.string(),
        label: z.string().optional(),
        expression: z.string(),
        scope: formulaScopeSchema.optional(),
        normalizedFormula: z.string().optional(),
        formulaFingerprint: z.string().optional(),
        variables: z.array(z.string()).optional(),
        outputUnit: z.string().optional(),
        reporting: formulaReportingSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  acceptanceCriteria: z
    .array(
      z.object({
        key: z.string(),
        label: z.string().optional(),
        expression: z.string(),
        severity: z.enum(["info", "warning", "blocking"]),
        message: z.string(),
        normalizedFormula: z.string().optional(),
        criterionFingerprint: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  measurementModels: z.array(z.unknown()).optional(),
});
export type CompiledMethodSnapshot = z.infer<
  typeof compiledMethodSnapshotSchema
>;

const methodValidationSchema = z.object({
  leftExpression: z.string(),
  operator: z.enum(["<", "<=", ">", ">=", "==", "!="]),
  rightExpression: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const methodTypeBComponentSchema = z.object({
  name: z.string(),
  value: z.number(),
  distribution: z.enum(["normal", "rectangular", "triangular", "u-shaped"]),
  coverageFactor: z.number().optional(),
  divisor: z.number().optional(),
  degreesOfFreedom: z.number().optional(),
});

const methodCertificateContentSchema = z.object({
  procedureCode: z.string().optional(),
  referenceStandards: z.array(z.string()).optional(),
  certifiedValuesDisplay: z.enum(["full", "hidden"]).optional(),
  massCompositionDisplay: z.enum(["full", "hidden"]).optional(),
  uncertaintyBudgetDisplay: z.enum(["full", "hidden"]).optional(),
  decisionRuleStatement: z.string().optional(),
  sections: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("paragraphs"),
          title: z.string(),
          paragraphs: z.array(z.string()),
        }),
        z.object({
          kind: z.literal("definition_list"),
          title: z.string(),
          items: z.array(
            z.object({ term: z.string(), definition: z.string() }),
          ),
        }),
        z.object({
          kind: z.literal("bullets"),
          title: z.string().optional(),
          items: z.array(z.string()),
        }),
      ]),
    )
    .optional(),
});

/** Frozen copy of the method at job creation (`calibration_job.method_snapshot`). */
export const jobMethodSnapshotSchema = z.object({
  methodId: z.number(),
  methodName: z.string(),
  methodVersion: z.number(),
  compiledMethod: z.unknown().optional(),
  methodFingerprint: nullableString.optional(),
  engineVersion: nullableString.optional(),
  engineOptionsFingerprint: nullableString.optional(),
  normalizedMethodJson: nullableString.optional(),
  publicationEvidence: z.unknown().optional(),
  dataFields: z.array(methodInputFieldSchema),
  variableBindings: z.array(methodVariableBindingSchema),
  formulas: z.array(methodFormulaSchema),
  // The measurement-model shape is owned by the method-definition compiler.
  measurementModels: z.array(z.unknown()),
  validations: z.array(methodValidationSchema),
  uncertaintyParams: z.array(methodTypeBComponentSchema),
  certificateContent: methodCertificateContentSchema.nullable().optional(),
  accreditedScope: z.boolean().optional(),
});
export type JobMethodSnapshot = z.infer<typeof jobMethodSnapshotSchema>;

const certifiedValueSchema = z.object({
  nominal: z.string(),
  authentication: nullableString.optional(),
  value: z.number(),
  uncertainty: z.number(),
  unit: z.string(),
  maxError: nullableNumber.optional(),
  drift: nullableNumber.optional(),
  buoyancy: nullableNumber.optional(),
  coverageFactor: nullableNumber.optional(),
  compositionProfile: z.boolean().optional(),
  profileKey: nullableString.optional(),
  profileClass: nullableString.optional(),
  profileQuantityAvailable: nullableNumber.optional(),
});

const metrologyPointSchema = z.object({
  reference: nullableNumber.optional(),
  indication: nullableNumber.optional(),
  meanReading: nullableNumber.optional(),
  correction: nullableNumber.optional(),
  uncertainty: nullableNumber.optional(),
  unit: z.string(),
  coverageFactor: nullableNumber.optional(),
  degreesOfFreedom: nullableNumber.optional(),
  degreesOfFreedomOperator: z
    .enum(["exact", "greater_than", "infinity"])
    .optional(),
  repeatability: nullableNumber.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const metrologyDataSchema = z.object({
  version: z.literal(1),
  channels: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      quantity: z.string(),
      value: nullableNumber.optional(),
      correction: nullableNumber.optional(),
      uncertainty: nullableNumber.optional(),
      unit: z.string(),
      coverageFactor: nullableNumber.optional(),
      drift: nullableNumber.optional(),
      notes: nullableString.optional(),
      points: z.array(metrologyPointSchema).optional(),
    }),
  ),
  massValues: z.array(
    z.object({
      nominal: z.string(),
      authentication: nullableString.optional(),
      value: z.number(),
      uncertainty: z.number(),
      unit: z.string(),
      maxError: nullableNumber.optional(),
      drift: nullableNumber.optional(),
      buoyancy: nullableNumber.optional(),
      coverageFactor: nullableNumber.optional(),
    }),
  ),
  compositionProfiles: z.array(z.unknown()),
  notes: nullableString.optional(),
});

/** One reference standard frozen at execution time (traceability, §6.5). */
export const jobStandardSnapshotSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: nullableString.optional(),
  kind: ReferenceStandardKindSchema.optional(),
  certificateNumber: z.string(),
  calibratedBy: nullableString.optional(),
  calibrationDate: isoTimestamp,
  nextCalibrationDate: nullableTimestamp,
  uncertainty: nullableNumber,
  uncertaintyUnit: nullableString,
  coverageFactor: z.number(),
  distribution: UncertaintyDistributionSchema,
  drift: nullableNumber,
  certifiedValues: z.array(certifiedValueSchema).nullable(),
  metrologyData: metrologyDataSchema.nullable().optional(),
  certificateDocument: z
    .object({
      documentId: z.number(),
      r2Key: z.string(),
      fileName: z.string(),
      fileSize: z.number(),
      sha256: z.string(),
      uploadedAt: isoTimestamp,
      certificateNumber: z.string(),
      calibrationDate: isoTimestamp,
      nextCalibrationDate: isoTimestamp,
    })
    .nullable()
    .optional(),
});
export type JobStandardSnapshot = z.infer<typeof jobStandardSnapshotSchema>;

const limitRangeSchema = z.object({ min: z.number(), max: z.number() });

export const jobEnvironmentalSnapshotSchema = z.object({
  temperature: nullableNumber,
  humidity: nullableNumber,
  pressure: nullableNumber,
  recordedAt: isoTimestamp,
  recordedBy: z.string(),
  limits: z
    .object({
      temperature: limitRangeSchema.optional(),
      humidity: limitRangeSchema.optional(),
      pressure: limitRangeSchema.optional(),
    })
    .nullable(),
  withinLimits: z.boolean(),
  outOfLimitsJustification: nullableString,
});
export type JobEnvironmentalSnapshot = z.infer<
  typeof jobEnvironmentalSnapshotSchema
>;

export const jobCalibrationLocationSnapshotSchema = z.object({
  type: z.enum(["customer_site", "lab", "other"]),
  addressText: z.string(),
  notes: nullableString.optional(),
  recordedAt: isoTimestamp,
  recordedBy: z.string(),
});
export type JobCalibrationLocationSnapshot = z.infer<
  typeof jobCalibrationLocationSnapshotSchema
>;

export const jobCalibrationPhaseSnapshotSchema = z.object({
  blocks: z.record(
    z.string(),
    z.object({
      mode: z.enum([
        "before_and_after",
        "before_only",
        "after_only",
        "not_performed",
      ]),
      reason: nullableString.optional(),
    }),
  ),
  recordedAt: isoTimestamp,
  recordedBy: z.string(),
});
export type JobCalibrationPhaseSnapshot = z.infer<
  typeof jobCalibrationPhaseSnapshotSchema
>;

export const jobAssetSnapshotSchema = z.object({
  assetId: z.number(),
  assetTypeId: z.number(),
  assetTypeName: z.string(),
  assetTypeSlug: z.string(),
  baseMeasurementUnit: MeasurementUnitSchema.nullable(),
  name: z.string(),
  tag: z.string(),
  serialNumber: z.string(),
  manufacturer: nullableString,
  model: nullableString,
  specifications: z.record(z.string(), z.unknown()).nullable(),
  capturedAt: isoTimestamp,
});
export type JobAssetSnapshot = z.infer<typeof jobAssetSnapshotSchema>;

export const scopeComplianceStatusSchema = z.enum([
  "PASS",
  "OUT_OF_SCOPE",
  "U_BELOW_CMC",
  "NOT_EVALUATED",
]);

const scopeComplianceFindingSchema = z.object({
  kind: z.enum(["out_of_scope", "u_below_cmc", "not_evaluated"]),
  pointValue: z.number(),
  pointUnit: z.string(),
  reportedU: nullableNumber,
  cmcValue: nullableNumber,
  cmcUnit: nullableString,
  scopeLineId: nullableNumber,
  message: z.string(),
});

const asFoundConformitySchema = z.enum([
  "CONFORMING",
  "NON_CONFORMING",
  "UNKNOWN",
]);

const jsonRecordSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// GET /api/jobs
// ---------------------------------------------------------------------------

export const jobListItemSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  certificateName: nullableString,
  status: jobStatusSchema,
  dueDate: nullableTimestamp,
  performedAt: nullableTimestamp,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  approvedAt: nullableTimestamp,
  customerId: z.number(),
  customerName: nullableString,
  assetId: z.number(),
  assetName: nullableString,
  assetTag: nullableString,
  serviceId: z.number(),
  serviceName: nullableString,
  technicianId: nullableString,
  technicianName: nullableString,
  // Display summary read out of the (not sent) method snapshot; omitted when
  // the snapshot carries no name / version.
  methodName: z.string().optional(),
  methodVersion: z.number().optional(),
  isOverdue: z.boolean().nullable(),
  daysUntilDue: nullableNumber,
  ...jobFinancialContextShape,
  // Desktop local-server only; the cloud API never sends it.
  syncState: nullableString.optional(),
});
export type JobListItem = z.infer<typeof jobListItemSchema>;

export const jobsListResponseSchema = z.object({
  data: z.array(jobListItemSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});
export type JobsListResponse = z.infer<typeof jobsListResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/jobs/:id
// ---------------------------------------------------------------------------

export const jobDetailSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  certificateName: nullableString,
  certificateNumberingSnapshot: jsonRecordSchema.nullable(),
  organizationId: z.string(),
  status: jobStatusSchema,
  dueDate: nullableTimestamp,
  performedAt: nullableTimestamp,
  data: jsonRecordSchema.nullable(),
  results: jsonRecordSchema.nullable(),
  standardsSnapshot: z.array(jobStandardSnapshotSchema).nullable(),
  environmentalSnapshot: jobEnvironmentalSnapshotSchema.nullable(),
  calibrationLocationSnapshot: jobCalibrationLocationSnapshotSchema.nullable(),
  calibrationPhaseSnapshot: jobCalibrationPhaseSnapshotSchema.nullable(),
  scopeComplianceStatus: scopeComplianceStatusSchema.nullable(),
  scopeComplianceFindings: z.array(scopeComplianceFindingSchema).nullable(),
  scopeOverrideJustification: nullableString,
  methodDeviations: nullableString,
  // Frozen snapshot, or (for jobs still open) one derived from the live asset.
  assetSnapshot: jobAssetSnapshotSchema.nullable(),
  certificateUrl: nullableString,
  labelUrl: nullableString,
  methodSnapshot: jobMethodSnapshotSchema,
  createdAt: isoTimestamp,
  createdBy: z.string(),
  updatedAt: isoTimestamp,
  approvedBy: nullableString,
  approvedAt: nullableTimestamp,
  rejectedBy: nullableString,
  rejectedAt: nullableTimestamp,
  rejectionReason: nullableString,
  supersedesId: nullableNumber,
  supersededById: nullableNumber,
  amendmentNumber: nullableNumber,
  amendmentReason: nullableString,
  supersededAt: nullableTimestamp,
  customerId: z.number(),
  customerName: nullableString,
  customerTaxId: nullableString,
  customerAddress: z
    .object({
      cep: z.string().optional(),
      number: z.string().optional(),
      street: z.string().optional(),
      complement: z.string().optional(),
      neighbourhood: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
    })
    .nullable(),
  labName: nullableString,
  labStreet: nullableString,
  labNumber: nullableString,
  labComplement: nullableString,
  labNeighbourhood: nullableString,
  labCity: nullableString,
  labState: nullableString,
  labCep: nullableString,
  assetId: z.number(),
  assetName: nullableString,
  assetTag: nullableString,
  assetTypeId: nullableNumber,
  assetSerialNumber: nullableString,
  assetManufacturer: nullableString,
  assetModel: nullableString,
  assetBaseMeasurementUnit: MeasurementUnitSchema.nullable(),
  assetSpecifications: jsonRecordSchema.nullable(),
  assetTypeName: nullableString,
  assetTypeSlug: nullableString,
  assetTypeDefinition: z.array(jsonRecordSchema).nullable(),
  serviceId: z.number(),
  serviceName: nullableString,
  servicePrice: nullableNumber,
  serviceTat: nullableNumber,
  technicianId: nullableString,
  technicianName: nullableString,
  approverName: nullableString,
  rejectorName: nullableString,
  isOverdue: z.boolean().nullable(),
  daysUntilDue: nullableNumber,
  ...jobFinancialContextShape,
  unitId: z.number(),
  asFoundConformity: asFoundConformitySchema.nullable(),
  asFoundMargins: z.array(z.number()).nullable(),
});
export type JobDetail = z.infer<typeof jobDetailSchema>;

// ---------------------------------------------------------------------------
// Mutations: the `data` of execute / submit / approve / reject / cancel /
// assign is the full `calibration_job` row (`.returning()`).
// ---------------------------------------------------------------------------

export const jobRowSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  certificateName: nullableString,
  certificateNumberingSnapshot: jsonRecordSchema.nullable(),
  organizationId: z.string(),
  unitId: z.number(),
  customerId: z.number(),
  assetId: z.number(),
  serviceId: z.number(),
  technicianId: nullableString,
  methodSnapshot: jobMethodSnapshotSchema,
  assetSnapshot: jobAssetSnapshotSchema.nullable(),
  status: jobStatusSchema,
  visitId: nullableNumber,
  sourceServiceOrderId: nullableNumber,
  dueDate: nullableTimestamp,
  performedAt: nullableTimestamp,
  data: jsonRecordSchema.nullable(),
  results: jsonRecordSchema.nullable(),
  asFoundConformity: asFoundConformitySchema.nullable(),
  asFoundMargins: z.array(z.number()).nullable(),
  scopeComplianceStatus: scopeComplianceStatusSchema.nullable(),
  scopeComplianceFindings: z.array(scopeComplianceFindingSchema).nullable(),
  scopeOverrideJustification: nullableString,
  methodDeviations: nullableString,
  standardsSnapshot: z.array(jobStandardSnapshotSchema).nullable(),
  environmentalSnapshot: jobEnvironmentalSnapshotSchema.nullable(),
  calibrationLocationSnapshot: jobCalibrationLocationSnapshotSchema.nullable(),
  calibrationPhaseSnapshot: jobCalibrationPhaseSnapshotSchema.nullable(),
  certificateTemplateSnapshot: jsonRecordSchema.nullable(),
  certificateUrl: nullableString,
  labelUrl: nullableString,
  verificationToken: z.string(),
  createdAt: isoTimestamp,
  createdBy: z.string(),
  updatedAt: isoTimestamp,
  approvedBy: nullableString,
  approvedAt: nullableTimestamp,
  rejectedBy: nullableString,
  rejectedAt: nullableTimestamp,
  rejectionReason: nullableString,
  supersedesId: nullableNumber,
  supersededById: nullableNumber,
  amendmentNumber: nullableNumber,
  amendmentReason: nullableString,
  supersededAt: nullableTimestamp,
  signatureMetadata: z.unknown(),
  signatureVerdict: z.unknown(),
});
export type JobRow = z.infer<typeof jobRowSchema>;

/** POST /:id/execute, /:id/submit, /:id/approve, /:id/reject, DELETE /:id, POST /:id/assign */
export const jobMutationResponseSchema = z.object({
  message: z.string(),
  data: jobRowSchema,
});
export type JobMutationResponse = z.infer<typeof jobMutationResponseSchema>;

/** POST /:id/amend */
export const jobAmendResponseSchema = z.object({
  message: z.string(),
  originalJob: z.object({
    id: z.number(),
    jobId: z.string(),
    status: z.literal("SUPERSEDED"),
  }),
  amendedJob: z.object({
    id: z.number(),
    jobId: z.string(),
    status: z.literal("DRAFT"),
    amendmentNumber: z.number(),
  }),
});
export type JobAmendResponse = z.infer<typeof jobAmendResponseSchema>;

/** GET /technicians/list */
export const jobTechniciansResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.string(),
    }),
  ),
});
export type JobTechniciansResponse = z.infer<
  typeof jobTechniciansResponseSchema
>;

/** GET /:id/download and /:id/download-label */
export const jobDownloadUrlResponseSchema = z.object({ url: z.string() });
export type JobDownloadUrlResponse = z.infer<
  typeof jobDownloadUrlResponseSchema
>;
