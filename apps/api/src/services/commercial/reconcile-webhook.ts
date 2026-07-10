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
import { activateOfferFromConfirmedPayment } from "./activation";
import {
  notifyPaymentFailed,
  notifyPaymentReceived,
} from "@calibra-facil/notifications";
import {
  createCommercialExternalReference,
  invalidateCommercialPublicToken,
  insertOfferHistory,
  insertPaymentStatusHistoryEntry,
  markOfferPaymentsDeleted,
  type DbTx,
} from "./common";
import { TransientWebhookError } from "./webhook-errors";

function hasUniqueViolationCode(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    "code" in value &&
    Reflect.get(value, "code") === "23505",
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  // postgres-js (Neon prod + the integration harness) surfaces a duplicate
  // insert as a Drizzle `DrizzleQueryError` wrapper whose own `code` is
  // undefined — the real Postgres `23505` lives on `error.cause`. Recognize
  // both the bare PostgresError and the wrapped error (unwrap one level).
  if (hasUniqueViolationCode(error)) {
    return true;
  }

  if (error && typeof error === "object" && "cause" in error) {
    return hasUniqueViolationCode(Reflect.get(error, "cause"));
  }

  return false;
}

function mapPaymentStatus(status: PaymentStatus): PaymentStatus {
  return status;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function paymentMethodFromBillingType(
  billingType: AsaasPayment["billingType"],
) {
  if (
    billingType === "PIX" ||
    billingType === "BOLETO" ||
    billingType === "CREDIT_CARD"
  ) {
    return billingType;
  }

  return "BOLETO";
}

type PaymentNotificationToSend = {
  type: "received" | "failed";
  paymentId: number;
  organizationId: string;
  reason?: string;
};

function getExistingPixSnapshot(
  existing: typeof paymentRecord.$inferSelect | null,
) {
  const providerSnapshot = optionalRecord(existing?.providerSnapshot);
  const pixTransaction = optionalRecord(providerSnapshot?.pixTransaction);

  return {
    qrCode:
      typeof pixTransaction?.qrCode === "string" ? pixTransaction.qrCode : null,
    qrCodePayload:
      typeof pixTransaction?.qrCodePayload === "string"
        ? pixTransaction.qrCodePayload
        : null,
    expirationDate:
      typeof pixTransaction?.expirationDate === "string"
        ? pixTransaction.expirationDate
        : null,
    providerSnapshot,
    pixTransaction,
  };
}

export function resolveProviderSubscriptionId(
  payload: AsaasWebhookPayload,
  currentProviderSubscriptionId: string | null | undefined,
) {
  return (
    payload.subscription?.id ??
    payload.payment?.subscription ??
    currentProviderSubscriptionId ??
    null
  );
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
  tx: DbTx,
  offer: typeof commercialOffer.$inferSelect,
  payment: AsaasPayment,
  eventId: string,
) {
  const existing = await tx.query.paymentRecord.findFirst({
    where: eq(paymentRecord.providerPaymentId, payment.id),
  });
  const existingPix = getExistingPixSnapshot(existing ?? null);
  const nextPixQrCodeUrl =
    payment.pixTransaction?.qrCode ??
    existing?.pixQrCodeUrl ??
    existingPix.qrCode ??
    null;
  const nextPixPayload =
    payment.pixTransaction?.qrCodePayload ??
    existing?.pixPayload ??
    existingPix.qrCodePayload ??
    null;
  const providerSnapshot = {
    ...asRecord(existingPix.providerSnapshot),
    ...asRecord(payment),
    pixTransaction: {
      ...asRecord(existingPix.pixTransaction),
      ...asRecord(payment.pixTransaction),
      ...(nextPixQrCodeUrl ? { qrCode: nextPixQrCodeUrl } : {}),
      ...(nextPixPayload ? { qrCodePayload: nextPixPayload } : {}),
      ...(payment.pixTransaction?.expirationDate || existingPix.expirationDate
        ? {
            expirationDate:
              payment.pixTransaction?.expirationDate ??
              existingPix.expirationDate,
          }
        : {}),
    },
  };

  const values = {
    commercialOfferId: offer.id,
    organizationId: offer.organizationId,
    provider: "ASAAS" as const,
    providerCheckoutId: offer.providerCheckoutId,
    providerPaymentId: payment.id,
    providerSubscriptionId:
      payment.subscription ?? offer.providerSubscriptionId,
    externalReference:
      payment.externalReference ?? createCommercialExternalReference(offer.id),
    amount: Math.round(payment.value * 100),
    netAmount: payment.netValue ? Math.round(payment.netValue * 100) : null,
    currency: "BRL",
    paymentMethod: paymentMethodFromBillingType(payment.billingType),
    status: mapPaymentStatus(payment.status),
    dueDate: payment.dueDate ? new Date(payment.dueDate) : null,
    paidAt: payment.paymentDate ? new Date(payment.paymentDate) : null,
    invoiceUrl: payment.invoiceUrl ?? null,
    bankSlipUrl: payment.bankSlipUrl ?? null,
    pixQrCodeUrl: nextPixQrCodeUrl,
    pixPayload: nextPixPayload,
    cardLast4: payment.creditCard?.creditCardNumber?.slice(-4) ?? null,
    cardBrand: payment.creditCard?.creditCardBrand ?? null,
    providerSnapshot,
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
      payload: asRecord(payment),
    });

    return { payment: updated ?? existing, previousStatus: existing.status };
  }

  const [created] = await tx.insert(paymentRecord).values(values).returning();
  if (!created) {
    // Infra-level failure (an insert that returned no row) — retryable, so surface
    // it as transient and let the handler ask ASAAS to re-send.
    throw new TransientWebhookError("Falha ao registrar pagamento do webhook");
  }

  await insertPaymentStatusHistoryEntry(tx, {
    paymentRecordId: created.id,
    commercialOfferId: offer.id,
    toStatus: values.status,
    sourceEventId: eventId,
    payload: asRecord(payment),
  });

  return { payment: created, previousStatus: null };
}

