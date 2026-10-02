import { z } from "zod";

import {
  checkSignupEmail,
  isValidCnpj,
  normalizeCnpj,
  SIGNUP_EMAIL_REJECTION_MESSAGES,
} from "@calibra-facil/shared";

/**
 * Public, unauthenticated self-serve sign-up for a laboratory.
 *
 * The account is opened without an invite, so the e-mail is the whole
 * gatekeeper: it must belong to the laboratory's own domain. The rule lives in
 * `@calibra-facil/shared` (`checkSignupEmail`) so the browser, this schema and
 * the API all refuse exactly the same addresses, with the same wording.
 */
export const SelfServeSignupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(200)
    .superRefine((value, ctx) => {
      const check = checkSignupEmail(value);
      if (check.ok) return;
      ctx.addIssue({
        code: "custom",
        message: SIGNUP_EMAIL_REJECTION_MESSAGES[check.reason],
      });
    }),
  labName: z.string().trim().min(2).max(160),
  // Required, and not as bureaucracy: billing cannot create the payment
  // customer without it (`ensureBillingCustomer` refuses a blank CNPJ), so
  // collecting it later would mean a dead end at the checkout step.
  cnpj: z
    .string()
    .trim()
    .transform((value) => normalizeCnpj(value))
    .refine((value) => isValidCnpj(value), {
      message: "Informe um CNPJ válido.",
    }),
  phone: z.string().trim().max(40).optional().default(""),
  /** Honeypot — bots fill it, the API accepts and discards so they learn nothing. */
  website: z.string().trim().max(200).optional().default(""),
});
export type SelfServeSignupInput = z.infer<typeof SelfServeSignupSchema>;

/**
 * Turning an organization the visitor just created into a payable checkout.
 * Authenticated (the owner), so it carries no identity of its own.
 */
export const SelfServeCheckoutSchema = z.object({
  planId: z.enum(["STANDARD", "PROFESSIONAL", "ADVANCED"]),
  billingCycle: z.enum(["MONTHLY", "YEARLY"]),
});
export type SelfServeCheckoutInput = z.infer<typeof SelfServeCheckoutSchema>;
