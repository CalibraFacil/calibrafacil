import { z } from "zod";

export const NonConformanceTypeSchema = z.enum([
  "work",
  "equipment",
  "documentation",
  "out_of_tolerance",
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
  // null: a client that clears the field sends it explicitly.
  jobId: z.coerce.number().int().positive().nullish(),
});

export type CreateNonConformanceInput = z.infer<
  typeof CreateNonConformanceSchema
>;

/**
 * Payload for flagging an approved job as out-of-tolerance (as found).
 * Opens a typed NC and generates the §7.10 customer notification.
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

/**
 * Reverse-traceability impact query: certificates issued using
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

/**
 * Approval-gated batch send of a standard recall. The reviewed
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

/**
 * Guided §7.10 impact assessment: structured evaluation of an
 * out-of-tolerance event's effect on the customer's measurements. Regulated
 * workflow → schema-first; the web form parses through this schema.
 */
export const OotImpactItemDispositionSchema = z.enum([
  "no_impact",
  "recheck",
  "notify_downstream",
  "other",
]);

const OotImpactAssessmentItemSchema = z.object({
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

export const CorrectiveActionSourceSchema = z.enum([
  "internal_audit",
  "customer_complaint",
  "nc_detection",
  "external_audit",
  "management_review",
  "proficiency_test",
  "spc_signal",
]);

export const CorrectiveActionTypeSchema = z.enum(["corrective", "preventive"]);

export const CorrectiveActionSeveritySchema = z.enum([
  "minor",
  "major",
  "critical",
]);

export const CorrectiveActionCategorySchema = z.enum([
  "method",
  "equipment",
  "personnel",
  "procedure",
  "environment",
  "other",
]);

export const RootCauseAnalysisMethodSchema = z.enum([
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

/**
 * The one CAPA create payload: the contract, the server and the web form all
 * parse through it. The optional fields accept null because API clients send
 * an explicit null for "none".
 */
export const CreateCapaSchema = z.object({
  title: z.string().trim().min(5, "Título deve ter pelo menos 5 caracteres"),
  description: z
    .string()
    .trim()
    .min(10, "Descrição deve ter pelo menos 10 caracteres"),
  source: CorrectiveActionSourceSchema,
  sourceReference: z.string().trim().nullish(),
  detectionDate: validIsoDate("Data de detecção inválida"),
  type: CorrectiveActionTypeSchema,
  severity: CorrectiveActionSeveritySchema,
  category: CorrectiveActionCategorySchema,
  actionPlan: z
    .string()
    .trim()
    .min(10, "Plano de ação deve ter pelo menos 10 caracteres"),
  responsibleId: z.string().trim().min(1, "Responsável é obrigatório"),
  dueDate: validIsoDate("Data alvo inválida"),
  rootCauseAnalysis: z.string().trim().nullish(),
  rootCauseAnalysisMethod: RootCauseAnalysisMethodSchema.nullish(),
  preventiveMeasures: z.string().trim().nullish(),
});

export type CreateCapaInput = z.infer<typeof CreateCapaSchema>;
