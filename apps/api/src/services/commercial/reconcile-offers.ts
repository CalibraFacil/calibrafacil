import { db } from "@calibra-facil/db";
import {
  commercialOffer,
  operatorAlert,
  paymentRecord,
} from "@calibra-facil/db/schema";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { AsaasPayment } from "../asaas/types";
import { getPayment } from "../asaas/payments";
import { AsaasError } from "../asaas/client";

/**
 * Backstop for one-off offers (SETUP_FEE, PLAN_UPFRONT).
 *
 * `reconcileProviderSubscriptions` only walks the `subscription` table, and a
 * one-off charge never creates a row there — activation is skipped for it. So
 * a webhook that Asaas never delivered, or that we acknowledged without
 * processing, left the offer PENDING_PAYMENT forever: the customer paid and
 * finance never saw it, with nothing polling the provider to notice.
 *
 * Delivery is "at least once", which also means "sometimes none", so a
 * periodic re-read of the provider's own view of the charge is the only honest
 * way to close that hole.
 */

export interface AsaasOfferReconciliationPort {
  /** The provider's current view of a charge, or null when it is gone (404). */
  getPayment(providerPaymentId: string): Promise<AsaasPayment | null>;
}

export type OfferDivergence = {
  offerId: string;
  organizationId: string;
  providerPaymentId: string;
  localStatus: string;
  remoteStatus: string;
};

export type OfferReconciliationSummary = {
  checked: number;
  diverged: number;
  errors: { offerId: string; message: string }[];
  divergences: OfferDivergence[];
};

/** Provider statuses that mean the money arrived. */
const PAID_REMOTE_STATUSES = new Set([
  "CONFIRMED",
  "RECEIVED",
  "RECEIVED_IN_CASH",
]);

/**
 * Only look at charges old enough that a webhook would already have arrived —
 * re-reading a charge created seconds ago would just race the delivery.
 */
const SETTLE_GRACE_MS = 30 * 60 * 1000;

export async function reconcilePendingOffers(
  port: AsaasOfferReconciliationPort,
  options?: { now?: Date; limit?: number },
): Promise<OfferReconciliationSummary> {
  const now = options?.now ?? new Date();
  const cutoff = new Date(now.getTime() - SETTLE_GRACE_MS);

  const pending = await db
    .select({
      offerId: commercialOffer.id,
      organizationId: commercialOffer.organizationId,
      status: commercialOffer.status,
      providerPaymentId: commercialOffer.providerPaymentId,
    })
    .from(commercialOffer)
    .where(
      and(
        eq(commercialOffer.status, "PENDING_PAYMENT"),
        isNotNull(commercialOffer.providerPaymentId),
        lt(commercialOffer.createdAt, cutoff),
      ),
    )
    .limit(options?.limit ?? 200);

  const divergences: OfferDivergence[] = [];
  const errors: { offerId: string; message: string }[] = [];

  for (const local of pending) {
    const providerPaymentId = local.providerPaymentId;
    if (!providerPaymentId) continue;

    try {
      // oxlint-disable-next-line no-await-in-loop -- one provider read per offer, deliberately serial to stay under the rate limit.
      const remote = await port.getPayment(providerPaymentId);
      if (!remote) continue;

      if (!PAID_REMOTE_STATUSES.has(remote.status)) continue;

      divergences.push({
        offerId: local.offerId,
        organizationId: local.organizationId,
        providerPaymentId,
        localStatus: local.status,
        remoteStatus: remote.status,
      });

      // Record what the provider says on the payment row. The offer itself is
      // left for the operator: activating a plan from a poll, outside the
      // webhook's transaction, is the kind of shortcut that double-activates.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db
        .update(paymentRecord)
        .set({ status: remote.status })
        .where(eq(paymentRecord.providerPaymentId, providerPaymentId));

      // ...but say so somewhere a human looks. Returning the divergence in a
      // cron response means every run rediscovers a paid customer who is still
      // on FREE and nobody is told. The alert dedupes per offer, so a standing
      // divergence is one row that keeps its first-seen date rather than noise.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await raiseUnreconciledPaymentAlert({
        offerId: local.offerId,
        organizationId: local.organizationId,
        providerPaymentId,
        remoteStatus: remote.status,
      });
    } catch (error) {
      errors.push({
        offerId: local.offerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    checked: pending.length,
    diverged: divergences.length,
    errors,
    divergences,
  };
}

export function createAsaasOfferReconciliationPort(): AsaasOfferReconciliationPort {
  return {
    async getPayment(providerPaymentId) {
      try {
        return await getPayment(providerPaymentId);
      } catch (error) {
        // A charge deleted at the provider is an answer, not a failure.
        if (error instanceof AsaasError && error.details.errors?.length) {
          const notFound = error.details.errors.some(
            (item) => item.code === "not_found" || item.code === "HTTP_404",
          );
          if (notFound) return null;
        }
        throw error;
      }
    },
  };
}

/**
 * A paid charge whose webhook never arrived needs a person: the plan is unpaid
 * for as far as the product is concerned, and only an operator can safely close
 * that gap. Best-effort, because failing to raise the alert must not abort the
 * sweep over the remaining offers.
 */
async function raiseUnreconciledPaymentAlert(params: {
  offerId: string;
  organizationId: string;
  providerPaymentId: string;
  remoteStatus: string;
}): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(operatorAlert)
      .values({
        organizationId: params.organizationId,
        dedupeKey: `commercial:unreconciled_payment:${params.offerId}`,
        kind: "commercial_unreconciled_payment",
        severity: "critical",
        title: "Pagamento confirmado no Asaas sem ativação",
        detail: `A cobrança ${params.providerPaymentId} está ${params.remoteStatus} no Asaas, mas a oferta ${params.offerId} continua aguardando pagamento e o plano não foi liberado. O webhook provavelmente se perdeu. Reprocesse o evento ou ative a oferta manualmente.`,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: operatorAlert.dedupeKey,
        set: { lastSeenAt: now, updatedAt: now },
      });
  } catch (error) {
    console.error("Failed to record an unreconciled payment alert", error);
  }
}
