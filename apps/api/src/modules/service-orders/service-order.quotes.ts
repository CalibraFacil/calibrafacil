import { db } from "@calibra-facil/db";
import { serviceOrder, serviceOrderQuote } from "@calibra-facil/db/schema";
import {
  canApproveServiceOrderQuote,
  canEditServiceOrderQuote,
} from "@calibra-facil/shared";
import type {
  ApproveServiceOrderQuoteManuallySchema,
  CreateServiceOrderQuoteSchema,
  RejectServiceOrderQuoteManuallySchema,
  RejectServiceOrderQuotePortalSchema,
  SendServiceOrderQuoteSchema,
  UpdateServiceOrderQuoteDraftSchema,
} from "@calibra-facil/schemas";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { AuthVariables } from "../../middleware/permission";
import {
  createPublicServiceOrderAccessToken,
  recordServiceOrderEvent,
  replaceQuoteItems,
} from "../../lib/service-order-workflow";
import { buildUnitScopeCondition } from "../../lib/units";
import { enqueueServiceOrderDocumentJob } from "./service-order.documents";
import { getQuoteForAction } from "./service-order.queries";
import { getServiceOrderDetail } from "./service-order.read-model";
import { getPortalCustomerForAuthOrganization } from "./service-order.list-queries";

type ServiceOrderMember = AuthVariables["member"];

type RequestMetadata = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type CreateQuoteInput = z.infer<typeof CreateServiceOrderQuoteSchema>;
type UpdateQuoteDraftInput = z.infer<typeof UpdateServiceOrderQuoteDraftSchema>;
type SendQuoteInput = z.infer<typeof SendServiceOrderQuoteSchema>;
type ApproveQuoteManuallyInput = z.infer<
  typeof ApproveServiceOrderQuoteManuallySchema
>;
type RejectQuoteManuallyInput = z.infer<
  typeof RejectServiceOrderQuoteManuallySchema
>;
type RejectQuotePortalInput = z.infer<
  typeof RejectServiceOrderQuotePortalSchema
>;

function parseDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function quoteItemsWithDates(items: CreateQuoteInput["items"]) {
  return items.map((item) => ({
    ...item,
    warrantyUntil: parseDate(item.warrantyUntil),
  }));
}

