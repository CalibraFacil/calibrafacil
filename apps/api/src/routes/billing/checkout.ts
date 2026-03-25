import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  subscription,
  paymentHistory,
  organization,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { withInvalidation } from "../../middleware/cache";
import { requireFeature } from "../../middleware/tier-guard";
import {
  getPlan,
  getPlanPrice,
  type BillingCycle,
} from "@calibra-facil/shared";
import {
  createCustomer,
  findCustomerByExternalReference,
  createSubscription,
  createCreditCardSubscription,
  getSubscriptionPayments,
  getPaymentPixQrCode,
  getPaymentBoletoLine,
  formatAsaasDate,
  calculatePeriodEnd,
  tokenizeCreditCard,
} from "../../services/asaas";

/* =============================================================================
 * VALIDATION
 * ========================================================================== */

const CreditCardSchema = z.object({
  holderName: z.string().min(3),
  number: z.string().min(13).max(19),
  expiryMonth: z.string().length(2),
  expiryYear: z.string().length(4),
  ccv: z.string().min(3).max(4),
});

const CardHolderInfoSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  cpfCnpj: z.string().min(11).max(14),
  postalCode: z.string().min(8).max(9),
  addressNumber: z.string().min(1),
  addressComplement: z.string().optional(),
  phone: z.string().optional(),
  mobilePhone: z.string().optional(),
});

const TokenizeSchema = z.object({
  creditCard: CreditCardSchema,
  cardHolder: CardHolderInfoSchema,
});

const CreditCardCheckoutSchema = z.object({
  planId: z.enum(["STANDARD", "PROFESSIONAL", "ENTERPRISE"]),
  cycle: z.enum(["MONTHLY", "YEARLY"]),
  creditCardToken: z.string().min(1),
  cardHolder: CardHolderInfoSchema,
});

const PixBoletoCheckoutSchema = z.object({
  planId: z.enum(["STANDARD", "PROFESSIONAL", "ENTERPRISE"]),
  cycle: z.enum(["MONTHLY", "YEARLY"]),
  customerInfo: z
    .object({
      name: z.string().min(3),
      email: z.string().email().optional(),
      cpfCnpj: z.string().min(11).max(14),
      phone: z.string().optional(),
    })
    .optional(),
});

/* =============================================================================
 * ROUTER
 * ========================================================================== */

export const checkoutRouter = new Hono<{ Variables: AuthVariables }>();

/* =============================================================================
 * TOKENIZE (PCI-DSS compliant - card data handled transiently)
 * ========================================================================== */

checkoutRouter.post(
  "/tokenize",
  ...withLabPermission({ billing: ["update"] }),
  requireFeature("financial"),
  zValidator("json", TokenizeSchema),
  async (c) => {
    const input = c.req.valid("json");
    const member = c.get("member");

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, member.organizationId),
    });
    if (!org) return c.json({ error: "Organização não encontrada" }, 404);

    if (!org.cnpj) {
      return c.json(
        {
          error:
            "CNPJ da organização não configurado. Configure nas configurações antes de assinar.",
        },
        400,
      );
    }

    const asaasCustomerId = await ensureAsaasCustomer(org.id, {
      name: org.name,
      cpfCnpj: org.cnpj,
      email: org.email ?? input.cardHolder.email,
      phone: org.phone ?? input.cardHolder.mobilePhone,
    });

    const remoteIp =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip");

    const result = await tokenizeCreditCard({
      customer: asaasCustomerId,
      creditCard: input.creditCard,
      creditCardHolderInfo: input.cardHolder,
      remoteIp,
    });

    return c.json({
      creditCardToken: result.creditCardToken,
      creditCardBrand: result.creditCardBrand,
      creditCardNumber: result.creditCardNumber,
    });
  },
);

/* =============================================================================
 * CREDIT CARD (uses token from /tokenize)
 * ========================================================================== */

