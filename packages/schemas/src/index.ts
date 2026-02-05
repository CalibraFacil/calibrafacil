import { z } from "zod";

export const TaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(3, "Title must be at least 3 characters"),
  status: z.enum(["pending", "completed"]).default("pending"),
});

export type Task = z.infer<typeof TaskSchema>;

export const GetTasksQuerySchema = z.object({
  status: z.string().optional(),
});

// =============================================================================
// CUSTOMER SCHEMAS
// =============================================================================

/**
 * Address schema for customer addresses (Brazilian format)
 */
export const AddressSchema = z.object({
  cep: z.string().optional(),
  number: z.string().optional(),
  street: z.string().optional(),
  neighbourhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

export type Address = z.infer<typeof AddressSchema>;

/**
 * Schema for creating a new customer
 */
export const CreateCustomerSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  taxId: z.string().optional(),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: AddressSchema.optional(),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

/**
 * Schema for updating a customer
 */
export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;

/**
 * Schema for listing customers with pagination and search
 */
export const ListCustomersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(),
});

export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;

// =============================================================================
// PORTAL USER MANAGEMENT SCHEMAS
// =============================================================================

/**
 * Schema for inviting a portal user
 */
export const CreatePortalInvitationSchema = z.object({
  email: z.string().email("Email invalido"),
  role: z.enum(["client_user"]).default("client_user"),
});

export type CreatePortalInvitationInput = z.infer<
  typeof CreatePortalInvitationSchema
>;

/**
 * Schema for updating a portal member's role
 */
export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["client_user"]),
});

export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;

// =============================================================================
// COMPLIANCE SCHEMAS - ISO 17025:2017
// =============================================================================

/**
 * Qualification status values for ISO 17025 compliance
 */
export const QualificationStatusSchema = z.enum([
  "pending",
  "qualified",
  "suspended",
  "expired",
]);

export type QualificationStatus = z.infer<typeof QualificationStatusSchema>;

/**
 * Schema for customer compliance data
 */
export const CustomerComplianceSchema = z.object({
  qualificationStatus: QualificationStatusSchema.optional(),
  qualificationDate: z.string().optional(),
  qualificationExpiresAt: z.string().optional(),
  contractNumber: z.string().optional(),
  contractSignedAt: z.string().optional(),
  contractExpiresAt: z.string().optional(),
  qualityRequirementsAcknowledged: z.boolean().optional(),
  notes: z.string().optional(),
});

export type CustomerComplianceInput = z.infer<typeof CustomerComplianceSchema>;

/**
 * Schema for updating compliance data
 * Requires reason for audit trail (ISO 17025 clause 8.4)
 */
export const UpdateComplianceSchema = z.object({
  compliance: CustomerComplianceSchema,
  reason: z
    .string()
    .min(1, "Motivo e obrigatorio para alteracoes de conformidade"),
});

export type UpdateComplianceInput = z.infer<typeof UpdateComplianceSchema>;

/**
 * Schema for audit log query with pagination
 */
export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

// =============================================================================
// ASSET TYPE SCHEMAS - Dynamic Instrument Classification
// =============================================================================

/**
 * Field definition for dynamic asset specifications
 */
export const AssetTypeFieldSchema = z.object({
  key: z.string().min(1, "Chave é obrigatória"),
  label: z.string().min(1, "Rótulo é obrigatório"),
  type: z.enum(["text", "number", "select"]),
  options: z.array(z.string()).optional(),
  unit: z.string().optional(),
  required: z.boolean().optional(),
});

export type AssetTypeField = z.infer<typeof AssetTypeFieldSchema>;

/**
 * Schema for creating a new asset type
 */
export const CreateAssetTypeSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  slug: z
    .string()
    .min(2, "Slug deve ter pelo menos 2 caracteres")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug deve conter apenas letras minúsculas, números e hífens",
    ),
  description: z.string().optional(),
  definition: z
    .array(AssetTypeFieldSchema)
    .min(1, "Defina pelo menos um campo de especificação"),
});

export type CreateAssetTypeInput = z.infer<typeof CreateAssetTypeSchema>;

/**
 * Schema for updating an asset type
 */
export const UpdateAssetTypeSchema = CreateAssetTypeSchema.partial();

export type UpdateAssetTypeInput = z.infer<typeof UpdateAssetTypeSchema>;

/**
 * Schema for listing asset types
 */
