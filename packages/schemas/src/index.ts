import { z } from "zod";
export * from "./commercial";
export * from "./quality";
export * from "./service-orders";

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
  complement: z.string().optional(),
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
  email: z.string().email("Email inválido").optional().or(z.literal("")),
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
  contractAgreementId: z.number().int().positive().optional(),
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
// CERTIFICATE NUMBERING SCHEMAS
// =============================================================================

export const CertificateSequenceResetScopeSchema = z.enum([
  "never",
  "year",
  "month",
  "project",
]);

export const CertificateNumberingConfigSchema = z.object({
  labCode: z
    .string()
    .trim()
    .min(1, "Codigo do laboratorio e obrigatorio")
    .max(32, "Codigo do laboratorio deve ter no maximo 32 caracteres")
    .default("CAL"),
  projectCode: z
    .string()
    .trim()
    .max(32, "Codigo do projeto deve ter no maximo 32 caracteres")
    .nullable()
    .optional()
    .or(z.literal("")),
  numberTemplate: z
    .string()
    .trim()
    .min(1, "Formato do numero e obrigatorio")
    .max(160, "Formato do numero deve ter no maximo 160 caracteres")
    .default("{labCode}-{yyyy}-{seq}"),
  certificateNameTemplate: z
    .string()
    .trim()
    .min(1, "Convencao de nome e obrigatoria")
    .max(200, "Convencao de nome deve ter no maximo 200 caracteres")
    .default("Certificado {number}"),
  sequence: z
    .object({
      resetScope: CertificateSequenceResetScopeSchema.default("year"),
      startAt: z.coerce.number().int().min(0).max(999999999).default(1),
      increment: z.coerce.number().int().min(1).max(1000).default(1),
      padding: z.coerce.number().int().min(1).max(12).default(4),
    })
    .default({
      resetScope: "year",
      startAt: 1,
      increment: 1,
      padding: 4,
    }),
});

export const UpdateCertificateNumberingProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nome do perfil e obrigatorio")
    .max(120, "Nome do perfil deve ter no maximo 120 caracteres")
    .default("Padrao"),
  config: CertificateNumberingConfigSchema,
});

export type CertificateSequenceResetScope = z.infer<
  typeof CertificateSequenceResetScopeSchema
>;
export type CertificateNumberingConfig = z.infer<
  typeof CertificateNumberingConfigSchema
>;
export type UpdateCertificateNumberingProfileInput = z.infer<
  typeof UpdateCertificateNumberingProfileSchema
>;

// =============================================================================
// ASSET TYPE SCHEMAS - Dynamic Instrument Classification
// =============================================================================

/**
 * Field definition for dynamic asset specifications
 */
export const AssetTypeFieldSchema = z.object({
  key: z.string().min(1, "Chave é obrigatória"),
  label: z.string().min(1, "Rótulo é obrigatório"),
  type: z.enum(["text", "number", "select", "weighing_ranges"]),
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
export const MassUnitSchema = z.enum(["mg", "g", "kg"]);
export type MassUnit = z.infer<typeof MassUnitSchema>;

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
  baseMeasurementUnit: MassUnitSchema.optional().nullable(),
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
  baseMeasurementUnit: true,
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
// CALIBRATION REQUEST SCHEMAS - Portal Intake Queue
// =============================================================================

export const CalibrationRequestStatusSchema = z.enum([
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
]);

export type CalibrationRequestStatus = z.infer<
  typeof CalibrationRequestStatusSchema
>;

export const CreateCalibrationRequestSchema = z.object({
  assetIds: z
    .array(z.coerce.number().min(1, "Ativo inválido"))
    .min(1, "Selecione pelo menos um ativo")
    .max(100, "Selecione no máximo 100 ativos por solicitação")
    .refine((assetIds) => new Set(assetIds).size === assetIds.length, {
      message: "Não repita ativos na mesma solicitação",
    }),
  observations: z.string().trim().max(2000).optional(),
  requestedDueDate: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Prazo solicitado inválido",
    })
    .optional()
    .nullable(),
});

export type CreateCalibrationRequestInput = z.infer<
  typeof CreateCalibrationRequestSchema
>;

export const ListCalibrationRequestsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(),
  status: CalibrationRequestStatusSchema.optional(),
  customerId: z.coerce.number().optional(),
  dateFrom: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data inicial invalida",
    })
    .optional(),
  dateTo: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data final invalida",
    })
    .optional(),
});

export type ListCalibrationRequestsQuery = z.infer<
  typeof ListCalibrationRequestsQuerySchema
>;

export const ReviewCalibrationRequestSchema = z.object({
  internalNotes: z.string().trim().max(2000).optional(),
});

export type ReviewCalibrationRequestInput = z.infer<
  typeof ReviewCalibrationRequestSchema
>;

