import { db } from "@calibra-facil/db";
import {
  commercialOffer,
  paymentRecord,
  providerWebhookEvent,
  subscription,
  type PaymentStatus,
} from "@calibra-facil/db/schema";
import { and, eq, or } from "drizzle-orm";
import type { AsaasPayment, AsaasWebhookPayload } from "../../services/asaas";
import {
  activateOfferFromConfirmedPayment,
} from "./activation";
import {
  createCommercialExternalReference,
  insertOfferHistory,
  insertPaymentStatusHistoryEntry,
} from "./common";

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505",
  );
}

function mapPaymentStatus(status: string): PaymentStatus {
  return status as PaymentStatus;
}

async function findOfferForPayload(payload: AsaasWebhookPayload) {
  const payment = payload.payment;
  const checkout = payload.checkout;
  const sub = payload.subscription;

  if (checkout?.id) {
    return db.query.commercialOffer.findFirst({
      where: eq(commercialOffer.providerCheckoutId, checkout.id),
    });
  }

  if (payment?.externalReference?.startsWith("commercial-offer:")) {
    const offerId = payment.externalReference.replace("commercial-offer:", "");
    return db.query.commercialOffer.findFirst({
      where: eq(commercialOffer.id, offerId),
    });
  }

  if (payment?.id || payment?.subscription) {
    const conditions = [];
    if (payment?.id) {
      conditions.push(eq(commercialOffer.providerPaymentId, payment.id));
    }
    if (payment?.subscription) {
      conditions.push(
        eq(commercialOffer.providerSubscriptionId, payment.subscription),
      );
    }
    if (conditions.length > 0) {
      return db.query.commercialOffer.findFirst({
        where: or(...conditions),
      });
    }
  }

  if (sub?.id) {
    return db.query.commercialOffer.findFirst({
      where: eq(commercialOffer.providerSubscriptionId, sub.id),
    });
  }

  return null;
}

async function upsertPaymentFromWebhook(
  tx: any,
  offer: typeof commercialOffer.$inferSelect,
  payment: AsaasPayment,
  eventId: string,
) {
  const existing = await tx.query.paymentRecord.findFirst({
    where: eq(paymentRecord.providerPaymentId, payment.id),
  });

  const values = {
    commercialOfferId: offer.id,
    organizationId: offer.organizationId,
    provider: "ASAAS" as const,
    providerCheckoutId: offer.providerCheckoutId,
    providerPaymentId: payment.id,
    providerSubscriptionId: payment.subscription ?? offer.providerSubscriptionId,
    externalReference:
      payment.externalReference ?? createCommercialExternalReference(offer.id),
    amount: Math.round(payment.value * 100),
    netAmount: payment.netValue ? Math.round(payment.netValue * 100) : null,
    currency: "BRL",
    paymentMethod: payment.billingType as "PIX" | "BOLETO" | "CREDIT_CARD",
    status: mapPaymentStatus(payment.status),
    dueDate: payment.dueDate ? new Date(payment.dueDate) : null,
    paidAt: payment.paymentDate ? new Date(payment.paymentDate) : null,
    invoiceUrl: payment.invoiceUrl ?? null,
    bankSlipUrl: payment.bankSlipUrl ?? null,
    pixQrCodeUrl: payment.pixTransaction?.qrCode ?? null,
    pixPayload: payment.pixTransaction?.qrCodePayload ?? null,
    cardLast4: payment.creditCard?.creditCardNumber?.slice(-4) ?? null,
    cardBrand: payment.creditCard?.creditCardBrand ?? null,
    providerSnapshot: payment as unknown as Record<string, unknown>,
  };

  if (existing) {
    const [updated] = await tx
      .update(paymentRecord)
      .set(values)
      .where(eq(paymentRecord.id, existing.id))
      .returning();

    await insertPaymentStatusHistoryEntry(tx, {
      paymentRecordId: existing.id,
      commercialOfferId: offer.id,
      fromStatus: existing.status,
      toStatus: values.status,
      sourceEventId: eventId,
      payload: payment as unknown as Record<string, unknown>,
    });

    return updated ?? existing;
  }

  const [created] = await tx.insert(paymentRecord).values(values).returning();
  if (!created) {
    throw new Error("Falha ao registrar pagamento do webhook");
  }

  await insertPaymentStatusHistoryEntry(tx, {
    paymentRecordId: created.id,
    commercialOfferId: offer.id,
    toStatus: values.status,
    sourceEventId: eventId,
    payload: payment as unknown as Record<string, unknown>,
  });

  return created;
}

