import { z } from "zod";
export * from "./commercial";
export * from "./imports";
export * from "./leads";
export * from "./portal-fleet";
export * from "./printing";
export * from "./proficiency-tests";
export * from "./quality";
export * from "./reference-standard-kind-map";
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
  // Nome Fantasia (trade name). Display-only; the legal `name` stays the
  // identifier on certificates and fiscal integrations.
  tradeName: z.string().optional(),
  taxId: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: AddressSchema.optional(),
  // Optional parent group (rede). null detaches; omitted leaves unchanged on update.
  groupId: z.number().int().positive().nullable().optional(),
});

/**
 * Schema for creating/updating a customer group (a network/rede of branches).
 */
export const CreateCustomerGroupSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
});

export type CreateCustomerGroupInput = z.infer<
  typeof CreateCustomerGroupSchema
>;

export const AssignCustomerGroupBranchSchema = z.object({
  customerId: z.number().int().positive(),
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
 * Every measurement unit token understood by the kind-aware unit registry
 * (`@calibra-facil/shared/units`). This is a strict *widening* of
 * {@link MassUnitSchema}: old stored snapshots (mass-only) keep parsing, and
 * the list must stay in sync with the registry (asserted by an enum-sync test).
 */
export const MeasurementUnitSchema = z.enum([
  // mass
  "mg",
  "g",
  "kg",
  // length
  "µm",
  "mm",
  "cm",
  "m",
  // temperature
  "°C",
  "°F",
  "K",
  // pressure
  "Pa",
  "kPa",
  "MPa",
  "bar",
  "psi",
  "kgf/cm²",
  "mmHg",
  "inHg",
  // volume
  "µL",
  "mL",
  "L",
  "m³",
  // time
  "ms",
  "s",
  "min",
  "h",
  // torque
  "N·m",
  "kgf·m",
  // humidity
  "%RH",
  // force
  "N",
  "kN",
  "kgf",
  // voltage
  "µV",
  "mV",
  "V",
  "kV",
  // current
  "µA",
  "mA",
  "A",
  // resistance
  "Ω",
  "kΩ",
  "MΩ",
  // frequency
  "Hz",
  "kHz",
  "MHz",
  "rpm",
]);
export type MeasurementUnit = z.infer<typeof MeasurementUnitSchema>;

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
  baseMeasurementUnit: MeasurementUnitSchema.optional().nullable(),
  lastCalibrationDate: z.string().optional(),
  // NO `nextCalibrationDate` here: the calibration interval / next-cal date is the
  // equipment owner's (customer's) decision, set via the portal — the lab never
  // authors it (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24). Keeping the field out of
  // the schema guarantees every consumer (assets API, public API, desktop sync,
  // local-server) strips it instead of having to remember to ignore it.
  // Installation/commissioning date (ISO). Anchors the legal-metrology verification
  // ceiling for `regulated_interval.kind = 'max_months_from_install'` (REQ-INSTALL-002).
  installedAt: z.string().optional(),
  comments: z.string().optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
  // Legal-metrology regime + the regulation-fixed VERIFICATION periodicity (Track 2,
  // independent of the customer-owned calibration interval). `z.lazy` defers to the
  // schemas declared below (declaration order). Spec: specs/legal-metrology-regime.
  metrologyRegime: z.lazy(() => MetrologyRegimeSchema).optional(),
  regulatedInterval: z
    .lazy(() => RegulatedIntervalSchema)
    .nullable()
    .optional(),
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

/**
 * Customer-set calibration interval (portal). The interval/periodicity is the
 * equipment owner's decision, not the lab's (ISO/IEC 17025:2017 §7.8.4.3 +
 * ILAC-G24 / OIML D 10). `rationale` is a required technical record
 * (NBR ISO/IEC 17025 §7.5). The 1–120-month bound keeps intervals sane per
 * ILAC-G24 §6.2.3 (avoid extremely long intervals → mass-recall risk).
 * Spec: `specs/calibration-interval-customer-owned/spec.md` (REQ-INTERVAL-010/011).
 */
export const SetCalibrationIntervalSchema = z.object({
  intervalMonths: z
    .number()
    .int("A periodicidade deve ser um número inteiro de meses")
    .min(1, "A periodicidade deve ser de pelo menos 1 mês")
    .max(120, "A periodicidade deve ser de no máximo 120 meses"),
  rationale: z.string().trim().min(1, "Justificativa é obrigatória"),
  // Provenance of the change: "customer" (manual) or "engine" (the customer applied a
  // reliability-engine suggestion → interval_set_by='engine_applied'). Spec REQ-ENGINE-APPLY-001.
  source: z.enum(["customer", "engine"]).default("customer"),
});

export type SetCalibrationIntervalInput = z.infer<
  typeof SetCalibrationIntervalSchema
>;

/**
 * Legal-metrology regime of an instrument. An instrument under Brazilian legal
 * metrological control (Inmetro / RBMLQ-I) has a verification periodicity FIXED BY
 * REGULATION; this is INDEPENDENT of the customer-owned calibration interval
 * (`SetCalibrationIntervalSchema`) — a regulated instrument the lab also RBC-calibrates
 * carries both. `UNKNOWN` = the lab has not yet determined the enquadramento.
 * Spec: `specs/legal-metrology-regime/spec.md` (REQ-MLR-001).
 */
export const MetrologyRegimeSchema = z.enum(["INDUSTRIAL", "LEGAL", "UNKNOWN"]);
export type MetrologyRegime = z.infer<typeof MetrologyRegimeSchema>;

const regulatedMonths = () =>
  z
    .number()
    .int("A periodicidade deve ser um número inteiro de meses")
    .min(1, "A periodicidade deve ser de pelo menos 1 mês")
    .max(600, "A periodicidade deve ser de no máximo 600 meses");

const regulatedIntervalBase = {
  // The governing act, verbatim (e.g. "Portaria Inmetro nº 157/2022").
  regulationReference: z
    .string()
    .trim()
    .min(1, "A referência do regulamento (Portaria) é obrigatória"),
  // true (balanças/bombas/esfigmo) → the Ipem runs the cronograma, so the derived date is
  // indicative, NOT a hard national deadline.
  operationalizedByDelegate: z.boolean(),
};

/**
 * The regulation-fixed legal-verification periodicity, as a shape-faithful discriminated
 * union (the period is NOT one scalar — research 2026-06-28, primary-sourced):
 *  - `fixed_months`            a fixed national value (taxímetro 24, etilômetro 12) OR an
 *                              annual cadence anchored to the calendar year (balanças/IPNA).
 *  - `max_months_from_install` a ceiling from year of installation (hidrômetros ≤84).
 *  - `per_technology`          resolved per the instrument's technology (gás: diafragma 120 /
 *                              ultrassônico 180 / turbina-rotativo 60).
 *  - `not_nationally_fixed`    no national periodic interval (energia elétrica → cite ANEEL).
 * Spec: `specs/legal-metrology-regime/spec.md` (REQ-MLR-010/011).
 */
export const RegulatedIntervalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixed_months"),
    valueMonths: regulatedMonths(),
    anchor: z.enum(["last_verification", "calendar_year"]),
    ...regulatedIntervalBase,
  }),
  z.object({
    kind: z.literal("max_months_from_install"),
    valueMonths: regulatedMonths(),
    anchor: z.literal("install_year"),
    ...regulatedIntervalBase,
  }),
  z.object({
    kind: z.literal("per_technology"),
    technology: z
      .string()
      .trim()
      .min(1, "A tecnologia do instrumento é obrigatória"),
    valueMonths: regulatedMonths(),
    anchor: z.enum(["last_verification", "first_verification"]),
    ...regulatedIntervalBase,
  }),
  z.object({
    kind: z.literal("not_nationally_fixed"),
    note: z.string().trim().optional(),
    ...regulatedIntervalBase,
  }),
]);