export const ListAssetTypesQuerySchema = z.object({
  query: z.string().optional(),
});

export type ListAssetTypesQuery = z.infer<typeof ListAssetTypesQuerySchema>;

// =============================================================================
// ASSET SCHEMAS - Equipment/Instruments
// =============================================================================

/**
 * Asset status values
 */
export const AssetStatusSchema = z.enum([
  "ACTIVE",
  "INACTIVE",
  "MAINTENANCE",
  "SCRAPPED",
]);

export type AssetStatus = z.infer<typeof AssetStatusSchema>;

/**
 * Schema for creating a new asset
 */
export const CreateAssetSchema = z.object({
  customerId: z.coerce.number().min(1, "Cliente é obrigatório"),
  assetTypeId: z.coerce.number().min(1, "Tipo de instrumento é obrigatório"),
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().min(1, "Número de série é obrigatório"),
  tag: z.string().min(1, "Tag é obrigatória"),
  status: AssetStatusSchema.optional().default("ACTIVE"),
  lastCalibrationDate: z.string().optional(),
  nextCalibrationDate: z.string().optional(),
  comments: z.string().optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
});

export type CreateAssetInput = z.infer<typeof CreateAssetSchema>;

/**
 * Schema for updating an asset
 * Note: customerId and assetTypeId cannot be changed after creation
 */
export const UpdateAssetSchema = CreateAssetSchema.partial().omit({
  customerId: true,
  assetTypeId: true,
});

export type UpdateAssetInput = z.infer<typeof UpdateAssetSchema>;

/**
 * Schema for listing assets with pagination and filtering
 */
export const ListAssetsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  customerId: z.coerce.number().optional(),
  assetTypeId: z.coerce.number().optional(),
  status: AssetStatusSchema.optional(),
  query: z.string().optional(), // Search by name, tag, serialNumber
});

export type ListAssetsQuery = z.infer<typeof ListAssetsQuerySchema>;

// =============================================================================
// CALIBRATION METHOD SCHEMAS - ISO 17025 Validated Templates
// =============================================================================

/**
 * Method status values
 */
export const MethodStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export type MethodStatus = z.infer<typeof MethodStatusSchema>;

/**
 * Table column definition for table-type inputs
 */
export const MethodTableColumnSchema = z.object({
  key: z
    .string()
    .min(1, "Chave é obrigatória")
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*$/,
      "Chave deve comecar com letra e conter apenas letras, numeros e underscore",
    ),
  label: z.string().min(1, "Rotulo é obrigatório"),
  type: z.enum(["text", "number"]),
  unit: z.string().optional(),
});

export type MethodTableColumn = z.infer<typeof MethodTableColumnSchema>;

/**
 * Input field definition for method data collection
 */
export const MethodInputFieldSchema = z
  .object({
    key: z
      .string()
      .min(1, "Chave é obrigatória")
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        "Chave deve comecar com letra e conter apenas letras, numeros e underscore",
      ),
    label: z.string().min(1, "Rótulo é obrigatório"),
    type: z.enum(["text", "number", "select", "table"]),
    unit: z.string().optional(),
    required: z.boolean().optional().default(false),
    options: z.array(z.string()).optional(),
    defaultValue: z.union([z.string(), z.number()]).optional(),
    columns: z.array(MethodTableColumnSchema).optional(),
  })
  .refine(
    (data) => {
      // If type is "select", options must be provided
      if (
        data.type === "select" &&
        (!data.options || data.options.length === 0)
      ) {
        return false;
      }
      return true;
    },
    { message: "Opcoes sao obrigatorias para campos do tipo 'select'" },
  )
  .refine(
    (data) => {
      // If type is "table", columns must be provided
      if (
        data.type === "table" &&
        (!data.columns || data.columns.length === 0)
      ) {
        return false;
      }
      return true;
    },
    { message: "Colunas sao obrigatorias para campos do tipo 'table'" },
  );

export type MethodInputField = z.infer<typeof MethodInputFieldSchema>;

/**
 * Formula definition for computed values
 */
export const MethodFormulaSchema = z.object({
  outputKey: z
    .string()
    .min(1, "Chave de saida é obrigatória")
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*$/,
      "Chave deve comecar com letra e conter apenas letras, numeros e underscore",
    ),
  expression: z.string().min(1, "Expressão é obrigatória"),
  label: z.string().optional(),
  unit: z.string().optional(),
});