export async function createServiceOrderQuote(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: CreateQuoteInput;
}) {
  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .limit(1);
  if (!order) return { status: "not_found" as const };

  const [latest] = await db
    .select({ version: serviceOrderQuote.version })
    .from(serviceOrderQuote)
    .where(eq(serviceOrderQuote.serviceOrderId, input.serviceOrderId))
    .orderBy(desc(serviceOrderQuote.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;

  const calculated = await db.transaction(async (tx) => {
    const [quote] = await tx
      .insert(serviceOrderQuote)
      .values({
        serviceOrderId: input.serviceOrderId,
        quoteNumber: `${order.serviceOrderNumber}/ORC`,
        version,
        validUntil: parseDate(input.values.validUntil),
        paymentTerms: input.values.paymentTerms ?? null,
        deliveryEstimate: input.values.deliveryEstimate ?? null,
        warrantyTerms: input.values.warrantyTerms ?? null,
        clientMessage: input.values.clientMessage ?? null,
        internalNotes: input.values.internalNotes ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning();
    if (!quote) throw new Error("Falha ao criar orcamento");

    const totals = await replaceQuoteItems(
      {
        quoteId: quote.id,
        items: quoteItemsWithDates(input.values.items),
      },
      tx,
    );
    await tx
      .update(serviceOrderQuote)
      .set({
        subtotalServicesCents: totals.subtotalServicesCents,
        subtotalPartsCents: totals.subtotalPartsCents,
        discountCents: totals.discountCents,
        freightCents: totals.freightCents,
        totalCents: totals.totalCents,
      })
      .where(eq(serviceOrderQuote.id, quote.id));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: order.id,
        actorType: "lab_user",
        actorId: input.actorUserId,
        eventType: "service_order.quote_created",
        metadata: { quoteId: quote.id, version },
      },
      tx,
    );

    return { quote: { ...quote, ...totals }, totals };
  });

  return { status: "ok" as const, data: calculated.quote };
}

export async function updateServiceOrderQuoteDraft(input: {
  serviceOrderId: number;
  quoteId: number;
  values: UpdateQuoteDraftInput;
}) {
  const quote = await getQuoteForAction(input.serviceOrderId, input.quoteId);
  if (!quote) return { status: "not_found" as const };
  if (!canEditServiceOrderQuote(quote.status)) {
    return { status: "conflict" as const };
  }

  const totals = input.values.items
    ? await replaceQuoteItems({
        quoteId: input.quoteId,
        items: quoteItemsWithDates(input.values.items),
      })
    : null;

  const [updated] = await db
    .update(serviceOrderQuote)
    .set({
      validUntil: parseDate(input.values.validUntil),
      paymentTerms: input.values.paymentTerms,
      deliveryEstimate: input.values.deliveryEstimate,
      warrantyTerms: input.values.warrantyTerms,
      clientMessage: input.values.clientMessage,
      internalNotes: input.values.internalNotes,
      ...(totals
        ? {
            subtotalServicesCents: totals.subtotalServicesCents,
            subtotalPartsCents: totals.subtotalPartsCents,
            discountCents: totals.discountCents,
            freightCents: totals.freightCents,
            totalCents: totals.totalCents,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(serviceOrderQuote.id, input.quoteId))
    .returning();

  return { status: "ok" as const, data: updated };
}

export async function sendServiceOrderQuote(input: {
  serviceOrderId: number;
  quoteId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: SendQuoteInput;
}) {
  const quote = await getQuoteForAction(input.serviceOrderId, input.quoteId);
  if (!quote) return { status: "quote_not_found" as const };
  if (!canEditServiceOrderQuote(quote.status)) {
    return { status: "conflict" as const };
  }

  const detail = await getServiceOrderDetail(
    input.serviceOrderId,
    input.member.organizationId,
    buildUnitScopeCondition(serviceOrder.unitId, input.member),
  );
  if (!detail) return { status: "order_not_found" as const };

  const token = await createPublicServiceOrderAccessToken({
    organizationId: input.member.organizationId,
    serviceOrderId: input.serviceOrderId,
    quoteId: input.quoteId,
    expiresAt: parseDate(input.values.expiresAt),
  });

  const [updated] = await db
    .update(serviceOrderQuote)
    .set({
      status: "sent",
      sentAt: new Date(),
      sentByUserId: input.actorUserId,
      portalAccessTokenHash: token.tokenHash,
      clientMessage: input.values.clientMessage ?? quote.clientMessage,
      updatedAt: new Date(),
    })
    .where(eq(serviceOrderQuote.id, input.quoteId))
    .returning();

  await db
    .update(serviceOrder)
    .set({
      status: "awaiting_quote_approval",
      quotedAt: new Date(),
      totalQuotedCents: quote.totalCents,
      updatedAt: new Date(),
    })
    .where(eq(serviceOrder.id, input.serviceOrderId));

  await recordServiceOrderEvent({
    organizationId: detail.organizationId,
    unitId: detail.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.quote_sent",
    metadata: { quoteId: input.quoteId, publicAccessTokenIssued: true },
  });
  await enqueueServiceOrderDocumentJob({
    type: "SERVICE_ORDER_QUOTE",
    serviceOrderId: input.serviceOrderId,
    quoteId: input.quoteId,
    userId: input.actorUserId,
  });

  return { status: "ok" as const, data: updated, publicToken: token.token };
}

export async function approveServiceOrderQuoteManually(input: {
  serviceOrderId: number;
  quoteId: number;
  actorUserId: string;
  values: ApproveQuoteManuallyInput;
}) {
  const quote = await getQuoteForAction(input.serviceOrderId, input.quoteId);
  if (!quote || !canApproveServiceOrderQuote(quote.status)) {
    return { status: "conflict" as const };
  }

  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, input.serviceOrderId))
    .limit(1);
  if (!order) return { status: "order_not_found" as const };

  await db.transaction(async (tx) => {
    await tx
      .update(serviceOrderQuote)
      .set({
        status: "approved",
        approvedAt: parseDate(input.values.approvedAt) ?? new Date(),
        approvedManuallyByUserId: input.actorUserId,
        manualApprovalByName: input.values.approvedByName,
        manualApprovalEvidenceType: input.values.manualApprovalEvidenceType,
        manualApprovalEvidenceText: input.values.manualApprovalEvidenceText,
      })
      .where(eq(serviceOrderQuote.id, input.quoteId));
    await tx
      .update(serviceOrder)
      .set({
        status: "quote_approved",
        approvedAt: new Date(),
        totalApprovedCents: quote.totalCents,
      })
      .where(eq(serviceOrder.id, input.serviceOrderId));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        actorType: "lab_user",
        actorId: input.actorUserId,
        eventType: "service_order.quote_approved_manually",
        metadata: {
          quoteId: input.quoteId,
          approvedByName: input.values.approvedByName,
          evidenceType: input.values.manualApprovalEvidenceType,
        },
      },
      tx,
    );
  });

  return { status: "ok" as const };
}

export async function rejectServiceOrderQuoteManually(input: {
  serviceOrderId: number;
  quoteId: number;
  actorUserId: string;
  values: RejectQuoteManuallyInput;
}) {
  const quote = await getQuoteForAction(input.serviceOrderId, input.quoteId);
  if (!quote || !canApproveServiceOrderQuote(quote.status)) {
    return { status: "conflict" as const };
  }

  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, input.serviceOrderId))
    .limit(1);
  if (!order) return { status: "order_not_found" as const };

  await db.transaction(async (tx) => {
    await tx
      .update(serviceOrderQuote)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: input.values.rejectionReason,
      })
      .where(eq(serviceOrderQuote.id, input.quoteId));
    await tx
      .update(serviceOrder)
      .set({ status: "quote_rejected", rejectedAt: new Date() })
      .where(eq(serviceOrder.id, input.serviceOrderId));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        actorType: "lab_user",
        actorId: input.actorUserId,
        eventType: "service_order.quote_rejected_manually",
        metadata: {
          quoteId: input.quoteId,
          reason: input.values.rejectionReason,
        },
      },
      tx,
    );
  });

  return { status: "ok" as const };
}

