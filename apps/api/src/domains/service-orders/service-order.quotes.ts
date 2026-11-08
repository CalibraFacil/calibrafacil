import {
  serviceOrder,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderAssetSnapshot,
  customer,
} from "@calibra-facil/db/schema";
import { isServiceOrderFinalStatus } from "@calibra-facil/shared";
import {
  SERVICE_ORDER_MACHINE,
  canApproveServiceOrderQuote,
  SERVICE_ORDER_QUOTE_MACHINE,
  canEditServiceOrderQuote,
  type ServiceOrderCommand,
} from "@calibra-facil/schemas/machines";
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
import {
  computeDefaultPublicTokenExpiry,
  createPublicServiceOrderAccessToken,
  recordServiceOrderEvent,
  replaceQuoteItems,
  revokeActiveTokensForQuote,
  revokeSupersededServiceOrderTokens,
} from "./service-order-workflow";
import { conflict, notFound } from "../../lib/domain-errors";
import type { OrgContext } from "../../lib/org-context";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  getQuoteForAction,
  lockServiceOrderStatus,
  requireScopedServiceOrder,
} from "./service-order.queries";
import { getServiceOrderDetail } from "./service-order.read-model";
import {
  serviceOrderInvalidTransition,
  serviceOrderNotFound,
  serviceOrderQuoteNotFound,
} from "./service-order-errors";
import type { ServiceOrderScope } from "./service-order-scope";
import type { getPortalCustomerForAuthOrganization } from "./service-order.list-queries";
import { enqueueServiceOrderEmail } from "./email/email-outbox-payloads";
import type {
  OrcamentoSentOutboxPayload,
  QuoteApprovedOutboxPayload,
  QuoteRejectedOutboxPayload,
} from "./email/email-outbox-payloads";
import { portalBaseUrl } from "@calibra-facil/shared/public-urls";

type ServiceOrderRowStatus = (typeof serviceOrder.$inferSelect)["status"];

/**
 * The order's side of a quote decision. The order advances only while it waits
 * on the decision (`approve_quote` / `reject_quote` in SERVICE_ORDER_MACHINE);
 * anywhere else the decision is late or out of band (a mid-job re-quote, a
 * public link answered after delivery) and moving the status would rewind real
 * progress, so only the decision's own fields are written.
 */
function orderStatusOnDecision(
  status: ServiceOrderRowStatus,
  command: Extract<ServiceOrderCommand, "approve_quote" | "reject_quote">,
) {
  return SERVICE_ORDER_MACHINE.canTransition(status, command)
    ? { status: SERVICE_ORDER_MACHINE.requireTargetOf(status, command) }
    : {};
}

/** The portal customer a decision is made for (the lab's customer row). */
type PortalQuoteCustomer = NonNullable<
  Awaited<ReturnType<typeof getPortalCustomerForAuthOrganization>>
>;

function quoteNotDecidable(message: string) {
  return conflict("service_order_quote_not_decidable", message);
}

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