export type MethodFormula = z.infer<typeof MethodFormulaSchema>;

/**
 * Validation rule for pass/fail criteria
 */
export const MethodValidationSchema = z.object({
  expression: z.string().min(1, "Expressão é obrigatória"),
  message: z.string().min(1, "Mensagem é obrigatória"),
  severity: z.enum(["error", "warning"]),
});

export type MethodValidation = z.infer<typeof MethodValidationSchema>;

/**
 * Type B uncertainty component for method defaults
 */
export const MethodTypeBComponentSchema = z.object({
  name: z.string().min(1, "Nome e obrigatorio"),
  value: z.number().positive("Valor deve ser positivo"),
  distribution: z.enum(["normal", "rectangular", "triangular", "u-shaped"]),
  coverageFactor: z.number().positive().optional(),
  divisor: z.number().positive().optional(),
  degreesOfFreedom: z.number().positive().optional().default(50),
});

export type MethodTypeBComponent = z.infer<typeof MethodTypeBComponentSchema>;

/**
 * Schema for creating a new method
 */
export const CreateMethodSchema = z.object({
  assetTypeId: z.coerce.number().optional(),
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  description: z.string().optional(),
  dataFields: z
    .array(MethodInputFieldSchema)
    .min(1, "Defina pelo menos um campo de entrada"),
  formulas: z.array(MethodFormulaSchema).default([]),
  validations: z.array(MethodValidationSchema).default([]),
  uncertaintyParams: z.array(MethodTypeBComponentSchema).default([]),
});

export type CreateMethodInput = z.infer<typeof CreateMethodSchema>;

/**
 * Schema for updating a method (only DRAFT status)
 */
export const UpdateMethodSchema = CreateMethodSchema.partial();

export type UpdateMethodInput = z.infer<typeof UpdateMethodSchema>;

/**
 * Schema for listing methods with pagination and filtering
 */
export const ListMethodsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: MethodStatusSchema.optional(),
  assetTypeId: z.coerce.number().optional(),
  query: z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
});

export type ListMethodsQuery = z.infer<typeof ListMethodsQuerySchema>;

// =============================================================================
// SERVICE SCHEMAS - Commercial Service Catalog (Product Registry)
// =============================================================================

/**
 * Schema for creating a new service
 * Price is stored in cents (e.g., 15000 = R$ 150,00)
 * Nullable price means "Call for Quote" / "Sob Consulta"
 */
export const CreateServiceSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  description: z.string().optional(),
  methodId: z.coerce.number().optional().nullable(),
  assetTypeId: z.coerce.number().optional().nullable(),
  price: z.coerce
    .number()
    .int("Preço deve ser um número inteiro (centavos)")
    .min(0, "Preço não pode ser negativo")
    .optional()
    .nullable(),
  currency: z.string().default("BRL"),
  tat: z.coerce
    .number()
    .int("Prazo deve ser um número inteiro")
    .min(1, "Prazo deve ser pelo menos 1 dia")
    .optional()
    .nullable(),
  isActive: z.boolean().optional().default(true),
});

export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;

/**
 * Schema for updating a service
 */
export const UpdateServiceSchema = CreateServiceSchema.partial();

export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;

/**
 * Schema for listing services with filtering
 */
export const ListServicesQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(),
  assetTypeId: z.coerce.number().optional(),
  methodId: z.coerce.number().optional(),
  isActive: z
    .string()
    .optional()
    .transform((val) => {
      if (val === "true") return true;
      if (val === "false") return false;
      return undefined;
    }),
});

export type ListServicesQuery = z.infer<typeof ListServicesQuerySchema>;

// =============================================================================
// REFERENCE STANDARD SCHEMAS - Lab Equipment Registry (ISO 17025 Clause 6.4)
// =============================================================================

/**
 * Reference Standard status values
 */
export const ReferenceStandardStatusSchema = z.enum([
  "ACTIVE",
  "INACTIVE",
  "OUT_OF_TOLERANCE",
  "SENT_FOR_CALIBRATION",
]);

export type ReferenceStandardStatus = z.infer<
  typeof ReferenceStandardStatusSchema
>;

/**
 * Uncertainty distribution types
 */
export const UncertaintyDistributionSchema = z.enum(["normal", "rectangular"]);

export type UncertaintyDistribution = z.infer<
  typeof UncertaintyDistributionSchema
>;