export async function approveServiceOrderQuoteByPortalUser(input: {
  serviceOrderId: number;
  quoteId: number;
  authOrganizationId: string;
  actorUserId: string;
  metadata: RequestMetadata;
}) {
  const linkedCustomer = await getPortalCustomerForAuthOrganization(
    input.authOrganizationId,
  );
  const quote = await getQuoteForAction(input.serviceOrderId, input.quoteId);
  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, input.serviceOrderId))
    .limit(1);

  if (
    !linkedCustomer ||
    !order ||
    order.customerId !== linkedCustomer.id ||
    !quote
  ) {
    return { status: "not_found" as const };
  }
  if (!canApproveServiceOrderQuote(quote.status)) {
    return { status: "conflict" as const };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(serviceOrderQuote)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedByPortalUserId: input.actorUserId,
      })
      .where(eq(serviceOrderQuote.id, input.quoteId));
    await tx
      .update(serviceOrder)
      .set({
        status: "quote_approved",
        approvedAt: new Date(),
        totalApprovedCents: quote.totalCents,
      })
      .where(eq(serviceOrder.id, input.serviceOrderId));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        actorType: "portal_user",
        actorId: input.actorUserId,
        eventType: "service_order.quote_approved_by_client",
        metadata: { quoteId: input.quoteId },
        ipAddress: input.metadata.ipAddress ?? null,
        userAgent: input.metadata.userAgent ?? null,
      },
      tx,
    );
  });

  return { status: "ok" as const };
}

export async function rejectServiceOrderQuoteByPortalUser(input: {
  serviceOrderId: number;
  quoteId: number;
  authOrganizationId: string;
  actorUserId: string;
  values: RejectQuotePortalInput;
  metadata: RequestMetadata;
}) {
  const linkedCustomer = await getPortalCustomerForAuthOrganization(
    input.authOrganizationId,
  );
  const quote = await getQuoteForAction(input.serviceOrderId, input.quoteId);
  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, input.serviceOrderId))
    .limit(1);

  if (
    !linkedCustomer ||
    !order ||
    order.customerId !== linkedCustomer.id ||
    !quote
  ) {
    return { status: "not_found" as const };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(serviceOrderQuote)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: input.values.rejectionReason ?? null,
      })
      .where(eq(serviceOrderQuote.id, input.quoteId));
    await tx
      .update(serviceOrder)
      .set({ status: "quote_rejected", rejectedAt: new Date() })
      .where(eq(serviceOrder.id, input.serviceOrderId));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        actorType: "portal_user",
        actorId: input.actorUserId,
        eventType: "service_order.quote_rejected_by_client",
        metadata: {
          quoteId: input.quoteId,
          reason: input.values.rejectionReason,
        },
        ipAddress: input.metadata.ipAddress ?? null,
        userAgent: input.metadata.userAgent ?? null,
      },
      tx,
    );
  });

  return { status: "ok" as const };
}
