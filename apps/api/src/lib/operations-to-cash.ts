import { db } from "@calibra-facil/db";
import {
  billingDocument,
  calibrationJob,
  customer,
  organizationUnit,
  receivableInstallment,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import type {
  BillingBlocker,
  BillingDocumentStatus,
  ReceivableInstallmentStatus,
} from "@calibra-facil/shared";
import { isServiceOrderBillable } from "@calibra-facil/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  evaluateOrderBlockers,
  resolveServiceOrderBillingDocumentLinks,
} from "./finance";
import { buildUnitScopeCondition } from "./units";

/**
 * Operations-to-cash dashboard stages. Provider-neutral, lab-facing.
 * `OVERDUE` and `BLOCKED` are surface flags layered over a stage, not
 * stages themselves — see {@link OperationsToCashClassification}.
 */
export type OperationsToCashStage =
  | "READY_TO_BILL"
  | "SENT_TO_FINANCE"
  | "INVOICED"
  | "PARTIALLY_COLLECTED"
  | "COLLECTED";

export const OPERATIONS_TO_CASH_STAGES: ReadonlyArray<OperationsToCashStage> = [
  "READY_TO_BILL",
  "SENT_TO_FINANCE",
  "INVOICED",
  "PARTIALLY_COLLECTED",
  "COLLECTED",
];

export const OPERATIONS_TO_CASH_STAGE_LABEL: Record<OperationsToCashStage, string> =
  {
    READY_TO_BILL: "Pronto para faturar",
    SENT_TO_FINANCE: "Enviado ao financeiro",
    INVOICED: "Faturado",
    PARTIALLY_COLLECTED: "Recebimento parcial",
    COLLECTED: "Recebido",
  };

export interface OperationsToCashClassifierInput {
  hasBillingDocument: boolean;
  billingDocumentStatus: BillingDocumentStatus | null;
  billingDocumentExportStatus:
    | "NOT_EXPORTED"
    | "PENDING"
    | "EXPORTED"
    | "FAILED"
    | null;
  installmentStatuses: ReadonlyArray<ReceivableInstallmentStatus>;
  blockers: ReadonlyArray<BillingBlocker>;
}

export interface OperationsToCashClassification {
  stage: OperationsToCashStage;
  isOverdue: boolean;
  isBlocked: boolean;
}

/**
 * Pure stage + overlay classifier. Inputs are pre-resolved from the
 * Phase 1 read model. Reuses billing-document status semantics and
 * installment-mix logic so the dashboard doesn't fork stage rules.
 */
export function classifyServiceOrder(
  input: OperationsToCashClassifierInput,
): OperationsToCashClassification {
  const activeInstallments = input.installmentStatuses.filter(
    (status) => status !== "VOID",
  );
  const anyPaidInstallment = activeInstallments.some(
    (status) => status === "PAID",
  );
  const allActivePaid =
    activeInstallments.length > 0 &&
    activeInstallments.every((status) => status === "PAID");
  const anyOverdueInstallment = activeInstallments.some(
    (status) => status === "OVERDUE",
  );

  const isBlocked = input.blockers.length > 0;
  const docStatus = input.billingDocumentStatus;
  const isDocumentOverdue = docStatus === "OVERDUE";
  const isOverdue = isDocumentOverdue || anyOverdueInstallment;

  let stage: OperationsToCashStage;

  if (!input.hasBillingDocument) {
    stage = "READY_TO_BILL";
  } else if (docStatus === "PAID" || allActivePaid) {
    stage = "COLLECTED";
  } else if (anyPaidInstallment) {
    stage = "PARTIALLY_COLLECTED";
  } else if (docStatus === "ISSUED" || docStatus === "OVERDUE") {
    stage = "INVOICED";
  } else if (
    docStatus === "DRAFT" ||
    input.billingDocumentExportStatus === "PENDING" ||
    input.billingDocumentExportStatus === "FAILED"
  ) {
    stage = "SENT_TO_FINANCE";
  } else {
    stage = "READY_TO_BILL";
  }

  return { stage, isOverdue, isBlocked };
}