export const ApproveCalibrationRequestSchema = z.object({
  internalNotes: z.string().trim().max(2000).optional(),
});

export type ApproveCalibrationRequestInput = z.infer<
  typeof ApproveCalibrationRequestSchema
>;

export const RejectCalibrationRequestSchema = z.object({
  reason: z.string().trim().min(3, "Motivo e obrigatorio"),
  internalNotes: z.string().trim().max(2000).optional(),
});

export type RejectCalibrationRequestInput = z.infer<
  typeof RejectCalibrationRequestSchema
>;

export const ConvertCalibrationRequestItemSchema = z.object({
  itemId: z.coerce.number().min(1, "Item invalido"),
  serviceId: z.coerce.number().min(1, "Servico e obrigatorio"),
  technicianId: z.string().optional().nullable(),
  dueDate: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data prevista invalida",
    })
    .optional()
    .nullable(),
});

export const ConvertCalibrationRequestSchema = z.object({
  items: z
    .array(ConvertCalibrationRequestItemSchema)
    .min(1, "Informe ao menos um item para conversao")
    .max(100, "Converta no maximo 100 itens por vez")
    .refine(
      (items) =>
        new Set(items.map((item) => item.itemId)).size === items.length,
      {
        message: "Nao repita itens na conversao",
      },
    ),
});

export type ConvertCalibrationRequestInput = z.infer<
  typeof ConvertCalibrationRequestSchema
>;

// =============================================================================
// CALIBRATION METHOD SCHEMAS - ISO 17025 Validated Templates
// =============================================================================

/**
 * Method status values
 */
export const MethodStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "TECHNICAL_REVIEWED",
  "PUBLISHED",
  "ARCHIVED",
]);
export type MethodStatus = z.infer<typeof MethodStatusSchema>;

/**
 * Table column definition for table-type inputs
 */
export const MethodTableColumnRoleSchema = z.enum([
  "standard_value",
  "mass_standard_composition",
]);
export type MethodTableColumnRole = z.infer<typeof MethodTableColumnRoleSchema>;

export const MassCompositionConfigSchema = z.object({
  targetUnit: z.enum(["mg", "g", "kg"]).optional(),
  optionSource: z.enum(["certified_values", "composition_profiles"]).optional(),
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
  uncertaintyMode: z.enum(["expanded_rss"]).optional(),
  quantityMode: z
    .enum(["linear_per_item_then_rss", "profile_linear"])
    .optional(),
});
export type MassCompositionConfig = z.infer<typeof MassCompositionConfigSchema>;

export const MethodTableColumnSchema = z.object({
  key: z
    .string()
    .min(1, "Chave é obrigatória")
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*$/,
      "Chave deve começar com letra e conter apenas letras, números e underscore",
    ),
  label: z.string().min(1, "Rótulo é obrigatório"),
  type: z.enum(["text", "number"]),
  unit: z.string().optional(),
  role: MethodTableColumnRoleSchema.optional(),
  phase: z.enum(["before", "after", "always"]).optional(),
  massComposition: MassCompositionConfigSchema.optional(),
});

export type MethodTableColumn = z.infer<typeof MethodTableColumnSchema>;

export const MethodInputSourceSchema = z.enum(["manual", "asset_spec"]);
export type MethodInputSource = z.infer<typeof MethodInputSourceSchema>;

export const EccentricityIndicatorVariantSchema = z.enum([
  "circular_platform",
  "road_scale",
]);
export type EccentricityIndicatorVariant = z.infer<
  typeof EccentricityIndicatorVariantSchema
>;

export const EccentricityIndicatorConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  variant:
    EccentricityIndicatorVariantSchema.optional().default("circular_platform"),
});
export type EccentricityIndicatorConfig = z.infer<
  typeof EccentricityIndicatorConfigSchema
>;

export const WeighingRangeResolverConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  assetSpecKey: z.string().min(1).optional(),
  pointColumn: z.string().min(1).optional(),
  pointUnit: z.enum(["mg", "g", "kg"]).optional(),
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
});
export type WeighingRangeResolverConfig = z.infer<
  typeof WeighingRangeResolverConfigSchema
