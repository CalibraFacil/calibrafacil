import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
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
  serviceOrderEvaluation,
  serviceOrderEventLog,
  serviceOrderExecution,
  serviceOrderExecutionItem,
  serviceOrderIntakeDocument,
  serviceOrderPublicAccessToken,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderSettings,
  serviceOrderTag,
  user,
} from "@calibra-facil/db/schema";
import {
  ApproveServiceOrderQuoteManuallySchema,
  ApproveServiceOrderQuotePortalSchema,
  AssignServiceOrderTechnicianSchema,
  CancelServiceOrderSchema,
  CloseServiceOrderSchema,
  CreateServiceOrderEvaluationSchema,
  CreateServiceOrderQuoteSchema,
  CreateServiceOrderSchema,
  DeliverServiceOrderSchema,
  FinishServiceOrderExecutionSchema,
  ListServiceOrdersQuerySchema,
  RejectServiceOrderQuoteManuallySchema,
  RejectServiceOrderQuotePortalSchema,
  ReopenServiceOrderSchema,
  SendServiceOrderQuoteSchema,
  StartServiceOrderExecutionSchema,
  UpdateServiceOrderEvaluationSchema,
  UpdateServiceOrderExecutionSchema,
  UpdateServiceOrderQuoteDraftSchema,
  UpdateServiceOrderSchema,
  UpdateServiceOrderSettingsSchema,
} from "@calibra-facil/schemas";
import {
  canApproveServiceOrderQuote,
  canEditServiceOrderQuote,
  canTransitionServiceOrderStatus,
  SERVICE_ORDER_STATUS_LABELS,
} from "@calibra-facil/shared";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
} from "drizzle-orm";
import {
  requirePermission,
  requirePortalProtected,
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { buildUnitScopeCondition } from "../lib/units";
import {
  createBillingDocumentFromServiceOrder,
  createInitialServiceOrderRecords,
  createPublicServiceOrderAccessToken,
  getOrCreateServiceOrderSettings,
  hashServiceOrderToken,
  recordServiceOrderEvent,
  replaceExecutionItems,
  replaceQuoteItems,
} from "../lib/service-order-workflow";
import {
  createR2Client,
  generatePresignedUrl,
  type R2Env,
} from "../lib/storage";

type CloudflareQueue = { send: (body: unknown) => Promise<void> };
type ServiceOrderEnv = R2Env & {
  PDF_QUEUE?: CloudflareQueue;
  PORTAL_APP_URL?: string;
};

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });
const QuoteParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  quoteId: z.coerce.number().int().positive(),
});
const TokenParamSchema = z.object({ token: z.string().trim().min(16) });

function requestIp(c: { req: { header: (name: string) => string | undefined } }) {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? null;
}

function requestUserAgent(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return c.req.header("user-agent") ?? null;
}

function parseDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function buildPortalBaseUrl(env: ServiceOrderEnv) {
  return env.PORTAL_APP_URL ?? "https://portal.calibrafacil.com";
}

async function enqueuePdf(
  env: ServiceOrderEnv,
  message: Record<string, unknown>,
) {
  if (!env.PDF_QUEUE) return false;
  await env.PDF_QUEUE.send(message);
  return true;
}

async function getServiceOrderDetail(
  id: number,
  organizationId: string,
  unitCondition?: ReturnType<typeof buildUnitScopeCondition>,
) {
  const [order] = await db
    .select({
      id: serviceOrder.id,
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
      status: serviceOrder.status,
      priority: serviceOrder.priority,
      intakeType: serviceOrder.intakeType,
      sourceServiceOrderId: serviceOrder.sourceServiceOrderId,
      responsibleTechnicianId: serviceOrder.responsibleTechnicianId,
      responsibleTechnicianName: user.name,
      openedAt: serviceOrder.openedAt,
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
      oldSealNumber: serviceOrder.oldSealNumber,
      newSealNumber: serviceOrder.newSealNumber,
      repairedSealNumber: serviceOrder.repairedSealNumber,
      inmetroRepairSealNumber: serviceOrder.inmetroRepairSealNumber,
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
        .orderBy(serviceOrderExecutionItem.sortOrder, serviceOrderExecutionItem.id)
    : [];

  return {
    ...order,
    statusLabel: SERVICE_ORDER_STATUS_LABELS[order.status],
    assetSnapshot: snapshot[0] ?? null,
    intakeDocuments,
    tags,
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

async function getPortalCustomer(
  authOrganizationId: string,
  labOrganizationId?: string | null,
) {
  const [linkedCustomer] = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.authOrganizationId, authOrganizationId),
        labOrganizationId
          ? eq(customer.labOrganizationId, labOrganizationId)
          : undefined,
      ),
    )
    .limit(1);

  return linkedCustomer ?? null;
}

function toClientVisibleServiceOrderDetail(
  detail: NonNullable<Awaited<ReturnType<typeof getServiceOrderDetail>>>,
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
      .filter((quote) => ["sent", "approved", "rejected", "expired"].includes(quote.status))
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

async function getQuoteForAction(serviceOrderId: number, quoteId: number) {
  const [quote] = await db
    .select()
    .from(serviceOrderQuote)
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.serviceOrderId, serviceOrderId),
      ),
    )
    .limit(1);
  return quote ?? null;
}