export type RegulatedInterval = z.infer<typeof RegulatedIntervalSchema>;

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
  // How the customer gets the assets to the lab. "onsite" = calibração in loco
  // (a technician travels to the customer). Carrier-only and onsite-only fields
  // below are gated server-side by deliveryMethod (see portal-requests.ts).
  deliveryMethod: z.enum(["dropoff", "carrier", "onsite"]).default("dropoff"),
  invoiceRemittanceNumber: z.string().trim().max(60).optional().nullable(),
  invoiceRemittanceKey: z
    .string()
    .trim()
    .max(60)
    .optional()
    .nullable()
    .refine((value) => !value || /^\d{44}$/.test(value.replace(/\D/g, "")), {
      message: "A chave de acesso deve ter 44 dígitos",
    }),
  carrierName: z.string().trim().max(120).optional().nullable(),
  invoiceRemittanceIssuedAt: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data de emissão inválida",
    })
    .optional()
    .nullable(),
  // On-site only — where the technician visits (defaults to the customer's
  // registered address server-side when omitted) and the customer's preferred
  // visit date (the lab confirms/schedules the actual visit).
  onsiteAddress: AddressSchema.optional().nullable(),
  preferredVisitDate: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data preferida inválida",
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
  // On-site only: schedule one visit for the whole conversion (date + technician).
  // The created jobs link to it via visit_id.
  visit: z
    .object({
      scheduledAt: z
        .string()
        .refine((value) => !Number.isNaN(new Date(value).getTime()), {
          message: "Data da visita invalida",
        })
        .optional()
        .nullable(),
      technicianId: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type ConvertCalibrationRequestInput = z.infer<
  typeof ConvertCalibrationRequestSchema
>;

// =============================================================================
// CALIBRATION VISIT SCHEMAS (on-site / calibração in loco)
// =============================================================================

export const VisitStatusSchema = z.enum([
  "PROPOSED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);
export type VisitStatusValue = z.infer<typeof VisitStatusSchema>;

const isValidDateString = (value: string) =>
  !Number.isNaN(new Date(value).getTime());

export const RescheduleVisitSchema = z.object({
  scheduledAt: z
    .string()
    .refine(isValidDateString, { message: "Data da visita invalida" })
    .optional()
    .nullable(),
  scheduledEndAt: z
    .string()
    .refine(isValidDateString, { message: "Data da visita invalida" })
    .optional()
    .nullable(),
  address: AddressSchema.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type RescheduleVisitInput = z.infer<typeof RescheduleVisitSchema>;

export const ConfirmVisitSchema = z.object({
  scheduledAt: z
    .string()
    .refine(isValidDateString, { message: "Data da visita invalida" })
    .optional()
    .nullable(),
  technicianId: z.string().optional().nullable(),
});

export const AssignVisitTechnicianSchema = z.object({
  technicianId: z.string().min(1, "Tecnico e obrigatorio"),
});

export const CancelVisitSchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
});

export const ListVisitsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: VisitStatusSchema.optional(),
  technicianId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  mine: z.coerce.boolean().optional(),
  rescheduleRequested: z.coerce.boolean().optional(),
});

// #739: portal two-way visit scheduling ------------------------------------

export const VisitReschedulePreferredPeriodSchema = z.enum([
  "MORNING",
  "AFTERNOON",
  "ANY",
]);

export const VisitReschedulePreferredWindowSchema = z.object({
  date: z
    .string()
    .refine(isValidDateString, { message: "Data preferida invalida" }),
  period: VisitReschedulePreferredPeriodSchema.default("ANY"),
  note: z.string().trim().max(200).optional(),
});

/** Portal customer asks the lab to move a visit (does not move the visit). */
export const PortalVisitRescheduleRequestSchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
  preferredWindows: z
    .array(VisitReschedulePreferredWindowSchema)
    .max(3, "Informe no maximo 3 janelas preferidas")
    .default([]),
});
export type PortalVisitRescheduleRequestInput = z.infer<
  typeof PortalVisitRescheduleRequestSchema