/**
 * Certified value for multi-value standards (e.g., weight sets, gauge block sets)
 * Each entry represents one value from the calibration certificate
 */
export const CertifiedValueSchema = z.object({
  nominal: z.string().min(1, "Valor nominal e obrigatorio"),
  value: z.coerce.number({ message: "Valor certificado e obrigatorio" }),
  uncertainty: z.coerce.number().positive("Incerteza deve ser positiva"),
  unit: z.string().min(1, "Unidade e obrigatoria"),
});

export type CertifiedValue = z.infer<typeof CertifiedValueSchema>;

/**
 * Schema for creating a new reference standard
 * Supports both single-value and multi-value (set) standards
 */
export const CreateReferenceStandardSchema = z
  .object({
    name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
    type: z.string().optional(), // Optional category: "Peso", "Bloco Padrão", etc.
    serialNumber: z.string().min(1, "Número de série é obrigatório"),
    manufacturer: z.string().optional(),
    model: z.string().optional(),
    // Certificate traceability
    certificateNumber: z.string().min(1, "Número do certificado é obrigatório"),
    calibratedBy: z.string().optional(),
    calibrationDate: z.string().min(1, "Data de calibração é obrigatória"),
    nextCalibrationDate: z.string().min(1, "Próxima calibração é obrigatória"),
    // Single-value metrology data (optional if using certifiedValues)
    referenceValue: z.coerce.number().optional().nullable(),
    uncertainty: z.coerce.number().positive().optional().nullable(),
    uncertaintyUnit: z.string().optional().nullable(),
    coverageFactor: z.coerce.number().positive().default(2.0),
    distribution: UncertaintyDistributionSchema.default("normal"),
    drift: z.coerce.number().optional().nullable(),
    // Multi-value metrology data (for sets)
    certifiedValues: z.array(CertifiedValueSchema).optional().nullable(),
    // Status
    status: ReferenceStandardStatusSchema.default("ACTIVE"),
  })
  .refine(
    (data) => {
      // Must have either single-value data OR certifiedValues array
      const hasSingleValue =
        data.referenceValue != null && data.uncertainty != null;
      const hasMultiValue =
        data.certifiedValues && data.certifiedValues.length > 0;
      return hasSingleValue || hasMultiValue;
    },
    {
      message:
        "Informe o valor de referencia e incerteza, ou os valores certificados do conjunto",
    },
  );

export type CreateReferenceStandardInput = z.infer<
  typeof CreateReferenceStandardSchema
>;

/**
 * Schema for updating a reference standard
 */
export const UpdateReferenceStandardSchema = z.object({
  name: z.string().min(2).optional(),
  type: z.string().optional().nullable(),
  serialNumber: z.string().min(1).optional(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  certificateNumber: z.string().min(1).optional(),
  calibratedBy: z.string().optional().nullable(),
  calibrationDate: z.string().optional(),
  nextCalibrationDate: z.string().optional(),
  referenceValue: z.coerce.number().optional().nullable(),
  uncertainty: z.coerce.number().positive().optional().nullable(),
  uncertaintyUnit: z.string().optional().nullable(),
  coverageFactor: z.coerce.number().positive().optional(),
  distribution: UncertaintyDistributionSchema.optional(),
  drift: z.coerce.number().optional().nullable(),
  certifiedValues: z.array(CertifiedValueSchema).optional().nullable(),
  status: ReferenceStandardStatusSchema.optional(),
});

export type UpdateReferenceStandardInput = z.infer<
  typeof UpdateReferenceStandardSchema
>;

/**
 * Schema for renewing a reference standard's calibration certificate
 * This is a special action that requires a reason for audit purposes
 */
export const RenewCertificateSchema = z.object({
  certificateNumber: z.string().min(1, "Número do certificado é obrigatório"),
  calibratedBy: z.string().optional(),
  calibrationDate: z.string().min(1, "Data de calibração é obrigatória"),
  nextCalibrationDate: z.string().min(1, "Próxima calibração é obrigatória"),
  // Updated metrology data
  referenceValue: z.coerce.number().optional().nullable(),
  uncertainty: z.coerce.number().positive().optional().nullable(),
  uncertaintyUnit: z.string().optional().nullable(),
  coverageFactor: z.coerce.number().positive().optional(),
  certifiedValues: z.array(CertifiedValueSchema).optional().nullable(),
  // Required for audit trail (ISO 17025)
  reason: z.string().min(1, "Motivo da renovacao e obrigatorio"),
});

export type RenewCertificateInput = z.infer<typeof RenewCertificateSchema>;

/**
 * Schema for listing reference standards with pagination and filtering
 */
export const ListReferenceStandardsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(), // Search by name, serialNumber
  status: ReferenceStandardStatusSchema.optional(),
  expiringWithinDays: z.coerce.number().optional(), // Filter by upcoming calibration due date
});