export const serviceOrdersRouter = new Hono<{
  Bindings: ServiceOrderEnv;
  Variables: AuthVariables;
}>()
  .get(
    "/",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("query", ListServiceOrdersQuerySchema),
    async (c) => {
      const member = c.get("member");
      const query = c.req.valid("query");
      const page = query.page;
      const limit = query.limit;
      const offset = (page - 1) * limit;
      const conditions = [
        eq(serviceOrder.organizationId, member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, member),
      ];

      if (query.status) conditions.push(eq(serviceOrder.status, query.status));
      if (query.customerId)
        conditions.push(eq(serviceOrder.customerId, query.customerId));
      if (query.assetId) conditions.push(eq(serviceOrder.assetId, query.assetId));
      if (query.technicianId)
        conditions.push(
          eq(serviceOrder.responsibleTechnicianId, query.technicianId),
        );
      if (query.unitId) conditions.push(eq(serviceOrder.unitId, query.unitId));
      if (query.awaitingApproval)
        conditions.push(eq(serviceOrder.status, "awaiting_quote_approval"));
      if (query.readyForPickup)
        conditions.push(eq(serviceOrder.status, "ready_for_pickup"));
      if (query.warranty) conditions.push(eq(serviceOrder.priority, "warranty"));
      if (query.dateFrom)
        conditions.push(gte(serviceOrder.openedAt, new Date(query.dateFrom)));
      if (query.dateTo)
        conditions.push(lte(serviceOrder.openedAt, new Date(query.dateTo)));
      if (query.query) {
        const searchCondition = or(
          ilike(serviceOrder.serviceOrderNumber, `%${query.query}%`),
          ilike(customer.name, `%${query.query}%`),
          ilike(asset.name, `%${query.query}%`),
          ilike(asset.serialNumber, `%${query.query}%`),
        );
        if (searchCondition) conditions.push(searchCondition);
      }

      const whereCondition = and(...conditions);
      const [total] = await db
        .select({ total: count() })
        .from(serviceOrder)
        .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
        .innerJoin(asset, eq(serviceOrder.assetId, asset.id))
        .where(whereCondition);

      const rows = await db
        .select({
          id: serviceOrder.id,
          serviceOrderNumber: serviceOrder.serviceOrderNumber,
          customerName: customer.name,
          assetName: asset.name,
          assetSerialNumber: asset.serialNumber,
          status: serviceOrder.status,
          priority: serviceOrder.priority,
          responsibleTechnicianName: user.name,
          openedAt: serviceOrder.openedAt,
          quotedAt: serviceOrder.quotedAt,
          approvedAt: serviceOrder.approvedAt,
          totalApprovedCents: serviceOrder.totalApprovedCents,
          totalQuotedCents: serviceOrder.totalQuotedCents,
          unitName: organizationUnit.name,
        })
        .from(serviceOrder)
        .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
        .innerJoin(asset, eq(serviceOrder.assetId, asset.id))
        .innerJoin(organizationUnit, eq(serviceOrder.unitId, organizationUnit.id))
        .leftJoin(user, eq(serviceOrder.responsibleTechnicianId, user.id))
        .where(whereCondition)
        .orderBy(desc(serviceOrder.openedAt))
        .limit(limit)
        .offset(offset);

      return c.json({
        data: rows.map((row) => ({
          ...row,
          statusLabel: SERVICE_ORDER_STATUS_LABELS[row.status],
        })),
        pagination: {
          page,
          limit,
          total: total?.total ?? 0,
          totalPages: Math.ceil((total?.total ?? 0) / limit),
        },
      });
    },
  )
  .post(
    "/",
    ...withLabPermission({ service_order: ["create"] }),
    zValidator("json", CreateServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const unitId = member.activeUnitId ?? member.accessibleUnitIds[0];

      if (!unitId) return c.json({ error: "Nenhuma unidade ativa" }, 400);

      const [assetRow] = await db
        .select({
          id: asset.id,
          unitId: asset.unitId,
          customerId: asset.customerId,
          labOrganizationId: customer.labOrganizationId,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .where(eq(asset.id, input.assetId))
        .limit(1);

      if (
        !assetRow ||
        assetRow.customerId !== input.customerId ||
        assetRow.labOrganizationId !== member.organizationId
      ) {
        return c.json({ error: "Ativo ou cliente invalido para esta OS" }, 400);
      }

      const created = await createInitialServiceOrderRecords({
        organizationId: member.organizationId,
        unitId,
        customerId: input.customerId,
        assetId: input.assetId,
        userId: session.user.id,
        assetSnapshot: input.assetSnapshot,
        signatureData: input.signatureData ?? null,
        ipAddress: requestIp(c),
        userAgent: requestUserAgent(c),
        values: {
          clientContactId: input.clientContactId ?? null,
          clientContactSnapshot: input.clientContactSnapshot ?? null,
          intakeType: input.intakeType,
          sourceServiceOrderId: input.sourceServiceOrderId ?? null,
          priority: input.priority,
          responsibleTechnicianId: input.responsibleTechnicianId ?? null,
          claimedDefect: input.claimedDefect,
          intakeCondition: input.intakeCondition,
          accessories: input.accessories ?? null,
          oldSealNumber: input.oldSealNumber ?? null,
          newSealNumber: input.newSealNumber ?? null,
          repairedSealNumber: input.repairedSealNumber ?? null,
          inmetroRepairSealNumber: input.inmetroRepairSealNumber ?? null,
          invoiceRemittanceNumber: input.invoiceRemittanceNumber ?? null,
          invoiceRemittanceKey: input.invoiceRemittanceKey ?? null,
          invoiceRemittanceIssuedAt: parseDate(input.invoiceRemittanceIssuedAt),
          carrierName: input.carrierName ?? null,
          carrierDocument: input.carrierDocument ?? null,
          thirdPartyName: input.thirdPartyName ?? null,
          thirdPartyDocument: input.thirdPartyDocument ?? null,
          thirdPartyPhone: input.thirdPartyPhone ?? null,
          deliveryMethod: input.deliveryMethod,
          internalNotes: input.internalNotes ?? null,
          clientVisibleNotes: input.clientVisibleNotes ?? null,
          evaluationFeeCents: input.evaluationFeeCents,
          warrantyUntil: parseDate(input.warrantyUntil),
          warrantyTerms: input.warrantyTerms ?? null,
        },
      });

      await Promise.all([
        enqueuePdf(c.env, {
          type: "SERVICE_ORDER_INTAKE_DOCUMENT",
          serviceOrderId: created.id,
          userId: session.user.id,
        }),
        enqueuePdf(c.env, {
          type: "SERVICE_ORDER_TAG",
          serviceOrderId: created.id,
          userId: session.user.id,
        }),
      ]);

      return c.json({ data: created }, 201);
    },
  )
  .get(
    "/settings",
    ...withLabPermission({ service_order: ["manage_settings"] }),
    async (c) => {
      const member = c.get("member");
      const settings = await getOrCreateServiceOrderSettings(
        member.organizationId,
      );
      return c.json({ data: settings });
    },
  )
  .patch(
    "/settings",
    ...withLabPermission({ service_order: ["manage_settings"] }),
    zValidator("json", UpdateServiceOrderSettingsSchema.partial()),
    async (c) => {
      const member = c.get("member");
      const input = c.req.valid("json");
      await getOrCreateServiceOrderSettings(member.organizationId);
      const [updated] = await db
        .update(serviceOrderSettings)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(serviceOrderSettings.organizationId, member.organizationId))
        .returning();
      return c.json({ data: updated });
    },
  )
  .get(
    "/reports/summary",
    ...withLabPermission({ service_order: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const rows = await db
        .select({
          id: serviceOrder.id,
          status: serviceOrder.status,
          unitId: serviceOrder.unitId,
          unitName: organizationUnit.name,
          customerId: serviceOrder.customerId,
          customerName: customer.name,
          technicianId: serviceOrder.responsibleTechnicianId,
          technicianName: user.name,
          openedAt: serviceOrder.openedAt,
          evaluatedAt: serviceOrder.evaluatedAt,
          quotedAt: serviceOrder.quotedAt,
          approvedAt: serviceOrder.approvedAt,
          rejectedAt: serviceOrder.rejectedAt,
          closedAt: serviceOrder.closedAt,
          totalApprovedCents: serviceOrder.totalApprovedCents,
          priority: serviceOrder.priority,
        })
        .from(serviceOrder)
        .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
        .innerJoin(organizationUnit, eq(serviceOrder.unitId, organizationUnit.id))
        .leftJoin(user, eq(serviceOrder.responsibleTechnicianId, user.id))
        .where(
          and(
            eq(serviceOrder.organizationId, member.organizationId),
            buildUnitScopeCondition(serviceOrder.unitId, member),
          ),
        );

      const byStatus = new Map<string, number>();
      const byUnit = new Map<string, { unitId: number; unitName: string; total: number }>();
      const byTechnician = new Map<
        string,
        { technicianId: string | null; technicianName: string; total: number }
      >();
      const byCustomer = new Map<
        number,
        { customerId: number; customerName: string; total: number }
      >();
      let approvedQuoteCount = 0;
      let rejectedQuoteCount = 0;
      let warrantyCount = 0;
      let revenueApprovedCents = 0;
      let closedCycleMs = 0;
      let closedCycleCount = 0;

      for (const row of rows) {
        byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
        const unitKey = String(row.unitId);
        const unit = byUnit.get(unitKey) ?? {
          unitId: row.unitId,
          unitName: row.unitName,
          total: 0,
        };
        unit.total += 1;
        byUnit.set(unitKey, unit);

        const techKey = row.technicianId ?? "unassigned";
        const technician = byTechnician.get(techKey) ?? {
          technicianId: row.technicianId,
          technicianName: row.technicianName ?? "Sem técnico",
          total: 0,
        };
        technician.total += 1;
        byTechnician.set(techKey, technician);

        const customerSummary = byCustomer.get(row.customerId) ?? {
          customerId: row.customerId,
          customerName: row.customerName,
          total: 0,
        };
        customerSummary.total += 1;
        byCustomer.set(row.customerId, customerSummary);

        if (row.approvedAt) approvedQuoteCount += 1;
        if (row.rejectedAt) rejectedQuoteCount += 1;
        if (row.priority === "warranty") warrantyCount += 1;
        revenueApprovedCents += row.totalApprovedCents ?? 0;

        if (row.closedAt) {
          closedCycleMs += row.closedAt.getTime() - row.openedAt.getTime();
          closedCycleCount += 1;
        }
      }

      return c.json({
        data: {
          total: rows.length,
          byStatus: Array.from(byStatus, ([status, total]) => ({
            status,
            statusLabel:
              SERVICE_ORDER_STATUS_LABELS[
                status as keyof typeof SERVICE_ORDER_STATUS_LABELS
              ] ?? status,
            total,
          })),
          byUnit: Array.from(byUnit.values()),
          byTechnician: Array.from(byTechnician.values()),
          topCustomers: Array.from(byCustomer.values())
            .sort((a, b) => b.total - a.total)
            .slice(0, 10),
          approval: {
            approvedQuoteCount,
            rejectedQuoteCount,
            approvalRate:
              approvedQuoteCount + rejectedQuoteCount > 0
                ? approvedQuoteCount / (approvedQuoteCount + rejectedQuoteCount)
                : null,
          },
          warranty: {
            warrantyCount,
            warrantyRate: rows.length > 0 ? warrantyCount / rows.length : null,
          },
          revenueApprovedCents,
          averageClosedCycleHours:
            closedCycleCount > 0
              ? closedCycleMs / closedCycleCount / 1000 / 60 / 60
              : null,
        },
      });
    },
  )
  .get(
    "/:id",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const detail = await getServiceOrderDetail(
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      );
      if (!detail) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: detail });
    },
  )
  .patch(
    "/:id",
    ...withLabPermission({ service_order: ["update"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", UpdateServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [existing] = await db
        .select()
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.id, id),
            eq(serviceOrder.organizationId, member.organizationId),
            buildUnitScopeCondition(serviceOrder.unitId, member),
          ),
        )
        .limit(1);
      if (!existing) return c.json({ error: "OS nao encontrada" }, 404);

      if (
        input.status &&
        input.status !== existing.status &&
        !canTransitionServiceOrderStatus(existing.status, input.status)
      ) {
        return c.json({ error: "Transicao de status invalida" }, 400);
      }

      const [updated] = await db
        .update(serviceOrder)
        .set({
          ...input,
          invoiceRemittanceIssuedAt: parseDate(input.invoiceRemittanceIssuedAt),
          warrantyUntil: parseDate(input.warrantyUntil),
          updatedAt: new Date(),
        })
        .where(eq(serviceOrder.id, id))
        .returning();

      if (input.status && input.status !== existing.status) {
        await recordServiceOrderEvent({
          organizationId: existing.organizationId,
          unitId: existing.unitId,
          serviceOrderId: existing.id,
          actorType: "lab_user",
          actorId: session.user.id,
          eventType: "service_order.status_changed",
          oldValue: { status: existing.status },
          newValue: { status: input.status },
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        });
      }

      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/intake-document",
    ...withLabPermission({ service_order: ["print_intake_document"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const detail = await getServiceOrderDetail(
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      );
      if (!detail) return c.json({ error: "OS nao encontrada" }, 404);

      const [document] = await db
        .insert(serviceOrderIntakeDocument)
        .values({
          serviceOrderId: id,
          documentNumber: `${detail.serviceOrderNumber}/REC`,
          version: detail.intakeDocuments.length + 1,
          issuedAt: new Date(),
          issuedByUserId: session.user.id,
          qrCodePayload: `${buildPortalBaseUrl(c.env)}/service-order-access`,
        })
        .returning();
      await recordServiceOrderEvent({
        organizationId: detail.organizationId,
        unitId: detail.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.intake_document_issued",
        metadata: { documentId: document?.id },
      });
      await enqueuePdf(c.env, {
        type: "SERVICE_ORDER_INTAKE_DOCUMENT",
        serviceOrderId: id,
        documentId: document?.id,
        userId: session.user.id,
      });
      return c.json({ data: document });
    },
  )
  .post(
    "/:id/tag",
    ...withLabPermission({ service_order: ["print_tag"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const detail = await getServiceOrderDetail(
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      );
      if (!detail) return c.json({ error: "OS nao encontrada" }, 404);
      const [tag] = await db
        .insert(serviceOrderTag)
        .values({
          serviceOrderId: id,
          tagNumber: `${detail.serviceOrderNumber}-TAG-${detail.tags.length + 1}`,
          printedAt: new Date(),
          printedByUserId: session.user.id,
        })
        .returning();
      await recordServiceOrderEvent({
        organizationId: detail.organizationId,
        unitId: detail.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.tag_printed",
        metadata: { tagId: tag?.id },
      });
      await enqueuePdf(c.env, {
        type: "SERVICE_ORDER_TAG",
        serviceOrderId: id,
        tagId: tag?.id,
        userId: session.user.id,
      });
      return c.json({ data: tag });
    },
  )
  .get(
    "/:id/intake-document.pdf",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const [document] = await db
        .select()
        .from(serviceOrderIntakeDocument)
        .where(eq(serviceOrderIntakeDocument.serviceOrderId, id))
        .orderBy(desc(serviceOrderIntakeDocument.version))
        .limit(1);
      if (!document?.pdfR2Key) return c.json({ error: "PDF indisponivel" }, 404);
      const client = createR2Client(c.env);
      return c.json({
        url: await generatePresignedUrl(
          client,
          c.env.R2_BUCKET_NAME,
          document.pdfR2Key,
        ),
      });
    },
  )
  .get(
    "/:id/tag.pdf",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const [tag] = await db
        .select()
        .from(serviceOrderTag)
        .where(eq(serviceOrderTag.serviceOrderId, id))
        .orderBy(desc(serviceOrderTag.id))
        .limit(1);
      if (!tag?.pdfR2Key) return c.json({ error: "PDF indisponivel" }, 404);
      const client = createR2Client(c.env);
      return c.json({
        url: await generatePresignedUrl(client, c.env.R2_BUCKET_NAME, tag.pdfR2Key),
      });
    },
  )
  .post(
    "/:id/assign-technician",
    ...withLabPermission({ service_order: ["assign_technician"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", AssignServiceOrderTechnicianSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const { technicianId } = c.req.valid("json");
      const [updated] = await db
        .update(serviceOrder)
        .set({ responsibleTechnicianId: technicianId, updatedAt: new Date() })
        .where(
          and(
            eq(serviceOrder.id, id),
            eq(serviceOrder.organizationId, member.organizationId),
            buildUnitScopeCondition(serviceOrder.unitId, member),
          ),
        )
        .returning();
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      await recordServiceOrderEvent({
        organizationId: updated.organizationId,
        unitId: updated.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.technician_assigned",
        newValue: { technicianId },
      });
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/evaluations",
    ...withLabPermission({ service_order: ["evaluate"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CreateServiceOrderEvaluationSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [order] = await db
        .select()
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.id, id),
            eq(serviceOrder.organizationId, member.organizationId),
            buildUnitScopeCondition(serviceOrder.unitId, member),
          ),
        )
        .limit(1);
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);
      const [existingEvaluation] = await db
        .select({ id: serviceOrderEvaluation.id })
        .from(serviceOrderEvaluation)
        .where(eq(serviceOrderEvaluation.serviceOrderId, id))
        .limit(1);
      if (existingEvaluation) {
        return c.json(
          { error: "Avaliacao ja registrada. Edite a avaliacao existente." },
          409,
        );
      }
      const technicianId = input.technicianId ?? session.user.id;
      const nextStatus = input.requiresQuote
        ? "awaiting_quote_approval"
        : input.calibrationRecommended
          ? "awaiting_calibration"
          : "ready_for_pickup";
      const [evaluation] = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(serviceOrderEvaluation)
          .values({
            serviceOrderId: id,
            technicianId,
            diagnosis: input.diagnosis,
            detectedIssues: input.detectedIssues ?? null,
            recommendedAction: input.recommendedAction,
            requiresQuote: input.requiresQuote,
            requiresClientApproval: input.requiresClientApproval,
            calibrationRecommended: input.calibrationRecommended,
            photos: input.photos,
            internalNotes: input.internalNotes ?? null,
            clientVisibleNotes: input.clientVisibleNotes ?? null,
          })
          .returning();
        await tx
          .update(serviceOrder)
          .set({ status: nextStatus, evaluatedAt: new Date(), updatedAt: new Date() })
          .where(eq(serviceOrder.id, id));
        await recordServiceOrderEvent(
          {
            organizationId: order.organizationId,
            unitId: order.unitId,
            serviceOrderId: id,
            actorType: "lab_user",
            actorId: session.user.id,
            eventType: "service_order.evaluation_completed",
            metadata: { evaluationId: created?.id },
            oldValue: { status: order.status },
            newValue: { status: nextStatus },
          },
          tx,
        );
        return [created];
      });
      return c.json({ data: evaluation });
    },
  )
  .patch(
    "/:id/evaluations/:evaluationId",
    ...withLabPermission({ service_order: ["evaluate"] }),
    zValidator(
      "param",
      z.object({
        id: z.coerce.number().int().positive(),
        evaluationId: z.coerce.number().int().positive(),
      }),
    ),
    zValidator("json", UpdateServiceOrderEvaluationSchema),
    async (c) => {
      const { evaluationId } = c.req.valid("param");
      const input = c.req.valid("json");
      const [updated] = await db
        .update(serviceOrderEvaluation)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(serviceOrderEvaluation.id, evaluationId))
        .returning();
      if (!updated) return c.json({ error: "Avaliacao nao encontrada" }, 404);
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/quotes",
    ...withLabPermission({ service_order: ["quote_create"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CreateServiceOrderQuoteSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [order] = await db
        .select()
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.id, id),
            eq(serviceOrder.organizationId, member.organizationId),
            buildUnitScopeCondition(serviceOrder.unitId, member),
          ),
        )
        .limit(1);
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);

      const [latest] = await db
        .select({ version: serviceOrderQuote.version })
        .from(serviceOrderQuote)
        .where(eq(serviceOrderQuote.serviceOrderId, id))
        .orderBy(desc(serviceOrderQuote.version))
        .limit(1);
      const version = (latest?.version ?? 0) + 1;
      const calculated = await db.transaction(async (tx) => {
        const [quote] = await tx
          .insert(serviceOrderQuote)
          .values({
            serviceOrderId: id,
            quoteNumber: `${order.serviceOrderNumber}/ORC`,
            version,
            validUntil: parseDate(input.validUntil),
            paymentTerms: input.paymentTerms ?? null,
            deliveryEstimate: input.deliveryEstimate ?? null,
            warrantyTerms: input.warrantyTerms ?? null,
            clientMessage: input.clientMessage ?? null,
            internalNotes: input.internalNotes ?? null,
            createdByUserId: session.user.id,
          })
          .returning();
        if (!quote) throw new Error("Falha ao criar orcamento");
        const totals = await replaceQuoteItems(
          {
            quoteId: quote.id,
            items: input.items.map((item) => ({
              ...item,
              warrantyUntil: parseDate(item.warrantyUntil),
            })),
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
            actorId: session.user.id,
            eventType: "service_order.quote_created",
            metadata: { quoteId: quote.id, version },
          },
          tx,
        );
        return { quote: { ...quote, ...totals }, totals };
      });
      return c.json({ data: calculated.quote }, 201);
    },
  )
  .patch(
    "/:id/quotes/:quoteId",
    ...withLabPermission({ service_order: ["quote_create"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", UpdateServiceOrderQuoteDraftSchema),
    async (c) => {
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const quote = await getQuoteForAction(id, quoteId);
      if (!quote) return c.json({ error: "Orcamento nao encontrado" }, 404);
      if (!canEditServiceOrderQuote(quote.status)) {
        return c.json({ error: "Orcamento enviado/aprovado e imutavel" }, 409);
      }
      const totals = input.items
        ? await replaceQuoteItems({
            quoteId,
            items: input.items.map((item) => ({
              ...item,
              warrantyUntil: parseDate(item.warrantyUntil),
            })),
          })
        : null;
      const [updated] = await db
        .update(serviceOrderQuote)
        .set({
          validUntil: parseDate(input.validUntil),
          paymentTerms: input.paymentTerms,
          deliveryEstimate: input.deliveryEstimate,
          warrantyTerms: input.warrantyTerms,
          clientMessage: input.clientMessage,
          internalNotes: input.internalNotes,
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
        .where(eq(serviceOrderQuote.id, quoteId))
        .returning();
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/quotes/:quoteId/send",
    ...withLabPermission({ service_order: ["quote_send"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", SendServiceOrderQuoteSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id, quoteId } = c.req.valid("param");
      const quote = await getQuoteForAction(id, quoteId);
      if (!quote) return c.json({ error: "Orcamento nao encontrado" }, 404);
      if (!canEditServiceOrderQuote(quote.status)) {
        return c.json({ error: "Apenas rascunhos podem ser enviados" }, 409);
      }
      const detail = await getServiceOrderDetail(
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      );
      if (!detail) return c.json({ error: "OS nao encontrada" }, 404);
      const token = await createPublicServiceOrderAccessToken({
        organizationId: member.organizationId,
        serviceOrderId: id,
        quoteId,
        expiresAt: parseDate(c.req.valid("json").expiresAt),
      });
      const [updated] = await db
        .update(serviceOrderQuote)
        .set({
          status: "sent",
          sentAt: new Date(),
          sentByUserId: session.user.id,
          portalAccessTokenHash: token.tokenHash,
          clientMessage: c.req.valid("json").clientMessage ?? quote.clientMessage,
          updatedAt: new Date(),
        })
        .where(eq(serviceOrderQuote.id, quoteId))
        .returning();
      await db
        .update(serviceOrder)
        .set({
          status: "awaiting_quote_approval",
          quotedAt: new Date(),
          totalQuotedCents: quote.totalCents,
          updatedAt: new Date(),
        })
        .where(eq(serviceOrder.id, id));
      await recordServiceOrderEvent({
        organizationId: detail.organizationId,
        unitId: detail.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.quote_sent",
        metadata: { quoteId, publicAccessTokenIssued: true },
      });
      await enqueuePdf(c.env, {
        type: "SERVICE_ORDER_QUOTE",
        serviceOrderId: id,
        quoteId,
        userId: session.user.id,
      });
      return c.json({
        data: updated,
        publicUrl: `${buildPortalBaseUrl(c.env)}/service-order-access/${token.token}`,
      });
    },
  )
  .post(
    "/:id/quotes/:quoteId/approve-manually",
    ...withLabPermission({ service_order: ["quote_approve_manually"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", ApproveServiceOrderQuoteManuallySchema),
    async (c) => {
      const session = c.get("session");
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const quote = await getQuoteForAction(id, quoteId);
      if (!quote || !canApproveServiceOrderQuote(quote.status)) {
        return c.json({ error: "Orcamento nao pode ser aprovado" }, 409);
      }
      const [order] = await db
        .select()
        .from(serviceOrder)
        .where(eq(serviceOrder.id, id))
        .limit(1);
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);
      await db.transaction(async (tx) => {
        await tx
          .update(serviceOrderQuote)
          .set({
            status: "approved",
            approvedAt: parseDate(input.approvedAt) ?? new Date(),
            approvedManuallyByUserId: session.user.id,
            manualApprovalByName: input.approvedByName,
            manualApprovalEvidenceType: input.manualApprovalEvidenceType,
            manualApprovalEvidenceText: input.manualApprovalEvidenceText,
          })
          .where(eq(serviceOrderQuote.id, quoteId));
        await tx
          .update(serviceOrder)
          .set({
            status: "quote_approved",
            approvedAt: new Date(),
            totalApprovedCents: quote.totalCents,
          })
          .where(eq(serviceOrder.id, id));
        await recordServiceOrderEvent(
          {
            organizationId: order.organizationId,
            unitId: order.unitId,
            serviceOrderId: id,
            actorType: "lab_user",
            actorId: session.user.id,
            eventType: "service_order.quote_approved_manually",
            metadata: {
              quoteId,
              approvedByName: input.approvedByName,
              evidenceType: input.manualApprovalEvidenceType,
            },
          },
          tx,
        );
      });
      return c.json({ ok: true });
    },
  )
  .post(
    "/:id/quotes/:quoteId/reject-manually",
    ...withLabPermission({ service_order: ["quote_reject_manually"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", RejectServiceOrderQuoteManuallySchema),
    async (c) => {
      const session = c.get("session");
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const quote = await getQuoteForAction(id, quoteId);
      if (!quote || !canApproveServiceOrderQuote(quote.status)) {
        return c.json({ error: "Orcamento nao pode ser recusado" }, 409);
      }
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, id)).limit(1);
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);
      await db.transaction(async (tx) => {
        await tx
          .update(serviceOrderQuote)
          .set({
            status: "rejected",
            rejectedAt: new Date(),
            rejectionReason: input.rejectionReason,
          })
          .where(eq(serviceOrderQuote.id, quoteId));
        await tx
          .update(serviceOrder)
          .set({ status: "quote_rejected", rejectedAt: new Date() })
          .where(eq(serviceOrder.id, id));
        await recordServiceOrderEvent(
          {
            organizationId: order.organizationId,
            unitId: order.unitId,
            serviceOrderId: id,
            actorType: "lab_user",
            actorId: session.user.id,
            eventType: "service_order.quote_rejected_manually",
            metadata: { quoteId, reason: input.rejectionReason },
          },
          tx,
        );
      });
      return c.json({ ok: true });
    },
  )
  .get(
    "/:id/quotes/:quoteId.pdf",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", QuoteParamSchema),
    async (c) => {
      const { quoteId } = c.req.valid("param");
      const [quote] = await db
        .select()
        .from(serviceOrderQuote)
        .where(eq(serviceOrderQuote.id, quoteId))
        .limit(1);
      if (!quote?.pdfR2Key) return c.json({ error: "PDF indisponivel" }, 404);
      const client = createR2Client(c.env);
      return c.json({
        url: await generatePresignedUrl(
          client,
          c.env.R2_BUCKET_NAME,
          quote.pdfR2Key,
        ),
      });
    },
  )
  .post(
    "/:id/execution/start",
    ...withLabPermission({ service_order: ["execute"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", StartServiceOrderExecutionSchema),
    async (c) => {
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, id)).limit(1);
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);
      const [execution] = await db
        .insert(serviceOrderExecution)
        .values({
          serviceOrderId: id,
          startedByUserId: session.user.id,
          technicalNotes: c.req.valid("json").notes ?? null,
        })
        .onConflictDoNothing({ target: serviceOrderExecution.serviceOrderId })
        .returning();
      await db
        .update(serviceOrder)
        .set({ status: "repair_in_progress", repairStartedAt: new Date() })
        .where(eq(serviceOrder.id, id));
      await recordServiceOrderEvent({
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.repair_started",
      });
      return c.json({ data: execution });
    },
  )
  .patch(
    "/:id/execution",
    ...withLabPermission({ service_order: ["execute"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", UpdateServiceOrderExecutionSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [execution] = await db
        .select()
        .from(serviceOrderExecution)
        .where(eq(serviceOrderExecution.serviceOrderId, id))
        .limit(1);
      if (!execution) return c.json({ error: "Execucao nao iniciada" }, 404);
      if (input.items) {
        await replaceExecutionItems({ executionId: execution.id, items: input.items });
      }
      const [updated] = await db
        .update(serviceOrderExecution)
        .set({
          servicePerformed: input.servicePerformed,
          partsUsedSummary: input.partsUsedSummary,
          technicalNotes: input.technicalNotes,
          calibrationRequiredAfterRepair: input.calibrationRequiredAfterRepair,
          result: input.result,
          updatedAt: new Date(),
        })
        .where(eq(serviceOrderExecution.id, execution.id))
        .returning();
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/execution/finish",
    ...withLabPermission({ service_order: ["execute"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", FinishServiceOrderExecutionSchema),
    async (c) => {
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [execution] = await db
        .select()
        .from(serviceOrderExecution)
        .where(eq(serviceOrderExecution.serviceOrderId, id))
        .limit(1);
      if (!execution) return c.json({ error: "Execucao nao iniciada" }, 404);
      if (input.items) {
        await replaceExecutionItems({ executionId: execution.id, items: input.items });
      }
      const nextStatus = input.calibrationRequiredAfterRepair
        ? "awaiting_calibration"
        : "awaiting_final_review";
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, id)).limit(1);
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);
      await db.transaction(async (tx) => {
        await tx
          .update(serviceOrderExecution)
          .set({
            servicePerformed: input.servicePerformed,
            partsUsedSummary: input.partsUsedSummary ?? null,
            technicalNotes: input.technicalNotes ?? null,
            calibrationRequiredAfterRepair:
              input.calibrationRequiredAfterRepair ?? false,
            result: input.result,
            finishedAt: new Date(),
            finishedByUserId: session.user.id,
          })
          .where(eq(serviceOrderExecution.id, execution.id));
        await tx
          .update(serviceOrder)
          .set({
            status: nextStatus,
            repairFinishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(serviceOrder.id, id));
        await recordServiceOrderEvent(
          {
            organizationId: order.organizationId,
            unitId: order.unitId,
            serviceOrderId: id,
            actorType: "lab_user",
            actorId: session.user.id,
            eventType: "service_order.repair_finished",
            newValue: { status: nextStatus, result: input.result },
          },
          tx,
        );
      });
      return c.json({ ok: true });
    },
  )
  .post(
    "/:id/deliver",
    ...withLabPermission({ service_order: ["deliver"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", DeliverServiceOrderSchema),
    async (c) => {
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [updated] = await db
        .update(serviceOrder)
        .set({
          status: "delivered",
          deliveredAt: new Date(),
          deliveryMethod: input.deliveryMethod,
          deliveredToName: input.deliveredToName,
          deliveredToDocument: input.deliveredToDocument ?? null,
          deliveryNotes: input.deliveryNotes ?? null,
        })
        .where(eq(serviceOrder.id, id))
        .returning();
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      await recordServiceOrderEvent({
        organizationId: updated.organizationId,
        unitId: updated.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.delivered",
        metadata: { deliveredToName: input.deliveredToName },
      });
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/close",
    ...withLabPermission({ service_order: ["close"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CloseServiceOrderSchema),
    async (c) => {
      const session = c.get("session");
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [updated] = await db
        .update(serviceOrder)
        .set({
          status: "closed",
          closedAt: new Date(),
          closingReason: input.closingReason,
          internalNotes: input.notes ?? undefined,
        })
        .where(
          and(
            eq(serviceOrder.id, id),
            eq(serviceOrder.organizationId, member.organizationId),
          ),
        )
        .returning();
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      if (input.createBillingDocument) {
        await createBillingDocumentFromServiceOrder({
          actorUserId: session.user.id,
          organizationId: member.organizationId,
          serviceOrderId: id,
          dueDate: parseDate(input.dueDate) ?? undefined,
        });
      }
      await recordServiceOrderEvent({
        organizationId: updated.organizationId,
        unitId: updated.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.closed",
        metadata: { closingReason: input.closingReason },
      });
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/cancel",
    ...withLabPermission({ service_order: ["cancel"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CancelServiceOrderSchema),
    async (c) => {
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [updated] = await db
        .update(serviceOrder)
        .set({
          status: "canceled",
          canceledAt: new Date(),
          cancelReason: input.reason,
        })
        .where(eq(serviceOrder.id, id))
        .returning();
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      await recordServiceOrderEvent({
        organizationId: updated.organizationId,
        unitId: updated.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.canceled",
        metadata: { reason: input.reason },
      });
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/reopen",
    ...withLabPermission({ service_order: ["reopen"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", ReopenServiceOrderSchema),
    async (c) => {
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const [updated] = await db
        .update(serviceOrder)
        .set({ status: "awaiting_tech_evaluation", canceledAt: null, closedAt: null })
        .where(eq(serviceOrder.id, id))
        .returning();
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      await recordServiceOrderEvent({
        organizationId: updated.organizationId,
        unitId: updated.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.reopened",
        metadata: { reason: input.reason },
      });
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/certificates/:certificateJobId/link",
    ...withLabPermission({ service_order: ["update"] }),
    zValidator(
      "param",
      z.object({
        id: z.coerce.number().int().positive(),
        certificateJobId: z.coerce.number().int().positive(),
      }),
    ),
    async (c) => {
      const session = c.get("session");
      const member = c.get("member");
      const { id, certificateJobId } = c.req.valid("param");
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, id)).limit(1);
      const [job] = await db.select().from(calibrationJob).where(eq(calibrationJob.id, certificateJobId)).limit(1);
      if (!order || !job) return c.json({ error: "OS ou certificado nao encontrado" }, 404);
      if (
        order.organizationId !== member.organizationId ||
        job.organizationId !== order.organizationId ||
        job.unitId !== order.unitId ||
        job.customerId !== order.customerId ||
        job.assetId !== order.assetId
      ) {
        return c.json({ error: "Certificado incompativel com a OS" }, 400);
      }
      const [link] = await db
        .insert(serviceOrderCertificateLink)
        .values({
          serviceOrderId: id,
          certificateJobId,
          linkedByUserId: session.user.id,
        })
        .onConflictDoNothing({
          target: [
            serviceOrderCertificateLink.serviceOrderId,
            serviceOrderCertificateLink.certificateJobId,
          ],
        })
        .returning();
      await recordServiceOrderEvent({
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: id,
        actorType: "lab_user",
        actorId: session.user.id,
        eventType: "service_order.certificate_linked",
        metadata: { certificateJobId },
      });
      return c.json({ data: link });
    },
  )
  .delete(
    "/:id/certificates/:certificateJobId/link",
    ...withLabPermission({ service_order: ["update"] }),
    zValidator(
      "param",
      z.object({
        id: z.coerce.number().int().positive(),
        certificateJobId: z.coerce.number().int().positive(),
      }),
    ),
    async (c) => {
      const session = c.get("session");
      const { id, certificateJobId } = c.req.valid("param");
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, id)).limit(1);
      await db
        .delete(serviceOrderCertificateLink)
        .where(
          and(
            eq(serviceOrderCertificateLink.serviceOrderId, id),
            eq(serviceOrderCertificateLink.certificateJobId, certificateJobId),
          ),
        );
      if (order) {
        await recordServiceOrderEvent({
          organizationId: order.organizationId,
          unitId: order.unitId,
          serviceOrderId: id,
          actorType: "lab_user",
          actorId: session.user.id,
          eventType: "service_order.certificate_unlinked",
          metadata: { certificateJobId },
        });
      }
      return c.json({ ok: true });
    },
  );

export const portalServiceOrdersRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get(
    "/",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("query", ListServiceOrdersQuerySchema),
    async (c) => {
      const member = c.get("member");
      const linkedCustomer = await getPortalCustomer(member.organizationId);
      if (!linkedCustomer) return c.json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
      const query = c.req.valid("query");
      const rows = await db
        .select({
          id: serviceOrder.id,
          serviceOrderNumber: serviceOrder.serviceOrderNumber,
          status: serviceOrder.status,
          openedAt: serviceOrder.openedAt,
          readyAt: serviceOrder.readyAt,
          assetName: asset.name,
          assetSerialNumber: asset.serialNumber,
        })
        .from(serviceOrder)
        .innerJoin(asset, eq(serviceOrder.assetId, asset.id))
        .where(
          and(
            eq(serviceOrder.customerId, linkedCustomer.id),
            query.status ? eq(serviceOrder.status, query.status) : undefined,
          ),
        )
        .orderBy(desc(serviceOrder.openedAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);
      return c.json({
        data: rows.map((row) => ({
          ...row,
          statusLabel: SERVICE_ORDER_STATUS_LABELS[row.status],
        })),
        pagination: { page: query.page, limit: query.limit, total: rows.length, totalPages: 1 },
      });
    },
  )
  .get(
    "/:id",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const linkedCustomer = await getPortalCustomer(member.organizationId);
      if (!linkedCustomer) return c.json({ error: "OS nao encontrada" }, 404);
      const detail = await getServiceOrderDetail(
        c.req.valid("param").id,
        linkedCustomer.labOrganizationId,
      );
      if (!detail || detail.customerId !== linkedCustomer.id) {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      return c.json({ data: toClientVisibleServiceOrderDetail(detail) });
    },
  )
  .post(
    "/:id/quotes/:quoteId/approve",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", ApproveServiceOrderQuotePortalSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id, quoteId } = c.req.valid("param");
      const linkedCustomer = await getPortalCustomer(member.organizationId);
      const quote = await getQuoteForAction(id, quoteId);
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, id)).limit(1);
      if (!linkedCustomer || !order || order.customerId !== linkedCustomer.id || !quote) {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      if (!canApproveServiceOrderQuote(quote.status)) {
        return c.json({ error: "Orcamento nao pode ser aprovado" }, 409);
      }
      await db.transaction(async (tx) => {
        await tx.update(serviceOrderQuote).set({ status: "approved", approvedAt: new Date(), approvedByPortalUserId: session.user.id }).where(eq(serviceOrderQuote.id, quoteId));
        await tx.update(serviceOrder).set({ status: "quote_approved", approvedAt: new Date(), totalApprovedCents: quote.totalCents }).where(eq(serviceOrder.id, id));
        await recordServiceOrderEvent({ organizationId: order.organizationId, unitId: order.unitId, serviceOrderId: id, actorType: "portal_user", actorId: session.user.id, eventType: "service_order.quote_approved_by_client", metadata: { quoteId }, ipAddress: requestIp(c), userAgent: requestUserAgent(c) }, tx);
      });
      return c.json({ ok: true });
    },
  )
  .post(
    "/:id/quotes/:quoteId/reject",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", RejectServiceOrderQuotePortalSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const linkedCustomer = await getPortalCustomer(member.organizationId);
      const quote = await getQuoteForAction(id, quoteId);
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, id)).limit(1);
      if (!linkedCustomer || !order || order.customerId !== linkedCustomer.id || !quote) {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      await db.transaction(async (tx) => {
        await tx.update(serviceOrderQuote).set({ status: "rejected", rejectedAt: new Date(), rejectionReason: input.rejectionReason ?? null }).where(eq(serviceOrderQuote.id, quoteId));
        await tx.update(serviceOrder).set({ status: "quote_rejected", rejectedAt: new Date() }).where(eq(serviceOrder.id, id));
        await recordServiceOrderEvent({ organizationId: order.organizationId, unitId: order.unitId, serviceOrderId: id, actorType: "portal_user", actorId: session.user.id, eventType: "service_order.quote_rejected_by_client", metadata: { quoteId, reason: input.rejectionReason }, ipAddress: requestIp(c), userAgent: requestUserAgent(c) }, tx);
      });
      return c.json({ ok: true });
    },
  );

export const publicServiceOrderAccessRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get(
    "/:token",
    zValidator("param", TokenParamSchema),
    async (c) => {
      const tokenHash = await hashServiceOrderToken(c.req.valid("param").token);
      const [access] = await db
        .select()
        .from(serviceOrderPublicAccessToken)
        .where(eq(serviceOrderPublicAccessToken.tokenHash, tokenHash))
        .limit(1);
      if (
        !access ||
        access.revokedAt ||
        (access.expiresAt && access.expiresAt < new Date())
      ) {
        return c.json({ error: "Link invalido ou expirado" }, 404);
      }
      await db
        .update(serviceOrderPublicAccessToken)
        .set({ lastViewedAt: new Date() })
        .where(eq(serviceOrderPublicAccessToken.id, access.id));
      const detail = await getServiceOrderDetail(
        access.serviceOrderId,
        access.organizationId,
      );
      if (!detail) return c.json({ error: "OS nao encontrada" }, 404);
      await recordServiceOrderEvent({
        organizationId: detail.organizationId,
        unitId: detail.unitId,
        serviceOrderId: detail.id,
        actorType: "public_token",
        actorId: String(access.id),
        eventType: "service_order.public_link_viewed",
        ipAddress: requestIp(c),
        userAgent: requestUserAgent(c),
      });
      return c.json({ data: toClientVisibleServiceOrderDetail(detail) });
    },
  )
  .post(
    "/:token/approve-quote",
    zValidator("param", TokenParamSchema),
    zValidator("json", ApproveServiceOrderQuotePortalSchema),
    async (c) => {
      const tokenHash = await hashServiceOrderToken(c.req.valid("param").token);
      const [access] = await db.select().from(serviceOrderPublicAccessToken).where(eq(serviceOrderPublicAccessToken.tokenHash, tokenHash)).limit(1);
      if (!access?.quoteId || access.revokedAt || (access.expiresAt && access.expiresAt < new Date())) {
        return c.json({ error: "Link invalido ou expirado" }, 404);
      }
      const quote = await getQuoteForAction(access.serviceOrderId, access.quoteId);
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, access.serviceOrderId)).limit(1);
      if (!quote || !order || !canApproveServiceOrderQuote(quote.status)) {
        return c.json({ error: "Orcamento nao pode ser aprovado" }, 409);
      }
      await db.transaction(async (tx) => {
        await tx.update(serviceOrderQuote).set({ status: "approved", approvedAt: new Date() }).where(eq(serviceOrderQuote.id, quote.id));
        await tx.update(serviceOrder).set({ status: "quote_approved", approvedAt: new Date(), totalApprovedCents: quote.totalCents }).where(eq(serviceOrder.id, order.id));
        await recordServiceOrderEvent({ organizationId: order.organizationId, unitId: order.unitId, serviceOrderId: order.id, actorType: "public_token", actorId: String(access.id), eventType: "service_order.quote_approved_by_client", metadata: { quoteId: quote.id }, ipAddress: requestIp(c), userAgent: requestUserAgent(c) }, tx);
      });
      return c.json({ ok: true });
    },
  )
  .post(
    "/:token/reject-quote",
    zValidator("param", TokenParamSchema),
    zValidator("json", RejectServiceOrderQuotePortalSchema),
    async (c) => {
      const tokenHash = await hashServiceOrderToken(c.req.valid("param").token);
      const input = c.req.valid("json");
      const [access] = await db.select().from(serviceOrderPublicAccessToken).where(eq(serviceOrderPublicAccessToken.tokenHash, tokenHash)).limit(1);
      if (!access?.quoteId || access.revokedAt || (access.expiresAt && access.expiresAt < new Date())) {
        return c.json({ error: "Link invalido ou expirado" }, 404);
      }
      const quote = await getQuoteForAction(access.serviceOrderId, access.quoteId);
      const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, access.serviceOrderId)).limit(1);
      if (!quote || !order) return c.json({ error: "Orcamento nao encontrado" }, 404);
      await db.transaction(async (tx) => {
        await tx.update(serviceOrderQuote).set({ status: "rejected", rejectedAt: new Date(), rejectionReason: input.rejectionReason ?? null }).where(eq(serviceOrderQuote.id, quote.id));
        await tx.update(serviceOrder).set({ status: "quote_rejected", rejectedAt: new Date() }).where(eq(serviceOrder.id, order.id));
        await recordServiceOrderEvent({ organizationId: order.organizationId, unitId: order.unitId, serviceOrderId: order.id, actorType: "public_token", actorId: String(access.id), eventType: "service_order.quote_rejected_by_client", metadata: { quoteId: quote.id, reason: input.rejectionReason }, ipAddress: requestIp(c), userAgent: requestUserAgent(c) }, tx);
      });
      return c.json({ ok: true });
    },
  );