>;

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
        "Chave deve começar com letra e conter apenas letras, números e underscore",
      ),
    label: z.string().min(1, "Rótulo é obrigatório"),
    type: z.enum(["text", "number", "select", "table"]),
    unit: z.string().optional(),
    required: z.boolean().optional().default(false),
    options: z.array(z.string()).optional(),
    defaultValue: z.union([z.string(), z.number()]).optional(),
    columns: z.array(MethodTableColumnSchema).optional(),
    source: MethodInputSourceSchema.optional().default("manual"),
    assetSpecKey: z.string().optional(),
    allowOverride: z.boolean().optional().default(false),
    phaseBlockKey: z.string().optional(),
    phaseBlockLabel: z.string().optional(),
    eccentricityIndicator: EccentricityIndicatorConfigSchema.optional(),
    weighingRangeResolver: WeighingRangeResolverConfigSchema.optional(),
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
    { message: "Opções são obrigatórias para campos do tipo 'select'" },
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
    { message: "Colunas são obrigatórias para campos do tipo 'table'" },
  )
  .refine(
    (data) => {
      if (data.source !== "asset_spec") {
        return true;
      }
      return Boolean(data.assetSpecKey?.trim());
    },
    {
      message:
        "Chave da especificação do ativo é obrigatória para campos do ativo",
      path: ["assetSpecKey"],
    },
  )
  .refine((data) => data.source !== "asset_spec" || data.type !== "table", {
    message: "Campos de especificação do ativo não podem ser tabela",
    path: ["type"],
  })
  .refine((data) => data.source !== "asset_spec" || !data.columns, {
    message: "Campos de especificação do ativo não aceitam colunas",
    path: ["columns"],
  });

export type MethodInputField = z.infer<typeof MethodInputFieldSchema>;

/**
 * Formula definition for computed values
 */
export const MethodFormulaReportingSchema = z.object({
  includeInCertificate: z.boolean().optional(),
  role: z
    .enum([
      "primary_result",
      "expanded_uncertainty",
      "coverage_factor",
      "conformity_margin",
      "uncertainty_component",
      "auxiliary",
    ])
    .optional(),
  group: z
    .enum(["calibration_result", "uncertainty_budget", "raw_calculation"])
    .optional(),
});

export type MethodFormulaReporting = z.infer<
  typeof MethodFormulaReportingSchema
>;

export const MethodFormulaSchema = z.object({
  outputKey: z
    .string()
    .min(1, "Chave de saida é obrigatória")
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*$/,
      "Chave deve começar com letra e conter apenas letras, números e underscore",
    ),
  expression: z.string().min(1, "Expressão é obrigatória"),
  scope: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("scalar") }),
      z.object({
        kind: z.literal("table_row"),
        tableKey: z.string().min(1, "Tabela é obrigatória"),
      }),
    ])
    .optional(),
  label: z.string().optional(),
  unit: z.string().optional(),
  reporting: MethodFormulaReportingSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type MethodFormula = z.infer<typeof MethodFormulaSchema>;

export const MethodMeasurementModelSchema = z
  .object({
    key: z
      .string()
      .min(1, "Chave é obrigatória")
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        "Chave deve começar com letra e conter apenas letras, números e underscore",
      ),
    label: z.string().min(1, "Rótulo é obrigatório"),
    scope: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("scalar") }),
        z.object({
          kind: z.literal("table_row"),
          tableKey: z.string().min(1, "Tabela é obrigatória"),
        }),
      ])
      .optional(),
    measurand: z.string().min(1, "Mensurando é obrigatório"),
    expression: z.string().min(1, "Expressão é obrigatória"),
    quantities: z.array(z.unknown()).default([]),
    correlations: z.array(z.unknown()).optional(),
    covariances: z.array(z.unknown()).optional(),
    coverageProbability: z.coerce.number().gt(0).lt(1).optional(),
    coverageFactor: z.union([z.string(), z.number()]).optional(),
    outputUnit: z.string().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type MethodMeasurementModel = z.infer<
  typeof MethodMeasurementModelSchema
>;

/**
 * Validation rule for pass/fail criteria
 */
export const MethodValidationOperatorSchema = z.enum([
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
]);
export type MethodValidationOperator = z.infer<
  typeof MethodValidationOperatorSchema
>;

