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
  BillingDocumentExportStatus,
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
import {
  classifyServiceOrder,
  type OperationsToCashStage,
} from "./operations-to-cash";

export type RevenueLeakageClass =
  | "STUCK_READY_TO_BILL"
  | "STUCK_SENT_TO_FINANCE"
  | "STUCK_INVOICED"
  | "LONG_OVERDUE"
  | "BLOCKED_TOO_LONG";

export const REVENUE_LEAKAGE_CLASSES: ReadonlyArray<RevenueLeakageClass> = [
  "STUCK_READY_TO_BILL",
  "STUCK_SENT_TO_FINANCE",
  "STUCK_INVOICED",
  "LONG_OVERDUE",
  "BLOCKED_TOO_LONG",
];

export const REVENUE_LEAKAGE_LABEL: Record<RevenueLeakageClass, string> = {
  STUCK_READY_TO_BILL: "Pronto para faturar há muito tempo",
  STUCK_SENT_TO_FINANCE: "Enviado ao financeiro sem fatura emitida",
  STUCK_INVOICED: "Faturado sem recebimento há mais de 30 dias",
  LONG_OVERDUE: "Vencido há mais de 14 dias",
  BLOCKED_TOO_LONG: "Bloqueado há mais de 7 dias",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const REVENUE_LEAKAGE_THRESHOLDS = {
  stuckReadyToBillDays: 7,
  stuckSentToFinanceDays: 3,
  stuckInvoicedDays: 30,
  longOverdueDays: 14,
  blockedTooLongDays: 7,
};

export interface RevenueLeakageInput {
  stage: OperationsToCashStage;
  isOverdue: boolean;
  isBlocked: boolean;
  completedAt: Date | null;
  sentAt: Date | null;
  issuedAt: Date | null;
  firstOverdueInstallmentDueDate: Date | null;
  lastStatusChangedAt: Date | null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS);
}

/**
 * Pure leakage evaluator. Returns every alert class that applies — an
 * SO can have multiple (e.g. LONG_OVERDUE + BLOCKED_TOO_LONG). `now`
 * is injected so tests are deterministic across CI clocks.
 */
export function evaluateRevenueLeakage(
  input: RevenueLeakageInput,
  now: Date,
): RevenueLeakageClass[] {
  const classes: RevenueLeakageClass[] = [];

  if (
    input.stage === "READY_TO_BILL" &&
    input.completedAt &&
    daysBetween(now, input.completedAt) >
      REVENUE_LEAKAGE_THRESHOLDS.stuckReadyToBillDays
  ) {
    classes.push("STUCK_READY_TO_BILL");
  }

  if (
    input.stage === "SENT_TO_FINANCE" &&
    input.sentAt &&
    daysBetween(now, input.sentAt) >
      REVENUE_LEAKAGE_THRESHOLDS.stuckSentToFinanceDays
  ) {
    classes.push("STUCK_SENT_TO_FINANCE");
  }

  if (
    input.stage === "INVOICED" &&
    !input.isOverdue &&
    input.issuedAt &&
    daysBetween(now, input.issuedAt) >
      REVENUE_LEAKAGE_THRESHOLDS.stuckInvoicedDays
  ) {
    classes.push("STUCK_INVOICED");
  }

  if (
    input.isOverdue &&
    input.firstOverdueInstallmentDueDate &&
    daysBetween(now, input.firstOverdueInstallmentDueDate) >
      REVENUE_LEAKAGE_THRESHOLDS.longOverdueDays
  ) {
    classes.push("LONG_OVERDUE");
  }

  if (
    input.isBlocked &&
    input.lastStatusChangedAt &&
    daysBetween(now, input.lastStatusChangedAt) >
      REVENUE_LEAKAGE_THRESHOLDS.blockedTooLongDays
  ) {
    classes.push("BLOCKED_TOO_LONG");
  }

  return classes;
}

export interface RevenueLeakageAlertItem {
  serviceOrderId: number;
  /** Opaque id the dashboard links with; the serial never reaches a URL. */
  serviceOrderPublicId: string;
  serviceOrderNumber: string;
  customer: { id: number; name: string };
  unit: { id: number; name: string };
  amountCents: number;
  currency: string;
  classes: RevenueLeakageClass[];
  ageInDays: number | null;
}

export interface RevenueLeakageSummary {
  classes: Record<RevenueLeakageClass, { count: number; totalCents: number }>;
  totalAlerts: number;
}

function emptyClassBuckets(): RevenueLeakageSummary["classes"] {
  return {
    STUCK_READY_TO_BILL: { count: 0, totalCents: 0 },
    STUCK_SENT_TO_FINANCE: { count: 0, totalCents: 0 },
    STUCK_INVOICED: { count: 0, totalCents: 0 },
    LONG_OVERDUE: { count: 0, totalCents: 0 },
    BLOCKED_TOO_LONG: { count: 0, totalCents: 0 },
  };
}

