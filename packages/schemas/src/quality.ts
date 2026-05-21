import { z } from "zod";

export const NonConformanceTypeSchema = z.enum([
  "work",
  "equipment",
  "documentation",
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
