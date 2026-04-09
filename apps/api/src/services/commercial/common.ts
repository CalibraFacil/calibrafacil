import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  billingContact,
  billingCustomer,
  commercialDeal,
  commercialOffer,
  commercialOfferItem,
  commercialOfferStatusHistory,
  organization,
  paymentRecord,
  paymentStatusHistory,
  subscription,
} from "@calibra-facil/db/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  createCheckout,
  createCustomer,
  createPayment,
  createSubscription,
  findCustomerByExternalReference,
  formatAsaasDate,
  getSubscriptionPayments,
  updateCustomer,
  type AsaasBillingType,
} from "../../services/asaas";
import { getCommercialRenewalMode, isPlanBearingOffer } from "@calibra-facil/shared";
import type { CommercialOfferPreviewInput } from "@calibra-facil/schemas";
import type { CommercialOfferPreviewResult } from "./preview";

export type DbTx = any;

function sanitizeTaxId(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

export function createCommercialExternalReference(offerId: string) {
  return `commercial-offer:${offerId}`;
}

export function createCommercialPublicToken() {
  return randomBytes(32).toString("base64url");
}

export function hashCommercialPublicToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function buildCustomerCheckoutUrlPath(token: string) {
  return `/checkout/${token}`;
}

export async function invalidateCommercialPublicToken(
  tx: DbTx,
  offerId: string,
) {
  await tx
    .update(commercialOffer)
    .set({
      publicTokenHash: null,
      publicTokenRevokedAt: new Date(),
      customerCheckoutUrlPath: null,
    })
    .where(eq(commercialOffer.id, offerId));
}

export async function markOfferPaymentsDeleted(
  tx: DbTx,
  offerId: string,
  sourceEventId?: string | null,
  payload?: Record<string, unknown> | null,
) {
  const payments = await tx.query.paymentRecord.findMany({
    where: eq(paymentRecord.commercialOfferId, offerId),
  });

  for (const payment of payments) {
    if (
      payment.status === "CONFIRMED" ||
      payment.status === "RECEIVED" ||
      payment.status === "DELETED"
    ) {
      continue;
    }

    await tx
      .update(paymentRecord)
      .set({ status: "DELETED" })
      .where(eq(paymentRecord.id, payment.id));

    await insertPaymentStatusHistoryEntry(tx, {
      paymentRecordId: payment.id,
      commercialOfferId: offerId,
      fromStatus: payment.status,
      toStatus: "DELETED",
      sourceEventId: sourceEventId ?? null,
      payload: payload ?? null,
    });
  }
}

export async function getOrganizationOrThrow(organizationId: string) {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });

  if (!org) {
    throw new Error("Organização não encontrada");
  }

  return org;
}

export async function ensureDeal(
  tx: DbTx,
  input: CommercialOfferPreviewInput,
  actorUserId: string,
) {
  if (input.dealId) {
    const existing = await tx.query.commercialDeal.findFirst({
      where: eq(commercialDeal.id, input.dealId),
    });

    if (!existing) {
      throw new Error("Deal comercial não encontrado");
    }

    return existing;
  }

  const org = await getOrganizationOrThrow(input.organizationId);
  const [created] = await tx
    .insert(commercialDeal)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      title: `${org.name} - Proposta comercial`,
      status: "OPEN",
      primaryBillingContactId: input.billingContactId ?? null,
      createdBy: actorUserId,
    })
    .returning();

  if (!created) {
    throw new Error("Falha ao criar deal comercial");
  }

  return created;
}