checkoutRouter.post(
  "/credit-card",
  ...withLabPermission({ billing: ["update"] }),
  requireFeature("financial"),
  withInvalidation("subscription"),
  zValidator("json", CreditCardCheckoutSchema),
  async (c) => {
    const input = c.req.valid("json");
    const member = c.get("member");

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, member.organizationId),
    });
    if (!org) return c.json({ error: "Organização não encontrada" }, 404);

    const existingSub = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, member.organizationId),
    });

    if (existingSub?.status === "ACTIVE") {
      return c.json({ error: "Já existe assinatura ativa" }, 400);
    }

    if (!org.cnpj) {
      return c.json(
        {
          error:
            "CNPJ da organização não configurado. Configure nas configurações antes de assinar.",
        },
        400,
      );
    }

    const asaasCustomerId = await ensureAsaasCustomer(org.id, {
      name: org.name,
      cpfCnpj: org.cnpj!,
      email: org.email ?? input.cardHolder.email,
      phone: org.phone ?? input.cardHolder.mobilePhone,
    });

    const price = getPlanPrice(input.planId, input.cycle);
    if (!price) return c.json({ error: "Plano inválido" }, 400);

    const now = new Date();
    const plan = getPlan(input.planId);

    // Use SELECT FOR UPDATE to prevent duplicate Asaas subscriptions
    const newSub = await db.transaction(async (tx) => {
      // Upsert local subscription first (without asaasSubscriptionId)
      const subData = {
        organizationId: member.organizationId,
        planId: input.planId,
        billingCycle: input.cycle as BillingCycle,
        status: "TRIAL" as const,
        asaasCustomerId,
        currentPeriodStart: now,
        currentPeriodEnd: calculatePeriodEnd(now, input.cycle),
        nextBillingDate: calculatePeriodEnd(now, input.cycle),
      };

      const [localSub] = await tx
        .insert(subscription)
        .values(subData)
        .onConflictDoUpdate({
          target: subscription.organizationId,
          set: subData,
        })
        .returning();

      if (!localSub) throw new Error("Failed to create subscription");

      // Lock the row and re-read to check for asaasSubscriptionId
      const [lockedSub] = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.id, localSub.id))
        .for("update");

      if (!lockedSub) throw new Error("Failed to lock subscription");

      let asaasSubscriptionId = lockedSub.asaasSubscriptionId;

      // Create Asaas subscription if needed (while holding lock)
      if (!asaasSubscriptionId) {
        const asaasSub = await createCreditCardSubscription({
          customer: asaasCustomerId,
          billingType: "CREDIT_CARD",
          value: price / 100,
          nextDueDate: formatAsaasDate(now),
          cycle: input.cycle,
          description: `CalibraFacil - ${plan.name}`,
          externalReference: member.organizationId,
          creditCardToken: input.creditCardToken,
        });

        asaasSubscriptionId = asaasSub.id;

        await tx
          .update(subscription)
          .set({ asaasSubscriptionId })
          .where(eq(subscription.id, localSub.id));
      }

      await tx
        .update(organization)
        .set({ asaasCustomerId })
        .where(eq(organization.id, member.organizationId));

      return { ...localSub, asaasSubscriptionId };
    });

    return c.json({ subscription: newSub }, 201);
  },
);

/* =============================================================================
 * PIX
 * ========================================================================== */

