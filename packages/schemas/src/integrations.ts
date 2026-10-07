import { z } from "zod";

/**
 * The OAuth application a laboratory registers on Conta Azul's developer
 * portal. Conta Azul issues the pair as soon as the application is created,
 * with no review. The secret is stored encrypted and never sent back to the
 * browser; the format is left open (non-blank, no spaces) because Conta Azul
 * does not document it.
 */
export const ContaAzulAppCredentialsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, "Informe o Client ID.")
    .max(200, "O Client ID tem no máximo 200 caracteres.")
    .regex(/^\S+$/, "O Client ID não tem espaços."),
  clientSecret: z
    .string()
    .trim()
    .min(1, "Informe o Client Secret.")
    .max(500, "O Client Secret tem no máximo 500 caracteres.")
    .regex(/^\S+$/, "O Client Secret não tem espaços."),
});

export type ContaAzulAppCredentialsInput = z.infer<
  typeof ContaAzulAppCredentialsSchema
>;