export interface OperationsToCashStageBucket {
  count: number;
  totalCents: number;
}

export interface OperationsToCashSummary {
  stages: Record<OperationsToCashStage, OperationsToCashStageBucket>;
  needsAttention: {
    overdueCount: number;
    blockedCount: number;
    overdueCents: number;
    blockedCents: number;
  };
}

export interface ClassifiedServiceOrderItem extends OperationsToCashClassification {
  serviceOrderId: number;
  serviceOrderNumber: string;
  customer: { id: number; name: string };
  unit: { id: number; name: string };
  amountCents: number;
  currency: string;
}

const EMPTY_BUCKET: OperationsToCashStageBucket = { count: 0, totalCents: 0 };

function emptyStages(): Record<OperationsToCashStage, OperationsToCashStageBucket> {
  return {
    READY_TO_BILL: { ...EMPTY_BUCKET },
    SENT_TO_FINANCE: { ...EMPTY_BUCKET },
    INVOICED: { ...EMPTY_BUCKET },
    PARTIALLY_COLLECTED: { ...EMPTY_BUCKET },
    COLLECTED: { ...EMPTY_BUCKET },
  };
}

/**
 * Aggregates classified items into per-stage counts + cents and a
 * separate "needs attention" pane (overdue + blocked flags). Stages
 * and attention flags are not mutually exclusive: an OVERDUE invoice
 * is `INVOICED` with `isOverdue: true`.
 */
export function summarizeOperationsToCash(
  items: ReadonlyArray<ClassifiedServiceOrderItem>,
): OperationsToCashSummary {
  const summary: OperationsToCashSummary = {
    stages: emptyStages(),
    needsAttention: {
      overdueCount: 0,
      blockedCount: 0,
      overdueCents: 0,
      blockedCents: 0,
    },
  };

  for (const item of items) {
    const bucket = summary.stages[item.stage];
    bucket.count += 1;
    bucket.totalCents += item.amountCents;
    if (item.isOverdue) {
      summary.needsAttention.overdueCount += 1;
      summary.needsAttention.overdueCents += item.amountCents;
    }
    if (item.isBlocked) {
      summary.needsAttention.blockedCount += 1;
      summary.needsAttention.blockedCents += item.amountCents;
    }
  }

  return summary;
}

export interface BuildOperationsToCashInput {
  organizationId: string;
  scope: Parameters<typeof buildUnitScopeCondition>[1];
  stageFilter?: OperationsToCashStage;
}

export interface OperationsToCashEnvelope {
  summary: OperationsToCashSummary;
  items: ClassifiedServiceOrderItem[];
}

const MAX_ROWS = 500;

/**
 * Single-shot DB read: resolves SOs in the caller's scope, joins to
 * billing docs + installments + linked calibration jobs, classifies
 * each one, and aggregates the summary. Tenant + unit scope enforced
 * by the existing `buildUnitScopeCondition`.
 */