const StructuredMethodValidationSchema = z.object({
  leftExpression: z.string().min(1, "Expressão esquerda é obrigatória"),
  operator: MethodValidationOperatorSchema,
  rightExpression: z.string().min(1, "Expressão direita é obrigatória"),
  message: z.string().min(1, "Mensagem é obrigatória"),
  severity: z.enum(["error", "warning"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type MethodValidation = z.infer<typeof StructuredMethodValidationSchema>;

const LegacyMethodValidationSchema = z
  .object({
    expression: z.string().min(1, "Expressão é obrigatória"),
    message: z.string().min(1, "Mensagem é obrigatória"),
    severity: z.enum(["error", "warning"]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .transform((validation) =>
    normalizeLegacyMethodValidationExpression(validation),
  );

export const MethodValidationSchema = z.union([
  StructuredMethodValidationSchema,
  LegacyMethodValidationSchema,
]);

export const MethodVariableBindingSchema = z.discriminatedUnion("source", [
  z.object({
    key: z
      .string()
      .min(1, "Chave é obrigatória")
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        "Chave deve começar com letra e conter apenas letras, números e underscore",
      ),
    label: z.string().optional(),
    source: z.literal("data_field"),
    fieldKey: z.string().min(1, "Campo é obrigatório"),
  }),
  z.object({
    key: z
      .string()
      .min(1, "Chave é obrigatória")
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        "Chave deve começar com letra e conter apenas letras, números e underscore",
      ),
    label: z.string().optional(),
    source: z.literal("table_column"),
    fieldKey: z.string().min(1, "Tabela é obrigatória"),
    columnKey: z.string().min(1, "Coluna é obrigatória"),
  }),
  z.object({
    key: z
      .string()
      .min(1, "Chave é obrigatória")
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        "Chave deve começar com letra e conter apenas letras, números e underscore",
      ),
    label: z.string().optional(),
    source: z.literal("table_statistic"),
    fieldKey: z.string().min(1, "Tabela é obrigatória"),
    columnKey: z.string().min(1, "Coluna é obrigatória"),
    statistic: z.enum(["mean", "sample_stddev", "count", "min", "max"]),
  }),
  z.object({
    key: z
      .string()
      .min(1, "Chave é obrigatória")
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        "Chave deve começar com letra e conter apenas letras, números e underscore",
      ),
    label: z.string().optional(),
    source: z.literal("environment"),
    field: z.enum(["temperature", "humidity", "pressure"]),
  }),
  z.object({
    key: z
      .string()
      .min(1, "Chave é obrigatória")
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        "Chave deve começar com letra e conter apenas letras, números e underscore",
      ),
    label: z.string().optional(),
    source: z.literal("standard"),
    standardId: z.number().int().positive().optional(),
    valueKey: z.string().min(1, "Valor do padrão é obrigatório"),
  }),
]);
export type MethodVariableBinding = z.infer<typeof MethodVariableBindingSchema>;

export function normalizeMethodValidationInput(
  validation: unknown,
): MethodValidation {
  return MethodValidationSchema.parse(validation);
}

export function normalizeMethodValidationsInput(
  validations: unknown,
): MethodValidation[] {
  if (!Array.isArray(validations)) return [];
  return validations.map((validation) =>
    normalizeMethodValidationInput(validation),
  );
}

function normalizeLegacyMethodValidationExpression(validation: {
  expression: string;
  message: string;
  severity: "error" | "warning";
  metadata?: Record<string, unknown>;
}): MethodValidation {
  const match = validation.expression.match(
    /^\s*(.+?)\s*(<=|>=|==|!=|<|>)\s*(.+?)\s*$/,
  );

  return {
    leftExpression: match?.[1]?.trim() || validation.expression,
    operator: parseMethodValidationOperator(match?.[2]),
    rightExpression: match?.[3]?.trim() || "0",
    message: validation.message,
    severity: validation.severity,
    metadata: validation.metadata,
  };
}

function parseMethodValidationOperator(
  operator: string | undefined,
): MethodValidationOperator {
  switch (operator) {
    case "<=":
    case ">":
    case ">=":
    case "==":
    case "!=":
      return operator;
    default:
      return "!=";
  }
}

/**
 * Type B uncertainty component for method defaults
 */
export const MethodTypeBComponentSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  value: z.number().positive("Valor deve ser positivo"),
  distribution: z.enum(["normal", "rectangular", "triangular", "u-shaped"]),
  coverageFactor: z.number().positive().optional(),
  divisor: z.number().positive().optional(),
  degreesOfFreedom: z.number().positive().optional().default(50),
});

export type MethodTypeBComponent = z.infer<typeof MethodTypeBComponentSchema>;

export const MethodCertificateContentSectionSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("paragraphs"),
      title: z.string().trim(),
      paragraphs: z.array(z.string().trim()).default([]),
    }),
    z.object({
      kind: z.literal("definition_list"),
      title: z.string().trim(),
      items: z
        .array(
          z.object({
            term: z.string().trim(),
            definition: z.string().trim(),
          }),
        )
        .default([]),
    }),
    z.object({
      kind: z.literal("bullets"),
      title: z.string().trim().optional(),
      items: z.array(z.string().trim()).default([]),
    }),
  ],
);

export const MethodCertificateContentSchema = z.object({
  procedureCode: z.string().trim().optional(),
  referenceStandards: z.array(z.string().trim()).default([]),
  certifiedValuesDisplay: z.enum(["full", "hidden"]).optional(),
  massCompositionDisplay: z.enum(["full", "hidden"]).optional(),
  uncertaintyBudgetDisplay: z.enum(["full", "hidden"]).optional(),
  sections: z.array(MethodCertificateContentSectionSchema).default([]),
});

export type MethodCertificateContent = z.infer<
  typeof MethodCertificateContentSchema
>;

/**
 * Schema for creating a new method
 */