export async function createServiceOrderQuote(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: CreateQuoteInput,
) {
  const [order] = await ctx.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
      ),
    )
    .limit(1);
  if (!order) throw serviceOrderNotFound();
  // Drafts mid-flow are harmless (a revision in progress), but a closed or
  // canceled OS must not grow new quotes — sending one would rewind the whole
  // order and email the customer about a job that is already finished.
  if (isServiceOrderFinalStatus(order.status)) {
    throw conflict(
      "status_transition_conflict",
      "OS encerrada ou cancelada nao aceita novo orcamento",
    );
  }

  const [latest] = await ctx.o
    .select({ version: serviceOrderQuote.version })
    .from(serviceOrderQuote)
    .where(eq(serviceOrderQuote.serviceOrderId, serviceOrderId))
    .orderBy(desc(serviceOrderQuote.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;

  const [quote] = await ctx.o
    .insert(serviceOrderQuote)
    .values({
      organizationId: ctx.org,
      serviceOrderId,
      quoteNumber: `${order.serviceOrderNumber}/ORC`,
      version,
      validUntil: parseDate(values.validUntil),
      paymentTerms: values.paymentTerms ?? null,
      deliveryEstimate: values.deliveryEstimate ?? null,
      warrantyTerms: values.warrantyTerms ?? null,
      clientMessage: values.clientMessage ?? null,
      internalNotes: values.internalNotes ?? null,
      createdByUserId: ctx.actor.userId,
    })
    .returning();
  if (!quote) throw new Error("Falha ao criar orcamento");

  const totals = await replaceQuoteItems(
    {
      organizationId: order.organizationId,
      quoteId: quote.id,
      items: quoteItemsWithDates(values.items),
    },
    ctx.o,
  );
  await ctx.o
    .update(serviceOrderQuote)
    .set({
      subtotalServicesCents: totals.subtotalServicesCents,
      subtotalPartsCents: totals.subtotalPartsCents,
      discountCents: totals.discountCents,
      freightCents: totals.freightCents,
      totalCents: totals.totalCents,
    })
    .where(
      and(
        eq(serviceOrderQuote.id, quote.id),
        eq(serviceOrderQuote.organizationId, quote.organizationId),
      ),
    );
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId: order.id,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.quote_created",
      metadata: { quoteId: quote.id, version },
    },
    ctx.o,
  );

  return { ...quote, ...totals };
}

export async function updateServiceOrderQuoteDraft(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  quoteId: number,
  values: UpdateQuoteDraftInput,
) {
  const [order] = await ctx.o
    .select({
      id: serviceOrder.id,
      organizationId: serviceOrder.organizationId,
    })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
      ),
    )
    .limit(1);
  if (!order) throw serviceOrderQuoteNotFound();

  const quote = await getQuoteForAction(
    serviceOrderId,
    quoteId,
    ctx.org,
    ctx.o,
    {
      lock: true,
    },
  );
  if (!quote) throw serviceOrderQuoteNotFound();
  if (!canEditServiceOrderQuote(quote.status)) {
    throw conflict("record_immutable", "Orcamento enviado/aprovado e imutavel");
  }

  const totals = values.items
    ? await replaceQuoteItems(
        {
          organizationId: order.organizationId,
          quoteId,
          items: quoteItemsWithDates(values.items),
        },
        ctx.o,
      )
    : null;

  const [updated] = await ctx.o
    .update(serviceOrderQuote)
    .set({
      validUntil: parseDate(values.validUntil),
      paymentTerms: values.paymentTerms,
      deliveryEstimate: values.deliveryEstimate,
      warrantyTerms: values.warrantyTerms,
      clientMessage: values.clientMessage,
      internalNotes: values.internalNotes,
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
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.organizationId, ctx.org),
      ),
    )
    .returning();

  return updated;
}

/**
 * Sends a draft quote: the grant for the public link, the order's move to
 * "awaiting approval", the durable e-mail outbox row (REQ-SOEMAIL-071) and the
 * quote PDF job (it renders the rows this transaction writes) commit together.
 * Answers the updated quote and the raw public token (the only time it exists).
 */
