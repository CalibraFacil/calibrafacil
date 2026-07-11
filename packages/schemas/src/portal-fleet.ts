import { z } from "zod";

/**
 * Portal fleet reliability analytics + asset OOT impact assessment (#740).
 * The assessment is a regulated record (ISO 9001 §7.1.5.2 / IATF 16949
 * §7.1.5.2.1) → schema-first; the API validates every write through these.
 */

export const FleetAnalyticsQuerySchema = z.object({
  /** Trailing window in months (default 24, max 60). */
  periodMonths: z.coerce.number().int().positive().max(60).default(24),
  bucket: z.enum(["quarter", "year"]).default("quarter"),
  assetTypeId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
});
export type FleetAnalyticsQuery = z.infer<typeof FleetAnalyticsQuerySchema>;

export const AssetOotImpactDecisionSchema = z.enum([
  "NO_IMPACT",
  "IMPACT_CONTAINED",
  "IMPACT_ESCALATED",
]);
export type AssetOotImpactDecisionInput = z.infer<
  typeof AssetOotImpactDecisionSchema
>;

function validIsoDate(message: string) {
  return z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message,
    });
}

export const RecordOotImpactAssessmentSchema = z
  .object({
    decision: AssetOotImpactDecisionSchema,
    rationale: z
      .string()
      .trim()
      .min(10, "Descreva a avaliação de impacto (mínimo 10 caracteres)")
      .max(4000),
    affectedPeriodStart: validIsoDate("Data inicial inválida").optional(),
    affectedPeriodEnd: validIsoDate("Data final inválida").optional(),
    // IATF 16949 §7.1.5.2.1
    suspectProductShipped: z.boolean().optional(),
    customerNotified: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (
      input.affectedPeriodStart &&
      input.affectedPeriodEnd &&
      new Date(input.affectedPeriodStart) > new Date(input.affectedPeriodEnd)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["affectedPeriodEnd"],
        message: "Período afetado: data final anterior à inicial",
      });
    }
    if (input.suspectProductShipped && input.customerNotified === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["customerNotified"],
        message:
          "Informe se os clientes afetados foram notificados (IATF 16949 §7.1.5.2.1)",
      });
    }
  });
export type RecordOotImpactAssessmentInput = z.infer<
  typeof RecordOotImpactAssessmentSchema
>;
