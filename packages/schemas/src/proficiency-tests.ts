import { z } from "zod";

/**
 * Proficiency testing & SPC schemas — ISO/IEC 17025 §7.7 (issue #60).
 * Regulated workflow → schema-first; web forms parse through these schemas.
 */

export const PtActivityTypeSchema = z.enum([
  "proficiency_test",
  "interlab_comparison",
]);
export type PtActivityType = z.infer<typeof PtActivityTypeSchema>;

export const PtScoreTypeSchema = z.enum(["en", "z", "z_prime", "zeta"]);
export type PtScoreType = z.infer<typeof PtScoreTypeSchema>;

export const PtOverallStatusSchema = z.enum([
  "pending",
  "satisfactory",
  "questionable",
  "unsatisfactory",
]);
export type PtOverallStatus = z.infer<typeof PtOverallStatusSchema>;

export const SpcChartTypeSchema = z.enum(["i_mr", "xbar_r", "cusum", "ewma"]);
export type SpcChartType = z.infer<typeof SpcChartTypeSchema>;

export const SpcStatusSchema = z.enum([
  "insufficient_data",
  "in_control",
  "trending",
  "out_of_control",
]);
export type SpcStatus = z.infer<typeof SpcStatusSchema>;

function validIsoDate(message: string) {
  return z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message,
    });
}

export const CreateProficiencyTestSchema = z.object({
  activityType: PtActivityTypeSchema.default("proficiency_test"),
  provider: z.string().trim().min(2, "Provedor é obrigatório").max(300),
  providerAccreditation: z.string().trim().max(300).optional(),
  ptRound: z.string().trim().min(1, "Rodada é obrigatória").max(100),
  scopePart: z.string().trim().min(2, "Parte do escopo é obrigatória").max(300),
  metrologyKind: z.string().trim().max(100).optional(),
  standardId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  registrationDate: validIsoDate("Data de inscrição inválida").optional(),
  participationDate: validIsoDate("Data de participação inválida").optional(),
  notes: z.string().trim().max(4000).optional(),
});
export type CreateProficiencyTestInput = z.infer<
  typeof CreateProficiencyTestSchema
>;

export const UpdateProficiencyTestSchema = z.object({
  activityType: PtActivityTypeSchema.optional(),
  provider: z.string().trim().min(2).max(300).optional(),
  providerAccreditation: z.string().trim().max(300).optional().nullable(),
  ptRound: z.string().trim().min(1).max(100).optional(),
  scopePart: z.string().trim().min(2).max(300).optional(),
  metrologyKind: z.string().trim().max(100).optional().nullable(),
  standardId: z.coerce.number().int().positive().optional().nullable(),
  registrationDate: validIsoDate("Data de inscrição inválida")
    .optional()
    .nullable(),
  participationDate: validIsoDate("Data de participação inválida")
    .optional()
    .nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});
export type UpdateProficiencyTestInput = z.infer<
  typeof UpdateProficiencyTestSchema
>;

/**
 * One measured point of the provider's final report. The API computes the
 * score + verdict from these inputs (ISO 13528) — clients never send verdicts.
 */
export const PtResultPointInputSchema = z
  .object({
    label: z.string().trim().min(1, "Ponto de medição é obrigatório").max(200),
    unit: z.string().trim().max(50).optional(),
    labValue: z.coerce.number(),
    labUncertainty: z.coerce.number().nonnegative().optional(),
    refValue: z.coerce.number(),
    refUncertainty: z.coerce.number().nonnegative().optional(),
    sigmaPt: z.coerce.number().positive().optional(),
    scoreType: PtScoreTypeSchema.default("en"),
  })
  .superRefine((point, ctx) => {
    if (point.scoreType === "en" || point.scoreType === "zeta") {
      if (point.labUncertainty === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["labUncertainty"],
          message: "Incerteza do laboratório é obrigatória para En/ζ",
        });
      }
      if (point.refUncertainty === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["refUncertainty"],
          message: "Incerteza do valor de referência é obrigatória para En/ζ",
        });
      }
    } else if (point.sigmaPt === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sigmaPt"],
        message: "σ_pt é obrigatório para escores z/z′",
      });
    }
    if (point.scoreType === "z_prime" && point.refUncertainty === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["refUncertainty"],
        message: "Incerteza do valor designado é obrigatória para z′",
      });
    }
  });
export type PtResultPointInput = z.infer<typeof PtResultPointInputSchema>;