export async function reconcileCommercialWebhook(payload: AsaasWebhookPayload) {
  const eventId = payload.id || crypto.randomUUID();

  try {
    await db.insert(providerWebhookEvent).values({
      provider: "ASAAS",
      eventId,
      eventType: payload.event,
      payload: payload as unknown as Record<string, unknown>,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { duplicate: true, organizationId: null as string | null };
    }
    throw error;
  }

  const offer = await findOfferForPayload(payload);
  if (!offer) {
    await db
      .update(providerWebhookEvent)
      .set({ processedAt: new Date() })
      .where(
        and(
          eq(providerWebhookEvent.provider, "ASAAS"),
          eq(providerWebhookEvent.eventId, eventId),
        ),
      );
    return { duplicate: false, organizationId: null as string | null };
  }

  await db.transaction(async (tx) => {
    if (payload.payment) {
      const payment = await upsertPaymentFromWebhook(tx, offer, payload.payment, eventId);

      let nextOfferStatus = offer.status;
      if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
        nextOfferStatus = "PAID";
      } else if (payment.status === "OVERDUE") {
        nextOfferStatus = "FAILED";
      } else if (payment.status === "REFUNDED" || payment.status === "DELETED") {
        nextOfferStatus = "FAILED";
      }

      if (nextOfferStatus !== offer.status) {
        await tx
          .update(commercialOffer)
          .set({
            status: nextOfferStatus,
            paidAt:
              nextOfferStatus === "PAID"
                ? payment.paidAt ?? new Date()
                : offer.paidAt,
          })
          .where(eq(commercialOffer.id, offer.id));

        await insertOfferHistory(tx, {
          offerId: offer.id,
          fromStatus: offer.status,
          toStatus: nextOfferStatus,
          source: "WEBHOOK",
          sourceEventId: eventId,
          payload: payload as unknown as Record<string, unknown>,
        });
      }

      if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
        await activateOfferFromConfirmedPayment(tx, offer.id, payment.status);
      }

      if (payment.status === "OVERDUE" && offer.kind !== "SETUP_FEE") {
        await tx
          .update(subscription)
          .set({ status: "PAST_DUE" })
          .where(eq(subscription.organizationId, offer.organizationId));
      }
    }

    if (payload.checkout?.id) {
      const nextStatus =
        payload.event === "CHECKOUT_EXPIRED"
          ? "EXPIRED"
          : payload.event === "CHECKOUT_CANCELED"
            ? "CANCELED"
            : payload.event === "CHECKOUT_PAID"
              ? "PAID"
              : offer.status;

      if (nextStatus !== offer.status) {
        await tx
          .update(commercialOffer)
          .set({ status: nextStatus })
          .where(eq(commercialOffer.id, offer.id));

        await insertOfferHistory(tx, {
          offerId: offer.id,
          fromStatus: offer.status,
          toStatus: nextStatus,
          source: "WEBHOOK",
          sourceEventId: eventId,
          payload: payload as unknown as Record<string, unknown>,
        });
      }
    }

    if (payload.subscription?.id) {
      await tx
        .update(commercialOffer)
        .set({
          providerSubscriptionId:
            offer.providerSubscriptionId ?? payload.subscription.id,
        })
        .where(eq(commercialOffer.id, offer.id));
    }

    await tx
      .update(providerWebhookEvent)
      .set({ processedAt: new Date() })
      .where(
        and(
          eq(providerWebhookEvent.provider, "ASAAS"),
          eq(providerWebhookEvent.eventId, eventId),
        ),
      );
  });

  return { duplicate: false, organizationId: offer.organizationId };
}