>;

/** Lab accepts a reschedule request: the new date the visit moves to. */
export const AcceptVisitRescheduleRequestSchema = z.object({
  scheduledAt: z
    .string()
    .refine(isValidDateString, { message: "Data da visita invalida" }),
  scheduledEndAt: z
    .string()
    .refine(isValidDateString, { message: "Data da visita invalida" })
    .optional()
    .nullable(),
  resolutionNote: z.string().trim().max(1000).optional().nullable(),
});
export type AcceptVisitRescheduleRequestInput = z.infer<
  typeof AcceptVisitRescheduleRequestSchema
>;

export const DeclineVisitRescheduleRequestSchema = z.object({
  resolutionNote: z.string().trim().max(1000).optional().nullable(),
});
export type DeclineVisitRescheduleRequestInput = z.infer<
  typeof DeclineVisitRescheduleRequestSchema
>;

/** REQ-VISITJOB-011: Add a calibration job (instrument) to an on-site visit. */
export const AddVisitJobSchema = z.object({
  assetId: z.number().int().positive("assetId deve ser inteiro positivo"),
  serviceId: z.number().int().positive("serviceId deve ser inteiro positivo"),
});

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
  uncertaintyMode: z.enum(["expanded_rss", "expanded_arithmetic"]).optional(),
  quantityMode: z
    .enum(["linear_per_item_then_rss", "profile_linear"])
    .optional(),
});
export type MassCompositionConfig = z.infer<typeof MassCompositionConfigSchema>;

