import { db } from "@calibra-facil/db";
import {
  serviceOrder,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderAssetSnapshot,
  customer,
} from "@calibra-facil/db/schema";
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
import {
  enqueueServiceOrderEmail,
} from "./email-outbox-payloads";
import type {
  OrcamentoSentOutboxPayload,
  QuoteApprovedOutboxPayload,
  QuoteRejectedOutboxPayload,
} from "./email-outbox-payloads";

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

  // REQ-SOEMAIL-071: enqueue a durable outbox row for the "novo orçamento" email.
  // Load all template data now (all queries scoped to the service order's org).
  // Enqueue is awaited so the row is persisted before the handler returns.
  // Email delivery happens in the worker drain (not in this request path).
  // The raw token is captured here (not reminted later) — REQ-SOEMAIL-023.
  const [orderRow, quoteItemRows, snapshotRow, customerRow] =
    await Promise.all([
      db
        .select({
          publicId: serviceOrder.publicId,
          clientContactSnapshot: serviceOrder.clientContactSnapshot,
        })
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.id, input.serviceOrderId),
            eq(serviceOrder.organizationId, input.member.organizationId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select()
        .from(serviceOrderQuoteItem)
        .where(eq(serviceOrderQuoteItem.quoteId, input.quoteId))
        .orderBy(
          serviceOrderQuoteItem.sortOrder,
          serviceOrderQuoteItem.id,
        ),
      db
        .select({
          manufacturer: serviceOrderAssetSnapshot.manufacturer,
          model: serviceOrderAssetSnapshot.model,
          serialNumber: serviceOrderAssetSnapshot.serialNumber,
          inventoryCode: serviceOrderAssetSnapshot.inventoryCode,
          displaySpecs: serviceOrderAssetSnapshot.displaySpecs,
        })
        .from(serviceOrderAssetSnapshot)
        .where(
          eq(serviceOrderAssetSnapshot.serviceOrderId, input.serviceOrderId),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          name: customer.name,
          email: customer.email,
          taxId: customer.taxId,
        })
        .from(customer)
        .where(
          and(
            eq(customer.id, detail.customerId),
            eq(customer.labOrganizationId, input.member.organizationId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

  const portalAppUrl =
    process.env.PORTAL_APP_URL ?? "https://portal.calibrafacil.com";

  if (orderRow) {
    const openedAtIso =
      detail.openedAt instanceof Date
        ? detail.openedAt.toISOString()
        : String(detail.openedAt);

    const orcamentoPayload = {
      serviceOrderId: input.serviceOrderId,
      quoteId: input.quoteId,
      serviceOrderNumber: detail.serviceOrderNumber,
      organizationId: input.member.organizationId,
      publicId: orderRow.publicId,
      customerId: detail.customerId,
      clientContactSnapshot:
        orderRow.clientContactSnapshot ?? null,
      customerName: customerRow?.name ?? detail.customerName ?? "",
      customerEmail: customerRow?.email ?? detail.customerEmail ?? null,
      customerTaxId: customerRow?.taxId ?? detail.customerTaxId ?? null,
      assetManufacturer: snapshotRow?.manufacturer ?? null,
      assetModel: snapshotRow?.model ?? null,
      assetInventoryCode: snapshotRow?.inventoryCode ?? null,
      openedAt: openedAtIso,
      assetSerialNumber: snapshotRow?.serialNumber ?? null,
      // REQ-SOEMAIL-025: instrument-agnostic spec rows, no hardcoded fields
      displaySpecs: snapshotRow?.displaySpecs ?? null,
      claimedDefect: detail.claimedDefect,
      items: quoteItemRows.map((item) => ({
        id: item.id,
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
        totalPriceCents: item.totalPriceCents,
      })),
      // REQ-SOEMAIL-022 [HIGH RISK]: persisted totals, not recomputed
      subtotalServicesCents: quote.subtotalServicesCents,
      subtotalPartsCents: quote.subtotalPartsCents,
      freightCents: quote.freightCents,
      discountCents: quote.discountCents,
      totalCents: quote.totalCents,
      // REQ-SOEMAIL-023 [HIGH RISK]: token captured above, not reminted
      publicAccessToken: token.token,
      portalAppUrl,
    } satisfies OrcamentoSentOutboxPayload;

    await enqueueServiceOrderEmail({
      organizationId: input.member.organizationId,
      unitId: detail.unitId,
      serviceOrderId: input.serviceOrderId,
      eventKey: `orcamento_sent:${input.quoteId}`,
      targetStatus: "awaiting_quote_approval",
      payload: orcamentoPayload,
    });
  }

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

  // Look up customer for the email payload before the transaction
  const [customerRow] = await db
    .select({ name: customer.name, email: customer.email })
    .from(customer)
    .where(
      and(
        eq(customer.id, order.customerId),
        eq(customer.labOrganizationId, order.organizationId),
      ),
    )
    .limit(1);

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
    // REQ-SOEMAIL-071/072: enqueue inside the transaction for atomicity
    const approvedPayload = {
      serviceOrderId: input.serviceOrderId,
      quoteId: input.quoteId,
      serviceOrderNumber: order.serviceOrderNumber,
      organizationId: order.organizationId,
      publicId: order.publicId,
      customerId: order.customerId,
      clientContactSnapshot: order.clientContactSnapshot,
      customerName: customerRow?.name ?? "",
      customerEmail: customerRow?.email ?? null,
      totalApprovedCents: quote.totalCents,
    } satisfies QuoteApprovedOutboxPayload;
    await enqueueServiceOrderEmail(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        eventKey: `quote_approved:${input.quoteId}`,
        targetStatus: "quote_approved",
        payload: approvedPayload,
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

  // Look up customer for the email payload before the transaction
  const [customerRowReject] = await db
    .select({ name: customer.name, email: customer.email })
    .from(customer)
    .where(
      and(
        eq(customer.id, order.customerId),
        eq(customer.labOrganizationId, order.organizationId),
      ),
    )
    .limit(1);

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
    // REQ-SOEMAIL-071/072: enqueue inside the transaction for atomicity
    const rejectedPayload = {
      serviceOrderId: input.serviceOrderId,
      quoteId: input.quoteId,
      serviceOrderNumber: order.serviceOrderNumber,
      organizationId: order.organizationId,
      publicId: order.publicId,
      customerId: order.customerId,
      clientContactSnapshot: order.clientContactSnapshot,
      customerName: customerRowReject?.name ?? "",
      customerEmail: customerRowReject?.email ?? null,
      rejectionReason: input.values.rejectionReason ?? null,
    } satisfies QuoteRejectedOutboxPayload;
    await enqueueServiceOrderEmail(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        eventKey: `quote_rejected:${input.quoteId}`,
        targetStatus: "quote_rejected",
        payload: rejectedPayload,
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
    // REQ-SOEMAIL-071/072: enqueue inside the transaction for atomicity
    // linkedCustomer is already tenant-scoped by the portal guard (REQ-075)
    const portalApprovedPayload = {
      serviceOrderId: input.serviceOrderId,
      quoteId: input.quoteId,
      serviceOrderNumber: order.serviceOrderNumber,
      organizationId: order.organizationId,
      publicId: order.publicId,
      customerId: order.customerId,
      clientContactSnapshot: order.clientContactSnapshot,
      customerName: linkedCustomer.name,
      customerEmail: linkedCustomer.email,
      totalApprovedCents: quote.totalCents,
    } satisfies QuoteApprovedOutboxPayload;
    await enqueueServiceOrderEmail(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        eventKey: `quote_approved:${input.quoteId}`,
        targetStatus: "quote_approved",
        payload: portalApprovedPayload,
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
    // REQ-SOEMAIL-071/072: enqueue inside the transaction for atomicity
    // linkedCustomer is already tenant-scoped by the portal guard (REQ-075)
    const portalRejectedPayload = {
      serviceOrderId: input.serviceOrderId,
      quoteId: input.quoteId,
      serviceOrderNumber: order.serviceOrderNumber,
      organizationId: order.organizationId,
      publicId: order.publicId,
      customerId: order.customerId,
      clientContactSnapshot: order.clientContactSnapshot,
      customerName: linkedCustomer.name,
      customerEmail: linkedCustomer.email,
      rejectionReason: input.values.rejectionReason ?? null,
    } satisfies QuoteRejectedOutboxPayload;
    await enqueueServiceOrderEmail(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        eventKey: `quote_rejected:${input.quoteId}`,
        targetStatus: "quote_rejected",
        payload: portalRejectedPayload,
      },
      tx,
    );
  });

  return { status: "ok" as const };
}