export async function ensureBillingCustomer(
  tx: DbTx,
  organizationId: string,
  actorUserId: string,
  override?: {
    name?: string;
    email?: string;
    phone?: string;
    taxId?: string;
    address?: Record<string, unknown>;
  },
) {
  const org = await getOrganizationOrThrow(organizationId);
  const name = override?.name ?? org.name;
  const taxId = sanitizeTaxId(override?.taxId ?? org.cnpj);

  if (!taxId) {
    throw new Error("CNPJ/CPF da organização é obrigatório para cobrança");
  }

  const customerPayload = {
    name,
    email: override?.email ?? org.email ?? undefined,
    phone: override?.phone ?? org.phone ?? undefined,
    cpfCnpj: taxId,
    postalCode:
      typeof override?.address?.cep === "string"
        ? override.address.cep
        : org.cep ?? undefined,
    address:
      typeof override?.address?.street === "string"
        ? override.address.street
        : org.street ?? undefined,
    addressNumber:
      typeof override?.address?.number === "string"
        ? override.address.number
        : org.number ?? undefined,
    complement:
      typeof override?.address?.complement === "string"
        ? override.address.complement
        : org.complement ?? undefined,
    province:
      typeof override?.address?.neighbourhood === "string"
        ? override.address.neighbourhood
        : org.neighbourhood ?? undefined,
    city:
      typeof override?.address?.city === "string"
        ? override.address.city
        : org.city ?? undefined,
    state:
      typeof override?.address?.state === "string"
        ? override.address.state
        : org.state ?? undefined,
    externalReference: organizationId,
  };

  const existing = await tx.query.billingCustomer.findFirst({
    where: and(
      eq(billingCustomer.organizationId, organizationId),
      eq(billingCustomer.provider, "ASAAS"),
    ),
  });

  let providerCustomer =
    existing?.providerCustomerId
      ? await updateCustomer(existing.providerCustomerId, customerPayload)
      : await findCustomerByExternalReference(organizationId);

  if (!providerCustomer) {
    providerCustomer = await createCustomer(customerPayload);
  }

  if (existing) {
    const [updated] = await tx
      .update(billingCustomer)
      .set({
        name: customerPayload.name,
        email: customerPayload.email,
        phone: customerPayload.phone,
        taxId,
        addressSnapshot: {
          cep: customerPayload.postalCode,
          street: customerPayload.address,
          number: customerPayload.addressNumber,
          complement: customerPayload.complement,
          neighbourhood: customerPayload.province,
          city: customerPayload.city,
          state: customerPayload.state,
        },
        providerSnapshot: providerCustomer as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(billingCustomer.id, existing.id))
      .returning();

    return updated ?? existing;
  }

  const [created] = await tx
    .insert(billingCustomer)
    .values({
      organizationId,
      provider: "ASAAS",
      providerCustomerId: providerCustomer.id,
      status: "ACTIVE",
      name: customerPayload.name,
      email: customerPayload.email,
      phone: customerPayload.phone,
      taxId,
      addressSnapshot: {
        cep: customerPayload.postalCode,
        street: customerPayload.address,
        number: customerPayload.addressNumber,
        complement: customerPayload.complement,
        neighbourhood: customerPayload.province,
        city: customerPayload.city,
        state: customerPayload.state,
      },
      providerSnapshot: providerCustomer as unknown as Record<string, unknown>,
      createdBy: actorUserId,
    })
    .returning();

  if (!created) {
    throw new Error("Falha ao criar cliente de cobrança");
  }

  return created;
}

export function resolveBillingType(method: string): AsaasBillingType {
  switch (method) {
    case "PIX":
      return "PIX";
    case "CREDIT_CARD":
      return "CREDIT_CARD";
    case "BOLETO":
    default:
      return "BOLETO";
  }
}

export function buildOfferDescription(preview: CommercialOfferPreviewResult) {
  return preview.normalizedSnapshot.items.map((item) => item.label).join(" • ");
}

export async function createProviderArtifact(params: {
  offerId: string;
  preview: CommercialOfferPreviewResult;
  customerId: string;
  successUrl?: string;
  cancelUrl?: string;
  expiredUrl?: string;
}) {
  const externalReference = createCommercialExternalReference(params.offerId);
  const { preview } = params;
  const description =
    preview.normalizedSnapshot.customerVisibleDescription ??
    buildOfferDescription(preview);

  if (preview.providerMode === "CHECKOUT") {
    const checkout = await createCheckout({
      billingTypes: preview.normalizedSnapshot.paymentMethods.map(resolveBillingType),
      chargeTypes: [
        preview.normalizedSnapshot.kind === "PLAN_RECURRING"
          ? "RECURRENT"
          : "DETACHED",
      ],
      customer: params.customerId,
      items: preview.normalizedSnapshot.items.map((item) => ({
        name: item.label,
        description: item.description,
        quantity: item.quantity,
        value: item.unitAmount / 100,
      })),
      minutesToExpire: preview.normalizedSnapshot.offerExpiresAt
        ? Math.max(
            10,
            Math.ceil(
              (preview.normalizedSnapshot.offerExpiresAt.getTime() - Date.now()) /
                60000,
            ),
          )
        : undefined,
      callback:
        params.successUrl || params.cancelUrl || params.expiredUrl
          ? {
              successUrl: params.successUrl,
              cancelUrl: params.cancelUrl,
              expiredUrl: params.expiredUrl,
            }
          : undefined,
      externalReference,
      subscription:
        preview.normalizedSnapshot.kind === "PLAN_RECURRING"
          ? {
              cycle: preview.normalizedSnapshot.billingCycle!,
              nextDueDate: formatAsaasDate(preview.normalizedSnapshot.dueDate),
            }
          : undefined,
    });

    return {
      mode: "CHECKOUT" as const,
      externalReference,
      checkoutId: checkout.id,
      checkoutUrl: checkout.url,
      providerRequestSnapshot: {
        externalReference,
        description,
      },
      providerResponseSnapshot: checkout as unknown as Record<string, unknown>,
    };
  }

  if (preview.providerMode === "PAYMENT") {
    const payment = await createPayment({
      customer: params.customerId,
      billingType: resolveBillingType(preview.normalizedSnapshot.paymentMethods[0]!),
      value: preview.totalAmount / 100,
      dueDate: formatAsaasDate(preview.normalizedSnapshot.dueDate),
      description,
      externalReference,
    });

    return {
      mode: "PAYMENT" as const,
      externalReference,
      paymentId: payment.id,
      checkoutUrl:
        payment.invoiceUrl ?? payment.bankSlipUrl ?? payment.pixTransaction?.qrCode,
      providerRequestSnapshot: {
        externalReference,
        description,
      },
      providerResponseSnapshot: payment as unknown as Record<string, unknown>,
      initialPayment: payment,
    };
  }

  const subscriptionResult = await createSubscription({
    customer: params.customerId,
    billingType: resolveBillingType(preview.normalizedSnapshot.paymentMethods[0]!),
    value: preview.totalAmount / 100,
    nextDueDate: formatAsaasDate(preview.normalizedSnapshot.dueDate),
    cycle: preview.normalizedSnapshot.billingCycle!,
    description,
    externalReference,
  });

  const payments = await getSubscriptionPayments(subscriptionResult.id, { limit: 1 });
  const firstPayment = payments.data[0];

  return {
    mode: "SUBSCRIPTION" as const,
    externalReference,
    subscriptionId: subscriptionResult.id,
    paymentId: firstPayment?.id,
    checkoutUrl:
      firstPayment?.invoiceUrl ??
      firstPayment?.bankSlipUrl ??
      firstPayment?.pixTransaction?.qrCode,
    providerRequestSnapshot: {
      externalReference,
      description,
    },
    providerResponseSnapshot: {
      subscription: subscriptionResult,
      firstPayment,
    } as Record<string, unknown>,
    initialPayment: firstPayment,
  };
}

export async function insertOfferHistory(
  tx: DbTx,
  params: {
    offerId: string;
    fromStatus?: typeof commercialOffer.$inferSelect.status | null;
    toStatus: typeof commercialOffer.$inferSelect.status;
    source: typeof commercialOfferStatusHistory.$inferInsert.source;
    reason?: string | null;
    sourceEventId?: string | null;
    changedBy?: string | null;
    payload?: Record<string, unknown> | null;
  },
) {
  await tx.insert(commercialOfferStatusHistory).values({
    offerId: params.offerId,
    fromStatus: params.fromStatus ?? null,
    toStatus: params.toStatus,
    source: params.source,
    reason: params.reason ?? null,
    sourceEventId: params.sourceEventId ?? null,
    changedBy: params.changedBy ?? null,
    payload: params.payload ?? null,
  });
}

export async function insertPaymentStatusHistoryEntry(
  tx: DbTx,
  params: {
    paymentRecordId: number;
    commercialOfferId: string;
    fromStatus?: typeof paymentRecord.$inferSelect.status | null;
    toStatus: typeof paymentRecord.$inferSelect.status;
    sourceEventId?: string | null;
    payload?: Record<string, unknown> | null;
  },
) {
  await tx.insert(paymentStatusHistory).values({
    paymentRecordId: params.paymentRecordId,
    commercialOfferId: params.commercialOfferId,
    fromStatus: params.fromStatus ?? null,
    toStatus: params.toStatus,
    sourceEventId: params.sourceEventId ?? null,
    payload: params.payload ?? null,
  });
}

export async function upsertSubscriptionFromOffer(
  tx: DbTx,
  offer: typeof commercialOffer.$inferSelect,
) {
  if (!isPlanBearingOffer(offer.kind) || !offer.basePlanId || !offer.billingCycle) {
    return null;
  }

  const now = offer.paidAt ?? new Date();
  const periodEnd = new Date(now);
  if (offer.billingCycle === "MONTHLY") {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }

  const [result] = await tx
    .insert(subscription)
    .values({
      organizationId: offer.organizationId,
      planId: offer.basePlanId,
      status: "ACTIVE",
      billingCycle: offer.billingCycle,
      renewalMode: getCommercialRenewalMode(offer.kind),
      contractTermMonths: offer.contractTermMonths,
      sourceCommercialOfferId: offer.id,
      providerSubscriptionId: offer.providerSubscriptionId,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      nextBillingDate: periodEnd,
    })
    .onConflictDoUpdate({
      target: subscription.organizationId,
      set: {
        planId: offer.basePlanId,
        status: "ACTIVE",
        billingCycle: offer.billingCycle,
        renewalMode: getCommercialRenewalMode(offer.kind),
        contractTermMonths: offer.contractTermMonths,
        sourceCommercialOfferId: offer.id,
        providerSubscriptionId: offer.providerSubscriptionId,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        canceledAt: null,
        cancelReason: null,
      },
    })
    .returning();

  return result ?? null;
}

export async function getOfferById(offerId: string) {
  return db.query.commercialOffer.findFirst({
    where: eq(commercialOffer.id, offerId),
  });
}

export async function listRecentOffers(organizationId: string) {
  return db.query.commercialOffer.findMany({
    where: eq(commercialOffer.organizationId, organizationId),
    orderBy: [desc(commercialOffer.createdAt)],
    limit: 20,
  });
}

export async function getBillingContacts(organizationId: string) {
  return db.query.billingContact.findMany({
    where: eq(billingContact.organizationId, organizationId),
    orderBy: [desc(billingContact.isPrimary), desc(billingContact.createdAt)],
  });
}
