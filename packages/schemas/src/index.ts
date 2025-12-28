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
