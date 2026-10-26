import { z } from "zod";

/** Shortest justification accepted for issuing unsigned on purpose (Q51). */
export const UNSIGNED_ISSUANCE_REASON_MIN_LENGTH = 15;
export const UNSIGNED_ISSUANCE_REASON_MAX_LENGTH = 500;

/**
 * Per-unit "emitir sem assinatura digital" setting (decision Q51): once a unit
 * has had a signing certificate, issuance fails closed when none is valid, and
 * this explicit, audited choice is the only way to issue unsigned again. It is
 * never set implicitly. Enabling needs a justification; disabling needs none.
 */
export const UnsignedIssuanceSettingSchema = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(true),
    reason: z
      .string()
      .trim()
      .min(
        UNSIGNED_ISSUANCE_REASON_MIN_LENGTH,
        `Informe a justificativa (mínimo de ${UNSIGNED_ISSUANCE_REASON_MIN_LENGTH} caracteres)`,
      )
      .max(UNSIGNED_ISSUANCE_REASON_MAX_LENGTH),
  }),
  z.object({ enabled: z.literal(false) }),
]);

export type UnsignedIssuanceSettingInput = z.infer<
  typeof UnsignedIssuanceSettingSchema
>;