export async function sendServiceOrderQuote(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  quoteId: number,
  values: SendQuoteInput,
) {
  // Resolve the OS inside the caller's org/unit scope FIRST: a cross-tenant
  // (OS, quote) pair then answers exactly like an unknown OS, instead of
  // revealing through "quote not found" vs "OS not found" that the quote exists.
  const detail = await getServiceOrderDetail(
    ctx.o,
    serviceOrderId,
    ctx.org,
    buildUnitScopeCondition(serviceOrder.unitId, scope),
  );
  if (!detail) throw serviceOrderNotFound();

  const quote = await getQuoteForAction(
    serviceOrderId,
    quoteId,
    ctx.org,
    ctx.o,
    {
      lock: true,
    },
  );
  if (!quote) throw serviceOrderQuoteNotFound();
  if (!SERVICE_ORDER_QUOTE_MACHINE.canTransition(quote.status, "send")) {
    throw conflict(
      "service_order_quote_not_sendable",
      "Apenas rascunhos podem ser enviados",
    );
  }
  // `send_quote` in SERVICE_ORDER_MACHINE: any open order, never a closed or
  // canceled one (it must not be rewound, nor the customer mailed a fresh
  // approval link for finished work). Off the bench the order then waits on
  // the customer; on the bench it keeps its stage (mid-job re-quote). The
  // order row is locked so its status holds until the writes commit.
  const lockedStatus = await lockServiceOrderStatus(
    ctx.o,
    serviceOrderId,
    ctx.org,
  );
  const orderStatusAfterSend = lockedStatus
    ? SERVICE_ORDER_MACHINE.targetOf(lockedStatus, "send_quote")
    : null;
  if (!orderStatusAfterSend) throw serviceOrderInvalidTransition();

  const sentAt = new Date();

  // REQ-QPUB-004: a new quote version supersedes earlier quotes' live tokens.
  // Revoke BEFORE minting so a crash between the two never leaves stale-live
  // old-quote tokens alongside a new send.
  await revokeSupersededServiceOrderTokens(ctx.o, {
    organizationId: ctx.org,
    serviceOrderId,
    currentQuoteId: quoteId,
  });

  const token = await createPublicServiceOrderAccessToken({
    organizationId: ctx.org,
    serviceOrderId,
    quoteId,
    // REQ-QPUB-010: the send-time grant also carries the emailed approval code.
    withApprovalCode: true,
    // REQ-QPUB-001: links never live forever — default to validUntil + grace,
    // else sentAt + 30 days, when the lab didn't set an explicit expiry.
    expiresAt:
      parseDate(values.expiresAt) ??
      computeDefaultPublicTokenExpiry({
        validUntil: quote.validUntil,
        sentAt,
      }),
    executor: ctx.o,
  });

  const [updated] = await ctx.o
    .update(serviceOrderQuote)
    .set({
      status: "sent",
      sentAt,
      sentByUserId: ctx.actor.userId,
      portalAccessTokenHash: token.tokenHash,
      clientMessage: values.clientMessage ?? quote.clientMessage,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.organizationId, ctx.org),
      ),
    )
    .returning();

  await ctx.o
    .update(serviceOrder)
    .set({
      status: orderStatusAfterSend,
      quotedAt: new Date(),
      totalQuotedCents: quote.totalCents,
      updatedAt: new Date(),
    })
    .where(eq(serviceOrder.id, serviceOrderId));

  await recordServiceOrderEvent(
    {
      organizationId: detail.organizationId,
      unitId: detail.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.quote_sent",
      metadata: { quoteId, publicAccessTokenIssued: true },
    },
    ctx.o,
  );

  // REQ-SOEMAIL-071: enqueue a durable outbox row for the "novo orçamento" email.
  // Load all template data now (all queries scoped to the service order's org).
  // Email delivery happens in the worker drain (not in this request path).
  // The raw token is captured here (not reminted later) — REQ-SOEMAIL-023.
  const [orderRow, quoteItemRows, snapshotRow, customerRow] = await Promise.all(
    [
      ctx.o
        .select({
          publicId: serviceOrder.publicId,
          clientContactSnapshot: serviceOrder.clientContactSnapshot,
        })
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.id, serviceOrderId),
            eq(serviceOrder.organizationId, ctx.org),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      ctx.o
        .select()
        .from(serviceOrderQuoteItem)
        .where(
          and(
            eq(serviceOrderQuoteItem.quoteId, quoteId),
            eq(serviceOrderQuoteItem.organizationId, ctx.org),
          ),
        )
        .orderBy(serviceOrderQuoteItem.sortOrder, serviceOrderQuoteItem.id),
      ctx.o
        .select({
          manufacturer: serviceOrderAssetSnapshot.manufacturer,
          model: serviceOrderAssetSnapshot.model,
          serialNumber: serviceOrderAssetSnapshot.serialNumber,
          inventoryCode: serviceOrderAssetSnapshot.inventoryCode,
          displaySpecs: serviceOrderAssetSnapshot.displaySpecs,
        })
        .from(serviceOrderAssetSnapshot)
        .where(eq(serviceOrderAssetSnapshot.serviceOrderId, serviceOrderId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      ctx.o
        .select({
          name: customer.name,
          email: customer.email,
          taxId: customer.taxId,
        })
        .from(customer)
        .where(
          and(
            eq(customer.id, detail.customerId),
            eq(customer.labOrganizationId, ctx.org),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ],
  );

  const portalAppUrl = portalBaseUrl();

  if (orderRow) {
    const openedAtIso =
      detail.openedAt instanceof Date
        ? detail.openedAt.toISOString()
        : String(detail.openedAt);

    const orcamentoPayload = {
      serviceOrderId,
      quoteId,
      serviceOrderNumber: detail.serviceOrderNumber,
      organizationId: ctx.org,
      publicId: orderRow.publicId,
      customerId: detail.customerId,
      clientContactSnapshot: orderRow.clientContactSnapshot ?? null,
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
      // REQ-QPUB-021 [HIGH RISK]: the emailed code is the one minted above.
      ...(token.code ? { approvalCode: token.code } : {}),
      portalAppUrl,
    } satisfies OrcamentoSentOutboxPayload;

    await enqueueServiceOrderEmail(
      {
        organizationId: ctx.org,
        unitId: detail.unitId,
        serviceOrderId,
        eventKey: `orcamento_sent:${quoteId}`,
        targetStatus: "awaiting_quote_approval",
        payload: orcamentoPayload,
      },
      ctx.o,
    );
  }

  await ctx.emit({
    type: "SERVICE_ORDER_QUOTE",
    serviceOrderId,
    quoteId,
    userId: ctx.actor.userId,
  });

  return { data: updated, publicToken: token.token };
}

export async function approveServiceOrderQuoteManually(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  quoteId: number,
  values: ApproveQuoteManuallyInput,
) {
  // Resolve the OS within the caller's org+unit scope first, so a
  // cross-tenant :id is rejected with 404.
  await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);

  const quote = await getQuoteForAction(
    serviceOrderId,
    quoteId,
    ctx.org,
    ctx.o,
    {
      lock: true,
    },
  );
  if (!quote || !canApproveServiceOrderQuote(quote.status)) {
    throw quoteNotDecidable("Orcamento nao pode ser aprovado");
  }

  // Scope the OS to the caller's organization so a cross-tenant :id
  // cannot be mutated (mirrors getScopedServiceOrder / the .pdf route). The
  // scoped read above already resolved it; this is the module-level
  // defense-in-depth.
  const [order] = await ctx.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
      ),
    )
    .limit(1)
    .for("update");
  if (!order) throw serviceOrderNotFound();

  const [customerRow] = await ctx.o
    .select({ name: customer.name, email: customer.email })
    .from(customer)
    .where(
      and(
        eq(customer.id, order.customerId),
        eq(customer.labOrganizationId, order.organizationId),
      ),
    )
    .limit(1);

  await ctx.o
    .update(serviceOrderQuote)
    .set({
      status: "approved",
      approvedAt: parseDate(values.approvedAt) ?? new Date(),
      approvedManuallyByUserId: ctx.actor.userId,
      manualApprovalByName: values.approvedByName,
      manualApprovalEvidenceType: values.manualApprovalEvidenceType,
      manualApprovalEvidenceText: values.manualApprovalEvidenceText,
    })
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.organizationId, ctx.org),
      ),
    );
  // REQ-QPUB-003 [HIGH RISK]: a decided quote's public links stop working.
  await revokeActiveTokensForQuote(ctx.o, {
    organizationId: order.organizationId,
    quoteId,
    reason: "decided",
  });
  await ctx.o
    .update(serviceOrder)
    .set({
      ...orderStatusOnDecision(order.status, "approve_quote"),
      approvedAt: new Date(),
      totalApprovedCents: quote.totalCents,
    })
    .where(eq(serviceOrder.id, serviceOrderId));
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.quote_approved_manually",
      metadata: {
        quoteId,
        approvedByName: values.approvedByName,
        evidenceType: values.manualApprovalEvidenceType,
      },
    },
    ctx.o,
  );
  // REQ-SOEMAIL-071/072: enqueue inside the transaction for atomicity
  const approvedPayload = {
    serviceOrderId,
    quoteId,
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
      serviceOrderId,
      eventKey: `quote_approved:${quoteId}`,
      targetStatus: "quote_approved",
      payload: approvedPayload,
    },
    ctx.o,
  );
}

