import { z } from "zod";

export const NonConformanceTypeSchema = z.enum([
  "work",
  "equipment",
  "documentation",
  "out_of_tolerance",
]);

export const NonConformanceTriggerSourceSchema = z.enum([
  "manual",
  "as_found_verdict",
  "standard_recall",
]);

export const CreateNonConformanceSchema = z.object({
  type: NonConformanceTypeSchema,
  description: z
    .string()
    .trim()
    .min(10, "Descrição deve ter pelo menos 10 caracteres"),
  detectedAt: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data de detecção inválida",
    }),
  jobId: z.coerce.number().int().positive().optional(),
});

export type CreateNonConformanceInput = z.infer<
  typeof CreateNonConformanceSchema
>;

/**
 * Payload for flagging an approved job as out-of-tolerance (as found).
 * Opens a typed NC and generates the §7.10 customer notification (#426).
 */
export const FlagJobOutOfToleranceSchema = z.object({
  description: z
    .string()
    .trim()
    .min(10, "Descrição deve ter pelo menos 10 caracteres")
    .optional(),
  // Manual scope entry: the customer's affected measurement window/context.
  affectedScope: z.string().trim().max(2000).optional(),
  notifyCustomer: z.boolean().default(true),
});

export type FlagJobOutOfToleranceInput = z.infer<
  typeof FlagJobOutOfToleranceSchema
>;

/**
 * Reverse-traceability impact query (#426 Phase 1): certificates issued using
 * a reference standard between dates. Both bounds optional — the API defaults
 * `from` to the standard's calibrationDate and `to` to now.
 */
export const ImpactedCertificatesQuerySchema = z.object({
  from: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data inicial inválida",
    })
    .optional(),
  to: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data final inválida",
    })
    .optional(),
});

export type ImpactedCertificatesQuery = z.infer<
  typeof ImpactedCertificatesQuerySchema
>;

/**
 * Approval-gated batch send of a standard recall (#426 Phase 1). The reviewed
 * job list is explicit — deselected certificates are simply not sent.
 */
export const SendStandardRecallSchema = z.object({
  jobIds: z
    .array(z.coerce.number().int().positive())
    .min(1, "Selecione ao menos um certificado")
    .max(500, "Máximo de 500 certificados por envio"),
  from: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data inicial inválida",
    })
    .optional(),
  to: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data final inválida",
    })
    .optional(),
});

export type SendStandardRecallInput = z.infer<typeof SendStandardRecallSchema>;

/**
 * Guided §7.10 impact assessment (#426 Phase 2): structured evaluation of an
 * out-of-tolerance event's effect on the customer's measurements. Regulated
 * workflow → schema-first; the web form parses through this schema.
 */
export const OotImpactItemDispositionSchema = z.enum([
  "no_impact",
  "recheck",
  "notify_downstream",
  "other",
]);

export const OotImpactAssessmentItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(3, "Descreva o item/medição afetada")
    .max(500),
  disposition: OotImpactItemDispositionSchema,
  note: z.string().trim().max(1000).optional(),
});

export const OotImpactConclusionSchema = z.enum([
  "no_significant_impact",
  "impact_confirmed",
  "inconclusive",
]);

export const SaveOotImpactAssessmentSchema = z.object({
  deviationSummary: z
    .string()
    .trim()
    .min(10, "Descreva a natureza e magnitude do desvio")
    .max(4000),
  // Magnitude vs. the customer's tolerance band (same unit). Feeds the
  // ~10%-of-tolerance triage HINT in the UI — never an automatic dismissal.
  deviationMagnitude: z.coerce.number().positive().optional(),
  customerTolerance: z.coerce.number().positive().optional(),
  toleranceUnit: z.string().trim().max(50).optional(),
  affectedFrom: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data inicial inválida",
    })
    .optional(),
  affectedTo: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Data final inválida",
    })
    .optional(),
  items: z.array(OotImpactAssessmentItemSchema).max(100).default([]),
  conclusion: OotImpactConclusionSchema.optional(),
  correctiveActionNote: z.string().trim().max(4000).optional(),
});

export type SaveOotImpactAssessmentInput = z.infer<
  typeof SaveOotImpactAssessmentSchema
>;

/**
 * Manual registration of a customer's acknowledgement of a §7.10 notification
 * (phone / e-mail confirmation collected outside the ack link).
 */
export const RegisterOotAcknowledgementSchema = z.object({
  note: z
    .string()
    .trim()
    .min(3, "Descreva como o recebimento foi confirmado")
    .max(2000),
});

export type RegisterOotAcknowledgementInput = z.infer<
  typeof RegisterOotAcknowledgementSchema
>;

export const CapaSourceSchema = z.enum([
  "internal_audit",
  "customer_complaint",
  "nc_detection",
  "external_audit",
  "management_review",
]);

export const CapaTypeSchema = z.enum(["corrective", "preventive"]);

export const CapaSeveritySchema = z.enum(["minor", "major", "critical"]);

export const CapaCategorySchema = z.enum([
  "method",
  "equipment",
  "personnel",
  "procedure",
  "environment",
  "other",
]);

export const CapaRootCauseAnalysisMethodSchema = z.enum([
  "5_whys",
  "fishbone",
  "pareto",
  "other",
]);

function validIsoDate(message: string) {
  return z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message,
    });
}

export const CreateCapaSchema = z.object({
  title: z.string().trim().min(5, "Título deve ter pelo menos 5 caracteres"),
  description: z
    .string()
    .trim()
    .min(10, "Descrição deve ter pelo menos 10 caracteres"),
  source: CapaSourceSchema,
  sourceReference: z.string().trim().optional(),
  detectionDate: validIsoDate("Data de detecção inválida"),
  type: CapaTypeSchema,
  severity: CapaSeveritySchema,
  category: CapaCategorySchema,
  actionPlan: z
    .string()
    .trim()
    .min(10, "Plano de ação deve ter pelo menos 10 caracteres"),
  responsibleId: z.string().trim().min(1, "Responsável é obrigatório"),
  dueDate: validIsoDate("Data alvo inválida"),
  rootCauseAnalysis: z.string().trim().optional(),
  rootCauseAnalysisMethod: CapaRootCauseAnalysisMethodSchema.optional(),
  preventiveMeasures: z.string().trim().optional(),
});

export type CreateCapaInput = z.infer<typeof CreateCapaSchema>;
