import type { ReissueCommercialOfferInput } from "@calibra-facil/schemas";
import { db } from "@calibra-facil/db";
import { commercialOffer } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { issueCommercialOffer } from "./issue";
import { getOfferById, insertOfferHistory } from "./common";

export function resolveReissueItems(
  overrides: ReissueCommercialOfferInput["overrides"],
  termsSnapshot: Record<string, unknown>,
) {
  const originalItems = Array.isArray(termsSnapshot.items)
    ? (termsSnapshot.items as NonNullable<
        ReissueCommercialOfferInput["overrides"]["items"]
      >)
    : [];

  return overrides.items ?? originalItems;
}

export async function reissueCommercialOffer(
  offerId: string,
  input: ReissueCommercialOfferInput,
  actorUserId: string,
) {
  const current = await getOfferById(offerId);
  if (!current) {
    throw new Error("Oferta original não encontrada");
  }

  const terms = (current.termsSnapshot ?? {}) as Record<string, unknown>;
  const merged = {
    organizationId: current.organizationId,
    dealId: current.dealId,
    billingContactId:
      typeof terms.billingContactId === "number"
        ? terms.billingContactId
        : undefined,
    kind: current.kind,
    basePlanId:
      (input.overrides.basePlanId ?? current.basePlanId ?? undefined) as
        | "STANDARD"
        | "PROFESSIONAL"
        | "ENTERPRISE"
        | undefined,
    billingCycle:
      (input.overrides.billingCycle ?? current.billingCycle ?? undefined) as
        | "MONTHLY"
        | "YEARLY"
        | undefined,
    contractTermMonths:
      input.overrides.contractTermMonths ?? current.contractTermMonths ?? undefined,
    negotiatedAmount:
      input.overrides.negotiatedAmount ?? Number(terms.totalAmount ?? current.totalAmount),
    discountAmount: input.overrides.discountAmount ?? current.discountAmount,
    setupFeeAmount: input.overrides.setupFeeAmount ?? 0,
    dueDate:
      input.overrides.dueDate ??
      (current.dueDate ? current.dueDate.toISOString() : undefined),
    offerExpiresAt:
      input.overrides.offerExpiresAt ??
      (current.offerExpiresAt ? current.offerExpiresAt.toISOString() : undefined),
    paymentMethods:
      input.overrides.paymentMethods ?? (current.paymentMethods as any[]),
    customerVisibleDescription:
      input.overrides.customerVisibleDescription ?? current.customerVisibleDescription ?? undefined,
    internalNotes: input.overrides.internalNotes ?? current.internalNotes ?? undefined,
    items: resolveReissueItems(input.overrides, terms),
  };

  const reissued = await issueCommercialOffer(
    merged,
    actorUserId,
    input.idempotencyKey,
  );

  await db.transaction(async (tx) => {
    await tx
      .update(commercialOffer)
      .set({
        status: "SUPERSEDED",
        publicTokenRevokedAt: new Date(),
      })
      .where(eq(commercialOffer.id, offerId));

    await insertOfferHistory(tx, {
      offerId,
      fromStatus: current.status,
      toStatus: "SUPERSEDED",
      source: "USER",
      changedBy: actorUserId,
      payload: { reissuedOfferId: reissued.id },
    });

    await tx
      .update(commercialOffer)
      .set({
        reissuedFromOfferId: offerId,
      })
      .where(eq(commercialOffer.id, reissued.id));
  });

  return reissued;
}