/**
 * Discipline-agnostic per-row certified-value binding for `standard_value`
 * columns. Parallel to (not a replacement for) MassCompositionConfig: matches
 * each row to a reference standard's certifiedValue by nominal and fills the
 * named target columns. No composition profiles / buoyancy / mass-unit model.
 */
export const StandardValueConfigSchema = z.object({
  matchBy: z.enum(["nominal"]).optional(),
  targetColumns: z
    .object({
      value: z.string().optional(),
      expandedUncertainty: z.string().optional(),
      coverageFactor: z.string().optional(),
      drift: z.string().optional(),
    })
    .optional(),
});
export type StandardValueConfig = z.infer<typeof StandardValueConfigSchema>;

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
  // Semantic role used to pick absolute vs. delta unit conversion for affine
  // kinds (temperature). Kept a permissive string for forward/import
  // compatibility; classified by DELTA_QUANTITY_KINDS in @calibra-facil/shared.
  quantityKind: z.string().optional(),
  phase: z.enum(["before", "after", "always"]).optional(),
  massComposition: MassCompositionConfigSchema.optional(),
  standardValue: StandardValueConfigSchema.optional(),
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
    // Semantic role used to pick absolute vs. delta unit conversion for affine
    // kinds (temperature). Permissive string; classified by DELTA_QUANTITY_KINDS.
    quantityKind: z.string().optional(),
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
      "conformity_verdict",
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
  z.object({
    key: z
      .string()
      .min(1, "Chave é obrigatória")
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        "Chave deve começar com letra e conter apenas letras, números e underscore",
      ),
    label: z.string().optional(),
    source: z.literal("standard_channel"),
    standardId: z.number().int().positive().optional(),
    channelKey: z.string().min(1, "Canal do padrão é obrigatório"),
    property: z.enum([
      "value",
      "correction",
      "uncertainty",
      "coverageFactor",
      "drift",
    ]),
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
  decisionRuleStatement: z.string().max(2000).optional(),
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
  accreditedScope: z.boolean().optional(),
});

export type CreateMethodInput = z.infer<typeof CreateMethodSchema>;

/**
 * Schema for updating a method (only DRAFT status)
 */
export const UpdateMethodSchema = CreateMethodSchema.partial();

/**
 * Body for creating a DRAFT method from a curated template
 * (`@calibra-facil/method-templates`). The route resolves the template's
 * payload; the caller may override the asset type and name.
 */
export const FromTemplateSchema = z.object({
  templateKey: z.string().min(1, "templateKey é obrigatório"),
  assetTypeId: z.coerce.number().nullable().optional(),
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres").optional(),
  // Mandatory informed-adoption acknowledgements (ISO/IEC 17025 §7.2.1.5). The
  // three consent booleans are `z.literal(true)`, so a missing or `false` value
  // is a 400 at validation — adoption is cloud-only, there is no legacy caller.
  // `acceptedVerificarRefs` is checked against the chosen template's
  // action-severity [VERIFICAR] refs in the route handler (which has the
  // template + its governance).
  acknowledgements: z.object({
    readVerificarAndOmitted: z.literal(true),
    acceptsVerificationDuty: z.literal(true),
    understandsDraftGate: z.literal(true),
    acknowledgedAt: z.string(),
    templateVersion: z.number(),
    acceptedVerificarRefs: z.array(z.string()),
  }),
});

export type FromTemplateInput = z.infer<typeof FromTemplateSchema>;

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
// MATERIAL CATALOG SCHEMAS - Peças e materiais (parts consumed on OS)
// =============================================================================

/**
 * Schema for creating a material (part) in the catalog.
 * Costs/prices are stored in cents; both optional ("sob consulta" /
 * cost-not-tracked materials are allowed).
 */
export const CreateMaterialSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  description: z.string().optional().nullable(),
  sku: z
    .string()
    .trim()
    .min(1, "Código não pode ser vazio")
    .max(64, "Código deve ter no máximo 64 caracteres")
    .optional()
    .nullable(),
  unit: z.string().trim().min(1).max(32).default("un"),
  unitCostCents: z.coerce
    .number()
    .int("Custo deve ser um número inteiro (centavos)")
    .min(0, "Custo não pode ser negativo")
    .optional()
    .nullable(),
  unitPriceCents: z.coerce
    .number()
    .int("Preço deve ser um número inteiro (centavos)")
    .min(0, "Preço não pode ser negativo")
    .optional()
    .nullable(),
  controlsStock: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>;

/**
 * Schema for updating a material
 */
export const UpdateMaterialSchema = CreateMaterialSchema.partial();

export type UpdateMaterialInput = z.infer<typeof UpdateMaterialSchema>;