export async function rejectServiceOrderQuoteManually(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  quoteId: number,
  values: RejectQuoteManuallyInput,
) {
  // Resolve the OS within the caller's org+unit scope first, so a
  // cross-tenant :id is rejected with 404.
  await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);

  const quote = await getQuoteForAction(
    serviceOrderId,
    quoteId,
    ctx.org,
    ctx.o,
    {
      lock: true,
    },
  );
  if (!quote || !canApproveServiceOrderQuote(quote.status)) {
    throw quoteNotDecidable("Orcamento nao pode ser recusado");
  }

  // Scope the OS to the caller's organization so a cross-tenant :id
  // cannot be mutated (mirrors getScopedServiceOrder / the .pdf route). The
  // scoped read above already resolved it; this is the module-level
  // defense-in-depth.
  const [order] = await ctx.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
      ),
    )
    .limit(1)
    .for("update");
  if (!order) throw serviceOrderNotFound();

  const [customerRowReject] = await ctx.o
    .select({ name: customer.name, email: customer.email })
    .from(customer)
    .where(
      and(
        eq(customer.id, order.customerId),
        eq(customer.labOrganizationId, order.organizationId),
      ),
    )
    .limit(1);

  await ctx.o
    .update(serviceOrderQuote)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: values.rejectionReason,
    })
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.organizationId, ctx.org),
      ),
    );
  // REQ-QPUB-003 [HIGH RISK]: a decided quote's public links stop working.
  await revokeActiveTokensForQuote(ctx.o, {
    organizationId: order.organizationId,
    quoteId,
    reason: "decided",
  });
  await ctx.o
    .update(serviceOrder)
    .set({
      ...orderStatusOnDecision(order.status, "reject_quote"),
      rejectedAt: new Date(),
    })
    .where(eq(serviceOrder.id, serviceOrderId));
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.quote_rejected_manually",
      metadata: {
        quoteId,
        reason: values.rejectionReason,
      },
    },
    ctx.o,
  );
  // REQ-SOEMAIL-071/072: enqueue inside the transaction for atomicity
  const rejectedPayload = {
    serviceOrderId,
    quoteId,
    serviceOrderNumber: order.serviceOrderNumber,
    organizationId: order.organizationId,
    publicId: order.publicId,
    customerId: order.customerId,
    clientContactSnapshot: order.clientContactSnapshot,
    customerName: customerRowReject?.name ?? "",
    customerEmail: customerRowReject?.email ?? null,
    rejectionReason: values.rejectionReason ?? null,
  } satisfies QuoteRejectedOutboxPayload;
  await enqueueServiceOrderEmail(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      eventKey: `quote_rejected:${quoteId}`,
      targetStatus: "quote_rejected",
      payload: rejectedPayload,
    },
    ctx.o,
  );
}