checkoutRouter.post(
  "/pix",
  ...withLabPermission({ billing: ["update"] }),
  requireFeature("financial"),
  withInvalidation("subscription"),
  zValidator("json", PixBoletoCheckoutSchema),
  async (c) => {
    const input = c.req.valid("json");
    const member = c.get("member");

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, member.organizationId),
    });
    if (!org) return c.json({ error: "Organização não encontrada" }, 404);

    const existingSub = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, member.organizationId),
    });

    if (existingSub?.status === "ACTIVE") {
      return c.json({ error: "Já existe assinatura ativa" }, 400);
    }

    if (!org.cnpj) {
      return c.json(
        {
          error:
            "CNPJ da organização não configurado. Configure nas configurações antes de assinar.",
        },
        400,
      );
    }

    const customerInfo = input.customerInfo ?? {
      name: org.name,
      cpfCnpj: org.cnpj!,
      email: org.email ?? undefined,
      phone: org.phone ?? undefined,
    };

    const asaasCustomerId = await ensureAsaasCustomer(org.id, customerInfo);

    const price = getPlanPrice(input.planId, input.cycle);
    if (!price) return c.json({ error: "Plano inválido" }, 400);

    const now = new Date();
    const plan = getPlan(input.planId);

    // Use SELECT FOR UPDATE to prevent duplicate Asaas subscriptions
    const result = await db.transaction(async (tx) => {
      // Upsert local subscription first
      const subData = {
        organizationId: member.organizationId,
        planId: input.planId,
        billingCycle: input.cycle as BillingCycle,
        status: "TRIAL" as const,
        asaasCustomerId,
        currentPeriodStart: now,
        currentPeriodEnd: calculatePeriodEnd(now, input.cycle),
        nextBillingDate: now,
      };

      const [localSub] = await tx
        .insert(subscription)
        .values(subData)
        .onConflictDoUpdate({
          target: subscription.organizationId,
          set: subData,
        })
        .returning();

      if (!localSub) throw new Error("Failed to create subscription");

      // Lock the row and re-read to check for asaasSubscriptionId
      const [lockedSub] = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.id, localSub.id))
        .for("update");

      if (!lockedSub) throw new Error("Failed to lock subscription");

      let asaasSubscriptionId = lockedSub.asaasSubscriptionId;

      // Create Asaas subscription if needed (while holding lock)
      if (!asaasSubscriptionId) {
        const asaasSub = await createSubscription({
          customer: asaasCustomerId,
          billingType: "PIX",
          value: price / 100,
          nextDueDate: formatAsaasDate(now),
          cycle: input.cycle,
          description: `CalibraFacil - ${plan.name}`,
          externalReference: member.organizationId,
        });

        asaasSubscriptionId = asaasSub.id;

        await tx
          .update(subscription)
          .set({ asaasSubscriptionId })
          .where(eq(subscription.id, localSub.id));
      }

      // Fetch payment info (while holding lock)
      const payments = await getSubscriptionPayments(asaasSubscriptionId, {
        limit: 1,
      });
      const payment = payments.data?.[0];

      let pix = null;
      let qrCodeError = false;

      if (payment) {
        // Try to fetch QR code, but don't fail the transaction if it fails
        try {
          const qr = await getPaymentPixQrCode(payment.id);
          pix = {
            qrCodeImage: `data:image/png;base64,${qr.encodedImage}`,
            payload: qr.payload,
            expirationDate: qr.expirationDate,
          };
        } catch (error) {
          console.error(
            `Failed to fetch PIX QR code for payment ${payment.id}:`,
            error,
          );
          qrCodeError = true;
          // Continue without QR code - user can refresh to get it
        }

        // Insert payment history (with or without QR code data)
        await tx
          .insert(paymentHistory)
          .values({
            subscriptionId: localSub.id,
            organizationId: member.organizationId,
            asaasPaymentId: payment.id,
            amount: price,
            currency: "BRL",
            paymentMethod: "PIX",
            status: "PENDING",
            source: "CHECKOUT",
            dueDate: new Date(payment.dueDate),
            asaasPixQrCodeUrl: pix?.qrCodeImage,
            asaasPixPayload: pix?.payload,
          })
          .onConflictDoNothing({ target: paymentHistory.asaasPaymentId });
      }

      return {
        subscriptionId: localSub.id,
        asaasSubscriptionId,
        pix,
        paymentId: payment?.id,
        qrCodeError,
      };
    });

    return c.json(
      {
        ...result,
        status: "PENDING",
        // Let frontend know if QR code needs to be fetched again
        ...(result.qrCodeError && {
          warning:
            "QR Code indisponível no momento. Atualize a página para tentar novamente.",
        }),
      },
      201,
    );
  },
);

