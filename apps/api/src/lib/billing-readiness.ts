import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  customer,
  organizationIntegration,
  organizationUnit,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import {
  type BillingBlocker,
  type BillingIntegrationState,
  type BillingReadinessItem,
  type BillingReadinessStatus,
  type BillingReadinessSummary,
  SERVICE_ORDER_BILLABLE_STATUSES,
  isServiceOrderBillable,
} from "@calibra-facil/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  evaluateOrderBlockers,
  resolveServiceOrderBillingDocumentLinks,
} from "./finance";
import { buildUnitScopeCondition } from "./units";

type UnitScope = Parameters<typeof buildUnitScopeCondition>[1];

const MAX_QUEUE_ROWS = 200;

export {
  evaluateOrderBlockers,
  resolveServiceOrderBillingDocumentLinks,
} from "./finance";

/**
 * Resolve whether the org has a usable financial provider connection. This is a
 * global gate on the "send to finance" action, surfaced separately from
 * per-order blockers so the queue can still list READY work.
 */
export async function getFinancialIntegrationState(
  organizationId: string,
): Promise<BillingIntegrationState> {
  const rows = await db
    .select({ status: organizationIntegration.status })
    .from(organizationIntegration)
    .where(
      and(
        eq(organizationIntegration.organizationId, organizationId),
        eq(organizationIntegration.type, "financial_erp"),
      ),
    );

  if (rows.length === 0) {
    return "not_configured";
  }
  return rows.some((row) => row.status === "ACTIVE")
    ? "connected"
    : "disconnected";
}

function resolveReadinessStatus(
  existingDoc: { exportStatus: string } | null,
  blockers: BillingBlocker[],
): BillingReadinessStatus {
  if (existingDoc) {
    return existingDoc.exportStatus === "EXPORTED" ? "SENT" : "BILLED";
  }
  return blockers.length > 0 ? "BLOCKED" : "READY";
}

export interface BillingReadinessQueue {
  integrationState: BillingIntegrationState;
  summary: BillingReadinessSummary;
  items: BillingReadinessItem[];
}

/**
 * Compute the billing readiness queue on the fly from existing operational
 * data (no materialized table). Lists completed service orders and classifies
 * each as READY / BLOCKED / BILLED / SENT with lab-facing blocker reasons.
 */
export async function computeBillingReadinessQueue(params: {
  organizationId: string;
  scope: UnitScope;
  filters?: { status?: BillingReadinessStatus; customerId?: number };
}): Promise<BillingReadinessQueue> {
  const { organizationId, scope, filters } = params;

  const integrationState = await getFinancialIntegrationState(organizationId);

  const orderConditions = [
    eq(serviceOrder.organizationId, organizationId),
    inArray(serviceOrder.status, [...SERVICE_ORDER_BILLABLE_STATUSES]),
    buildUnitScopeCondition(serviceOrder.unitId, scope),
  ];
  if (filters?.customerId) {
    orderConditions.push(eq(serviceOrder.customerId, filters.customerId));
  }

  const orders = await db
    .select({
      id: serviceOrder.id,
      number: serviceOrder.serviceOrderNumber,
      status: serviceOrder.status,
      closingReason: serviceOrder.closingReason,
      customerId: customer.id,
      customerName: customer.name,
      taxId: customer.taxId,
      email: customer.email,
      address: customer.address,
      unitId: organizationUnit.id,
      unitName: organizationUnit.name,
      amountApprovedCents: serviceOrder.totalApprovedCents,
      amountQuotedCents: serviceOrder.totalQuotedCents,
      readyAt: serviceOrder.readyAt,
      deliveredAt: serviceOrder.deliveredAt,
      closedAt: serviceOrder.closedAt,
      billingDocumentId: serviceOrder.billingDocumentId,
    })
    .from(serviceOrder)
    .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
    .innerJoin(organizationUnit, eq(serviceOrder.unitId, organizationUnit.id))
    .where(and(...orderConditions))
    .orderBy(desc(serviceOrder.updatedAt))
    .limit(MAX_QUEUE_ROWS);

  const billableOrders = orders.filter((order) =>
    isServiceOrderBillable(order.status, order.closingReason),
  );

  const orderIds = billableOrders.map((order) => order.id);

  // Linked certificate jobs per order (for certificate-status blockers + refs).
  const links = orderIds.length
    ? await db
        .select({
          serviceOrderId: serviceOrderCertificateLink.serviceOrderId,
          jobId: calibrationJob.id,
          jobNumber: calibrationJob.jobId,
          jobStatus: calibrationJob.status,
        })
        .from(serviceOrderCertificateLink)
        .innerJoin(
          calibrationJob,
          eq(serviceOrderCertificateLink.certificateJobId, calibrationJob.id),
        )
        .where(inArray(serviceOrderCertificateLink.serviceOrderId, orderIds))
    : [];

  const linksByOrder = new Map<number, typeof links>();
  for (const link of links) {
    const list = linksByOrder.get(link.serviceOrderId) ?? [];
    list.push(link);
    linksByOrder.set(link.serviceOrderId, list);
  }
  const resolvedDocumentLinks = await resolveServiceOrderBillingDocumentLinks(
    billableOrders.map((order) => ({
      serviceOrderId: order.id,
      directBillingDocumentId: order.billingDocumentId,
      certificateJobIds: (linksByOrder.get(order.id) ?? []).map(
        (link) => link.jobId,
      ),
    })),
    organizationId,
  );

  const items: BillingReadinessItem[] = [];
  const summary: BillingReadinessSummary = {
    ready: 0,
    blocked: 0,
    billed: 0,
    sent: 0,
  };

  for (const order of billableOrders) {
    const orderLinks = linksByOrder.get(order.id) ?? [];
    const amountCents =
      order.amountApprovedCents > 0
        ? order.amountApprovedCents
        : order.amountQuotedCents;

    const existingDoc = resolvedDocumentLinks.get(order.id) ?? null;

    const blockers = existingDoc
      ? []
      : evaluateOrderBlockers({
          customer: {
            taxId: order.taxId,
            email: order.email,
            address: order.address,
          },
          certificateJobStatuses: orderLinks.map((link) => link.jobStatus),
          amountCents,
        });

    const readinessStatus = resolveReadinessStatus(existingDoc, blockers);

    if (filters?.status && filters.status !== readinessStatus) {
      continue;
    }

    if (readinessStatus === "READY") summary.ready += 1;
    else if (readinessStatus === "BLOCKED") summary.blocked += 1;
    else if (readinessStatus === "BILLED") summary.billed += 1;
    else summary.sent += 1;

    items.push({
      serviceOrderId: order.id,
      serviceOrderNumber: order.number,
      customer: { id: order.customerId, name: order.customerName },
      unit: { id: order.unitId, name: order.unitName },
      amountCents,
      currency: "BRL",
      completedAt:
        (
          order.closedAt ??
          order.deliveredAt ??
          order.readyAt ??
          null
        )?.toISOString() ?? null,
      certificateRefs: orderLinks.map((link) => ({
        jobId: link.jobId,
        displayId: link.jobNumber,
        status: link.jobStatus,
      })),
      readinessStatus,
      blockers,
      existingBillingDocumentId: existingDoc?.documentId ?? null,
    });
  }

  return { integrationState, summary, items };
}
