import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  customer,
  organization,
  organizationUnit,
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderCertificateLink,
  serviceOrderDeliveryDocument,
  serviceOrderEvaluation,
  serviceOrderEventLog,
  serviceOrderExecution,
  serviceOrderExecutionItem,
  serviceOrderIntakeDocument,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderTag,
  user,
} from "@calibra-facil/db/schema";
import { SERVICE_ORDER_STATUS_LABELS } from "@calibra-facil/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { buildUnitScopeCondition } from "../../lib/units";

export async function getServiceOrderDetail(
  id: number,
  organizationId: string,
  unitCondition?: ReturnType<typeof buildUnitScopeCondition>,
) {
  const [order] = await db
    .select({
      id: serviceOrder.id,
      // Opaque id the dashboard routes by, so URLs never carry the enumerable
      // serial. Same identifier the portal already uses.
      publicId: serviceOrder.publicId,
      organizationId: serviceOrder.organizationId,
      organizationName: organization.name,
      organizationCnpj: organization.cnpj,
      organizationPhone: organization.phone,
      organizationEmail: organization.email,
      organizationStreet: organization.street,
      organizationNumber: organization.number,
      organizationNeighbourhood: organization.neighbourhood,
      organizationCity: organization.city,
      organizationState: organization.state,
      organizationCep: organization.cep,
      unitId: serviceOrder.unitId,
      unitName: organizationUnit.name,
      serviceOrderNumber: serviceOrder.serviceOrderNumber,
      customerId: serviceOrder.customerId,
      customerName: customer.name,
      customerTaxId: customer.taxId,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      assetId: serviceOrder.assetId,
      assetName: asset.name,
      assetTag: asset.tag,
      assetSerialNumber: asset.serialNumber,
      assetMetrologyRegime: asset.metrologyRegime,
      status: serviceOrder.status,
      priority: serviceOrder.priority,
      intakeType: serviceOrder.intakeType,
      isExternalService: serviceOrder.isExternalService,
      sourceServiceOrderId: serviceOrder.sourceServiceOrderId,
      responsibleTechnicianId: serviceOrder.responsibleTechnicianId,
      responsibleTechnicianName: user.name,
      openedAt: serviceOrder.openedAt,
      serviceStartedAt: serviceOrder.serviceStartedAt,
      evaluatedAt: serviceOrder.evaluatedAt,
      quotedAt: serviceOrder.quotedAt,
      approvedAt: serviceOrder.approvedAt,
      rejectedAt: serviceOrder.rejectedAt,
      repairStartedAt: serviceOrder.repairStartedAt,
      repairFinishedAt: serviceOrder.repairFinishedAt,
      readyAt: serviceOrder.readyAt,
      deliveredAt: serviceOrder.deliveredAt,
      deliveredToName: serviceOrder.deliveredToName,
      deliveredToDocument: serviceOrder.deliveredToDocument,
      deliveryNotes: serviceOrder.deliveryNotes,
      closedAt: serviceOrder.closedAt,
      canceledAt: serviceOrder.canceledAt,
      cancelReason: serviceOrder.cancelReason,
      claimedDefect: serviceOrder.claimedDefect,
      intakeCondition: serviceOrder.intakeCondition,
      accessories: serviceOrder.accessories,
      removedSealingMarkNumber: serviceOrder.removedSealingMarkNumber,
      affixedSealingMarkNumber: serviceOrder.affixedSealingMarkNumber,
      inmetroRepairMarkNumber: serviceOrder.inmetroRepairMarkNumber,
      inmetroRepairMarkIssuedAt: serviceOrder.inmetroRepairMarkIssuedAt,
      inmetroRepairMarkAppliedAt: serviceOrder.inmetroRepairMarkAppliedAt,
      inmetroRepairMarkNotes: serviceOrder.inmetroRepairMarkNotes,
      invoiceRemittanceNumber: serviceOrder.invoiceRemittanceNumber,
      invoiceRemittanceKey: serviceOrder.invoiceRemittanceKey,
      invoiceRemittanceIssuedAt: serviceOrder.invoiceRemittanceIssuedAt,
      carrierName: serviceOrder.carrierName,
      carrierDocument: serviceOrder.carrierDocument,
      thirdPartyName: serviceOrder.thirdPartyName,
      thirdPartyDocument: serviceOrder.thirdPartyDocument,
      thirdPartyPhone: serviceOrder.thirdPartyPhone,
      deliveryMethod: serviceOrder.deliveryMethod,
      internalNotes: serviceOrder.internalNotes,
      clientVisibleNotes: serviceOrder.clientVisibleNotes,
      totalQuotedCents: serviceOrder.totalQuotedCents,
      totalApprovedCents: serviceOrder.totalApprovedCents,
      evaluationFeeCents: serviceOrder.evaluationFeeCents,
      evaluationFeeApplied: serviceOrder.evaluationFeeApplied,
      warrantyUntil: serviceOrder.warrantyUntil,
      warrantyTerms: serviceOrder.warrantyTerms,
      closingReason: serviceOrder.closingReason,
      billingDocumentId: serviceOrder.billingDocumentId,
      createdAt: serviceOrder.createdAt,
      updatedAt: serviceOrder.updatedAt,
    })
    .from(serviceOrder)
    .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
    .innerJoin(asset, eq(serviceOrder.assetId, asset.id))
    .innerJoin(organization, eq(serviceOrder.organizationId, organization.id))
    .innerJoin(organizationUnit, eq(serviceOrder.unitId, organizationUnit.id))
    .leftJoin(user, eq(serviceOrder.responsibleTechnicianId, user.id))
    .where(
      and(
        eq(serviceOrder.id, id),
        eq(serviceOrder.organizationId, organizationId),
        unitCondition,
      ),
    )
    .limit(1);

  if (!order) return null;

  const [
    snapshot,
    intakeDocuments,
    tags,
    deliveryDocuments,
    evaluations,
    quotes,
    executionRows,
    events,
    certificateLinks,
  ] = await Promise.all([
    db
      .select()
      .from(serviceOrderAssetSnapshot)
      .where(eq(serviceOrderAssetSnapshot.serviceOrderId, id))
      .limit(1),
    db
      .select()
      .from(serviceOrderIntakeDocument)
      .where(eq(serviceOrderIntakeDocument.serviceOrderId, id))
      .orderBy(desc(serviceOrderIntakeDocument.version)),
    db
      .select()
      .from(serviceOrderTag)
      .where(eq(serviceOrderTag.serviceOrderId, id))
      .orderBy(desc(serviceOrderTag.id)),
    db
      .select()
      .from(serviceOrderDeliveryDocument)
      .where(eq(serviceOrderDeliveryDocument.serviceOrderId, id))
      .orderBy(desc(serviceOrderDeliveryDocument.version)),
    db
      .select()
      .from(serviceOrderEvaluation)
      .where(eq(serviceOrderEvaluation.serviceOrderId, id))
      .orderBy(desc(serviceOrderEvaluation.evaluatedAt)),
    db
      .select()
      .from(serviceOrderQuote)
      .where(eq(serviceOrderQuote.serviceOrderId, id))
      .orderBy(desc(serviceOrderQuote.version)),
    db
      .select()
      .from(serviceOrderExecution)
      .where(eq(serviceOrderExecution.serviceOrderId, id))
      .limit(1),
    db
      .select({
        id: serviceOrderEventLog.id,
        organizationId: serviceOrderEventLog.organizationId,
        unitId: serviceOrderEventLog.unitId,
        serviceOrderId: serviceOrderEventLog.serviceOrderId,
        actorType: serviceOrderEventLog.actorType,
        actorId: serviceOrderEventLog.actorId,
        actorName: user.name,
        eventType: serviceOrderEventLog.eventType,
        oldValue: serviceOrderEventLog.oldValue,
        newValue: serviceOrderEventLog.newValue,
        metadata: serviceOrderEventLog.metadata,
        ipAddress: serviceOrderEventLog.ipAddress,
        userAgent: serviceOrderEventLog.userAgent,
        createdAt: serviceOrderEventLog.createdAt,
      })
      .from(serviceOrderEventLog)
      .leftJoin(user, eq(serviceOrderEventLog.actorId, user.id))
      .where(eq(serviceOrderEventLog.serviceOrderId, id))
      .orderBy(desc(serviceOrderEventLog.createdAt)),
    db
      .select({
        id: serviceOrderCertificateLink.id,
        certificateJobId: serviceOrderCertificateLink.certificateJobId,
        jobId: calibrationJob.jobId,
        certificateUrl: calibrationJob.certificateUrl,
        status: calibrationJob.status,
        linkedAt: serviceOrderCertificateLink.linkedAt,
      })
      .from(serviceOrderCertificateLink)
      .innerJoin(
        calibrationJob,
        eq(serviceOrderCertificateLink.certificateJobId, calibrationJob.id),
      )
      .where(eq(serviceOrderCertificateLink.serviceOrderId, id)),
  ]);

  const quoteItems = quotes.length
    ? await db
        .select()
        .from(serviceOrderQuoteItem)
        .where(
          inArray(
            serviceOrderQuoteItem.quoteId,
            quotes.map((quote) => quote.id),
          ),
        )
        .orderBy(serviceOrderQuoteItem.sortOrder, serviceOrderQuoteItem.id)
    : [];
  const execution = executionRows[0] ?? null;
  const executionItems = execution
    ? await db
        .select()
        .from(serviceOrderExecutionItem)
        .where(eq(serviceOrderExecutionItem.executionId, execution.id))
        .orderBy(
          serviceOrderExecutionItem.sortOrder,
          serviceOrderExecutionItem.id,
        )
    : [];

  return {
    ...order,
    statusLabel: SERVICE_ORDER_STATUS_LABELS[order.status],
    assetSnapshot: snapshot[0] ?? null,
    intakeDocuments,
    tags,
    deliveryDocuments,
    evaluations,
    quotes: quotes.map((quote) => ({
      ...quote,
      items: quoteItems.filter((item) => item.quoteId === quote.id),
    })),
    execution: execution ? { ...execution, items: executionItems } : null,
    events,
    certificateLinks,
  };
}