export type ListReferenceStandardsQuery = z.infer<
  typeof ListReferenceStandardsQuerySchema
>;

// =============================================================================
// CALIBRATION JOB SCHEMAS - Work Order (ISO 17025 Operational Layer)
// =============================================================================

/**
 * Job status values for workflow tracking
 * - SUPERSEDED: Certificate was amended and replaced (ISO 17025 Clause 7.8.4.1)
 */
export const JobStatusSchema = z.enum([
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
  "GENERATING_PDF",
  "APPROVED",
  "REJECTED",
  "CANCELED",
  "SUPERSEDED",
]);

export type JobStatus = z.infer<typeof JobStatusSchema>;

/**
 * Method Snapshot schema - Frozen copy of method at job creation
 * This is read-only after job creation (never modified)
 */
export const MethodSnapshotSchema = z.object({
  methodId: z.number(),
  methodName: z.string(),
  methodVersion: z.number(),
  dataFields: z.array(MethodInputFieldSchema),
  formulas: z.array(MethodFormulaSchema),
  validations: z.array(MethodValidationSchema),
  uncertaintyParams: z.array(MethodTypeBComponentSchema),
});

export type MethodSnapshot = z.infer<typeof MethodSnapshotSchema>;

/**
 * Schema for creating a new calibration job
 * The method snapshot is created server-side from the service's linked method
 */
export const CreateJobSchema = z.object({
  assetId: z.coerce.number().min(1, "Ativo e obrigatorio"),
  serviceId: z.coerce.number().min(1, "Servico e obrigatorio"),
  technicianId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(), // ISO date string
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;

/**
 * Schema for updating a calibration job
 * Only basic fields can be updated (not the method snapshot)
 */
export const UpdateJobSchema = z.object({
  technicianId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  status: JobStatusSchema.optional(),
});

export type UpdateJobInput = z.infer<typeof UpdateJobSchema>;

/**
 * Schema for assigning a technician to a job
 */
export const AssignTechnicianSchema = z.object({
  technicianId: z.string().min(1, "Tecnico e obrigatorio"),
});

export type AssignTechnicianInput = z.infer<typeof AssignTechnicianSchema>;

/**
 * Schema for submitting job data (execution by technician)
 * The data structure matches the method's dataFields definition
 */
export const SubmitJobDataSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export type SubmitJobDataInput = z.infer<typeof SubmitJobDataSchema>;

/**
 * Schema for submitting job for review
 */
export const SubmitForReviewSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export type SubmitForReviewInput = z.infer<typeof SubmitForReviewSchema>;

/**
 * Schema for approving a job
 */
export const ApproveJobSchema = z.object({
  reason: z.string().optional(), // Optional approval notes
});

export type ApproveJobInput = z.infer<typeof ApproveJobSchema>;

/**
 * Schema for rejecting a job
 */
export const RejectJobSchema = z.object({
  reason: z.string().min(1, "Motivo da rejeicao e obrigatorio"),
});

export type RejectJobInput = z.infer<typeof RejectJobSchema>;

/**
 * Schema for canceling a job
 */
export const CancelJobSchema = z.object({
  reason: z.string().min(1, "Motivo do cancelamento e obrigatorio"),
});

export type CancelJobInput = z.infer<typeof CancelJobSchema>;

/**
 * Schema for amending a job (ISO 17025 Clause 7.8.4.1)
 * Creates a corrected version of an approved certificate
 */
export const AmendJobSchema = z.object({
  reason: z
    .string()
    .min(10, "Motivo da retificacao deve ter pelo menos 10 caracteres"),
});

export type AmendJobInput = z.infer<typeof AmendJobSchema>;

/**
 * Standard Snapshot schema - Frozen copy of reference standard at execution
 * This is read-only after job execution (never modified)
 */
export const StandardSnapshotSchema = z.object({
  id: z.number(),
  name: z.string(),
  certificateNumber: z.string(),
  calibrationDate: z.string(),
  uncertainty: z.number().nullable(),
  uncertaintyUnit: z.string().nullable(),
  coverageFactor: z.number(),
  distribution: UncertaintyDistributionSchema,
  drift: z.number().nullable(),
  certifiedValues: z.array(CertifiedValueSchema).nullable(),
});

export type StandardSnapshot = z.infer<typeof StandardSnapshotSchema>;

/**
 * Schema for executing a job (saving worksheet data)
 * Includes selected reference standards for ISO 17025 traceability
 */
export const ExecuteJobSchema = z.object({
  selectedStandardIds: z.array(z.number()).optional(),
  data: z.record(z.string(), z.unknown()),
  results: z.record(z.string(), z.unknown()).optional(),
});

export type ExecuteJobInput = z.infer<typeof ExecuteJobSchema>;

/**
 * Schema for listing jobs with pagination and filtering
 */
export const ListJobsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(), // Search by jobId
  status: JobStatusSchema.optional(),
  customerId: z.coerce.number().optional(),
  assetId: z.coerce.number().optional(),
  serviceId: z.coerce.number().optional(),
  technicianId: z.string().optional(),
  dateFrom: z.string().optional(), // ISO date string
  dateTo: z.string().optional(), // ISO date string
  dueSoon: z.coerce.boolean().optional(), // Filter jobs due in next 7 days
  overdue: z.coerce.boolean().optional(), // Filter overdue jobs
});