export const CreateMethodSchema = z.object({
  assetTypeId: z.coerce.number().nullable().optional(),
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  description: z.string().nullable().optional(),
  dataFields: z
    .array(MethodInputFieldSchema)
    .min(1, "Defina pelo menos um campo de entrada"),
  variableBindings: z.array(MethodVariableBindingSchema).default([]),
  formulas: z.array(MethodFormulaSchema).default([]),
  measurementModels: z.array(MethodMeasurementModelSchema).default([]),
  validations: z.array(MethodValidationSchema).default([]),
  uncertaintyParams: z.array(MethodTypeBComponentSchema).default([]),
  certificateContent: MethodCertificateContentSchema.nullable().optional(),
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

/**
 * Schema for returning a method to draft with optional reason
 */
export const ReturnMethodToDraftSchema = z.object({
  reason: z.string().trim().min(3, "Motivo é obrigatório"),
});

export type ReturnMethodToDraftInput = z.infer<
  typeof ReturnMethodToDraftSchema
>;

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
  maxError: z.coerce.number().nullable().optional(),
  drift: z.coerce.number().nullable().optional(),
  buoyancy: z.coerce.number().nullable().optional(),
  coverageFactor: z.coerce.number().positive().nullable().optional(),
  compositionProfile: z.boolean().optional(),
  profileKey: z.string().nullable().optional(),
  profileClass: z.string().nullable().optional(),
  profileQuantityAvailable: z.coerce.number().nullable().optional(),
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
        "Informe o valor de referência e incerteza, ou os valores certificados do conjunto",
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
  reason: z.string().min(1, "Motivo da renovação é obrigatório"),
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
  compiledMethod: z.unknown().optional(),
  methodFingerprint: z.string().nullable().optional(),
  engineVersion: z.string().nullable().optional(),
  engineOptionsFingerprint: z.string().nullable().optional(),
  normalizedMethodJson: z.string().nullable().optional(),
  publicationEvidence: z.unknown().optional(),
  dataFields: z.array(MethodInputFieldSchema),
  variableBindings: z.array(MethodVariableBindingSchema).default([]),
  formulas: z.array(MethodFormulaSchema),
  measurementModels: z.array(MethodMeasurementModelSchema).default([]),
  validations: z.array(MethodValidationSchema),
  uncertaintyParams: z.array(MethodTypeBComponentSchema),
  certificateContent: MethodCertificateContentSchema.nullable().optional(),
});

export type MethodSnapshot = z.infer<typeof MethodSnapshotSchema>;

/**
 * Schema for creating a new calibration job
 * The method snapshot is created server-side from the service's linked method
 */
export const CreateJobSchema = z.object({
  assetId: z.coerce.number().min(1, "Ativo é obrigatório"),
  serviceId: z.coerce.number().min(1, "Serviço é obrigatório"),
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
 * Environmental data input - ISO 17025:2017 Clause 7.1.2
 * Captured during job execution for environmental conditions monitoring
 */
export const EnvironmentalDataSchema = z.object({
  temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  pressure: z.number().nullable(),
});

export type EnvironmentalDataInput = z.infer<typeof EnvironmentalDataSchema>;

export const CalibrationLocationTypeSchema = z.enum([
  "customer_site",
  "lab",
  "other",
]);

export const CalibrationLocationInputSchema = z.object({
  type: CalibrationLocationTypeSchema,
  addressText: z.string().trim().min(1, "Local da calibração é obrigatório"),
  notes: z.string().trim().optional().nullable(),
});

export type CalibrationLocationInput = z.infer<
  typeof CalibrationLocationInputSchema
>;

export const CalibrationPhaseModeSchema = z.enum([
  "before_and_after",
  "before_only",
  "after_only",
  "not_performed",
]);

export const CalibrationPhaseInputSchema = z.object({
  blocks: z.record(
    z.string(),
    z.object({
      mode: CalibrationPhaseModeSchema,
      reason: z.string().trim().optional().nullable(),
    }),
  ),
});

export type CalibrationPhaseInput = z.infer<typeof CalibrationPhaseInputSchema>;

/**
 * Schema for submitting job for review
 */
export const SubmitForReviewSchema = z.object({
  selectedStandardIds: z.array(z.number()).optional(),
  data: z.record(z.string(), z.unknown()),
  results: z.record(z.string(), z.unknown()).optional(),
  environment: EnvironmentalDataSchema.optional(),
  calibrationLocation: CalibrationLocationInputSchema.optional(),
  calibrationPhases: CalibrationPhaseInputSchema.optional(),
});

export type SubmitForReviewInput = z.infer<typeof SubmitForReviewSchema>;

/**
 * Schema for approving a job
 */
export const ApproveJobSchema = z.object({
  reason: z.string().optional(), // Optional approval notes
  environmentalJustification: z.string().optional(), // Required if env conditions out of limits
});

export type ApproveJobInput = z.infer<typeof ApproveJobSchema>;

/**
 * Schema for rejecting a job
 */
export const RejectJobSchema = z.object({
  reason: z.string().min(1, "Motivo da rejeição é obrigatório"),
});

export type RejectJobInput = z.infer<typeof RejectJobSchema>;

/**
 * Schema for canceling a job
 */
export const CancelJobSchema = z.object({
  reason: z.string().min(1, "Motivo do cancelamento é obrigatório"),
});

export type CancelJobInput = z.infer<typeof CancelJobSchema>;

/**
 * Schema for amending a job (ISO 17025 Clause 7.8.4.1)
 * Creates a corrected version of an approved certificate
 */
export const AmendJobSchema = z.object({
  reason: z
    .string()
    .min(10, "Motivo da retificação deve ter pelo menos 10 caracteres"),
});

export type AmendJobInput = z.infer<typeof AmendJobSchema>;

/**
 * Standard Snapshot schema - Frozen copy of reference standard at execution
 * This is read-only after job execution (never modified)
 */
export const StandardSnapshotSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().nullable().optional(),
  certificateNumber: z.string(),
  calibrationDate: z.string(),
  nextCalibrationDate: z.string().nullable().optional(),
  uncertainty: z.number().nullable(),
  uncertaintyUnit: z.string().nullable(),
  coverageFactor: z.number(),
  distribution: UncertaintyDistributionSchema,
  drift: z.number().nullable(),
  certifiedValues: z.array(CertifiedValueSchema).nullable(),
});

