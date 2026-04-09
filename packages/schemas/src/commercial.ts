import { z } from "zod";

const moneySchema = z.coerce.number().int().min(0);
const isoDateSchema = z.string().datetime().or(z.string().date());

export const CommercialOfferKindSchema = z.enum([
  "SETUP_FEE",
  "PLAN_UPFRONT",
  "PLAN_RECURRING",
]);

export const CommercialOfferStatusSchema = z.enum([
  "DRAFT",
  "ISSUED",
  "PENDING_PAYMENT",
  "PAID",
  "ACTIVATED",
  "EXPIRED",
  "CANCELED",
  "SUPERSEDED",
  "FAILED",
]);

export const CommercialProviderModeSchema = z.enum([
  "CHECKOUT",
  "PAYMENT",
  "SUBSCRIPTION",
]);

export const CommercialPaymentMethodSchema = z.enum([
  "PIX",
  "BOLETO",
  "CREDIT_CARD",
]);

export const CommercialOfferAccessEventTypeSchema = z.enum([
  "TOKEN_VALIDATED",
  "TOKEN_INVALID",
  "TOKEN_REVOKED",
  "TOKEN_EXPIRED",
  "TOKEN_TERMINAL",
  "SNAPSHOT_VIEWED",
  "PAYMENT_START_REQUESTED",
  "PAYMENT_STARTED",
  "PAYMENT_RESUMED",
  "STATUS_CHECKED",
  "PROVIDER_REDIRECTED",
]);

export const CommercialPublicCheckoutStateSchema = z.enum([
  "INVALID",
  "EXPIRED",
  "REVOKED",
  "AWAITING_PAYMENT",
  "REDIRECTING",
  "PIX_READY",
  "BOLETO_READY",
  "PAID",
  "OVERDUE",
  "REFUNDED",
  "CANCELED",
]);

export const CommercialPublicStartResultTypeSchema = z.enum([
  "PIX_READY",
  "BOLETO_READY",
  "REDIRECT",
  "PAID",
]);

export const CommercialOfferItemSchema = z.object({
  type: z.enum([
    "PLAN",
    "SETUP_FEE",
    "ONBOARDING_FEE",
    "ADD_ON",
    "DISCOUNT",
    "OTHER",
  ]),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  quantity: z.coerce.number().int().positive().default(1),
  unitAmount: moneySchema,
});

export const CommercialOfferPreviewInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  dealId: z.string().trim().min(1).optional(),
  billingContactId: z.coerce.number().int().positive().optional(),
  kind: CommercialOfferKindSchema,
  basePlanId: z.enum(["STANDARD", "PROFESSIONAL", "ENTERPRISE"]).optional(),
  billingCycle: z.enum(["MONTHLY", "YEARLY"]).optional(),
  contractTermMonths: z.coerce.number().int().positive().max(120).optional(),
  negotiatedAmount: moneySchema,
  discountAmount: moneySchema.optional().default(0),
  setupFeeAmount: moneySchema.optional().default(0),
  dueDate: isoDateSchema.optional(),
  offerExpiresAt: isoDateSchema.optional(),
  paymentMethods: z
    .array(CommercialPaymentMethodSchema)
    .min(1)
    .max(1, "A oferta comercial deve ter apenas um meio de pagamento."),
  customerVisibleDescription: z.string().trim().max(4000).optional(),
  internalNotes: z.string().trim().max(4000).optional(),
  items: z.array(CommercialOfferItemSchema).default([]),
});

export const CreateCommercialOfferSchema =
  CommercialOfferPreviewInputSchema.extend({
    idempotencyKey: z.string().trim().min(8).max(120),
  });

export const SyncBillingCustomerSchema = z.object({
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(255).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(32).optional(),
  taxId: z.string().trim().min(11).max(18).optional(),
  address: z
    .object({
      cep: z.string().trim().optional(),
      street: z.string().trim().optional(),
      number: z.string().trim().optional(),
      complement: z.string().trim().optional(),
      neighbourhood: z.string().trim().optional(),
      city: z.string().trim().optional(),
      state: z.string().trim().optional(),
    })
    .optional(),
});

export const CancelCommercialOfferSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const ReissueCommercialOfferSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  overrides: CommercialOfferPreviewInputSchema.partial(),
});

export type CommercialOfferPreviewInput = z.infer<
  typeof CommercialOfferPreviewInputSchema
>;
export type CreateCommercialOfferInput = z.infer<
  typeof CreateCommercialOfferSchema
>;
export type SyncBillingCustomerInput = z.infer<
  typeof SyncBillingCustomerSchema
>;
export type CancelCommercialOfferInput = z.infer<
  typeof CancelCommercialOfferSchema
>;
export type ReissueCommercialOfferInput = z.infer<
  typeof ReissueCommercialOfferSchema
>;
