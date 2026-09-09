import { and, eq, ne } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { commercialOffer } from "@calibra-facil/db/schema";

import {
  insertOfferHistory,
  invalidateCommercialPublicToken,
  type DbTx,
} from "./common";

/**
 * Self-serve offers, and why they are marked.
 *
 * An offer issued by the customer's own click and an offer issued by an
 * operator look identical in the table, but they are not interchangeable: an
 * operator preparing a plan change for an organization that already pays us is
 * a deliberate act that a human reconciles at the provider, while a customer
 * doing the same by accident is the bug this module exists to prevent.
 *
 * The marker is the idempotency key the issuing route supplies, which
 * `issueCommercialOffer` persists into `termsSnapshot`. There is no column for
 * it, and inventing one would be a migration for a string we already store.
 */
const SELF_SERVE_IDEMPOTENCY_PREFIX = "self-serve:";

export function buildSelfServeIdempotencyKey(params: {
  organizationId: string;
  planId: string;
  billingCycle: string;
  nonce: string;
}) {
  return `${SELF_SERVE_IDEMPOTENCY_PREFIX}${params.organizationId}:${params.planId}:${params.billingCycle}:${params.nonce}`;
}

export function isSelfServeOffer(offer: {
  termsSnapshot: Record<string, unknown> | null;
}) {
  const key = offer.termsSnapshot?.idempotencyKey;

  return (
    typeof key === "string" && key.startsWith(SELF_SERVE_IDEMPOTENCY_PREFIX)
  );
}

/**
 * Close the self-serve checkouts a customer left behind when they changed their
 * mind about the plan.
 *
 * Choosing Essencial, then Profissional, leaves two payable links: the shape
 * lookup that reuses an open offer only matches an identical plan, cycle,
 * method and price. Paying one activates the subscription; opening the other
 * afterwards would create a second recurrence at Asaas and overwrite the
 * provider id we track, so the first would keep charging where nothing can see
 * it.
 *
 * Only offers that were never started are superseded — no provider artifact
 * means no money has been touched, so this needs none of the dual-control
 * governance that cancelling a live charge does. An offer that already has a
 * charge at the provider is left exactly as it is and handled at payment time
 * instead, by re-checking eligibility before a second recurrence can be
 * created.
 */
export async function supersedeUnstartedSelfServeOffers(
  tx: DbTx,
  params: {
    organizationId: string;
    keepOfferId?: string;
    actorUserId: string;
    reason: string;
  },
) {
  const open = await tx.query.commercialOffer.findMany({
    where: and(
      eq(commercialOffer.organizationId, params.organizationId),
      eq(commercialOffer.status, "PENDING_PAYMENT"),
      eq(commercialOffer.kind, "PLAN_RECURRING"),
      params.keepOfferId
        ? ne(commercialOffer.id, params.keepOfferId)
        : undefined,
    ),
  });

  const superseded: string[] = [];

  for (const offer of open) {
    if (!isSelfServeOffer(offer)) continue;
    if (offerHasProviderArtifact(offer)) continue;

    await tx
      .update(commercialOffer)
      .set({ status: "SUPERSEDED" })
      .where(eq(commercialOffer.id, offer.id));

    await invalidateCommercialPublicToken(tx, offer.id);

    await insertOfferHistory(tx, {
      offerId: offer.id,
      fromStatus: offer.status,
      toStatus: "SUPERSEDED",
      source: "USER",
      reason: params.reason,
      changedBy: params.actorUserId,
    });

    superseded.push(offer.id);
  }

  return superseded;
}

/** A charge exists at Asaas for this offer, so it is payable right now. */
export function offerHasProviderArtifact(offer: {
  providerCheckoutId: string | null;
  providerPaymentId: string | null;
  providerSubscriptionId: string | null;
}) {
  return Boolean(
    offer.providerCheckoutId ??
    offer.providerPaymentId ??
    offer.providerSubscriptionId,
  );
}

/**
 * A self-serve checkout the customer already started and has not paid.
 *
 * Once `start` runs, a Pix code, a boleto or a card subscription exists at
 * Asaas and stays payable. Issuing a second offer next to it is how a customer
 * ends up with two live recurrences: they pay the new one, the plan activates,
 * and the abandoned Pix is still sitting in their banking app. Superseding it
 * locally would not help, because the charge is at the provider, not here.
 *
 * So the second offer is refused while the first is payable, and the customer
 * is pointed back at it. Cancelling the provider artifact from this path was
 * the alternative and it is the more dangerous one: a payment we have not yet
 * seen a webhook for would be cancelled after the customer paid it.
 */
export async function findStartedSelfServeOffer(
  organizationId: string,
): Promise<{ id: string; checkoutPath: string | null } | null> {
  const open = await db.query.commercialOffer.findMany({
    where: and(
      eq(commercialOffer.organizationId, organizationId),
      eq(commercialOffer.status, "PENDING_PAYMENT"),
      eq(commercialOffer.kind, "PLAN_RECURRING"),
    ),
  });

  const started = open.find(
    (offer) => isSelfServeOffer(offer) && offerHasProviderArtifact(offer),
  );

  return started
    ? { id: started.id, checkoutPath: started.customerCheckoutUrlPath }
    : null;
}
