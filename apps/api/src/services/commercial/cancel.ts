import { db } from "@calibra-facil/db";
import {
  approvalRequest,
  commercialOffer,
  type ApprovalRequestKind,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { isSameDualControlIdentity } from "../../lib/dual-control";
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

// DOM-04 (#657): the money-touching cancel of a commercial offer is gated on a
// linked, APPROVED maker-checker `approval_request`. The single named 403 that a
// rejected cancel surfaces (REQ-DOM-DC-001) — the same message for every failure
// reason so the enforcement point is unambiguous and nothing is disclosed about
// which specific check tripped.
export const OFFER_CANCEL_DUAL_CONTROL_ERROR =
  "Controle duplo: o cancelamento financeiro exige uma aprovação (approvalRequest) vinculada, aprovada, da mesma organização e decidida por uma identidade distinta do solicitante e do executor.";

// Only genuine financial-governance kinds authorize a money-touching cancel; the
// generic "other" catch-all does not (REQ-DOM-DC-001, "of the appropriate kind").
const FINANCIAL_CANCEL_APPROVAL_KINDS: readonly ApprovalRequestKind[] = [
  "refund",
  "credit",
  "adjustment",
];

function rejectDualControl(): never {
  throw new HTTPException(403, { message: OFFER_CANCEL_DUAL_CONTROL_ERROR });
}

/**
 * Validate that `approvalRequestId` points to an approval that authorizes
 * cancelling THIS offer, executed by `actorUserId`. Throws a named 403 (changing
 * nothing) unless every dual-control invariant holds. Returns the validated
 * approval row so the caller can persist the audit link.
 *
 * Fails CLOSED: a missing id, a missing row, a cross-org row, a non-APPROVED
 * status, a non-financial kind, an approval with no recorded requester/decider,
 * an approver who is also the requester, or an approver who is also the executor
 * all reject. The approver-vs-requester check reuses the shared dual-control
 * identity rule (../../lib/dual-control) — the same rule the decision route
 * enforces (REQ-DOM-DC-003).
 */
async function requireApprovedFinancialApproval(params: {
  approvalRequestId: number | null | undefined;
  offerOrganizationId: string;
  actorUserId: string;
}) {
  const { approvalRequestId, offerOrganizationId, actorUserId } = params;

  if (approvalRequestId == null) {
    rejectDualControl();
  }

  const approval = await db.query.approvalRequest.findFirst({
    where: eq(approvalRequest.id, approvalRequestId),
  });

  if (!approval) {
    rejectDualControl();
  }
  // Same-organization scoping: an approval only authorizes actions in its own org.
  if (approval.organizationId !== offerOrganizationId) {
    rejectDualControl();
  }
  if (approval.status !== "APPROVED") {
    rejectDualControl();
  }
  if (!FINANCIAL_CANCEL_APPROVAL_KINDS.includes(approval.kind)) {
    rejectDualControl();
  }
  // An APPROVED request always has both ids set at decision time; assert it so a
  // tampered/orphaned row (e.g. the requester or decider user was purged) can
  // never satisfy the identity checks by way of a null.
  if (approval.requestedByUserId == null || approval.decidedByUserId == null) {
    rejectDualControl();
  }
  // Approver must differ from the requester (maker-checker) AND from the operator
  // executing the cancel (no single person both approves and executes).
  if (
    isSameDualControlIdentity(
      approval.requestedByUserId,
      approval.decidedByUserId,
    )
  ) {
    rejectDualControl();
  }
  if (isSameDualControlIdentity(approval.decidedByUserId, actorUserId)) {
    rejectDualControl();
  }

  return approval;
}

export async function cancelCommercialOffer(
  offerId: string,
  reason: string,
  actorUserId: string,
  approvalRequestId: number | null | undefined,
) {
  const offer = await getOfferById(offerId);

  if (!offer) {
    throw new Error("Oferta comercial não encontrada");
  }

  if (offer.status === "PAID" || offer.status === "ACTIVATED") {
    throw new Error("Não é possível cancelar uma oferta já paga");
  }

  // Gate BEFORE any provider call or DB mutation so a rejected cancel changes
  // nothing (REQ-DOM-DC-001). The reused identity rule is enforced inside.
  const approval = await requireApprovedFinancialApproval({
    approvalRequestId,
    offerOrganizationId: offer.organizationId,
    actorUserId,
  });

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
        // Persist the audit link to the approval that authorized this cancel
        // (REQ-DOM-DC-002).
        approvalRequestId: approval.id,
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