export async function reconcileCommercialWebhook(
  payload: AsaasWebhookPayload,
): Promise<{ duplicate: boolean; organizationId: string | null }> {
  const eventId = payload.id || crypto.randomUUID();

  try {
    await db.insert(providerWebhookEvent).values({
      provider: "ASAAS",
      eventId,
      eventType: payload.event,
      payload: asRecord(payload),
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // The event row already exists. Distinguish a real duplicate from a RETRY:
      // if a prior delivery finished (processedAt set) this is a true duplicate
      // and we skip — the money state was applied exactly once. If the prior
      // attempt inserted the row but never finished (processedAt IS NULL — its
      // transaction rolled back on a transient failure, and the handler returned
      // non-2xx so ASAAS re-sent it), we fall through and RE-PROCESS. Every money
      // mutation below is inside a single transaction that re-derives from the
      // current DB state, so re-processing an unfinished event is idempotent.
      const existing = await db.query.providerWebhookEvent.findFirst({
        where: and(
          eq(providerWebhookEvent.provider, "ASAAS"),
          eq(providerWebhookEvent.eventId, eventId),
        ),
      });
      if (!existing || existing.processedAt) {
        return { duplicate: true, organizationId: null };
      }
    } else {
      throw error;
    }
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
    return { duplicate: false, organizationId: null };
  }

  const paymentNotification = await db.transaction(async (tx) => {
    let notification: PaymentNotificationToSend | null = null;
    const providerSubscriptionId = resolveProviderSubscriptionId(
      payload,
      offer.providerSubscriptionId,
    );

    if (payload.payment) {
      const { payment, previousStatus } = await upsertPaymentFromWebhook(
        tx,
        offer,
        payload.payment,
        eventId,
      );

      let nextOfferStatus = offer.status;
      if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
        nextOfferStatus = "PAID";
      } else if (payment.status === "OVERDUE") {
        nextOfferStatus = "FAILED";
      } else if (
        payment.status === "REFUNDED" ||
        payment.status === "DELETED"
      ) {
        nextOfferStatus = "FAILED";
      }

      if (nextOfferStatus !== offer.status) {
        await tx
          .update(commercialOffer)
          .set({
            status: nextOfferStatus,
            paidAt:
              nextOfferStatus === "PAID"
                ? (payment.paidAt ?? new Date())
                : offer.paidAt,
          })
          .where(eq(commercialOffer.id, offer.id));

        if (nextOfferStatus === "PAID") {
          await invalidateCommercialPublicToken(tx, offer.id);
        }

        await insertOfferHistory(tx, {
          offerId: offer.id,
          fromStatus: offer.status,
          toStatus: nextOfferStatus,
          source: "WEBHOOK",
          sourceEventId: eventId,
          payload: asRecord(payload),
        });
      }

      if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
        await activateOfferFromConfirmedPayment(tx, offer.id, payment.status);
      }

      const paymentSuccessStatuses: PaymentStatus[] = ["CONFIRMED", "RECEIVED"];
      const enteredSuccessfulPaymentState =
        paymentSuccessStatuses.includes(payment.status) &&
        (previousStatus === null ||
          !paymentSuccessStatuses.includes(previousStatus));

      if (enteredSuccessfulPaymentState) {
        notification = {
          type: "received",
          paymentId: payment.id,
          organizationId: offer.organizationId,
        };
      } else if (
        previousStatus !== payment.status &&
        [
          "OVERDUE",
          "REFUNDED",
          "REFUND_REQUESTED",
          "CHARGEBACK_REQUESTED",
          "CHARGEBACK_DISPUTE",
          "AWAITING_CHARGEBACK_REVERSAL",
          "DELETED",
        ].includes(payment.status)
      ) {
        notification = {
          type: "failed",
          paymentId: payment.id,
          organizationId: offer.organizationId,
          reason:
            payment.status === "OVERDUE"
              ? "Pagamento vencido"
              : payment.status === "REFUNDED" ||
                  payment.status === "REFUND_REQUESTED"
                ? "Pagamento estornado"
                : payment.status.includes("CHARGEBACK")
                  ? "Pagamento em contestação"
                  : "Pagamento cancelado",
        };
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

        if (nextStatus === "PAID" || nextStatus === "CANCELED") {
          await invalidateCommercialPublicToken(tx, offer.id);
        }

        if (nextStatus === "CANCELED") {
          await markOfferPaymentsDeleted(
            tx,
            offer.id,
            eventId,
            asRecord(payload),
          );
        }

        await insertOfferHistory(tx, {
          offerId: offer.id,
          fromStatus: offer.status,
          toStatus: nextStatus,
          source: "WEBHOOK",
          sourceEventId: eventId,
          payload: asRecord(payload),
        });
      }
    }

    if (providerSubscriptionId) {
      await tx
        .update(commercialOffer)
        .set({
          providerSubscriptionId,
        })
        .where(eq(commercialOffer.id, offer.id));

      await tx
        .update(subscription)
        .set({
          providerSubscriptionId,
        })
        .where(
          and(
            eq(subscription.organizationId, offer.organizationId),
            eq(subscription.sourceCommercialOfferId, offer.id),
          ),
        );
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

    return notification;
  });

  const notificationToSend = paymentNotification;

  if (notificationToSend) {
    try {
      if (notificationToSend.type === "received") {
        await notifyPaymentReceived(
          notificationToSend.paymentId,
          notificationToSend.organizationId,
        );
      } else {
        await notifyPaymentFailed(
          notificationToSend.paymentId,
          notificationToSend.organizationId,
          notificationToSend.reason,
        );
      }
    } catch (error) {
      console.error(
        "[Commercial Webhook] Failed to send payment notification:",
        error,
      );
    }
  }

  return { duplicate: false, organizationId: offer.organizationId };
}
