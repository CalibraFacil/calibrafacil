import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  commercialOffer,
  organization,
  subscription,
} from "@calibra-facil/db/schema";
import { SelfServeCheckoutSchema } from "@calibra-facil/schemas";
import {
  checkSelfServeEligibility,
  getPlan,
  getPlanPrice,
} from "@calibra-facil/shared";

import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { issueCommercialOffer } from "../../services/commercial/issue";
import {
  buildSelfServeIdempotencyKey,
  findStartedSelfServeOffer,
  supersedeUnstartedSelfServeOffers,
} from "../../services/commercial/self-serve-offer";

/**
 * Turns "I want the Profissional plan" into a payable checkout link, without an
 * operator in the loop.
 *
 * Two properties matter more than convenience here:
 *
 * - **The price is never accepted from the client.** The amount is read from
 *   `PLAN_PRICES` on the server for the requested plan and cycle. The existing
 *   offer machinery takes an operator-typed `negotiatedAmount`, which is right
 *   for a negotiated deal and wrong for a public one — anyone could otherwise
 *   post their own discount.
 * - **Clicking twice does not create two offers.** Offer issuance has an
 *   `idempotencyKey` field that nothing enforces, so this route reuses an open
 *   offer for the same plan and cycle instead of minting a second one (which
 *   would also mean a second ASAAS customer sync).
 * - **Changing your mind does not leave a payable link behind.** Picking a
 *   different plan or cycle supersedes the checkouts that were never started,
 *   so only one self-serve link is ever live for an organization.
 */

const SELF_SERVE_PAYMENT_METHODS = ["PIX", "BOLETO", "CREDIT_CARD"] as const;

export const selfServeCheckoutRouter = new Hono<{
  Variables: AuthVariables;
}>().post(
  "/",
  ...withLabPermission({ billing: ["update"] }),
  zValidator("json", SelfServeCheckoutSchema),
  async (c) => {
    const memberData = c.get("member");
    const session = c.get("session");
    const input = c.req.valid("json");

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, memberData.organizationId),
    });

    if (!org) {
      return c.json({ error: "Organização não encontrada" }, 404);
    }

    // The payment customer cannot be created without it, and failing here
    // with a clear message beats failing inside the provider call.
    if (!org.cnpj || org.cnpj.trim().length === 0) {
      return c.json(
        {
          error:
            "Informe o CNPJ do laboratório nas configurações antes de assinar.",
          code: "CNPJ_REQUIRED",
        },
        422,
      );
    }

    // Refuse to be the path that creates a double charge: replacing a live
    // provider subscription is not implemented (see checkSelfServeEligibility).
    const currentSubscription = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, memberData.organizationId),
    });
    const eligibility = checkSelfServeEligibility(currentSubscription);
    if (!eligibility.ok) {
      return c.json(
        { error: eligibility.message, code: eligibility.code },
        409,
      );
    }

    const paymentMethod = resolvePaymentMethod(c.req.query("pagamento"));
    // Typed nullable because FREE has no price; the schema only admits paid
    // plans here, so a null would mean the price table lost a tier.
    const amount = getPlanPrice(input.planId, input.billingCycle);
    if (amount === null) {
      return c.json({ error: "Plano sem preço publicado" }, 422);
    }

    const existing = await findReusableOffer({
      organizationId: memberData.organizationId,
      planId: input.planId,
      billingCycle: input.billingCycle,
      paymentMethod,
      amount,
    });

    // A checkout the customer already started leaves a payable Pix, boleto or
    // card subscription at Asaas. Handing them a second one is how somebody
    // ends up paying twice, so they are sent back to finish or abandon the
    // first. Cancelling it here instead would risk voiding a charge the
    // customer has already paid and whose webhook has not landed yet.
    const started = await findStartedSelfServeOffer(memberData.organizationId);
    if (started && started.id !== existing?.id) {
      return c.json(
        {
          error:
            "Você já tem um pagamento em aberto. Conclua ou aguarde o vencimento dele antes de escolher outro plano.",
          code: "CHECKOUT_ALREADY_STARTED",
          checkoutPath: started.checkoutPath,
        },
        409,
      );
    }

    if (existing) {
      await retireSupersededOffers({
        organizationId: memberData.organizationId,
        keepOfferId: existing.id,
        actorUserId: session.user.id,
      });

      return c.json({
        checkoutPath: existing.customerCheckoutUrlPath,
        offerId: existing.id,
        reused: true,
      });
    }

    const plan = getPlan(input.planId);

    const offer = await issueCommercialOffer(
      {
        organizationId: memberData.organizationId,
        kind: "PLAN_RECURRING",
        basePlanId: input.planId,
        billingCycle: input.billingCycle,
        negotiatedAmount: amount,
        discountAmount: 0,
        setupFeeAmount: 0,
        paymentMethods: [paymentMethod],
        customerVisibleDescription: `Plano ${plan.name} — assinatura ${
          input.billingCycle === "YEARLY" ? "anual" : "mensal"
        }`,
        internalNotes: "Assinatura contratada pelo cadastro self-serve.",
        items: [],
      },
      session.user.id,
      buildSelfServeIdempotencyKey({
        organizationId: memberData.organizationId,
        planId: input.planId,
        billingCycle: input.billingCycle,
        nonce: randomUUID(),
      }),
    );

    await retireSupersededOffers({
      organizationId: memberData.organizationId,
      keepOfferId: offer.id,
      actorUserId: session.user.id,
    });

    return c.json({
      checkoutPath: offer.customerCheckoutUrlPath,
      offerId: offer.id,
      reused: false,
    });
  },
);