export type ServiceOrderDetailReadModel = NonNullable<
  Awaited<ReturnType<typeof getServiceOrderDetail>>
>;

export function toClientVisibleServiceOrderDetail(
  detail: ServiceOrderDetailReadModel,
) {
  const {
    internalNotes: _internalNotes,
    cancelReason: _cancelReason,
    carrierDocument: _carrierDocument,
    thirdPartyDocument: _thirdPartyDocument,
    events,
    ...safeDetail
  } = detail;

  return {
    ...safeDetail,
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      createdAt: event.createdAt,
    })),
    evaluations: detail.evaluations.map((evaluation) => ({
      id: evaluation.id,
      diagnosis: evaluation.diagnosis,
      detectedIssues: evaluation.detectedIssues,
      clientVisibleNotes: evaluation.clientVisibleNotes,
      evaluatedAt: evaluation.evaluatedAt,
    })),
    quotes: detail.quotes
      .filter((quote) =>
        ["sent", "approved", "rejected", "expired"].includes(quote.status),
      )
      .map((quote) => ({
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        version: quote.version,
        status: quote.status,
        totalCents: quote.totalCents,
        validUntil: quote.validUntil,
        clientMessage: quote.clientMessage,
        warrantyTerms: quote.warrantyTerms,
        items: quote.items.map((item) => ({
          id: item.id,
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalPriceCents,
          warrantyCovered: item.warrantyCovered,
        })),
      })),
  };
}
