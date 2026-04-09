import { db } from "@calibra-facil/db";
import { commercialOffer } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { insertOfferHistory, upsertSubscriptionFromOffer, type DbTx } from "./common";

export async function activateOfferFromConfirmedPayment(
  tx: DbTx,
  offerId: string,
  paymentStatus: "CONFIRMED" | "RECEIVED",
) {
  if (paymentStatus !== "CONFIRMED" && paymentStatus !== "RECEIVED") return null;

  const offer = await tx.query.commercialOffer.findFirst({
    where: eq(commercialOffer.id, offerId),
  });

  if (!offer) {
    throw new Error("Oferta comercial não encontrada");
  }

  if (offer.kind === "SETUP_FEE" || offer.status === "ACTIVATED") {
    return offer;
  }

  await upsertSubscriptionFromOffer(tx, {
    ...offer,
    paidAt: offer.paidAt ?? new Date(),
  });

  const [updated] = await tx
    .update(commercialOffer)
    .set({
      status: "ACTIVATED",
      activatedAt: new Date(),
      paidAt: offer.paidAt ?? new Date(),
    })
    .where(eq(commercialOffer.id, offer.id))
    .returning();

  await insertOfferHistory(tx, {
    offerId,
    fromStatus: offer.status,
    toStatus: "ACTIVATED",
    source: "WEBHOOK",
    payload: { paymentStatus },
  });

  return updated ?? offer;
}