/**
 * Superseding an abandoned checkout is housekeeping, not part of buying: the
 * customer already has a working link either way. A failure here must not turn
 * a successful purchase into an error, so it is logged and swallowed.
 */
async function retireSupersededOffers(params: {
  organizationId: string;
  keepOfferId: string;
  actorUserId: string;
}) {
  try {
    await db.transaction((tx) =>
      supersedeUnstartedSelfServeOffers(tx, {
        organizationId: params.organizationId,
        keepOfferId: params.keepOfferId,
        actorUserId: params.actorUserId,
        reason: "Substituída por outro plano escolhido no cadastro self-serve.",
      }),
    );
  } catch (error) {
    console.error("Failed to supersede stale self-serve offers", error);
  }
}

function resolvePaymentMethod(raw: string | undefined) {
  const candidate = raw?.trim().toUpperCase();
  const match = SELF_SERVE_PAYMENT_METHODS.find(
    (method) => method === candidate,
  );

  // Card by default: it is the only method that renews without the customer
  // having to pay a boleto or a PIX every cycle.
  return match ?? "CREDIT_CARD";
}

/**
 * An offer still awaiting payment for exactly the same plan, cycle, method and
 * price can be handed back instead of issuing another one.
 */
async function findReusableOffer(params: {
  organizationId: string;
  planId: string;
  billingCycle: string;
  paymentMethod: string;
  amount: number;
}) {
  const open = await db.query.commercialOffer.findFirst({
    where: and(
      eq(commercialOffer.organizationId, params.organizationId),
      eq(commercialOffer.status, "PENDING_PAYMENT"),
      eq(commercialOffer.kind, "PLAN_RECURRING"),
    ),
    orderBy: [desc(commercialOffer.createdAt)],
  });

  if (!open || !open.customerCheckoutUrlPath) return null;

  const offerMethods = Array.isArray(open.paymentMethods)
    ? open.paymentMethods
    : [];
  const sameShape =
    open.basePlanId === params.planId &&
    open.billingCycle === params.billingCycle &&
    offerMethods.length === 1 &&
    offerMethods[0] === params.paymentMethod &&
    open.totalAmount === params.amount;

  return sameShape ? open : null;
}