/**
 * Schema for listing materials with filtering
 */
export const ListMaterialsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(),
  controlsStock: z
    .string()
    .optional()
    .transform((val) => {
      if (val === "true") return true;
      if (val === "false") return false;
      return undefined;
    }),
  isActive: z
    .string()
    .optional()
    .transform((val) => {
      if (val === "true") return true;
      if (val === "false") return false;
      return undefined;
    }),
});

export type ListMaterialsQuery = z.infer<typeof ListMaterialsQuerySchema>;

/**
 * Schema for the manual stock adjust (entrada/ajuste): sets the ERP
 * product's absolute on-hand quantity for a catalog-linked material.
 */
export const AdjustMaterialStockSchema = z.object({
  quantityOnHand: z.coerce
    .number()
    .min(0, "Quantidade não pode ser negativa")
    .finite(),
});

export type AdjustMaterialStockInput = z.infer<
  typeof AdjustMaterialStockSchema
>;

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

export const ReferenceStandardKindSchema = z.enum([
  "mass_single",
  "mass_set",
  "thermohygrometer",
  "thermometer",
  "hygrometer",
  "barometer",
  "manometer",
  "dimensional",
  "electrical",
  "time_frequency",
  "volume",
  "force_torque",
  "rpm",
  "generic_scalar",
  "generic_multi_channel",
]);

export type ReferenceStandardKind = z.infer<typeof ReferenceStandardKindSchema>;