export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;

// =============================================================================
// NOTIFICATION SCHEMAS - In-App & Email Notifications (ISO 17025 Compliance)
// =============================================================================

/**
 * Notification type enum
 */
export const NotificationTypeSchema = z.enum([
  "JOB_SUBMITTED_FOR_REVIEW",
  "JOB_APPROVED",
  "JOB_REJECTED",
  "JOB_ASSIGNED",
  "CERTIFICATE_READY",
  "CERTIFICATE_AMENDED", // ISO 17025 Clause 7.8.4.1 - Certificate amendment notification
  "ASSET_DUE_FOR_RECALIBRATION",
  "STANDARD_EXPIRING",
  "JOB_OVERDUE",
  "PAYMENT_RECEIVED",
  "PAYMENT_FAILED",
  "NC_CREATED", // ISO 17025 Clause 8.7 - New non-conformance registered
  "NC_ESCALATED_TO_CAPA", // ISO 17025 Clause 8.7 - NC escalated to CAPA
]);

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * Notification status values
 */
export const NotificationStatusSchema = z.enum(["UNREAD", "READ", "ARCHIVED"]);

export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

/**
 * Notification priority levels
 */
export const NotificationPrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export type NotificationPriority = z.infer<typeof NotificationPrioritySchema>;

/**
 * Schema for listing notifications with pagination and filters
 */
export const ListNotificationsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: NotificationStatusSchema.optional(),
  type: NotificationTypeSchema.optional(),
  priority: NotificationPrioritySchema.optional(),
});

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * Schema for marking notifications as read
 */
export const MarkNotificationsReadSchema = z.object({
  notificationIds: z.array(z.number()).min(1, "Selecione ao menos uma notificacao"),
});

export type MarkNotificationsReadInput = z.infer<typeof MarkNotificationsReadSchema>;

/**
 * Individual notification channel preference
 */
export const NotificationChannelPreferenceSchema = z.object({
  inApp: z.boolean().default(true),
  email: z.boolean().default(true),
});

export type NotificationChannelPreference = z.infer<typeof NotificationChannelPreferenceSchema>;

/**
 * Full notification preferences map
 * Note: Using z.string() for keys to avoid z.record(enum, ...) validation issues
 * The application layer handles unknown keys gracefully
 */
export const NotificationPreferencesMapSchema = z.record(
  z.string(),
  NotificationChannelPreferenceSchema,
);

export type NotificationPreferencesMap = z.infer<typeof NotificationPreferencesMapSchema>;

/**
 * Digest frequency options
 */
export const DigestFrequencySchema = z.enum(["NONE", "DAILY", "WEEKLY"]);

export type DigestFrequency = z.infer<typeof DigestFrequencySchema>;

/**
 * Schema for updating notification preferences
 */
export const UpdateNotificationPreferencesSchema = z.object({
  preferences: NotificationPreferencesMapSchema.optional(),
  emailEnabled: z.boolean().optional(),
  notifySelfActions: z.boolean().optional(),
  digestFrequency: DigestFrequencySchema.optional(),
});