/**
 * The quote and order a portal decision acts on, both locked (quote first, as
 * every quote decision does) so the checks hold until the writes commit. The
 * order must belong to the portal customer; anything else answers 404.
 */
async function lockPortalDecision(
  ctx: OrgContext,
  customer: PortalQuoteCustomer,
  serviceOrderId: number,
  quoteId: number,
) {
  const quote = await getQuoteForAction(
    serviceOrderId,
    quoteId,
    ctx.org,
    ctx.o,
    {
      lock: true,
    },
  );
  const [order] = await ctx.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
      ),
    )
    .limit(1)
    .for("update");
  if (!quote || !order || order.customerId !== customer.id) {
    throw serviceOrderQuoteNotFound();
  }
  return { quote, order };
}

export async function approveServiceOrderQuoteByPortalUser(
  ctx: OrgContext,
  linkedCustomer: PortalQuoteCustomer,
  serviceOrderId: number,
  quoteId: number,
) {
  const { quote, order } = await lockPortalDecision(
    ctx,
    linkedCustomer,
    serviceOrderId,
    quoteId,
  );
  if (!canApproveServiceOrderQuote(quote.status)) {
    throw quoteNotDecidable("Orcamento nao pode ser aprovado");
  }

  await ctx.o
    .update(serviceOrderQuote)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedByPortalUserId: ctx.actor.userId,
    })
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.organizationId, ctx.org),
      ),
    );
  // REQ-QPUB-003 [HIGH RISK]: a decided quote's public links stop working.
  await revokeActiveTokensForQuote(ctx.o, {
    organizationId: order.organizationId,
    quoteId,
    reason: "decided",
  });
  await ctx.o
    .update(serviceOrder)
    .set({
      ...orderStatusOnDecision(order.status, "approve_quote"),
      approvedAt: new Date(),
      totalApprovedCents: quote.totalCents,
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
      ),
    );
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "portal_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.quote_approved_by_client",
      metadata: { quoteId },
      ipAddress: ctx.actor.ipAddress,
      userAgent: ctx.actor.userAgent ?? null,
    },
    ctx.o,
  );
  // REQ-SOEMAIL-071/072: enqueue inside the transaction for atomicity
  // linkedCustomer is already tenant-scoped by the portal guard (REQ-075)
  const portalApprovedPayload = {
    serviceOrderId,
    quoteId,
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
      serviceOrderId,
      eventKey: `quote_approved:${quoteId}`,
      targetStatus: "quote_approved",
      payload: portalApprovedPayload,
    },
    ctx.o,
  );
}