export const RecordPtResultsSchema = z.object({
  resultReportedAt: validIsoDate("Data do relatório inválida"),
  results: z
    .array(PtResultPointInputSchema)
    .min(1, "Informe ao menos um ponto de medição")
    .max(200),
});
export type RecordPtResultsInput = z.infer<typeof RecordPtResultsSchema>;

export const ListProficiencyTestsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  query: z.string().trim().max(200).optional(),
  status: PtOverallStatusSchema.optional(),
  activityType: PtActivityTypeSchema.optional(),
  scopePart: z.string().trim().max(300).optional(),
});
export type ListProficiencyTestsQuery = z.infer<
  typeof ListProficiencyTestsQuerySchema
>;

// --- PT participation plan (NIT-DICLA-026 §9.4; default 4-year cycle) ---

export const CreatePtPlanItemSchema = z.object({
  scopePart: z.string().trim().min(2, "Parte do escopo é obrigatória").max(300),
  riskJustification: z.string().trim().max(2000).optional(),
  frequencyMonths: z.coerce
    .number()
    .int()
    .positive()
    .max(120, "Frequência máxima de 120 meses")
    .default(48),
  unitId: z.coerce.number().int().positive().optional(),
  lastSatisfactoryAt: validIsoDate("Data inválida").optional(),
});
export type CreatePtPlanItemInput = z.infer<typeof CreatePtPlanItemSchema>;

export const UpdatePtPlanItemSchema = z.object({
  scopePart: z.string().trim().min(2).max(300).optional(),
  riskJustification: z.string().trim().max(2000).optional().nullable(),
  frequencyMonths: z.coerce.number().int().positive().max(120).optional(),
  lastSatisfactoryAt: validIsoDate("Data inválida").optional().nullable(),
});
export type UpdatePtPlanItemInput = z.infer<typeof UpdatePtPlanItemSchema>;

// --- SPC: check-standard readings + control charts (17025 §7.7.1) ---

export const CreateCheckStandardReadingSchema = z.object({
  standardId: z.coerce.number().int().positive(),
  parameter: z
    .string()
    .trim()
    .min(1, "Parâmetro/ponto de medição é obrigatório")
    .max(200),
  value: z.coerce.number(),
  uncertainty: z.coerce.number().nonnegative().optional(),
  measuredAt: validIsoDate("Data da medição inválida"),
  sourceJobId: z.coerce.number().int().positive().optional(),
});
export type CreateCheckStandardReadingInput = z.infer<
  typeof CreateCheckStandardReadingSchema
>;

export const ListCheckStandardReadingsQuerySchema = z.object({
  standardId: z.coerce.number().int().positive(),
  parameter: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});
export type ListCheckStandardReadingsQuery = z.infer<
  typeof ListCheckStandardReadingsQuerySchema
>;

export const SpcChartParamsSchema = z.object({
  baselineWindow: z.coerce.number().int().min(4).max(200).optional(),
  centerline: z.coerce.number().optional(),
  sigma: z.coerce.number().positive().optional(),
  subgroupSize: z.coerce.number().int().min(2).max(10).optional(),
  cusumK: z.coerce.number().positive().optional(),
  cusumH: z.coerce.number().positive().optional(),
  ewmaLambda: z.coerce.number().gt(0).lte(1).optional(),
  ewmaK: z.coerce.number().positive().optional(),
  enabledRules: z.array(z.string().max(60)).max(20).optional(),
});
export type SpcChartParamsInput = z.infer<typeof SpcChartParamsSchema>;

export const CreateControlChartSchema = z.object({
  standardId: z.coerce.number().int().positive(),
  parameter: z
    .string()
    .trim()
    .min(1, "Parâmetro/ponto de medição é obrigatório")
    .max(200),
  chartType: SpcChartTypeSchema.default("i_mr"),
  params: SpcChartParamsSchema.optional(),
  unitId: z.coerce.number().int().positive().optional(),
});
export type CreateControlChartInput = z.infer<typeof CreateControlChartSchema>;

export const UpdateControlChartSchema = z.object({
  chartType: SpcChartTypeSchema.optional(),
  params: SpcChartParamsSchema.optional(),
});
export type UpdateControlChartInput = z.infer<typeof UpdateControlChartSchema>;

export const ListControlChartsQuerySchema = z.object({
  standardId: z.coerce.number().int().positive().optional(),
  status: SpcStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListControlChartsQuery = z.infer<
  typeof ListControlChartsQuerySchema
>;

export const EscalateControlChartSchema = z.object({
  description: z
    .string()
    .trim()
    .min(10, "Descrição deve ter pelo menos 10 caracteres")
    .max(4000)
    .optional(),
});
export type EscalateControlChartInput = z.infer<
  typeof EscalateControlChartSchema
>;