export type UpdateNotificationPreferencesInput = z.infer<typeof UpdateNotificationPreferencesSchema>;

// =============================================================================
// NON-CONFORMANCE SCHEMAS - ISO 17025:2017 Clause 8.7
// =============================================================================

/**
 * NC type values
 */
export const NonConformanceTypeSchema = z.enum([
  "work",
  "equipment",
  "documentation",
]);

export type NonConformanceType = z.infer<typeof NonConformanceTypeSchema>;

/**
 * NC disposition values
 */
export const NonConformanceDispositionSchema = z.enum([
  "rework",
  "scrap",
  "use_as_is",
  "concession",
]);

export type NonConformanceDisposition = z.infer<typeof NonConformanceDispositionSchema>;

/**
 * NC status values
 */
export const NonConformanceStatusSchema = z.enum([
  "open",
  "under_review",
  "resolved",
]);

export type NonConformanceStatus = z.infer<typeof NonConformanceStatusSchema>;

/**
 * Schema for creating a new non-conformance
 */
export const CreateNonConformanceSchema = z.object({
  jobId: z.coerce.number().optional().nullable(),
  type: NonConformanceTypeSchema,
  description: z.string().min(10, "Descricao deve ter pelo menos 10 caracteres"),
  detectedAt: z.string().min(1, "Data de deteccao e obrigatoria"),
});

export type CreateNonConformanceInput = z.infer<typeof CreateNonConformanceSchema>;

/**
 * Schema for setting disposition on an NC
 * "use_as_is" and "concession" require justification
 */