export type StandardSnapshot = z.infer<typeof StandardSnapshotSchema>;

/**
 * Environmental limits configuration - per org or per asset type
 */
export const EnvironmentalLimitsSchema = z.object({
  assetTypeId: z.number().nullable(),
  temperatureMin: z.number().nullable(),
  temperatureMax: z.number().nullable(),
  humidityMin: z.number().nullable(),
  humidityMax: z.number().nullable(),
  pressureMin: z.number().nullable(),
  pressureMax: z.number().nullable(),
});

export type EnvironmentalLimitsInput = z.infer<
  typeof EnvironmentalLimitsSchema
>;

/**
 * Schema for executing a job (saving worksheet data)
 * Includes selected reference standards for ISO 17025 traceability
 */
export const ExecuteJobSchema = z.object({
  selectedStandardIds: z.array(z.number()).optional(),
  data: z.record(z.string(), z.unknown()),
  results: z.record(z.string(), z.unknown()).optional(),
  environment: EnvironmentalDataSchema.optional(),
  calibrationLocation: CalibrationLocationInputSchema.optional(),
  calibrationPhases: CalibrationPhaseInputSchema.optional(),
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
  "COMPETENCE_EXPIRING", // ISO 17025 Clause 6.2.3
  "COMPETENCE_EXPIRED", // ISO 17025 Clause 6.2.3
  "COMPETENCE_REQUESTED", // ISO 17025 Clause 6.2.3
  "COMPETENCE_APPROVED", // ISO 17025 Clause 6.2.3
  "CUSTOMER_SUCCESS_WORKFLOW_BLOCKED",
  "CUSTOMER_SUCCESS_GO_LIVE_AT_RISK",
  "CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE",
  "CUSTOMER_SUCCESS_SLA_DUE_SOON",
  "CUSTOMER_SUCCESS_SLA_BREACHED",
  "CUSTOMER_SUCCESS_ESCALATION_REQUIRED",
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

export type ListNotificationsQuery = z.infer<
  typeof ListNotificationsQuerySchema
>;

/**
 * Schema for marking notifications as read
 */
export const MarkNotificationsReadSchema = z.object({
  notificationIds: z
    .array(z.number())
    .min(1, "Selecione ao menos uma notificação"),
});

export type MarkNotificationsReadInput = z.infer<
  typeof MarkNotificationsReadSchema
>;

/**
 * Individual notification channel preference
 */
export const NotificationChannelPreferenceSchema = z.object({
  inApp: z.boolean().default(true),
  email: z.boolean().default(true),
});

export type NotificationChannelPreference = z.infer<
  typeof NotificationChannelPreferenceSchema
>;

/**
 * Full notification preferences map
 * Note: Using z.string() for keys to avoid z.record(enum, ...) validation issues
 * The application layer handles unknown keys gracefully
 */
export const NotificationPreferencesMapSchema = z.record(
  z.string(),
  NotificationChannelPreferenceSchema,
);

export type NotificationPreferencesMap = z.infer<
  typeof NotificationPreferencesMapSchema
>;

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

export type UpdateNotificationPreferencesInput = z.infer<
  typeof UpdateNotificationPreferencesSchema
>;

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

export type NonConformanceDisposition = z.infer<
  typeof NonConformanceDispositionSchema
>;

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
  description: z
    .string()
    .min(10, "Descrição deve ter pelo menos 10 caracteres"),
  detectedAt: z.string().min(1, "Data de detecção é obrigatória"),
});

