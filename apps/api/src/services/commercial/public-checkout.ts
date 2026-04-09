import { db } from "@calibra-facil/db";
import {
  billingCustomer,
  commercialOffer,
  commercialOfferAccessLog,
  commercialOfferItem,
  organization,
  paymentRecord,
} from "@calibra-facil/db/schema";
import type {
  CommercialPaymentMethod,
  CommercialPublicCheckoutState,
} from "@calibra-facil/shared";
import { getCommercialRenewalMode } from "@calibra-facil/shared";
import { desc, eq, sql } from "drizzle-orm";
import {
  createCheckout,
  createPayment,
  createSubscription,
  formatAsaasDate,
  getPaymentBoletoLine,
  getPaymentPixQrCode,
  getSubscriptionPayments,
  type AsaasPayment,
} from "../../services/asaas";
import {
  buildOfferDescription,
  createCommercialExternalReference,
  hashCommercialPublicToken,
  insertPaymentStatusHistoryEntry,
  resolveBillingType,
} from "./common";
import type { CommercialOfferPreviewResult } from "./preview";

type OfferRow = typeof commercialOffer.$inferSelect;
type OfferItemRow = typeof commercialOfferItem.$inferSelect;
type PaymentRecordRow = typeof paymentRecord.$inferSelect;
type OrganizationRow = typeof organization.$inferSelect;
type BillingCustomerRow = typeof billingCustomer.$inferSelect;

type PublicRequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type OfferContext = {
  offer: OfferRow;
  items: OfferItemRow[];
  organization: OrganizationRow;
  billingCustomer: BillingCustomerRow;
  latestPayment: PaymentRecordRow | null;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const PAID_PAYMENT_STATUSES = new Set(["CONFIRMED", "RECEIVED"]);
const REFUNDED_PAYMENT_STATUSES = new Set([
  "REFUNDED",
  "REFUND_REQUESTED",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
]);

type PublicCheckoutPresentation =
  | {
      type: "PIX";
      paymentId: number | null;
      providerPaymentId: string | null;
      providerUrl: string | null;
      pix: {
        qrCodeImage: string | null;
        payload: string | null;
        expirationDate: string | null;
      };
      boleto: null;
    }
  | {
      type: "BOLETO";
      paymentId: number | null;
      providerPaymentId: string | null;
      providerUrl: string | null;
      pix: null;
      boleto: {
        bankSlipUrl: string | null;
        identificationField: string | null;
        dueDate: string | null;
        amount: number;
      };
    }
  | {
      type: "REDIRECT" | null;
      paymentId: number | null;
      providerPaymentId: string | null;
      providerUrl: string | null;
      pix: null;
      boleto: null;
    }
  | null;

type ValidPublicCheckoutState = Exclude<
  CommercialPublicCheckoutState,
  "INVALID" | "REDIRECTING"
>;

type ValidPublicCheckoutSnapshotResponse = {
  state: ValidPublicCheckoutState;
  offer: {
    id: string;
    status: string;
    kind: OfferRow["kind"];
    paymentMethod: CommercialPaymentMethod;
    providerMode: OfferRow["providerMode"];
    currency: string;
    totalAmount: number;
    recurringAmount: number | null;
    dueDate: string | null;
    offerExpiresAt: string | null;
    issuedAt: string | null;
    paidAt: string | null;
    customerVisibleDescription: string | null;
    items: Array<{
      id: number;
      type: OfferItemRow["type"];
      label: string;
      description: string | null;
      quantity: number;
      unitAmount: number;
      totalAmount: number;
    }>;
    seller: {
      name: string;
      cnpj: string | null;
      email: string | null;
      phone: string | null;
      website: string | null;
      city: string | null;
      state: string | null;
    };
    payer: {
      name: string | null;
      email: string | null;
      phone: string | null;
      taxId: string | null;
    };
  };
  presentation: PublicCheckoutPresentation;
};

export type PublicCheckoutSnapshotResponse =
  | {
      state: "INVALID";
      offer: null;
      presentation: null;
    }
  | ValidPublicCheckoutSnapshotResponse;

export type PublicCheckoutStartResponse =
  | {
      type: "PAID";
      state: "PAID";
      paymentId: number | null;
    }
  | {
      type: "PIX_READY";
      state: "PIX_READY";
      paymentId: number;
      pix: NonNullable<Extract<PublicCheckoutPresentation, { type: "PIX" }>["pix"]>;
    }
  | {
      type: "BOLETO_READY";
      state: "BOLETO_READY";
      paymentId: number;
      boleto: NonNullable<Extract<PublicCheckoutPresentation, { type: "BOLETO" }>["boleto"]>;
    }
  | {
      type: "REDIRECT";
      state: "AWAITING_PAYMENT";
      providerUrl: string;
      paymentId: number | null;
    };

export type PublicCheckoutStatusResponse = {
  state: ValidPublicCheckoutState;
  paymentId: number | null;
  status: string | null;
  paidAt: string | null;
  presentation: PublicCheckoutPresentation;
};

function isPublicTokenFormat(token: string) {
  return TOKEN_PATTERN.test(token);
}

function getPaymentMethod(offer: OfferRow): CommercialPaymentMethod {
  return (offer.paymentMethods[0] as CommercialPaymentMethod | undefined) ?? "BOLETO";
}

function getRecurringAmount(offer: OfferRow) {
  const terms = (offer.termsSnapshot ?? {}) as Record<string, unknown>;
  const value = terms.recurringAmount;
  return typeof value === "number" ? value : offer.kind === "PLAN_RECURRING" ? offer.totalAmount : null;
}

function getPaymentPresentationStatus(payment: PaymentRecordRow | null) {
  return payment?.status ?? null;
}

export function resolveCommercialPublicState(
  offer: OfferRow,
  latestPayment: PaymentRecordRow | null,
): ValidPublicCheckoutState {
  const now = Date.now();
  const offerExpired =
    offer.offerExpiresAt &&
    offer.offerExpiresAt.getTime() < now &&
    offer.status !== "PAID" &&
    offer.status !== "ACTIVATED";

  if (offer.publicTokenRevokedAt || offer.status === "SUPERSEDED") {
    return "REVOKED";
  }

  if (offer.status === "CANCELED") {
    return "CANCELED";
  }

  if (offer.status === "EXPIRED" || offerExpired) {
    return "EXPIRED";
  }

  if (offer.status === "PAID" || offer.status === "ACTIVATED") {
    return "PAID";
  }

  if (latestPayment) {
    if (PAID_PAYMENT_STATUSES.has(latestPayment.status)) {
      return "PAID";
    }

    if (latestPayment.status === "OVERDUE") {
      return "OVERDUE";
    }

    if (REFUNDED_PAYMENT_STATUSES.has(latestPayment.status)) {
      return "REFUNDED";
    }

    if (latestPayment.status === "DELETED") {
      return "CANCELED";
    }
  }

  const paymentMethod = getPaymentMethod(offer);
  if (paymentMethod === "PIX" && latestPayment?.providerPaymentId) {
    return "PIX_READY";
  }

  if (paymentMethod === "BOLETO" && latestPayment?.providerPaymentId) {
    return "BOLETO_READY";
  }

  return "AWAITING_PAYMENT";
}

function getProviderSnapshotValue<T>(
  payment: PaymentRecordRow | null,
  key: string,
): T | null {
  if (!payment?.providerSnapshot || typeof payment.providerSnapshot !== "object") {
    return null;
  }

  const snapshot = payment.providerSnapshot as Record<string, unknown>;
  return (snapshot[key] as T | undefined) ?? null;
}

function normalizePixImage(input: string | null | undefined) {
  if (!input) return null;
  if (input.startsWith("data:") || input.startsWith("http")) {
    return input;
  }

  return `data:image/png;base64,${input}`;
}

function buildPresentation(
  offer: OfferRow | null,
  latestPayment: PaymentRecordRow | null,
): PublicCheckoutPresentation {
  if (!offer) {
    return null;
  }

  const paymentMethod = getPaymentMethod(offer);
  const paymentId = latestPayment?.id ?? null;
  const dueDate = latestPayment?.dueDate?.toISOString() ?? offer.dueDate?.toISOString() ?? null;

  if (paymentMethod === "PIX" && latestPayment) {
    const snapshotPix = getProviderSnapshotValue<Record<string, unknown>>(
      latestPayment,
      "pixTransaction",
    );

    return {
      type: "PIX" as const,
      paymentId,
      providerPaymentId: latestPayment.providerPaymentId ?? null,
      providerUrl: latestPayment.invoiceUrl ?? offer.checkoutUrl ?? null,
      pix: {
        qrCodeImage: normalizePixImage(latestPayment.pixQrCodeUrl),
        payload: latestPayment.pixPayload ?? null,
        expirationDate:
          typeof snapshotPix?.expirationDate === "string"
            ? snapshotPix.expirationDate
            : dueDate,
      },
      boleto: null,
    };
  }

  if (paymentMethod === "BOLETO" && latestPayment) {
    return {
      type: "BOLETO" as const,
      paymentId,
      providerPaymentId: latestPayment.providerPaymentId ?? null,
      providerUrl: latestPayment.bankSlipUrl ?? latestPayment.invoiceUrl ?? null,
      pix: null,
      boleto: {
        bankSlipUrl: latestPayment.bankSlipUrl ?? null,
        identificationField:
          getProviderSnapshotValue<string>(latestPayment, "identificationField"),
        dueDate,
        amount: latestPayment.amount,
      },
    };
  }

  const providerUrl =
    latestPayment?.invoiceUrl ??
    latestPayment?.bankSlipUrl ??
    offer.checkoutUrl ??
    null;

  return {
    type: providerUrl ? ("REDIRECT" as const) : null,
    paymentId,
    providerPaymentId: latestPayment?.providerPaymentId ?? null,
    providerUrl,
    pix: null,
    boleto: null,
  };
}

function serializeSnapshot(
  context: OfferContext,
): ValidPublicCheckoutSnapshotResponse {
  const state = resolveCommercialPublicState(context.offer, context.latestPayment);

  return {
    state,
    offer: {
      id: context.offer.id,
      status: context.offer.status,
      kind: context.offer.kind,
      paymentMethod: getPaymentMethod(context.offer),
      providerMode: context.offer.providerMode,
      currency: context.offer.currency,
      totalAmount: context.offer.totalAmount,
      recurringAmount: getRecurringAmount(context.offer),
      dueDate: context.offer.dueDate?.toISOString() ?? null,
      offerExpiresAt: context.offer.offerExpiresAt?.toISOString() ?? null,
      issuedAt: context.offer.issuedAt?.toISOString() ?? null,
      paidAt: context.offer.paidAt?.toISOString() ?? null,
      customerVisibleDescription: context.offer.customerVisibleDescription,
      items: context.items.map((item) => ({
        id: item.id,
        type: item.type,
        label: item.label,
        description: item.description ?? null,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        totalAmount: item.totalAmount,
      })),
      seller: {
        name: context.organization.name,
        cnpj: context.organization.cnpj ?? null,
        email: context.organization.email ?? null,
        phone: context.organization.phone ?? null,
        website: context.organization.website ?? null,
        city: context.organization.city ?? null,
        state: context.organization.state ?? null,
      },
      payer: {
        name:
          typeof (context.offer.customerSnapshot as Record<string, unknown> | null)?.name ===
          "string"
            ? ((context.offer.customerSnapshot as Record<string, unknown>).name as string)
            : null,
        email:
          typeof (context.offer.customerSnapshot as Record<string, unknown> | null)?.email ===
          "string"
            ? ((context.offer.customerSnapshot as Record<string, unknown>).email as string)
            : null,
        phone:
          typeof (context.offer.customerSnapshot as Record<string, unknown> | null)?.phone ===
          "string"
            ? ((context.offer.customerSnapshot as Record<string, unknown>).phone as string)
            : null,
        taxId:
          typeof (context.offer.customerSnapshot as Record<string, unknown> | null)?.cpfCnpj ===
          "string"
            ? ((context.offer.customerSnapshot as Record<string, unknown>).cpfCnpj as string)
            : null,
      },
    },
    presentation: buildPresentation(context.offer, context.latestPayment),
  };
}

async function loadOfferContextById(executor: typeof db, offerId: string) {
  const offer = await executor.query.commercialOffer.findFirst({
    where: eq(commercialOffer.id, offerId),
  });

  if (!offer) {
    return null;
  }

  const [items, organizationRecord, billingCustomerRecord, latestPayment] =
    await Promise.all([
    executor.query.commercialOfferItem.findMany({
      where: eq(commercialOfferItem.offerId, offer.id),
      orderBy: [commercialOfferItem.id],
    }),
    executor.query.organization.findFirst({
      where: eq(organization.id, offer.organizationId),
    }),
    executor.query.billingCustomer.findFirst({
      where: eq(billingCustomer.id, offer.billingCustomerId),
    }),
    executor.query.paymentRecord.findFirst({
      where: eq(paymentRecord.commercialOfferId, offer.id),
      orderBy: [desc(paymentRecord.createdAt)],
    }),
  ]);

  if (!organizationRecord || !billingCustomerRecord) {
    throw new Error("Dados vinculados à oferta pública não encontrados");
  }

  return {
    offer,
    items,
    organization: organizationRecord,
    billingCustomer: billingCustomerRecord,
    latestPayment: latestPayment ?? null,
  } satisfies OfferContext;
}

async function loadOfferContextByTokenHash(tokenHash: string) {
  const offer = await db.query.commercialOffer.findFirst({
    where: eq(commercialOffer.publicTokenHash, tokenHash),
  });

  if (!offer) {
    return null;
  }

  return loadOfferContextById(db, offer.id);
}

async function recordOfferAccess(
  executor: typeof db,
  offerId: string,
  meta: PublicRequestMeta,
  eventType: typeof commercialOfferAccessLog.$inferInsert.eventType,
  publicState: Exclude<CommercialPublicCheckoutState, "INVALID" | "REDIRECTING">,
  markViewed = false,
  metadata?: Record<string, unknown> | null,
) {
  const accessTimestamp = new Date();

  await executor
    .update(commercialOffer)
    .set({
      publicLastAccessAt: accessTimestamp,
      ...(markViewed ? { publicViewedAt: accessTimestamp } : {}),
    })
    .where(eq(commercialOffer.id, offerId));

  await executor.insert(commercialOfferAccessLog).values({
    offerId,
    eventType,
    publicState,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: metadata ?? null,
  });
}

function buildPreviewFromOffer(offer: OfferRow, items: OfferItemRow[]): CommercialOfferPreviewResult {
  const normalizedItems: CommercialOfferPreviewResult["normalizedSnapshot"]["items"] =
    items.length > 0
      ? items.map((item) => ({
          type: item.type,
          label: item.label,
          description: item.description ?? undefined,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          totalAmount: item.totalAmount,
        }))
      : [
          {
            type: offer.kind === "SETUP_FEE" ? "SETUP_FEE" : "PLAN",
            label: offer.customerVisibleDescription ?? "Oferta comercial",
            quantity: 1,
            unitAmount: offer.totalAmount,
            totalAmount: offer.totalAmount,
          },
        ];

  return {
    providerMode: offer.providerMode,
    subtotalAmount: offer.subtotalAmount,
    discountAmount: offer.discountAmount,
    totalAmount: offer.totalAmount,
    recurringAmount: getRecurringAmount(offer),
    issueable: true,
    warnings: [],
    normalizedSnapshot: {
      kind: offer.kind,
      basePlanId: offer.basePlanId as "STANDARD" | "PROFESSIONAL" | "ENTERPRISE" | undefined,
      billingCycle: offer.billingCycle as "MONTHLY" | "YEARLY" | undefined,
      contractTermMonths: offer.contractTermMonths,
      paymentMethods: offer.paymentMethods as CommercialPaymentMethod[],
      dueDate: offer.dueDate ?? new Date(),
      offerExpiresAt: offer.offerExpiresAt,
      customerVisibleDescription: offer.customerVisibleDescription,
      internalNotes: null,
      items: normalizedItems,
      subtotalAmount: offer.subtotalAmount,
      discountAmount: offer.discountAmount,
      totalAmount: offer.totalAmount,
      recurringAmount: getRecurringAmount(offer),
      providerMode: offer.providerMode,
      renewalMode: getCommercialRenewalMode(offer.kind),
    },
  };
}

function buildProviderReturnUrls(publicAppUrl: string, token: string) {
  const base = publicAppUrl.replace(/\/$/, "");
  return {
    successUrl: `${base}/checkout/${token}?providerOutcome=success`,
    cancelUrl: `${base}/checkout/${token}?providerOutcome=cancel`,
    expiredUrl: `${base}/checkout/${token}?providerOutcome=expired`,
  };
}

async function createLazyArtifactForOffer(params: {
  offer: OfferRow;
  items: OfferItemRow[];
  customerId: string;
  publicToken: string;
  publicAppUrl: string;
}) {
  const preview = buildPreviewFromOffer(params.offer, params.items);
  const externalReference = createCommercialExternalReference(params.offer.id);
  const paymentMethod = getPaymentMethod(params.offer);
  const description =
    preview.normalizedSnapshot.customerVisibleDescription ??
    buildOfferDescription(preview);
  const callbacks = buildProviderReturnUrls(params.publicAppUrl, params.publicToken);

  if (params.offer.providerMode === "CHECKOUT") {
    const checkout = await createCheckout({
      billingTypes: [resolveBillingType(paymentMethod)],
      chargeTypes: ["RECURRENT"],
      customer: params.customerId,
      items: preview.normalizedSnapshot.items.map((item) => ({
        name: item.label,
        description: item.description,
        quantity: item.quantity,
        value: item.unitAmount / 100,
      })),
      minutesToExpire: params.offer.offerExpiresAt
        ? Math.max(
            10,
            Math.ceil(
              (params.offer.offerExpiresAt.getTime() - Date.now()) / 60000,
            ),
          )
        : undefined,
      callback: {
        ...callbacks,
        autoRedirect: true,
      },
      externalReference,
      subscription: params.offer.billingCycle
        ? {
            cycle: params.offer.billingCycle,
            nextDueDate: formatAsaasDate(params.offer.dueDate ?? new Date()),
          }
        : undefined,
    });

    return {
      offerValues: {
        checkoutUrl: checkout.url,
        providerCheckoutId: checkout.id,
        providerPaymentId: null,
        providerSubscriptionId: null,
        providerRequestSnapshot: {
          externalReference,
          description,
          callbacks,
        },
        providerResponseSnapshot: checkout as unknown as Record<string, unknown>,
      },
      paymentValues: null,
      paymentStatus: null,
      result: {
        type: "REDIRECT" as const,
        state: "AWAITING_PAYMENT" as const,
        providerUrl: checkout.url,
        paymentId: null,
      },
      accessEventType: "PAYMENT_STARTED" as const,
    };
  }

  if (params.offer.providerMode === "SUBSCRIPTION") {
    const subscriptionResult = await createSubscription({
      customer: params.customerId,
      billingType: resolveBillingType(paymentMethod),
      value: params.offer.totalAmount / 100,
      nextDueDate: formatAsaasDate(params.offer.dueDate ?? new Date()),
      cycle: params.offer.billingCycle!,
      description,
      externalReference,
    });

    const payments = await getSubscriptionPayments(subscriptionResult.id, { limit: 1 });
    const firstPayment = payments.data[0];

    if (!firstPayment) {
      throw new Error("Asaas não retornou o primeiro pagamento da assinatura");
    }

    return buildPaymentArtifactResult({
      offer: params.offer,
      payment: firstPayment,
      paymentMethod,
      externalReference,
      providerResponseSnapshot: {
        subscription: subscriptionResult,
        firstPayment,
      },
      providerRequestSnapshot: {
        externalReference,
        description,
        callbacks,
      },
      providerSubscriptionId: subscriptionResult.id,
      checkoutUrl:
        firstPayment.invoiceUrl ??
        firstPayment.bankSlipUrl ??
        null,
    });
  }

  const payment = await createPayment({
    customer: params.customerId,
    billingType: resolveBillingType(paymentMethod),
    value: params.offer.totalAmount / 100,
    dueDate: formatAsaasDate(params.offer.dueDate ?? new Date()),
    description,
    externalReference,
    callback: {
      ...callbacks,
      autoRedirect: true,
    },
  });

  return buildPaymentArtifactResult({
    offer: params.offer,
    payment,
    paymentMethod,
    externalReference,
    providerResponseSnapshot: payment as unknown as Record<string, unknown>,
    providerRequestSnapshot: {
      externalReference,
      description,
      callbacks,
    },
    providerSubscriptionId: payment.subscription ?? null,
    checkoutUrl:
      paymentMethod === "CREDIT_CARD"
        ? payment.invoiceUrl ?? null
        : payment.invoiceUrl ?? payment.bankSlipUrl ?? null,
  });
}

async function buildPaymentArtifactResult(params: {
  offer: OfferRow;
  payment: AsaasPayment;
  paymentMethod: CommercialPaymentMethod;
  externalReference: string;
  providerResponseSnapshot: Record<string, unknown>;
  providerRequestSnapshot: Record<string, unknown>;
  providerSubscriptionId: string | null;
  checkoutUrl: string | null;
}) {
  const paymentSnapshot = {
    ...(params.payment as unknown as Record<string, unknown>),
  };

  let pixQrCodeUrl: string | null =
    params.payment.pixTransaction?.qrCode ?? null;
  let pixPayload: string | null =
    params.payment.pixTransaction?.qrCodePayload ?? null;

  if (params.paymentMethod === "PIX") {
    const pixQrCode = await getPaymentPixQrCode(params.payment.id);
    pixQrCodeUrl = normalizePixImage(pixQrCode.encodedImage);
    pixPayload = pixQrCode.payload;
    paymentSnapshot.pixTransaction = {
      ...(params.payment.pixTransaction ?? {}),
      qrCode: pixQrCodeUrl,
      qrCodePayload: pixQrCode.payload,
      expirationDate: pixQrCode.expirationDate,
    };
  }

  if (params.paymentMethod === "BOLETO") {
    const identificationField = await getPaymentBoletoLine(params.payment.id);
    paymentSnapshot.identificationField = identificationField.identificationField;
    paymentSnapshot.nossoNumero = identificationField.nossoNumero;
    paymentSnapshot.barCode = identificationField.barCode;
  }

  return {
    offerValues: {
      checkoutUrl: params.checkoutUrl,
      providerCheckoutId: null,
      providerPaymentId: params.payment.id,
      providerSubscriptionId: params.providerSubscriptionId,
      providerRequestSnapshot: params.providerRequestSnapshot,
      providerResponseSnapshot: params.providerResponseSnapshot,
    },
    paymentValues: {
      providerCheckoutId: null,
      providerPaymentId: params.payment.id,
      providerSubscriptionId: params.providerSubscriptionId,
      externalReference: params.externalReference,
      amount: Math.round(params.payment.value * 100),
      netAmount: params.payment.netValue
        ? Math.round(params.payment.netValue * 100)
        : null,
      paymentMethod: params.paymentMethod,
      status: params.payment.status,
      dueDate: params.payment.dueDate ? new Date(params.payment.dueDate) : null,
      paidAt: params.payment.paymentDate ? new Date(params.payment.paymentDate) : null,
      invoiceUrl: params.payment.invoiceUrl ?? null,
      bankSlipUrl: params.payment.bankSlipUrl ?? null,
      pixQrCodeUrl,
      pixPayload,
      cardLast4:
        params.payment.creditCard?.creditCardNumber?.slice(-4) ?? null,
      cardBrand: params.payment.creditCard?.creditCardBrand ?? null,
      providerSnapshot: paymentSnapshot,
    },
    paymentStatus: params.payment.status,
    result:
      params.paymentMethod === "PIX"
        ? ({
            type: "PIX_READY",
            state: "PIX_READY",
            paymentId: -1,
            pix: {
              qrCodeImage: pixQrCodeUrl,
              payload: pixPayload,
              expirationDate:
                (paymentSnapshot.pixTransaction as Record<string, unknown> | undefined)
                  ?.expirationDate as string | null | undefined ?? null,
            },
          } satisfies PublicCheckoutStartResponse)
        : params.paymentMethod === "BOLETO"
          ? ({
              type: "BOLETO_READY",
              state: "BOLETO_READY",
              paymentId: -1,
              boleto: {
                bankSlipUrl: params.payment.bankSlipUrl ?? null,
                identificationField:
                  (paymentSnapshot.identificationField as string | undefined) ?? null,
                dueDate:
                  params.payment.dueDate
                    ? new Date(params.payment.dueDate).toISOString()
                    : null,
                amount: Math.round(params.payment.value * 100),
              },
            } satisfies PublicCheckoutStartResponse)
          : ({
              type: "REDIRECT",
              state: "AWAITING_PAYMENT",
              providerUrl: params.payment.invoiceUrl ?? "",
              paymentId: -1,
            } satisfies PublicCheckoutStartResponse),
    accessEventType: "PAYMENT_STARTED" as const,
  };
}

function coerceStartResponse(
  snapshot: PublicCheckoutSnapshotResponse,
): PublicCheckoutStartResponse {
  if (snapshot.state === "PAID") {
    return {
      type: "PAID",
      state: "PAID",
      paymentId: snapshot.presentation?.paymentId ?? null,
    };
  }

  if (snapshot.state === "PIX_READY" && snapshot.presentation?.pix) {
    return {
      type: "PIX_READY",
      state: "PIX_READY",
      paymentId: snapshot.presentation.paymentId ?? 0,
      pix: snapshot.presentation.pix,
    };
  }

  if (snapshot.state === "BOLETO_READY" && snapshot.presentation?.boleto) {
    return {
      type: "BOLETO_READY",
      state: "BOLETO_READY",
      paymentId: snapshot.presentation.paymentId ?? 0,
      boleto: snapshot.presentation.boleto,
    };
  }

  if (snapshot.presentation?.providerUrl) {
    return {
      type: "REDIRECT",
      state: "AWAITING_PAYMENT",
      providerUrl: snapshot.presentation.providerUrl,
      paymentId: snapshot.presentation.paymentId ?? null,
    };
  }

  throw new Error("A oferta ainda não possui uma apresentação pública iniciada");
}

export function getPublicRequestMeta(request: Request): PublicRequestMeta {
  return {
    ipAddress:
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
  };
}

export async function getCommercialPublicCheckout(
  token: string,
  meta: PublicRequestMeta,
): Promise<PublicCheckoutSnapshotResponse> {
  if (!isPublicTokenFormat(token)) {
    return { state: "INVALID", offer: null, presentation: null };
  }

  const context = await loadOfferContextByTokenHash(hashCommercialPublicToken(token));
  if (!context) {
    return { state: "INVALID", offer: null, presentation: null };
  }

  const snapshot = serializeSnapshot(context);
  await recordOfferAccess(
    db,
    context.offer.id,
    meta,
    "SNAPSHOT_VIEWED",
    snapshot.state,
    true,
  );

  return snapshot;
}

export async function getCommercialPublicCheckoutStatus(
  token: string,
  meta: PublicRequestMeta,
): Promise<PublicCheckoutStatusResponse | { state: "INVALID" }> {
  if (!isPublicTokenFormat(token)) {
    return { state: "INVALID" };
  }

  const context = await loadOfferContextByTokenHash(hashCommercialPublicToken(token));
  if (!context) {
    return { state: "INVALID" };
  }

  const state = resolveCommercialPublicState(context.offer, context.latestPayment);
  await recordOfferAccess(db, context.offer.id, meta, "STATUS_CHECKED", state, false);

  return {
    state,
    paymentId: context.latestPayment?.id ?? null,
    status: getPaymentPresentationStatus(context.latestPayment),
    paidAt:
      context.latestPayment?.paidAt?.toISOString() ??
      context.offer.paidAt?.toISOString() ??
      null,
    presentation: buildPresentation(context.offer, context.latestPayment),
  };
}

export async function startCommercialPublicCheckout(params: {
  token: string;
  publicAppUrl: string;
  meta: PublicRequestMeta;
}): Promise<PublicCheckoutStartResponse> {
  if (!isPublicTokenFormat(params.token)) {
    throw new Error("INVALID_TOKEN");
  }

  const tokenHash = hashCommercialPublicToken(params.token);

  return db.transaction(async (tx) => {
    const lockedRows = await tx.execute(
      sql`select id from commercial_offer where public_token_hash = ${tokenHash} for update`,
    );
    const lockedOfferId =
      (lockedRows as { rows?: Array<{ id?: string }> }).rows?.[0]?.id ??
      (Array.isArray(lockedRows)
        ? ((lockedRows[0] as { id?: string } | undefined)?.id ?? undefined)
        : undefined);

    if (!lockedOfferId) {
      throw new Error("INVALID_TOKEN");
    }

    const context = await loadOfferContextById(tx as typeof db, lockedOfferId);
    if (!context) {
      throw new Error("INVALID_TOKEN");
    }

    const currentSnapshot = serializeSnapshot(context);
    if (currentSnapshot.state === "PAID") {
      await recordOfferAccess(
        tx as typeof db,
        context.offer.id,
        params.meta,
        "PAYMENT_RESUMED",
        currentSnapshot.state,
        false,
      );
      return coerceStartResponse(currentSnapshot);
    }

    if (
      currentSnapshot.state === "PIX_READY" ||
      currentSnapshot.state === "BOLETO_READY" ||
      (currentSnapshot.state === "AWAITING_PAYMENT" &&
        currentSnapshot.presentation?.providerUrl)
    ) {
      await recordOfferAccess(
        tx as typeof db,
        context.offer.id,
        params.meta,
        "PAYMENT_RESUMED",
        currentSnapshot.state,
        false,
      );
      return coerceStartResponse(currentSnapshot);
    }

    if (
      currentSnapshot.state === "REVOKED" ||
      currentSnapshot.state === "EXPIRED" ||
      currentSnapshot.state === "CANCELED" ||
      currentSnapshot.state === "OVERDUE" ||
      currentSnapshot.state === "REFUNDED"
    ) {
      throw new Error(`TERMINAL_${currentSnapshot.state}`);
    }

    const createdArtifact = await createLazyArtifactForOffer({
      offer: context.offer,
      items: context.items,
      customerId: context.billingCustomer.providerCustomerId,
      publicToken: params.token,
      publicAppUrl: params.publicAppUrl,
    });

    if (!createdArtifact.offerValues.providerCheckoutId && !createdArtifact.offerValues.providerPaymentId) {
      throw new Error("Falha ao iniciar o artefato público de pagamento");
    }

    await tx
      .update(commercialOffer)
      .set({
        checkoutUrl: createdArtifact.offerValues.checkoutUrl ?? null,
        providerCheckoutId: createdArtifact.offerValues.providerCheckoutId ?? null,
        providerPaymentId: createdArtifact.offerValues.providerPaymentId ?? null,
        providerSubscriptionId:
          createdArtifact.offerValues.providerSubscriptionId ?? null,
        providerRequestSnapshot:
          createdArtifact.offerValues.providerRequestSnapshot ?? null,
        providerResponseSnapshot:
          createdArtifact.offerValues.providerResponseSnapshot ?? null,
      })
      .where(eq(commercialOffer.id, context.offer.id));

    let persistedPaymentId: number | null = null;

    if (createdArtifact.paymentValues) {
      const [createdPayment] = await tx
        .insert(paymentRecord)
        .values({
          commercialOfferId: context.offer.id,
          organizationId: context.offer.organizationId,
          provider: "ASAAS",
          providerCheckoutId: createdArtifact.paymentValues.providerCheckoutId,
          providerPaymentId: createdArtifact.paymentValues.providerPaymentId,
          providerSubscriptionId: createdArtifact.paymentValues.providerSubscriptionId,
          externalReference: createdArtifact.paymentValues.externalReference,
          amount: createdArtifact.paymentValues.amount,
          netAmount: createdArtifact.paymentValues.netAmount,
          currency: context.offer.currency,
          paymentMethod: createdArtifact.paymentValues.paymentMethod,
          status: createdArtifact.paymentValues.status,
          dueDate: createdArtifact.paymentValues.dueDate,
          paidAt: createdArtifact.paymentValues.paidAt,
          invoiceUrl: createdArtifact.paymentValues.invoiceUrl,
          bankSlipUrl: createdArtifact.paymentValues.bankSlipUrl,
          pixQrCodeUrl: createdArtifact.paymentValues.pixQrCodeUrl,
          pixPayload: createdArtifact.paymentValues.pixPayload,
          cardLast4: createdArtifact.paymentValues.cardLast4,
          cardBrand: createdArtifact.paymentValues.cardBrand,
          providerSnapshot: createdArtifact.paymentValues.providerSnapshot,
        })
        .returning();

      if (!createdPayment) {
        throw new Error("Falha ao persistir o pagamento público");
      }

      persistedPaymentId = createdPayment.id;

      await insertPaymentStatusHistoryEntry(tx, {
        paymentRecordId: createdPayment.id,
        commercialOfferId: context.offer.id,
        toStatus: createdPayment.status,
        payload: createdPayment.providerSnapshot ?? null,
      });
    }

    const response: PublicCheckoutStartResponse =
      createdArtifact.result.type === "PIX_READY"
        ? {
            ...createdArtifact.result,
            paymentId: persistedPaymentId ?? 0,
          }
        : createdArtifact.result.type === "BOLETO_READY"
          ? {
              ...createdArtifact.result,
              paymentId: persistedPaymentId ?? 0,
            }
          : {
              ...createdArtifact.result,
              paymentId: persistedPaymentId ?? createdArtifact.result.paymentId,
            };

    await recordOfferAccess(
      tx as typeof db,
      context.offer.id,
      params.meta,
      createdArtifact.result.type === "REDIRECT"
        ? "PROVIDER_REDIRECTED"
        : createdArtifact.accessEventType,
      response.state,
      false,
    );

    return response;
  });
}