export const SetDispositionSchema = z
  .object({
    disposition: NonConformanceDispositionSchema,
    justification: z.string().optional(),
  })
  .refine(
    (data) => {
      if (
        (data.disposition === "use_as_is" || data.disposition === "concession") &&
        (!data.justification || data.justification.length < 10)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "Justificativa com pelo menos 10 caracteres e obrigatoria para disposicao 'uso como esta' ou 'concessao'",
    },
  );

export type SetDispositionInput = z.infer<typeof SetDispositionSchema>;

/**
 * Schema for resolving an NC
 */
export const ResolveNonConformanceSchema = z.object({
  correctionTaken: z.string().min(10, "Correcao tomada deve ter pelo menos 10 caracteres"),
});

export type ResolveNonConformanceInput = z.infer<typeof ResolveNonConformanceSchema>;

/**
 * Schema for escalating NC to CAPA
 */
export const EscalateToCapaSchema = z.object({
  rootCauseAnalysis: z.string().optional(),
  actionPlan: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  responsibleId: z.string().optional().nullable(),
});

export type EscalateToCapaInput = z.infer<typeof EscalateToCapaSchema>;

/**
 * Schema for listing NCs with pagination and filtering
 */
export const ListNonConformancesQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(),
  status: NonConformanceStatusSchema.optional(),
  type: NonConformanceTypeSchema.optional(),
  jobId: z.coerce.number().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export type ListNonConformancesQuery = z.infer<typeof ListNonConformancesQuerySchema>;

// =============================================================================
// CORRECTIVE ACTION (CAPA) SCHEMAS - ISO 17025:2017 Clause 8.7 / 8.9
// =============================================================================

/**
 * CAPA status values
 */
export const CorrectiveActionStatusSchema = z.enum([
  "OPEN",
  "INVESTIGATION",
  "IMPLEMENTATION",
  "VERIFICATION",
  "CLOSED",
]);

export type CorrectiveActionStatus = z.infer<typeof CorrectiveActionStatusSchema>;

/**
 * CAPA source - where the CAPA originated from
 */
export const CorrectiveActionSourceSchema = z.enum([
  "internal_audit",
  "customer_complaint",
  "nc_detection",
  "external_audit",
  "management_review",
]);

export type CorrectiveActionSource = z.infer<typeof CorrectiveActionSourceSchema>;

/**
 * CAPA type - corrective vs preventive
 */
export const CorrectiveActionTypeSchema = z.enum(["corrective", "preventive"]);

export type CorrectiveActionType = z.infer<typeof CorrectiveActionTypeSchema>;

/**
 * CAPA severity classification
 */
export const CorrectiveActionSeveritySchema = z.enum(["minor", "major", "critical"]);

export type CorrectiveActionSeverity = z.infer<typeof CorrectiveActionSeveritySchema>;

/**
 * CAPA category - affected area
 */
export const CorrectiveActionCategorySchema = z.enum([
  "method",
  "equipment",
  "personnel",
  "procedure",
  "environment",
  "other",
]);

export type CorrectiveActionCategory = z.infer<typeof CorrectiveActionCategorySchema>;

/**
 * Root cause analysis method
 */
export const RootCauseAnalysisMethodSchema = z.enum([
  "5_whys",
  "fishbone",
  "pareto",
  "other",
]);

export type RootCauseAnalysisMethod = z.infer<typeof RootCauseAnalysisMethodSchema>;

/**
 * Schema for creating a new CAPA
 */
export const CreateCorrectiveActionSchema = z.object({
  title: z.string().min(5, "Titulo deve ter pelo menos 5 caracteres"),
  description: z.string().min(10, "Descricao deve ter pelo menos 10 caracteres"),
  source: CorrectiveActionSourceSchema,
  sourceReference: z.string().optional().nullable(),
  detectionDate: z.string().min(1, "Data de deteccao e obrigatoria"),
  type: CorrectiveActionTypeSchema,
  severity: CorrectiveActionSeveritySchema,
  category: CorrectiveActionCategorySchema,
  actionPlan: z.string().min(10, "Plano de acao deve ter pelo menos 10 caracteres"),
  responsibleId: z.string().min(1, "Responsavel e obrigatorio"),
  dueDate: z.string().min(1, "Data alvo e obrigatoria"),
  rootCauseAnalysis: z.string().optional().nullable(),
  rootCauseAnalysisMethod: RootCauseAnalysisMethodSchema.optional().nullable(),
  preventiveMeasures: z.string().optional().nullable(),
});

export type CreateCorrectiveActionInput = z.infer<typeof CreateCorrectiveActionSchema>;

/**
 * Schema for updating a CAPA
 */
export const UpdateCorrectiveActionSchema = z.object({
  title: z.string().min(5).optional(),
  description: z.string().min(10).optional(),
  source: CorrectiveActionSourceSchema.optional(),
  sourceReference: z.string().optional().nullable(),
  type: CorrectiveActionTypeSchema.optional(),
  severity: CorrectiveActionSeveritySchema.optional(),
  category: CorrectiveActionCategorySchema.optional(),
  actionPlan: z.string().min(10).optional(),
  responsibleId: z.string().min(1).optional(),
  dueDate: z.string().optional().nullable(),
  rootCauseAnalysis: z.string().optional().nullable(),
  rootCauseAnalysisMethod: RootCauseAnalysisMethodSchema.optional().nullable(),
  preventiveMeasures: z.string().optional().nullable(),
});

export type UpdateCorrectiveActionInput = z.infer<typeof UpdateCorrectiveActionSchema>;

/**
 * Schema for marking a CAPA as implemented
 */
export const ImplementCorrectiveActionSchema = z.object({
  implementationEvidence: z.string().min(10, "Evidencia de implementacao deve ter pelo menos 10 caracteres"),
});

export type ImplementCorrectiveActionInput = z.infer<typeof ImplementCorrectiveActionSchema>;

/**
 * Schema for verifying CAPA effectiveness
 */
export const VerifyCorrectiveActionSchema = z.object({
  effectivenessConfirmed: z.boolean(),
  verificationNotes: z.string().min(10, "Notas de verificacao devem ter pelo menos 10 caracteres"),
});

export type VerifyCorrectiveActionInput = z.infer<typeof VerifyCorrectiveActionSchema>;

/**
 * Schema for closing a CAPA
 */
export const CloseCorrectiveActionSchema = z.object({
  reason: z.string().optional(),
});

export type CloseCorrectiveActionInput = z.infer<typeof CloseCorrectiveActionSchema>;

/**
 * Schema for listing CAPAs with pagination and filtering
 */
export const ListCorrectiveActionsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(),
  status: CorrectiveActionStatusSchema.optional(),
  severity: CorrectiveActionSeveritySchema.optional(),
  category: CorrectiveActionCategorySchema.optional(),
  source: CorrectiveActionSourceSchema.optional(),
  type: CorrectiveActionTypeSchema.optional(),
  responsibleId: z.string().optional(),
  overdue: z.coerce.boolean().optional(),
});

export type ListCorrectiveActionsQuery = z.infer<typeof ListCorrectiveActionsQuerySchema>;