export type CreateNonConformanceInput = z.infer<
  typeof CreateNonConformanceSchema
>;

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
        (data.disposition === "use_as_is" ||
          data.disposition === "concession") &&
        (!data.justification || data.justification.length < 10)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "Justificativa com pelo menos 10 caracteres é obrigatória para disposição 'uso como esta' ou 'concessão'",
    },
  );

export type SetDispositionInput = z.infer<typeof SetDispositionSchema>;

/**
 * Schema for resolving an NC
 */
export const ResolveNonConformanceSchema = z.object({
  correctionTaken: z
    .string()
    .min(10, "Correção tomada deve ter pelo menos 10 caracteres"),
});

export type ResolveNonConformanceInput = z.infer<
  typeof ResolveNonConformanceSchema
>;

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

export type ListNonConformancesQuery = z.infer<
  typeof ListNonConformancesQuerySchema
>;

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

export type CorrectiveActionStatus = z.infer<
  typeof CorrectiveActionStatusSchema
>;

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

export type CorrectiveActionSource = z.infer<
  typeof CorrectiveActionSourceSchema
>;

/**
 * CAPA type - corrective vs preventive
 */
export const CorrectiveActionTypeSchema = z.enum(["corrective", "preventive"]);

export type CorrectiveActionType = z.infer<typeof CorrectiveActionTypeSchema>;

/**
 * CAPA severity classification
 */
export const CorrectiveActionSeveritySchema = z.enum([
  "minor",
  "major",
  "critical",
]);

export type CorrectiveActionSeverity = z.infer<
  typeof CorrectiveActionSeveritySchema
>;

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

export type CorrectiveActionCategory = z.infer<
  typeof CorrectiveActionCategorySchema
>;

/**
 * Root cause analysis method
 */
export const RootCauseAnalysisMethodSchema = z.enum([
  "5_whys",
  "fishbone",
  "pareto",
  "other",
]);

export type RootCauseAnalysisMethod = z.infer<
  typeof RootCauseAnalysisMethodSchema
>;

/**
 * Schema for creating a new CAPA
 */
export const CreateCorrectiveActionSchema = z.object({
  title: z.string().min(5, "Título deve ter pelo menos 5 caracteres"),
  description: z
    .string()
    .min(10, "Descrição deve ter pelo menos 10 caracteres"),
  source: CorrectiveActionSourceSchema,
  sourceReference: z.string().optional().nullable(),
  detectionDate: z.string().min(1, "Data de detecção é obrigatória"),
  type: CorrectiveActionTypeSchema,
  severity: CorrectiveActionSeveritySchema,
  category: CorrectiveActionCategorySchema,
  actionPlan: z
    .string()
    .min(10, "Plano de acão deve ter pelo menos 10 caracteres"),
  responsibleId: z.string().min(1, "Responsavel é obrigatório"),
  dueDate: z.string().min(1, "Data alvo é obrigatória"),
  rootCauseAnalysis: z.string().optional().nullable(),
  rootCauseAnalysisMethod: RootCauseAnalysisMethodSchema.optional().nullable(),
  preventiveMeasures: z.string().optional().nullable(),
});

export type CreateCorrectiveActionInput = z.infer<
  typeof CreateCorrectiveActionSchema
>;

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

export type UpdateCorrectiveActionInput = z.infer<
  typeof UpdateCorrectiveActionSchema
>;

/**
 * Schema for marking a CAPA as implemented
 */
export const ImplementCorrectiveActionSchema = z.object({
  implementationEvidence: z
    .string()
    .min(10, "Evidencia de implementação deve ter pelo menos 10 caracteres"),
});

export type ImplementCorrectiveActionInput = z.infer<
  typeof ImplementCorrectiveActionSchema
>;

/**
 * Schema for verifying CAPA effectiveness
 */
export const VerifyCorrectiveActionSchema = z.object({
  effectivenessConfirmed: z.boolean(),
  verificationNotes: z
    .string()
    .min(10, "Notas de verificação devem ter pelo menos 10 caracteres"),
});

export type VerifyCorrectiveActionInput = z.infer<
  typeof VerifyCorrectiveActionSchema
>;

/**
 * Schema for closing a CAPA
 */
export const CloseCorrectiveActionSchema = z.object({
  reason: z.string().optional(),
});

export type CloseCorrectiveActionInput = z.infer<
  typeof CloseCorrectiveActionSchema
>;

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

export type ListCorrectiveActionsQuery = z.infer<
  typeof ListCorrectiveActionsQuerySchema
>;

// =============================================================================
// PERSONNEL COMPETENCE SCHEMAS - ISO 17025:2017 Clause 6.2.3
// =============================================================================

/**
 * Competence workflow status values
 */