/* =============================================================================
 * BOLETO (MESMA LÓGICA DO PIX)
 * ========================================================================== */

checkoutRouter.post(
  "/boleto",
  ...withLabPermission({ billing: ["update"] }),
  requireFeature("financial"),
  withInvalidation("subscription"),
  zValidator("json", PixBoletoCheckoutSchema),
  async (c) => {
    const input = c.req.valid("json");
    const member = c.get("member");

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, member.organizationId),
    });
    if (!org) return c.json({ error: "Organização não encontrada" }, 404);

    const existingSub = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, member.organizationId),
    });

    if (existingSub?.status === "ACTIVE") {
      return c.json({ error: "Já existe assinatura ativa" }, 400);
    }

    const price = getPlanPrice(input.planId, input.cycle);
    if (!price) return c.json({ error: "Plano inválido" }, 400);

    if (!org.cnpj) {
      return c.json(
        {
          error:
            "CNPJ da organização não configurado. Configure nas configurações antes de assinar.",
        },
        400,
      );
    }

    const asaasCustomerId = await ensureAsaasCustomer(org.id, {
      name: org.name,
      cpfCnpj: org.cnpj!,
      email: org.email ?? undefined,
      phone: org.phone ?? undefined,
    });

    const now = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const plan = getPlan(input.planId);

    // Use SELECT FOR UPDATE to prevent duplicate Asaas subscriptions
    const result = await db.transaction(async (tx) => {
      // Upsert local subscription first
      const subData = {
        organizationId: member.organizationId,
        planId: input.planId,
        billingCycle: input.cycle as BillingCycle,
        status: "TRIAL" as const,
        asaasCustomerId,
        currentPeriodStart: now,
        currentPeriodEnd: calculatePeriodEnd(now, input.cycle),
        nextBillingDate: dueDate,
      };

      const [localSub] = await tx
        .insert(subscription)
        .values(subData)
        .onConflictDoUpdate({
          target: subscription.organizationId,
          set: subData,
        })
        .returning();

      if (!localSub) throw new Error("Failed to create subscription");

      // Lock the row and re-read to check for asaasSubscriptionId
      const [lockedSub] = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.id, localSub.id))
        .for("update");

      if (!lockedSub) throw new Error("Failed to lock subscription");

      let asaasSubscriptionId = lockedSub.asaasSubscriptionId;

      // Create Asaas subscription if needed (while holding lock)
      if (!asaasSubscriptionId) {
        const asaasSub = await createSubscription({
          customer: asaasCustomerId,
          billingType: "BOLETO",
          value: price / 100,
          nextDueDate: formatAsaasDate(dueDate),
          cycle: input.cycle,
          description: `CalibraFacil - ${plan.name}`,
          externalReference: member.organizationId,
        });

        asaasSubscriptionId = asaasSub.id;

        await tx
          .update(subscription)
          .set({ asaasSubscriptionId })
          .where(eq(subscription.id, localSub.id));
      }

      // Fetch payment info (while holding lock)
      const payments = await getSubscriptionPayments(asaasSubscriptionId, {
        limit: 1,
      });
      const payment = payments.data?.[0];

      let boleto = null;
      let boletoError = false;

      if (payment) {
        // Try to fetch boleto line, but don't fail the transaction if it fails
        try {
          const line = await getPaymentBoletoLine(payment.id);
          boleto = {
            bankSlipUrl: payment.bankSlipUrl,
            barCode: line.barCode,
            identificationField: line.identificationField,
            dueDate: payment.dueDate,
          };
        } catch (error) {
          console.error(
            `Failed to fetch boleto line for payment ${payment.id}:`,
            error,
          );
          boletoError = true;
          // Still include bankSlipUrl if available
          if (payment.bankSlipUrl) {
            boleto = {
              bankSlipUrl: payment.bankSlipUrl,
              barCode: null,
              identificationField: null,
              dueDate: payment.dueDate,
            };
          }
        }

        // Insert payment history (with or without boleto line data)
        await tx
          .insert(paymentHistory)
          .values({
            subscriptionId: localSub.id,
            organizationId: member.organizationId,
            asaasPaymentId: payment.id,
            amount: price,
            currency: "BRL",
            paymentMethod: "BOLETO",
            status: "PENDING",
            source: "CHECKOUT",
            dueDate: new Date(payment.dueDate),
            asaasBankSlipUrl: payment.bankSlipUrl,
          })
          .onConflictDoNothing({ target: paymentHistory.asaasPaymentId });
      }

      return {
        subscriptionId: localSub.id,
        boleto,
        paymentId: payment?.id,
        boletoError,
      };
    });

    return c.json(
      {
        ...result,
        status: "PENDING",
        // Let frontend know if boleto line needs to be fetched again
        ...(result.boletoError && {
          warning:
            "Linha digitável indisponível no momento. O boleto ainda pode ser acessado pelo link.",
        }),
      },
      201,
    );
  },
);

