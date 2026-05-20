import { db } from "@calibra-facil/db";
import { commercialOffer } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  cancelCheckout,
  cancelPayment,
  cancelSubscription,
} from "../../services/asaas";
import {
  getOfferById,
  insertOfferHistory,
  invalidateCommercialPublicToken,
  markOfferPaymentsDeleted,
} from "./common";

export async function cancelCommercialOffer(
  offerId: string,
  reason: string,
  actorUserId: string,
) {
  const offer = await getOfferById(offerId);

  if (!offer) {
    throw new Error("Oferta comercial não encontrada");
  }

  if (offer.status === "PAID" || offer.status === "ACTIVATED") {
    throw new Error("Não é possível cancelar uma oferta já paga");
  }

  return db.transaction(async (tx) => {
    if (offer.providerMode === "CHECKOUT" && offer.providerCheckoutId) {
      await cancelCheckout(offer.providerCheckoutId);
    } else if (offer.providerMode === "PAYMENT" && offer.providerPaymentId) {
      await cancelPayment(offer.providerPaymentId);
    } else if (
      offer.providerMode === "SUBSCRIPTION" &&
      offer.providerSubscriptionId
    ) {
      await cancelSubscription(offer.providerSubscriptionId);
    }

    const [updated] = await tx
      .update(commercialOffer)
      .set({
        status: "CANCELED",
        canceledAt: new Date(),
        canceledBy: actorUserId,
      })
      .where(eq(commercialOffer.id, offerId))
      .returning();

    await invalidateCommercialPublicToken(tx, offerId);
    await markOfferPaymentsDeleted(tx, offerId, null, {
      reason,
      canceledBy: actorUserId,
      source: "USER",
    });

    await insertOfferHistory(tx, {
      offerId,
      fromStatus: offer.status,
      toStatus: "CANCELED",
      source: "USER",
      reason,
      changedBy: actorUserId,
    });

    return updated ?? offer;
  });
}
