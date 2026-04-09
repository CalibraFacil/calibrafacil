import { randomUUID } from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  commercialOffer,
  commercialOfferItem,
} from "@calibra-facil/db/schema";
import type { CommercialOfferPreviewInput } from "@calibra-facil/schemas";
import { previewCommercialOffer } from "./preview";
import {
  buildCustomerCheckoutUrlPath,
  createCommercialPublicToken,
  ensureBillingCustomer,
  ensureDeal,
  hashCommercialPublicToken,
  insertOfferHistory,
} from "./common";

export async function issueCommercialOffer(
  input: CommercialOfferPreviewInput,
  actorUserId: string,
  idempotencyKey: string,
) {
  const preview = previewCommercialOffer(input);
  if (!preview.issueable) {
    throw new Error(
      preview.warnings[0] ?? "A oferta não pode ser emitida com a configuração atual",
    );
  }

  const offerId = randomUUID();
  const publicToken = createCommercialPublicToken();
  const publicTokenHash = hashCommercialPublicToken(publicToken);
  const customerCheckoutUrlPath = buildCustomerCheckoutUrlPath(publicToken);

  return db.transaction(async (tx) => {
    const billingCustomer = await ensureBillingCustomer(
      tx,
      input.organizationId,
      actorUserId,
    );
    const deal = await ensureDeal(tx, input, actorUserId);

    const [offer] = await tx
      .insert(commercialOffer)
      .values({
        id: offerId,
        dealId: deal.id,
        organizationId: input.organizationId,
        kind: preview.normalizedSnapshot.kind,
        status: "PENDING_PAYMENT",
        provider: "ASAAS",
        providerMode: preview.normalizedSnapshot.providerMode,
        activationBehavior:
          preview.normalizedSnapshot.kind === "SETUP_FEE"
            ? "NONE"
            : "IMMEDIATE_REPLACE",
        basePlanId: preview.normalizedSnapshot.basePlanId,
        billingCycle: preview.normalizedSnapshot.billingCycle,
        contractTermMonths: preview.normalizedSnapshot.contractTermMonths,
        renewalMode: preview.normalizedSnapshot.renewalMode,
        currency: "BRL",
        subtotalAmount: preview.subtotalAmount,
        discountAmount: preview.discountAmount,
        totalAmount: preview.totalAmount,
        dueDate: preview.normalizedSnapshot.dueDate,
        offerExpiresAt: preview.normalizedSnapshot.offerExpiresAt,
        paymentMethods: preview.normalizedSnapshot.paymentMethods,
        customerVisibleDescription:
          preview.normalizedSnapshot.customerVisibleDescription,
        internalNotes: preview.normalizedSnapshot.internalNotes,
        termsSnapshot: {
          ...preview.normalizedSnapshot,
          idempotencyKey,
        },
        customerSnapshot: billingCustomer.providerSnapshot ?? {},
        providerRequestSnapshot: null,
        providerResponseSnapshot: null,
        checkoutUrl: null,
        providerCheckoutId: null,
        providerPaymentId: null,
        providerSubscriptionId: null,
        publicTokenHash,
        publicTokenIssuedAt: new Date(),
        publicTokenRevokedAt: null,
        publicViewedAt: null,
        publicLastAccessAt: null,
        customerCheckoutUrlPath,
        billingCustomerId: billingCustomer.id,
        issuedAt: new Date(),
        createdBy: actorUserId,
        reissuedFromOfferId: null,
      })
      .returning();

    if (!offer) {
      throw new Error("Falha ao registrar oferta comercial");
    }

    if (preview.normalizedSnapshot.items.length > 0) {
      await tx.insert(commercialOfferItem).values(
        preview.normalizedSnapshot.items.map((item) => ({
          offerId: offer.id,
          type: item.type,
          label: item.label,
          description: item.description,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          totalAmount: item.totalAmount,
          metadata: null,
        })),
      );
    }

    await insertOfferHistory(tx, {
      offerId: offer.id,
      fromStatus: "DRAFT",
      toStatus: "PENDING_PAYMENT",
      source: "USER",
      changedBy: actorUserId,
      payload: { idempotencyKey },
    });

    return offer;
  });
}