/* =============================================================================
 * STATUS - Poll for payment confirmation
 * ========================================================================== */

checkoutRouter.get(
  "/status/:subscriptionId",
  ...withLabPermission({ billing: ["read"] }),
  requireFeature("financial"),
  async (c) => {
    const subscriptionId = parseInt(c.req.param("subscriptionId"), 10);
    const member = c.get("member");

    if (isNaN(subscriptionId)) {
      return c.json({ error: "Invalid subscription ID" }, 400);
    }

    // Get subscription
    const sub = await db.query.subscription.findFirst({
      where: eq(subscription.id, subscriptionId),
    });

    if (!sub) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    // Verify ownership
    if (sub.organizationId !== member.organizationId) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    // Get latest payment for this subscription
    const latestPayment = await db.query.paymentHistory.findFirst({
      where: eq(paymentHistory.subscriptionId, subscriptionId),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    });

    return c.json({
      subscription: {
        id: sub.id,
        status: sub.status,
        planId: sub.planId,
        billingCycle: sub.billingCycle,
      },
      payment: latestPayment
        ? {
            id: latestPayment.id,
            status: latestPayment.status,
            source: latestPayment.source,
            paidAt: latestPayment.paidAt,
          }
        : null,
      // Convenience flags for frontend
      isActive: sub.status === "ACTIVE",
      isPaid: latestPayment?.status === "RECEIVED",
      isConfirmedByWebhook: latestPayment?.source === "WEBHOOK",
    });
  },
);

/* =============================================================================
 * HELPERS
 * ========================================================================== */

async function ensureAsaasCustomer(
  orgId: string,
  customer: {
    name: string;
    cpfCnpj: string;
    email?: string;
    phone?: string;
  },
): Promise<string> {
  // Use SELECT FOR UPDATE to lock the organization row and prevent race conditions.
  // This ensures only one request at a time can create a customer for this org.
  return await db.transaction(async (tx) => {
    // Lock the row - other requests will wait here
    const [lockedOrg] = await tx
      .select({ asaasCustomerId: organization.asaasCustomerId })
      .from(organization)
      .where(eq(organization.id, orgId))
      .for("update");

    // Fast path: another request already created the customer
    if (lockedOrg?.asaasCustomerId) {
      return lockedOrg.asaasCustomerId;
    }

    // Check if customer exists in Asaas by external reference
    const existing = await findCustomerByExternalReference(orgId);
    if (existing) {
      await tx
        .update(organization)
        .set({ asaasCustomerId: existing.id })
        .where(eq(organization.id, orgId));
      return existing.id;
    }

    // No customer exists - create one
    const created = await createCustomer({
      name: customer.name,
      cpfCnpj: customer.cpfCnpj.replace(/\D/g, ""),
      email: customer.email,
      phone: customer.phone,
      externalReference: orgId,
    });

    // Save to org
    await tx
      .update(organization)
      .set({ asaasCustomerId: created.id })
      .where(eq(organization.id, orgId));

    return created.id;
  });
}