export async function buildOperationsToCash(
  input: BuildOperationsToCashInput,
): Promise<OperationsToCashEnvelope> {
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
      billingDocumentId: serviceOrder.billingDocumentId,
    })
    .from(serviceOrder)
    .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
    .innerJoin(organizationUnit, eq(serviceOrder.unitId, organizationUnit.id))
    .where(
      and(
        eq(serviceOrder.organizationId, input.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.scope),
      ),
    )
    .orderBy(desc(serviceOrder.updatedAt))
    .limit(MAX_ROWS);

  const billable = orders.filter((row) =>
    isServiceOrderBillable(row.status, row.closingReason),
  );
  if (billable.length === 0) {
    return { summary: summarizeOperationsToCash([]), items: [] };
  }

  const orderIds = billable.map((row) => row.id);

  const links = await db
    .select({
      serviceOrderId: serviceOrderCertificateLink.serviceOrderId,
      jobId: calibrationJob.id,
      jobStatus: calibrationJob.status,
    })
    .from(serviceOrderCertificateLink)
    .innerJoin(
      calibrationJob,
      eq(serviceOrderCertificateLink.certificateJobId, calibrationJob.id),
    )
    .where(inArray(serviceOrderCertificateLink.serviceOrderId, orderIds));

  const linksByOrder = new Map<number, typeof links>();
  for (const link of links) {
    const list = linksByOrder.get(link.serviceOrderId) ?? [];
    list.push(link);
    linksByOrder.set(link.serviceOrderId, list);
  }

  const resolvedDocumentLinks = await resolveServiceOrderBillingDocumentLinks(
    billable.map((row) => ({
      serviceOrderId: row.id,
      directBillingDocumentId: row.billingDocumentId,
      certificateJobIds: (linksByOrder.get(row.id) ?? []).map(
        (link) => link.jobId,
      ),
    })),
    input.organizationId,
  );

  const billingDocumentIds = Array.from(
    new Set(
      Array.from(resolvedDocumentLinks.values()).map((link) => link.documentId),
    ),
  );

  const installmentRows = billingDocumentIds.length
    ? await db
        .select({
          documentId: receivableInstallment.documentId,
          status: receivableInstallment.status,
        })
        .from(receivableInstallment)
        .where(
          inArray(receivableInstallment.documentId, billingDocumentIds),
        )
    : [];

  const installmentsByDoc = new Map<number, ReceivableInstallmentStatus[]>();
  for (const row of installmentRows) {
    const list = installmentsByDoc.get(row.documentId) ?? [];
    list.push(row.status);
    installmentsByDoc.set(row.documentId, list);
  }

  const billingDocStatusByDoc = new Map<
    number,
    {
      status: BillingDocumentStatus;
      exportStatus:
        | "NOT_EXPORTED"
        | "PENDING"
        | "EXPORTED"
        | "FAILED"
        | null;
    }
  >();
  if (billingDocumentIds.length) {
    const docRows = await db
      .select({
        id: billingDocument.id,
        status: billingDocument.status,
        exportStatus: billingDocument.exportStatus,
      })
      .from(billingDocument)
      .where(
        and(
          eq(billingDocument.organizationId, input.organizationId),
          inArray(billingDocument.id, billingDocumentIds),
        ),
      );
    for (const row of docRows) {
      billingDocStatusByDoc.set(row.id, {
        status: row.status,
        exportStatus: row.exportStatus,
      });
    }
  }

  const items: ClassifiedServiceOrderItem[] = [];

  for (const order of billable) {
    const orderLinks = linksByOrder.get(order.id) ?? [];
    const existingDoc = resolvedDocumentLinks.get(order.id) ?? null;
    const docInfo = existingDoc
      ? billingDocStatusByDoc.get(existingDoc.documentId) ?? null
      : null;
    const installmentStatuses = existingDoc
      ? installmentsByDoc.get(existingDoc.documentId) ?? []
      : [];
    const amountCents =
      order.amountApprovedCents > 0
        ? order.amountApprovedCents
        : order.amountQuotedCents;

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

    const classification = classifyServiceOrder({
      hasBillingDocument: existingDoc !== null,
      billingDocumentStatus: docInfo?.status ?? null,
      billingDocumentExportStatus: docInfo?.exportStatus ?? null,
      installmentStatuses,
      blockers,
    });

    if (input.stageFilter && classification.stage !== input.stageFilter) {
      continue;
    }

    items.push({
      ...classification,
      serviceOrderId: order.id,
      serviceOrderNumber: order.number,
      customer: { id: order.customerId, name: order.customerName },
      unit: { id: order.unitId, name: order.unitName },
      amountCents,
      currency: "BRL",
    });
  }

  return {
    summary: summarizeOperationsToCash(items),
    items,
  };
}