export const ReferenceStandardMetrologyPointSchema = z.object({
  reference: z.coerce.number().nullable().optional(),
  indication: z.coerce.number().nullable().optional(),
  meanReading: z.coerce.number().nullable().optional(),
  correction: z.coerce.number().nullable().optional(),
  uncertainty: z.coerce.number().positive().nullable().optional(),
  unit: z.string().min(1, "Unidade é obrigatória"),
  coverageFactor: z.coerce.number().positive().nullable().optional(),
  degreesOfFreedom: z.coerce.number().positive().nullable().optional(),
  degreesOfFreedomOperator: z
    .enum(["exact", "greater_than", "infinity"])
    .default("exact"),
  repeatability: z.coerce.number().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ReferenceStandardMetrologyChannelSchema = z.object({
  key: z.string().min(1, "Canal é obrigatório"),
  label: z.string().min(1, "Nome do canal é obrigatório"),
  quantity: z.string().min(1, "Grandeza é obrigatória"),
  value: z.coerce.number().nullable().optional(),
  correction: z.coerce.number().nullable().optional(),
  uncertainty: z.coerce.number().positive().nullable().optional(),
  unit: z.string().min(1, "Unidade é obrigatória"),
  coverageFactor: z.coerce.number().positive().nullable().optional(),
  drift: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  points: z.array(ReferenceStandardMetrologyPointSchema).default([]),
});

export const ReferenceStandardMassValueSchema = z.object({
  nominal: z.string().min(1, "Valor nominal é obrigatório"),
  authentication: z.string().nullable().optional(),
  value: z.coerce.number({ message: "Valor certificado é obrigatório" }),
  uncertainty: z.coerce.number().positive("Incerteza deve ser positiva"),
  unit: z.string().min(1, "Unidade é obrigatória"),
  maxError: z.coerce.number().nullable().optional(),
  drift: z.coerce.number().nullable().optional(),
  buoyancy: z.coerce.number().nullable().optional(),
  coverageFactor: z.coerce.number().positive().nullable().optional(),
});

export const ReferenceStandardCompositionProfileSchema = z.object({
  profileKey: z.string().min(1, "Perfil é obrigatório"),
  profileClass: z.string().nullable().optional(),
  nominal: z.string().min(1, "Valor nominal é obrigatório"),
  value: z.coerce.number({ message: "Valor certificado é obrigatório" }),
  uncertainty: z.coerce.number().positive("Incerteza deve ser positiva"),
  unit: z.string().min(1, "Unidade é obrigatória"),
  maxError: z.coerce.number().nullable().optional(),
  drift: z.coerce.number().nullable().optional(),
  buoyancy: z.coerce.number().nullable().optional(),
  coverageFactor: z.coerce.number().positive().nullable().optional(),
  quantityAvailable: z.coerce.number().nullable().optional(),
});

/**
 * Mass composition profile catalog — the org-shared, normalized buildup-weight
 * inventory keyed by (organization, class, nominal_g). Edited in the catalog UI
 * (not per-standard). Metrology numbers are gram-canonical (unit defaults "g").
 */
export const MassCompositionProfileCreateSchema = z.object({
  profileKey: z.string().trim().min(1, "Perfil é obrigatório"),
  profileClass: z.string().trim().min(1, "Classe é obrigatória"),
  nominal: z.string().trim().min(1, "Valor nominal é obrigatório"),
  nominalG: z.coerce.number().positive("Nominal (g) deve ser positivo"),
  value: z.coerce.number({ message: "Valor é obrigatório" }),
  uncertainty: z.coerce.number().positive("Incerteza deve ser positiva"),
  unit: z.string().trim().min(1, "Unidade é obrigatória").default("g"),
  maxError: z.coerce.number().nullable().optional(),
  drift: z.coerce.number().nullable().optional(),
  buoyancy: z.coerce.number().nullable().optional(),
  coverageFactor: z.coerce.number().positive().nullable().optional(),
  quantityAvailable: z.coerce
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional(),
});
export type MassCompositionProfileCreateInput = z.infer<
  typeof MassCompositionProfileCreateSchema
>;

export const MassCompositionProfileUpdateSchema =
  MassCompositionProfileCreateSchema.partial();
export type MassCompositionProfileUpdateInput = z.infer<
  typeof MassCompositionProfileUpdateSchema
>;

export const ReferenceStandardMetrologyDataSchema = z
  .object({
    version: z.literal(1).default(1),
    channels: z.array(ReferenceStandardMetrologyChannelSchema).default([]),
    massValues: z.array(ReferenceStandardMassValueSchema).default([]),
    compositionProfiles: z
      .array(ReferenceStandardCompositionProfileSchema)
      .default([]),
    notes: z.string().nullable().optional(),
  })
  .default({
    version: 1,
    channels: [],
    massValues: [],
    compositionProfiles: [],
  });

export type ReferenceStandardMetrologyData = z.infer<
  typeof ReferenceStandardMetrologyDataSchema
>;

export const ReferenceStandardCertificateDocumentSchema = z.object({
  documentId: z.number(),
  r2Key: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  sha256: z.string(),
  uploadedAt: z.string().or(z.date()),
  certificateNumber: z.string(),
  calibrationDate: z.string().or(z.date()),
  nextCalibrationDate: z.string().or(z.date()),
});

export type ReferenceStandardCertificateDocument = z.infer<
  typeof ReferenceStandardCertificateDocumentSchema
>;

/**
 * Certified value for multi-value standards (e.g., weight sets, gauge block sets)
 * Each entry represents one value from the calibration certificate
 */
export const CertifiedValueSchema = z.object({
  nominal: z.string().min(1, "Valor nominal e obrigatorio"),
  authentication: z.string().nullable().optional(),
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
    kind: ReferenceStandardKindSchema.default("generic_scalar"),
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
    metrologyData: ReferenceStandardMetrologyDataSchema.optional().nullable(),
    // Status
    status: ReferenceStandardStatusSchema.default("ACTIVE"),
  })
  .refine(
    (data) => {
      const hasSingleValue =
        data.referenceValue != null && data.uncertainty != null;
      const hasMultiValue =
        data.certifiedValues && data.certifiedValues.length > 0;
      const hasTypedMetrology =
        (data.metrologyData?.channels.length ?? 0) > 0 ||
        (data.metrologyData?.massValues.length ?? 0) > 0 ||
        (data.metrologyData?.compositionProfiles.length ?? 0) > 0;
      return hasSingleValue || hasMultiValue || hasTypedMetrology;
    },
    {
      message:
        "Informe os dados metrológicos do padrão, como canais, valores de massa ou valor de referência",
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
  kind: ReferenceStandardKindSchema.optional(),
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
  metrologyData: ReferenceStandardMetrologyDataSchema.optional().nullable(),
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
  metrologyData: ReferenceStandardMetrologyDataSchema.optional().nullable(),
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
  accreditedScope: z.boolean().optional(),
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
  // DOM-02 (#655): when this calibration is opened from a repair service order
  // flagged "calibration required after repair", record the source OS so the
  // pending-after-repair queue can tell the follow-up was opened. Server
  // re-validates the OS belongs to the caller's org before persisting the link.
  sourceServiceOrderId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .nullable(),
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
  performedAt: z.string().datetime().optional(),
  backdateReason: z.string().trim().min(1).optional(),
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
  // #427 Phase 1: documented scope-violation override. Only honored when the
  // org enforces the CMC guard and the classification is adverse; approving
  // with it downgrades the issuance to non-accredited (seal suppressed).
  scopeOverrideJustification: z.string().max(1000).optional(),
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
  kind: ReferenceStandardKindSchema.optional(),
  type: z.string().nullable().optional(),
  certificateNumber: z.string(),
  calibratedBy: z.string().nullable().optional(),
  calibrationDate: z.string(),
  nextCalibrationDate: z.string().nullable().optional(),
  uncertainty: z.number().nullable(),
  uncertaintyUnit: z.string().nullable(),
  coverageFactor: z.number(),
  distribution: UncertaintyDistributionSchema,
  drift: z.number().nullable(),
  certifiedValues: z.array(CertifiedValueSchema).nullable(),
  metrologyData: ReferenceStandardMetrologyDataSchema.nullable().optional(),
  certificateDocument:
    ReferenceStandardCertificateDocumentSchema.nullable().optional(),
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
 * Quantity kinds understood by the kind-aware unit registry
 * (`@calibra-facil/shared/units`). Must stay in sync with `QuantityKind`.
 */
export const QuantityKindSchema = z.enum([
  "mass",
  "length",
  "temperature",
  "pressure",
  "volume",
  "time",
  "torque",
  "humidity",
  "force",
  "voltage",
  "current",
  "resistance",
  "frequency",
]);

/**
 * Accredited-scope line (CMC) — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14 (#427).
 * CMC(x) = cmcA + cmcB·|x| with x in rangeUnit and the result in cmcUnit;
 * "fixed" ignores cmcB. Upsert payload: `id` present = update.
 */
export const AccreditedScopeLineSchema = z
  .object({
    id: z.number().optional(),
    quantityKind: QuantityKindSchema,
    rangeMin: z.number(),
    rangeMax: z.number(),
    rangeUnit: MeasurementUnitSchema,
    cmcType: z.enum(["fixed", "linear"]).default("fixed"),
    cmcA: z.number().nonnegative("CMC deve ser positiva"),
    cmcB: z.number().nonnegative().nullable().optional(),
    cmcUnit: MeasurementUnitSchema,
    // Optional on purpose (no default): an omitted field on update must
    // preserve the stored value instead of silently resetting it to 2.
    coverageFactor: z.number().positive().optional(),
    description: z.string().max(500).nullable().optional(),
    validFrom: z.string().datetime().nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
  })
  .refine((line) => line.rangeMax >= line.rangeMin, {
    message: "Faixa inválida: o limite superior deve ser maior que o inferior",
    path: ["rangeMax"],
  })
  .refine((line) => line.cmcType === "fixed" || line.cmcB != null, {
    message: "CMC linear exige o coeficiente por unidade de leitura",
    path: ["cmcB"],
  })
  .refine((line) => line.cmcType === "linear" || line.cmcA > 0, {
    message: "CMC fixa deve ser maior que zero",
    path: ["cmcA"],
  });

export type AccreditedScopeLineInput = z.infer<
  typeof AccreditedScopeLineSchema
>;

/**
 * Schema for executing a job (saving worksheet data)
 * Includes selected reference standards for ISO 17025 traceability
 */
/**
 * Cap for the §7.8.2.1(n) deviations note. Exported because the offline path
 * does not run this schema — the local server parses its own payload and the
 * sync apply path only trims — so all three have to agree on the limit or a
 * deviation typed on desktop syncs into a column the cloud API would have
 * rejected.
 */
export const METHOD_DEVIATIONS_MAX_LENGTH = 2000;

export const ExecuteJobSchema = z.object({
  selectedStandardIds: z.array(z.number()).optional(),
  data: z.record(z.string(), z.unknown()),
  results: z.record(z.string(), z.unknown()).optional(),
  environment: EnvironmentalDataSchema.optional(),
  // Persisted on draft saves so the chosen execution date survives a reload.
  performedAt: z.string().datetime().optional(),
  calibrationLocation: CalibrationLocationInputSchema.optional(),
  calibrationPhases: CalibrationPhaseInputSchema.optional(),
  /**
   * ISO/IEC 17025 §7.8.2.1(n) — additions to, deviations from, or exclusions
   * from the method, as actually executed. Recorded by whoever ran the
   * calibration and printed on the certificate.
   *
   * Nullable so a technician can clear a deviation they entered by mistake;
   * `undefined` (absent) leaves the stored value untouched, which matters
   * because the worksheet auto-saves and must not wipe the field on a partial
   * payload.
   */
  methodDeviations: z
    .string()
    .max(METHOD_DEVIATIONS_MAX_LENGTH)
    .optional()
    .nullable(),
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
  "STANDARD_EXPIRED",
  "JOB_OVERDUE",
  "PAYMENT_RECEIVED",
  "PAYMENT_FAILED",
  "NC_CREATED", // ISO 17025 Clause 8.7 - New non-conformance registered
  "NC_ESCALATED_TO_CAPA", // ISO 17025 Clause 8.7 - NC escalated to CAPA
  "OOT_NOTIFICATION_ACKNOWLEDGED", // ISO 17025 Clause 7.10 - Customer acknowledged an OOT notification
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
  "CALIBRATION_REQUEST_SUBMITTED",
  "CALIBRATION_REQUEST_UNDER_REVIEW",
  "CALIBRATION_REQUEST_APPROVED",
  "CALIBRATION_REQUEST_REJECTED",
  "CALIBRATION_REQUEST_CONVERTED",
  "VISIT_SCHEDULED", // On-site visit proposed/assigned to a technician
  "VISIT_CONFIRMED", // On-site visit confirmed (date + technician) for the customer
  "VISIT_RESCHEDULED", // On-site visit date changed
  "VISIT_CANCELLED", // On-site visit cancelled
  "VISIT_REMINDER", // On-site visit coming up soon
  "VISIT_CUSTOMER_CONFIRMED", // Lab-bound (#739): portal customer confirmed attendance
  "VISIT_RESCHEDULE_REQUESTED", // Lab-bound (#739): portal customer asked to reschedule
  "VISIT_RESCHEDULE_DECLINED", // Customer-bound (#739): lab declined the reschedule request
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

/**
 * Customer-facing notification types: the only types the portal notification
 * center lists and whose channel preferences a portal user may edit.
 * Deliberately a subset of the full type union — lab-internal types (jobs,
 * standards, competence, payments, customer success) must never be listed or
 * toggled from a portal session. Keep in sync with the dispatchers in
 * packages/notifications/src/service.ts that address portal recipients.
 */
export const PORTAL_NOTIFICATION_TYPES = [
  "CERTIFICATE_READY",
  "CERTIFICATE_AMENDED",
  "AUDIT_PACK_READY",
  "CALIBRATION_REQUEST_UNDER_REVIEW",
  "CALIBRATION_REQUEST_APPROVED",
  "CALIBRATION_REQUEST_REJECTED",
  "CALIBRATION_REQUEST_CONVERTED",
  "VISIT_CONFIRMED",
  "VISIT_RESCHEDULED",
  "VISIT_CANCELLED",
  "VISIT_REMINDER",
  "VISIT_RESCHEDULE_DECLINED",
  "ASSET_FOUND_OUT_OF_TOLERANCE",
] as const;

export const PortalNotificationTypeSchema = z.enum(PORTAL_NOTIFICATION_TYPES);

export type PortalNotificationType = z.infer<
  typeof PortalNotificationTypeSchema
>;

const PORTAL_NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(
  PORTAL_NOTIFICATION_TYPES,
);

/**
 * Portal notification preferences update. `preferences` keys are validated
 * against the portal whitelist so a portal session cannot toggle lab-internal
 * types; the API merge-writes the map so lab-side keys of dual-role users
 * survive untouched.
 */
export const PortalUpdateNotificationPreferencesSchema = z.object({
  preferences: z
    .record(z.string(), NotificationChannelPreferenceSchema)
    .refine(
      (map) =>
        Object.keys(map).every((key) => PORTAL_NOTIFICATION_TYPE_SET.has(key)),
      { message: "Tipo de notificação não permitido" },
    )
    .optional(),
  emailEnabled: z.boolean().optional(),
  digestFrequency: DigestFrequencySchema.optional(),
});

export type PortalUpdateNotificationPreferencesInput = z.infer<
  typeof PortalUpdateNotificationPreferencesSchema
>;

/**
 * Query for the portal notification center list. Cursor = the last row's id
 * (serial, descending order), so pagination is stable under new inserts.
 */
export const PortalListNotificationsQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  status: NotificationStatusSchema.optional(),
});

export type PortalListNotificationsQuery = z.infer<
  typeof PortalListNotificationsQuerySchema
>;

// =============================================================================
// NON-CONFORMANCE SCHEMAS - ISO 17025:2017 Clause 8.7
// =============================================================================

/**
 * NC type values
 */
// NOTE: shadows the copy star-exported from ./quality — keep both in sync.
export const NonConformanceTypeSchema = z.enum([
  "work",
  "equipment",
  "documentation",
  "out_of_tolerance",
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
  "proficiency_test",
  "spc_signal",
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