export async function rejectServiceOrderQuoteByPortalUser(
  ctx: OrgContext,
  linkedCustomer: PortalQuoteCustomer,
  serviceOrderId: number,
  quoteId: number,
  values: RejectQuotePortalInput,
) {
  const { quote, order } = await lockPortalDecision(
    ctx,
    linkedCustomer,
    serviceOrderId,
    quoteId,
  );
  // Mirrors rejectServiceOrderQuoteManually: only a quote still awaiting a
  // decision may be rejected. Without this, a portal user could reject a quote
  // that was already approved, throwing an OS in repair_in_progress back to
  // quote_rejected.
  if (
    !canApproveServiceOrderQuote(quote.status) ||
    !SERVICE_ORDER_QUOTE_MACHINE.canTransition(quote.status, "reject")
  ) {
    throw quoteNotDecidable("Este orcamento ja foi respondido");
  }

  await ctx.o
    .update(serviceOrderQuote)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: values.rejectionReason ?? null,
    })
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.organizationId, ctx.org),
      ),
    );
  // REQ-QPUB-003 [HIGH RISK]: a decided quote's public links stop working.
  await revokeActiveTokensForQuote(ctx.o, {
    organizationId: order.organizationId,
    quoteId,
    reason: "decided",
  });
  await ctx.o
    .update(serviceOrder)
    .set({
      ...orderStatusOnDecision(order.status, "reject_quote"),
      rejectedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
      ),
    );
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "portal_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.quote_rejected_by_client",
      metadata: {
        quoteId,
        reason: values.rejectionReason,
      },
      ipAddress: ctx.actor.ipAddress,
      userAgent: ctx.actor.userAgent ?? null,
    },
    ctx.o,
  );
  // REQ-SOEMAIL-071/072: enqueue inside the transaction for atomicity
  // linkedCustomer is already tenant-scoped by the portal guard (REQ-075)
  const portalRejectedPayload = {
    serviceOrderId,
    quoteId,
    serviceOrderNumber: order.serviceOrderNumber,
    organizationId: order.organizationId,
    publicId: order.publicId,
    customerId: order.customerId,
    clientContactSnapshot: order.clientContactSnapshot,
    customerName: linkedCustomer.name,
    customerEmail: linkedCustomer.email,
    rejectionReason: values.rejectionReason ?? null,
  } satisfies QuoteRejectedOutboxPayload;
  await enqueueServiceOrderEmail(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      eventKey: `quote_rejected:${quoteId}`,
      targetStatus: "quote_rejected",
      payload: portalRejectedPayload,
    },
    ctx.o,
  );
}
