import {
  CommercialOfferItemSchema,
  CommercialPaymentMethodSchema,
  type ReissueCommercialOfferInput,
} from "@calibra-facil/schemas";
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
    ? termsSnapshot.items.flatMap((item) => {
        const parsed = CommercialOfferItemSchema.safeParse(item);
        if (!parsed.success) {
          return [];
        }

        const totalAmount =
          item && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item)).totalAmount
            : null;

        return [
          typeof totalAmount === "number"
            ? { ...parsed.data, totalAmount }
            : parsed.data,
        ];
      })
    : [];

  return overrides.items ?? originalItems;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function toBasePlanId(value: unknown) {
  switch (value) {
    case "STANDARD":
    case "PROFESSIONAL":
    case "ADVANCED":
    case "ENTERPRISE":
      return value;
    default:
      return undefined;
  }
}

function toBillingCycle(value: unknown) {
  switch (value) {
    case "MONTHLY":
    case "YEARLY":
      return value;
    default:
      return undefined;
  }
}

function toPaymentMethods(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const methods = value.flatMap((item) => {
    const parsed = CommercialPaymentMethodSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

  return methods.length > 0 ? methods : undefined;
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

  const terms = toRecord(current.termsSnapshot);
  const paymentMethods =
    input.overrides.paymentMethods ?? toPaymentMethods(current.paymentMethods);
  if (!paymentMethods) {
    throw new Error("Oferta original sem meio de pagamento valido");
  }
  const merged = {
    organizationId: current.organizationId,
    dealId: current.dealId,
    billingContactId:
      typeof terms.billingContactId === "number"
        ? terms.billingContactId
        : undefined,
    kind: current.kind,
    basePlanId: input.overrides.basePlanId ?? toBasePlanId(current.basePlanId),
    billingCycle:
      input.overrides.billingCycle ?? toBillingCycle(current.billingCycle),
    contractTermMonths:
      input.overrides.contractTermMonths ??
      current.contractTermMonths ??
      undefined,
    negotiatedAmount:
      input.overrides.negotiatedAmount ??
      Number(terms.totalAmount ?? current.totalAmount),
    discountAmount: input.overrides.discountAmount ?? current.discountAmount,
    setupFeeAmount: input.overrides.setupFeeAmount ?? 0,
    dueDate:
      input.overrides.dueDate ??
      (current.dueDate ? current.dueDate.toISOString() : undefined),
    offerExpiresAt:
      input.overrides.offerExpiresAt ??
      (current.offerExpiresAt
        ? current.offerExpiresAt.toISOString()
        : undefined),
    paymentMethods,
    customerVisibleDescription:
      input.overrides.customerVisibleDescription ??
      current.customerVisibleDescription ??
      undefined,
    internalNotes:
      input.overrides.internalNotes ?? current.internalNotes ?? undefined,
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