export const CompetenceStatusSchema = z.enum([
  "REQUESTED",
  "TRAINING_ASSIGNED",
  "IN_TRAINING",
  "PENDING_EVALUATION",
  "ACTIVE",
  "SUSPENDED",
  "EXPIRED",
  "CANCELLED",
]);

export type CompetenceStatus = z.infer<typeof CompetenceStatusSchema>;

/**
 * Training type values
 */
export const TrainingTypeSchema = z.enum([
  "internal",
  "external",
  "ojt",
  "proficiency_test",
]);

export type TrainingType = z.infer<typeof TrainingTypeSchema>;

/**
 * Training status values
 */
export const TrainingStatusSchema = z.enum([
  "planned",
  "in_progress",
  "completed",
  "failed",
]);

export type TrainingStatus = z.infer<typeof TrainingStatusSchema>;

/**
 * Schema for creating a new competence request
 */
export const CreateCompetenceRequestSchema = z.object({
  userId: z.string().min(1, "Técnico é obrigatório"),
  assetTypeId: z.coerce.number().optional().nullable(),
  scopeDescription: z
    .string()
    .min(5, "Descrição do escopo deve ter pelo menos 5 caracteres"),
});

export type CreateCompetenceRequestInput = z.infer<
  typeof CreateCompetenceRequestSchema
>;

/**
 * Schema for updating a personnel competence record
 */
export const UpdatePersonnelCompetenceSchema = z.object({
  scopeDescription: z.string().min(5).optional(),
  notes: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
});

export type UpdatePersonnelCompetenceInput = z.infer<
  typeof UpdatePersonnelCompetenceSchema
>;

/**
 * Schema for assigning training to a competence record
 */
export const AssignTrainingSchema = z.object({
  trainingRecordIds: z
    .array(z.number())
    .min(1, "Selecione pelo menos um treinamento"),
});

export type AssignTrainingInput = z.infer<typeof AssignTrainingSchema>;

/**
 * Schema for evaluating a competence
 */
export const EvaluateCompetenceSchema = z.object({
  passed: z.boolean(),
  notes: z.string().optional().nullable(),
  qualifiedAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
});

export type EvaluateCompetenceInput = z.infer<typeof EvaluateCompetenceSchema>;

/**
 * Schema for cancelling a competence workflow
 */
export const CancelCompetenceSchema = z.object({
  notes: z.string().optional().nullable(),
});

export type CancelCompetenceInput = z.infer<typeof CancelCompetenceSchema>;

/**
 * Schema for listing personnel competences with filters
 */
export const ListPersonnelCompetenceQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  userId: z.string().optional(),
  assetTypeId: z.coerce.number().optional(),
  status: CompetenceStatusSchema.optional(),
  expiringWithinDays: z.coerce.number().optional(),
});

export type ListPersonnelCompetenceQuery = z.infer<
  typeof ListPersonnelCompetenceQuerySchema
>;

// =============================================================================
// TRAINING RECORD SCHEMAS - ISO 17025:2017 Clause 6.2.3
// =============================================================================

/**
 * Schema for creating a new training record
 */
export const CreateTrainingRecordSchema = z.object({
  userId: z.string().min(1, "Técnico é obrigatório"),
  competenceId: z.coerce.number().optional().nullable(),
  title: z.string().min(3, "Título deve ter pelo menos 3 caracteres"),
  type: TrainingTypeSchema,
  provider: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  startDate: z.string().min(1, "Data de início é obrigatória"),
  endDate: z.string().optional().nullable(),
  hoursCompleted: z.coerce.number().int().min(0).optional().nullable(),
  score: z.coerce.number().optional().nullable(),
  passingScore: z.coerce.number().optional().nullable(),
  passed: z.boolean().optional().nullable(),
});

export type CreateTrainingRecordInput = z.infer<
  typeof CreateTrainingRecordSchema
>;

/**
 * Schema for updating a training record
 */
export const UpdateTrainingRecordSchema = z.object({
  title: z.string().min(3).optional(),
  type: TrainingTypeSchema.optional(),
  status: TrainingStatusSchema.optional(),
  provider: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  startDate: z.string().optional(),
  endDate: z.string().optional().nullable(),
  hoursCompleted: z.coerce.number().int().min(0).optional().nullable(),
  score: z.coerce.number().optional().nullable(),
  passingScore: z.coerce.number().optional().nullable(),
  passed: z.boolean().optional().nullable(),
});

export type UpdateTrainingRecordInput = z.infer<
  typeof UpdateTrainingRecordSchema
>;

/**
 * Schema for listing training records with filters
 */
export const ListTrainingRecordsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  userId: z.string().optional(),
  competenceId: z.coerce.number().optional(),
  status: TrainingStatusSchema.optional(),
  type: TrainingTypeSchema.optional(),
});