export function summarizeRevenueLeakage(
  alerts: ReadonlyArray<RevenueLeakageAlertItem>,
): RevenueLeakageSummary {
  const summary: RevenueLeakageSummary = {
    classes: emptyClassBuckets(),
    totalAlerts: 0,
  };
  for (const alert of alerts) {
    if (alert.classes.length === 0) continue;
    summary.totalAlerts += 1;
    for (const cls of alert.classes) {
      summary.classes[cls].count += 1;
      summary.classes[cls].totalCents += alert.amountCents;
    }
  }
  return summary;
}

export interface BuildRevenueLeakageInput {
  organizationId: string;
  scope: Parameters<typeof buildUnitScopeCondition>[1];
  now?: Date;
}

export interface RevenueLeakageEnvelope {
  summary: RevenueLeakageSummary;
  alerts: RevenueLeakageAlertItem[];
}

const MAX_ROWS = 500;

export async function buildRevenueLeakage(
  input: BuildRevenueLeakageInput,
): Promise<RevenueLeakageEnvelope> {
  const now = input.now ?? new Date();

  const orders = await db
    .select({
      id: serviceOrder.id,
      publicId: serviceOrder.publicId,
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
      deliveredAt: serviceOrder.deliveredAt,
      readyAt: serviceOrder.readyAt,
      updatedAt: serviceOrder.updatedAt,
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
    return { summary: summarizeRevenueLeakage([]), alerts: [] };
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

  const docRows = billingDocumentIds.length
    ? await db
        .select({
          id: billingDocument.id,
          status: billingDocument.status,
          exportStatus: billingDocument.exportStatus,
          issueDate: billingDocument.issueDate,
          updatedAt: billingDocument.updatedAt,
        })
        .from(billingDocument)
        .where(
          and(
            eq(billingDocument.organizationId, input.organizationId),
            inArray(billingDocument.id, billingDocumentIds),
          ),
        )
    : [];

  const docInfoMap = new Map<
    number,
    {
      status: BillingDocumentStatus;
      exportStatus: BillingDocumentExportStatus;
      issueDate: Date | null;
      updatedAt: Date | null;
    }
  >();
  for (const row of docRows) {
    docInfoMap.set(row.id, {
      status: row.status,
      exportStatus: row.exportStatus,
      issueDate: row.issueDate,
      updatedAt: row.updatedAt,
    });
  }

  const installmentRows = billingDocumentIds.length
    ? await db
        .select({
          documentId: receivableInstallment.documentId,
          status: receivableInstallment.status,
          dueDate: receivableInstallment.dueDate,
        })
        .from(receivableInstallment)
        .where(inArray(receivableInstallment.documentId, billingDocumentIds))
    : [];

  const installmentsByDoc = new Map<
    number,
    Array<{ status: ReceivableInstallmentStatus; dueDate: Date }>
  >();
  for (const row of installmentRows) {
    const list = installmentsByDoc.get(row.documentId) ?? [];
    list.push({ status: row.status, dueDate: row.dueDate });
    installmentsByDoc.set(row.documentId, list);
  }

  const alerts: RevenueLeakageAlertItem[] = [];

  for (const order of billable) {
    const orderLinks = linksByOrder.get(order.id) ?? [];
    const existingDoc = resolvedDocumentLinks.get(order.id) ?? null;
    const docInfo = existingDoc
      ? (docInfoMap.get(existingDoc.documentId) ?? null)
      : null;
    const installments = existingDoc
      ? (installmentsByDoc.get(existingDoc.documentId) ?? [])
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
      installmentStatuses: installments.map((i) => i.status),
      blockers,
    });

    const firstOverdue = installments
      .filter((i) => i.status === "OVERDUE")
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

    const classes = evaluateRevenueLeakage(
      {
        stage: classification.stage,
        isOverdue: classification.isOverdue,
        isBlocked: classification.isBlocked,
        completedAt: order.deliveredAt ?? order.readyAt ?? null,
        sentAt: docInfo?.updatedAt ?? null,
        issuedAt: docInfo?.issueDate ?? null,
        firstOverdueInstallmentDueDate: firstOverdue?.dueDate ?? null,
        lastStatusChangedAt: order.updatedAt ?? null,
      },
      now,
    );

    if (classes.length === 0) continue;

    // Age signal: pick the most relevant timestamp for the displayed
    // "há N dias" badge — overdue rules > completed > generic update.
    const ageAnchor =
      (classes.includes("LONG_OVERDUE")
        ? firstOverdue?.dueDate
        : classes.includes("STUCK_INVOICED")
          ? docInfo?.issueDate
          : classes.includes("STUCK_SENT_TO_FINANCE")
            ? docInfo?.updatedAt
            : (order.deliveredAt ?? order.readyAt ?? null)) ?? null;
    const ageInDays = ageAnchor ? daysBetween(now, ageAnchor) : null;

    alerts.push({
      serviceOrderId: order.id,
      serviceOrderPublicId: order.publicId,
      serviceOrderNumber: order.number,
      customer: { id: order.customerId, name: order.customerName },
      unit: { id: order.unitId, name: order.unitName },
      amountCents,
      currency: "BRL",
      classes,
      ageInDays,
    });
  }

  return {
    summary: summarizeRevenueLeakage(alerts),
    alerts,
  };
}
